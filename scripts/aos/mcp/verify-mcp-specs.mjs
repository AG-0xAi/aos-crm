#!/usr/bin/env node
// CRM-007: runs the MCP layer's own jest specs for real.
//
// The R3 guard -- "search_help_center and every other tool whose destination is
// outside this deployment is not offered over MCP" -- is asserted twice: at
// runtime by scripts/aos/test/crm-mcp-e2e.test.mjs against the running stack,
// and statically by the specs under
// packages/twenty-server/src/engine/api/mcp/**/__tests__/. This wrapper exists
// because scripts/aos/verify-server-specs.mjs runs a FIXED two-spec list (it
// self-tests that the list is exactly the two CRM-003 privacy specs), so the
// MCP specs would otherwise never be executed by anything.
//
// It deliberately reuses that gate's image tags, Dockerfiles and build
// commands, so the two commands share one BuildKit layer cache and the second
// one is a cache hit: the cost here is the deps rebuild plus jest.
//
// Fail-closed throughout: if WSL, Docker, either build or the container run
// cannot be measured, this exits non-zero. It never degrades to "skipped".
//
//   node scripts/aos/mcp/verify-mcp-specs.mjs
//   node scripts/aos/mcp/verify-mcp-specs.mjs --self-test   (no WSL, no Docker)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const DEPS_IMAGE = 'aos-crm-local/server-deps:gate';
const SOURCES_IMAGE = 'aos-crm-local/server-specs:gate';
const SOURCES_DOCKERFILE = 'scripts/aos/server-specs-sources.Dockerfile';
const SOURCE_TAR = '/tmp/aos-crm-mcp-specs-sources.tar';
const NO_ATTESTATION = '--provenance=false';
const CONTAINER_NAME = `aos-crm-mcp-specs-gate-${process.pid}`;

// jest is pointed at the MCP API directory, not at a hand-maintained file
// list: a spec added under it is then run by this gate without anybody
// remembering to come back here.
const SPEC_PATH = 'src/engine/api/mcp';
// The two suites R3 depends on. Counting them is what stops a pattern that
// matched nothing, or a renamed directory, from reading as green.
export const REQUIRED_SPEC_FILES = [
  'packages/twenty-server/src/engine/api/mcp/constants/__tests__/mcp-excluded-tool-names.constant.spec.ts',
  'packages/twenty-server/src/engine/api/mcp/utils/__tests__/get-mcp-preload-tool-names.util.spec.ts',
];
export const MIN_SUITES = 11;

// Same context definitions as scripts/aos/verify-server-specs.mjs, which owns
// the canonical copy and the reasons for each path. They are repeated rather
// than imported because that module runs its own gate on import.
const DEPS_CONTEXT_PATHS = [
  'package.json', 'yarn.lock', '.yarnrc.yml', 'tsconfig.base.json', 'nx.json',
  '.yarn/releases', '.yarn/patches',
  'packages/twenty-docker/twenty/Dockerfile',
  'packages/twenty-emails/package.json',
  'packages/twenty-server/package.json',
  'packages/twenty-server/patches',
  'packages/twenty-shared/package.json',
  'packages/twenty-client-sdk/package.json',
  'packages/twenty-oxlint-rules/package.json',
];
const SPEC_SOURCE_PACKAGES = ['twenty-emails', 'twenty-shared', 'twenty-client-sdk', 'twenty-server'];

// Measured on this host 2026-10-29: 229 s with the sources layer rebuilt by
// this commit's MCP changes (the workspace build inside it 70 s, the image
// export 15 s, jest 11 s for 11 suites) against a warm cache where every build
// step comes back CACHED and the cost is jest alone. The deadlines are those
// numbers with room for a cold cache, and their sum stays under the gate
// budget so the teardown below runs here instead of after the harness has
// already killed the process.
const DEPS_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_MCP_SPECS_DEPS_TIMEOUT_MS || 420_000);
const SOURCES_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_MCP_SPECS_SOURCES_TIMEOUT_MS || 420_000);
const RUN_TIMEOUT_MS = Number(process.env.AOS_CRM_MCP_SPECS_RUN_TIMEOUT_MS || 300_000);

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

