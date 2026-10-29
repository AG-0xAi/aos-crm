#!/usr/bin/env node
// CRM-005 (R3): metadata-only network capture around a covered flow.
//
//   node scripts/aos/capture-traffic.mjs --label crud -- node --test scripts/aos/test/crm-api-authz-e2e.test.mjs
//   node scripts/aos/capture-traffic.mjs --self-test     (no WSL, no tcpdump)
//
// WHAT IT CAPTURES. tcpdump inside the WSL distro that runs the stack, on every
// interface, with a filter that keeps (1) all DNS and (2) any packet with a
// PUBLIC address on either side. Snaplen 128 bytes and tcpdump's own text
// output: there is no pcap file, no -A/-X, no HAR -- so what lands on disk is
// timestamps, addresses, ports, TCP flags and DNS question names, and never a
// request body, an Authorization header or a cookie. The server, the worker and
// the browser container all live in this distro's network namespace, so one
// capture covers the three of them.
//
// WHAT IT CANNOT SEE, stated here because the summary is evidence: traffic from
// a browser running on the WINDOWS side (the founder's own browser) does not
// cross this namespace; TLS contents are never decrypted, so a destination is
// classified by name and port, not by what was sent; and a capture proves what
// happened inside ITS OWN WINDOW, never the absence of traffic outside it.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const RUN_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

// Private/loopback space on both sides, plus DNS on any address: what is left
// is every packet that actually leaves this machine's own networks, which is
// the only thing this capture is for.
const PRIVATE_NETS = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'];
export function captureFilter() {
  const srcPublic = `not (${PRIVATE_NETS.map((n) => `src net ${n}`).join(' or ')})`;
  const dstPublic = `not (${PRIVATE_NETS.map((n) => `dst net ${n}`).join(' or ')})`;
  return `port 53 or (ip and (${srcPublic} or ${dstPublic}))`;
}

const SNAPLEN = 128;

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

// One line of tcpdump output -> what it tells us, or null. Exported so the
// self-test can drive it with measured fixtures instead of a live capture.
export function parseLine(line) {
  const timestamp = (line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/) || [])[1] ?? null;
  const dns = line.match(/\s(A|AAAA|HTTPS|CNAME|TXT|MX|SRV)\?\s+([A-Za-z0-9._-]+)\./);
  if (dns) {
    return { kind: 'dns', timestamp, name: dns[2].toLowerCase(), question: dns[1] };
  }
  // "IP 10.0.0.1.52014 > 140.82.121.4.443: Flags [S], ..." -- the address and
  // port are the last dotted group of each side.
  const flow = line.match(/\sIP6?\s+([0-9a-fA-F.:]+)\.(\d+|\w[\w-]*)\s+>\s+([0-9a-fA-F.:]+)\.(\d+|\w[\w-]*):/);
  if (flow) {
    return {
      kind: 'flow',
      timestamp,
      src: flow[1],
      srcPort: flow[2],
      dst: flow[3],
      dstPort: flow[4],
    };
  }
  return null;
}

function isPrivateAddress(address) {
  if (address.startsWith('127.') || address.startsWith('10.')) return true;
  if (address.startsWith('192.168.')) return true;
  if (address.startsWith('169.254.')) return true;
  const second = Number(address.split('.')[1]);
  if (address.startsWith('172.') && second >= 16 && second <= 31) return true;
  return false;
}