// Only ever the container THIS process named: the app, db, Redis and worker
// containers share this daemon, so nothing here matches by image or pattern.
function removeOwnContainer() {
  if (wsl(['docker', 'inspect', '--format', '{{.Id}}', CONTAINER_NAME]).status !== 0) return;
  const removed = wsl(['docker', 'rm', '-f', CONTAINER_NAME]);
  console.error(`[INFO] removed this run's own specs container ${CONTAINER_NAME} (${removed.status === 0 ? 'ok' : `docker rm exited ${removed.status}`})`);
}

// jest's own summary is the verdict, never the exit code alone: a pattern that
// matched zero files also exits 0.
export function judgeMcpSpecsRun({ containerStatus, output = '' }) {
  const suites = output.match(/^Test Suites:.*?(\d+) passed, (\d+) total$/m);
  const tests = output.match(/^Tests:.*?(\d+) passed, (\d+) total$/m);
  if (!suites || !tests) return { ok: false, detail: 'no Test Suites/Tests summary in jest output' };
  const [, suitesPassed, suitesTotal] = suites.map(Number);
  const [, testsPassed, testsTotal] = tests.map(Number);
  if (suitesTotal < MIN_SUITES) return { ok: false, detail: `expected at least ${MIN_SUITES} MCP suites, jest ran ${suitesTotal}` };
  if (testsTotal === 0) return { ok: false, detail: 'jest ran 0 tests' };
  if (suitesPassed !== suitesTotal || testsPassed !== testsTotal) {
    return { ok: false, detail: `${suitesPassed}/${suitesTotal} suites and ${testsPassed}/${testsTotal} tests passed` };
  }
  if (containerStatus !== 0) return { ok: false, detail: `jest reported all green but the container exited ${containerStatus ?? 'unmeasured'}` };
  return { ok: true, detail: `${suitesPassed}/${suitesTotal} suites, ${testsPassed}/${testsTotal} tests passed` };
}

function git(args) {
  const res = spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) fail(`git ${args.join(' ')} exited ${res.status}`);
  return res.stdout;
}

function run() {
  const linuxRoot = wsl(['wslpath', '-a', REPO_ROOT]);
  if (linuxRoot.status !== 0 || !linuxRoot.stdout.trim()) {
    fail(`could not reach WSL distro '${DISTRO}' to translate the repo path (status=${linuxRoot.status})`);
  }
  const root = linuxRoot.stdout.trim();

  for (const relative of REQUIRED_SPEC_FILES) {
    if (wsl(['test', '-e', `${root}/${relative}`]).status !== 0) {
      fail(`the R3 guard spec is missing from the checkout: ${relative}`);
    }
  }

  // The source context is `git archive HEAD`. Running the specs against HEAD
  // while the working tree says something else would measure code nobody is
  // running, so an uncommitted change under these inputs fails closed.
  const trackedInputs = [...SPEC_SOURCE_PACKAGES.map((p) => `packages/${p}`), ...DEPS_CONTEXT_PATHS, SOURCES_DOCKERFILE];
  const dirty = git(['status', '--porcelain', '--', ...trackedInputs]).split('\n').filter((l) => l.trim() !== '');
  if (dirty.length > 0) {
    fail(`${dirty.length} uncommitted change(s) under the inputs this gate measures (${dirty.slice(0, 3).map((l) => l.trim().slice(0, 60)).join('; ')}). This gate runs the committed tree; commit or stash them first.`);
  }

  console.log('[INFO] rebuilding the server-deps stage from the official Dockerfile (shared layer cache with verify-server-specs.mjs)');
  const depsPaths = DEPS_CONTEXT_PATHS.map((p) => JSON.stringify(p)).join(' ');
  const depsBuild = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(root)}; tar -cf - ${depsPaths} | ` +
    `docker build ${NO_ATTESTATION} --target server-deps -f packages/twenty-docker/twenty/Dockerfile -t ${DEPS_IMAGE} -`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: DEPS_BUILD_TIMEOUT_MS });
  if (depsBuild.status !== 0) fail(`docker build --target server-deps exited ${depsBuild.status ?? 'unmeasured'}`);

  console.log('[INFO] building the source/dependency-build image from a clean git archive of HEAD');
  const archivePaths = SPEC_SOURCE_PACKAGES.map((p) => JSON.stringify(`packages/${p}`)).join(' ');
  const sourcesBuild = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(root)}; rm -f ${SOURCE_TAR}; ` +
    `git archive --format=tar -o ${SOURCE_TAR} HEAD -- ${archivePaths}; ` +
    `tar --append -f ${SOURCE_TAR} ${SOURCES_DOCKERFILE}; ` +
    `docker build ${NO_ATTESTATION} --build-arg DEPS_IMAGE=${DEPS_IMAGE} -f ${SOURCES_DOCKERFILE} -t ${SOURCES_IMAGE} - < ${SOURCE_TAR}; rm -f ${SOURCE_TAR}`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: SOURCES_BUILD_TIMEOUT_MS });
  if (sourcesBuild.status !== 0) {
    wsl(['rm', '-f', SOURCE_TAR]);
    fail(`docker build -f ${SOURCES_DOCKERFILE} exited ${sourcesBuild.status ?? 'unmeasured'}`);
  }

  console.log(`[INFO] running the MCP API specs (container ${CONTAINER_NAME}, no network)`);
  const res = wsl(['docker', 'run', '--rm', '--name', CONTAINER_NAME, '--network', 'none', SOURCES_IMAGE,
    'sh', '-c', `cd /app/packages/twenty-server && npx jest --config jest.config.mjs --runInBand ${SPEC_PATH}`,
  ], { timeout: RUN_TIMEOUT_MS });
  if (res.error?.code === 'ETIMEDOUT' || res.signal) {
    removeOwnContainer();
    fail(`the MCP specs container exceeded its ${RUN_TIMEOUT_MS} ms budget and was torn down; nothing was measured`);
  }
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const verdict = judgeMcpSpecsRun({ containerStatus: res.status, output });
  if (!verdict.ok) {
    removeOwnContainer();
    console.error(output.split('\n').filter((l) => l.trim()).slice(-30).join('\n') || '(the container produced no output at all)');
    if (res.error) console.error(`spawn error: ${res.error.code || res.error.message}`);
    fail(`MCP specs: ${verdict.detail}`);
  }

  console.log(`[PASS] MCP API specs executed against this commit's sources: ${verdict.detail}`);
  console.log('Scope: the MCP layer\'s unit specs, including the R3 guard that search_help_center and every other third-party-destination action tool stay in MCP_EXCLUDED_TOOL_NAMES and out of the preload list. This does NOT start the CRM and does NOT observe runtime traffic -- scripts/aos/test/crm-mcp-e2e.test.mjs does that.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const green = `Test Suites: ${MIN_SUITES} passed, ${MIN_SUITES} total\nTests:       30 passed, 30 total\n`;

  record('a clean run over the MCP spec directory passes', () => {
    const r = judgeMcpSpecsRun({ containerStatus: 0, output: green });
    assert(r.ok, r.detail);
  });
  record('a failing suite is rejected', () => {
    const r = judgeMcpSpecsRun({ containerStatus: 1, output: `Test Suites: 1 failed, ${MIN_SUITES - 1} passed, ${MIN_SUITES} total\nTests:       1 failed, 29 passed, 30 total\n` });
    assert(!r.ok, 'expected a failing suite to be rejected');
  });
  record('a run that matched no spec file is rejected, not read as green', () => {
    const r = judgeMcpSpecsRun({ containerStatus: 0, output: 'Test Suites: 0 total\nTests:       0 total\n' });
    assert(!r.ok, 'expected zero suites to be rejected');
  });
  record('fewer suites than the MCP directory holds is rejected even if all passed', () => {
    const r = judgeMcpSpecsRun({ containerStatus: 0, output: 'Test Suites: 2 passed, 2 total\nTests:       8 passed, 8 total\n' });
    assert(!r.ok, 'expected a shrunken suite count to be rejected');
  });
  record('an all-green summary with a non-zero container exit is rejected', () => {
    const r = judgeMcpSpecsRun({ containerStatus: 137, output: green });
    assert(!r.ok, 'expected a killed container to be rejected');
  });
  record('output with no jest summary at all is rejected', () => {
    assert(!judgeMcpSpecsRun({ containerStatus: 0, output: 'Cannot find module' }).ok, 'expected a missing summary to be rejected');
  });
  record('the two R3 guard specs are the ones this gate requires on disk', () => {
    for (const relative of REQUIRED_SPEC_FILES) {
      readFileSync(resolve(REPO_ROOT, relative), 'utf8');
    }
  });
  record('the R3 guard specs assert the exclusion, not just the shape', () => {
    const constant = readFileSync(resolve(REPO_ROOT, REQUIRED_SPEC_FILES[0]), 'utf8');
    assert(/third_party/.test(constant) && /ACTION_TOOL_IDS/.test(constant),
      'the exclusion spec no longer classifies every action tool by destination');
    const preload = readFileSync(resolve(REPO_ROOT, REQUIRED_SPEC_FILES[1]), 'utf8');
    assert(/search_help_center/.test(preload), 'the preload spec no longer names search_help_center');
  });
  record('the specs run in band with the project jest config and no network', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/npx jest --config jest\.config\.mjs --runInBand/.test(source), 'the specs are no longer run with the project jest config in band');
    assert(/'--network', 'none'/.test(source), 'the specs container is no longer isolated from the network');
  });
  record('the wrapper tears down only the container it named itself', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/--name', CONTAINER_NAME/.test(source), 'the specs container is no longer named by this run');
    assert(/docker', 'rm', '-f', CONTAINER_NAME/.test(source), 'cleanup no longer targets this run\'s own container by name');
    assert(!/\bdocker.*(prune|kill \$\(|rm -f \$\()/.test(source), 'cleanup matches containers by pattern instead of by name');
  });
  // The least-privilege probe's own offline self-test, run here because this is
  // the gate command that already covers the MCP probes without Docker: the
  // only other thing that exercises team-role.mjs is the e2e suite, which needs
  // the stack up, so an undeclared refusal would otherwise be caught by nothing.
  record('the least-privilege probe\'s offline self-test passes', () => {
    const probe = spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/aos/mcp/team-role.mjs'), '--self-test'],
      { encoding: 'utf8', timeout: 60_000 });
    assert(probe.status === 0,
      `node scripts/aos/mcp/team-role.mjs --self-test exited ${probe.status ?? probe.error?.code ?? 'unmeasured'}: ` +
      `${`${probe.stdout || ''}${probe.stderr || ''}`.split('\n').filter((l) => /FAIL/.test(l)).join(' | ').slice(0, 300)}`);
  });
  record('the two builds plus the run fit inside the gate budget this command is given', () => {
    const verify = JSON.parse(readFileSync(resolve(REPO_ROOT, '.aos/verify.json'), 'utf8'));
    const budget = verify.timeoutsMs['verify-mcp-specs.mjs'];
    assert(budget > 0, '.aos/verify.json declares no budget for this command');
    const worstCase = DEPS_BUILD_TIMEOUT_MS + SOURCES_BUILD_TIMEOUT_MS + RUN_TIMEOUT_MS;
    assert(worstCase < budget, `the worst case (${worstCase} ms) must stay under the gate budget (${budget} ms)`);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