// The whole summary, computed from parsed lines so the self-test can check it
// without tcpdump: outbound destinations (address + port, packet count, first
// and last time seen) and the DNS question names observed.
export function summarize(lines) {
  const destinations = new Map();
  const dnsNames = new Map();
  let parsed = 0;
  for (const line of lines) {
    const event = parseLine(line);
    if (!event) continue;
    parsed += 1;
    if (event.kind === 'dns') {
      const seen = dnsNames.get(event.name) ?? { name: event.name, questions: new Set(), count: 0 };
      seen.questions.add(event.question);
      seen.count += 1;
      dnsNames.set(event.name, seen);
      continue;
    }
    // Only the OUTBOUND half is a destination: an inbound packet from a public
    // address is the same conversation seen from the other side.
    const outbound = !isPrivateAddress(event.dst);
    const key = outbound ? `${event.dst}:${event.dstPort}` : `${event.src}:${event.srcPort}`;
    const record = destinations.get(key) ?? {
      address: outbound ? event.dst : event.src,
      port: outbound ? event.dstPort : event.srcPort,
      packets: 0,
      firstSeen: event.timestamp,
      lastSeen: event.timestamp,
      direction: outbound ? 'outbound' : 'inbound',
    };
    record.packets += 1;
    record.lastSeen = event.timestamp ?? record.lastSeen;
    if (!outbound) record.direction = 'inbound';
    destinations.set(key, record);
  }
  return {
    parsedEvents: parsed,
    totalLines: lines.length,
    destinations: [...destinations.values()].sort((a, b) => b.packets - a.packets),
    dnsNames: [...dnsNames.values()]
      .map((d) => ({ name: d.name, questions: [...d.questions].sort(), count: d.count }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function report(label, summary, flowExit) {
  console.log(`\n=== AOS-CRM traffic capture: ${label} ===`);
  console.log(`flow exit code: ${flowExit ?? 'unmeasured'}`);
  console.log(`tcpdump lines: ${summary.totalLines} (parsed events: ${summary.parsedEvents})`);
  console.log('\n-- external destinations (address, port, packets, first seen, last seen) --');
  if (summary.destinations.length === 0) {
    console.log('(none in this window)');
  }
  for (const d of summary.destinations) {
    console.log(`${d.direction}\t${d.address}\t${d.port}\t${d.packets}\t${d.firstSeen ?? '?'}\t${d.lastSeen ?? '?'}`);
  }
  console.log('\n-- DNS question names --');
  if (summary.dnsNames.length === 0) {
    console.log('(none in this window)');
  }
  for (const d of summary.dnsNames) {
    console.log(`${d.name}\t${d.questions.join(',')}\t${d.count}`);
  }
  console.log('\nLIMITS: this window only; no payloads, headers or cookies were captured (snaplen 128, no pcap); a Windows-side browser is outside this namespace; TLS was not decrypted.');
}

async function run() {
  const args = process.argv.slice(2);
  const labelIndex = args.indexOf('--label');
  const label = labelIndex === -1 ? `capture-${RUN_ID}` : args[labelIndex + 1];
  const separator = args.indexOf('--');
  if (separator === -1 || separator === args.length - 1) {
    console.error('[FAIL] nothing to capture: pass the flow after --, e.g. --label crud -- node --test path/to.test.mjs');
    process.exit(2);
  }
  const flow = args.slice(separator + 1);

  const reachable = wsl(['true']);
  if (reachable.status !== 0) {
    console.error(`[FAIL] could not reach WSL distro '${DISTRO}' (status ${reachable.status})`);
    process.exit(1);
  }
  if (wsl(['sh', '-c', 'command -v tcpdump']).status !== 0) {
    console.error(`[FAIL] tcpdump is not installed in '${DISTRO}'; nothing was captured`);
    process.exit(1);
  }

  const outPath = `/tmp/aos-crm-capture-${RUN_ID}.txt`;
  // -l line buffered, -n no name resolution (a capture that resolves names
  // would itself generate DNS), -tttt absolute timestamps, -s 128 headers only,
  // no -w so no pcap of payloads is ever written.
  const tcpdump = spawn('wsl.exe', ['-d', DISTRO, '--exec', 'sh', '-c',
    `tcpdump -i any -n -l -tttt -s ${SNAPLEN} ${JSON.stringify(captureFilter())} > ${outPath} 2>/tmp/aos-crm-capture-${RUN_ID}.err & echo $! > /tmp/aos-crm-capture-${RUN_ID}.pid; wait`,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  // tcpdump needs a moment to attach to the interfaces; starting the flow
  // first would measure a window that began after it.
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`[INFO] capturing into ${outPath} inside ${DISTRO} (filter: ${captureFilter()})`);

  const started = Date.now();
  const flowRun = spawnSync(flow[0], flow.slice(1), {
    cwd: REPO_ROOT, stdio: 'inherit', shell: false, timeout: 3_600_000,
  });
  console.log(`[INFO] flow finished in ${Math.round((Date.now() - started) / 1000)} s with exit ${flowRun.status}`);

  // Let the last packets land, then stop the capture by the pid IT wrote --
  // never a sweep over process names, which would take out another session's
  // capture (and is what this host's own kill guard forbids).
  await new Promise((r) => setTimeout(r, 3000));
  wsl(['sh', '-c', `kill "$(cat /tmp/aos-crm-capture-${RUN_ID}.pid)" 2>/dev/null; sleep 1; true`]);
  tcpdump.kill();

  const read = wsl(['cat', outPath]);
  if (read.status !== 0) {
    console.error(`[FAIL] the capture file could not be read (status ${read.status}); no summary can be trusted`);
    process.exit(1);
  }
  const stderr = wsl(['cat', `/tmp/aos-crm-capture-${RUN_ID}.err`]).stdout ?? '';
  if (/permission denied|not permitted/i.test(stderr)) {
    console.error(`[FAIL] tcpdump could not capture: ${stderr.trim().slice(0, 200)}`);
    process.exit(1);
  }
  const lines = read.stdout.split('\n').filter((l) => l.trim() !== '');
  report(label, summarize(lines), flowRun.status);
  // The raw capture is left in the distro's /tmp for the length of the session
  // and named after this run; nothing else is deleted by pattern.
  console.log(`\nraw capture: ${outPath} (inside ${DISTRO}); tcpdump stderr: ${stderr.trim().slice(0, 200) || 'empty'}`);
  process.exit(flowRun.status === 0 ? 0 : 1);
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  // Measured tcpdump output shapes from this host, 2026-10-29.
  const DNS_LINE = '2026-10-29 14:31:02.123456 eth0  Out IP 172.25.0.2.42817 > 10.255.255.254.53: 12345+ A? twenty-icons.com. (34)';
  const TCP_OUT = '2026-10-29 14:31:02.223456 eth0  Out IP 172.25.0.2.52014 > 140.82.121.4.443: Flags [S], seq 1, win 64240, length 0';
  const TCP_IN = '2026-10-29 14:31:02.323456 eth0  In  IP 140.82.121.4.443 > 172.25.0.2.52014: Flags [S.], seq 2, ack 2, win 65535, length 0';
  const INTERNAL = '2026-10-29 14:31:02.423456 br-abc  Out IP 172.18.0.3.5432 > 172.18.0.4.41234: Flags [P.], seq 1:2, length 1';

  record('a DNS question is read as a name, not as content', () => {
    const event = parseLine(DNS_LINE);
    assert(event?.kind === 'dns', `expected a dns event, got ${JSON.stringify(event)}`);
    assert(event.name === 'twenty-icons.com', `expected the question name, got ${event.name}`);
  });
  record('an outbound flow is read as a destination with its port and time', () => {
    const event = parseLine(TCP_OUT);
    assert(event?.kind === 'flow', `expected a flow event, got ${JSON.stringify(event)}`);
    assert(event.dst === '140.82.121.4' && event.dstPort === '443', `wrong destination: ${JSON.stringify(event)}`);
    assert(event.timestamp === '2026-10-29 14:31:02', `wrong timestamp: ${event.timestamp}`);
  });
  record('the summary counts one destination for both directions of one conversation', () => {
    const summary = summarize([TCP_OUT, TCP_IN, TCP_OUT]);
    assert(summary.destinations.length === 1, `expected 1 destination, got ${summary.destinations.length}`);
    assert(summary.destinations[0].address === '140.82.121.4', `wrong address: ${summary.destinations[0].address}`);
    assert(summary.destinations[0].packets === 3, `expected 3 packets, got ${summary.destinations[0].packets}`);
  });
  record('a private-to-private flow that slipped through the filter is not reported as a destination', () => {
    const summary = summarize([INTERNAL]);
    assert(summary.destinations.length === 1 && summary.destinations[0].direction === 'inbound',
      'an internal flow was reported as an outbound destination');
  });
  record('an empty capture summarizes as none, never as "no telemetry"', () => {
    const summary = summarize([]);
    assert(summary.destinations.length === 0 && summary.dnsNames.length === 0, 'an empty capture produced findings');
    assert(summary.totalLines === 0 && summary.parsedEvents === 0, 'an empty capture produced events');
  });
  record('the filter keeps DNS and every packet with a public address, and nothing else', () => {
    const filter = captureFilter();
    assert(filter.startsWith('port 53 or '), `DNS is no longer captured: ${filter}`);
    for (const net of PRIVATE_NETS) {
      assert(filter.includes(`src net ${net}`) && filter.includes(`dst net ${net}`), `${net} is no longer excluded on both sides`);
    }
  });
  record('nothing in this command can write a payload capture', () => {
    // The production half only: the assertions below name the flags they
    // forbid, and a whole-file match would match itself.
    const source = readSelf().split('function selfTest()')[0];
    assert(!/tcpdump[^\n]*\s-w\s/.test(source), 'tcpdump is invoked with -w: that writes a pcap with payloads');
    assert(!/tcpdump[^\n]*\s-(A|X|XX)\b/.test(source), 'tcpdump is invoked with a payload-printing flag');
    assert(/-s \$\{SNAPLEN\}/.test(source) && SNAPLEN <= 256, `the snaplen is no longer header-sized: ${SNAPLEN}`);
    assert(!/pkill|killall/.test(source), 'the capture is stopped by pattern, which would kill another session\'s tcpdump');
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

function readSelf() {
  // eslint-disable-next-line no-sync
  return spawnSync('node', ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))',
    fileURLToPath(import.meta.url)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout ?? '';
}

if (process.argv.includes('--self-test')) selfTest();
else run();
