#!/usr/bin/env node
// CRM-004: runs the two CRM-003 privacy specs for real.
//
// CRM-003 could only deliver a STATIC privacy gate: it reads config files and
// greps pinned source, and it says so. The two specs that exercise the real
// classes -- TelemetryService.publish() with an HTTP spy, and
// TwentyConfigService's ENV-vs-DB precedence -- existed but had never run,
// because the monorepo's dependencies were not installed. They are installed
// now, inside the image the official Dockerfile's `server-deps` stage builds,
// so this wrapper runs them there on every gate.
//
// Fail-closed throughout: if WSL, Docker, the image build or the container
// run cannot be measured, this exits non-zero. It never degrades to "skipped".
//
//   node scripts/aos/verify-server-specs.mjs
//   node scripts/aos/verify-server-specs.mjs --self-test   (no WSL, no Docker)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const DEPS_IMAGE = 'aos-crm-local/server-deps:gate';
const SPECS = [
  'src/engine/core-modules/telemetry/__tests__/telemetry.service.spec.ts',
  'src/engine/core-modules/twenty-config/__tests__/twenty-config.service.spec.ts',
];
const EXPECTED_SUITES = SPECS.length;

// Exactly what the official Dockerfile's `server-deps` stage COPYs, plus the
// Dockerfile itself. The stage is rebuilt on EVERY run from a tar context
// holding only these paths: "the tag already exists" is not evidence that the
// dependencies behind it match today's lockfile, and a gate that trusts a
// stale tag can report PASS against dependencies nobody installed. Keeping the
// context this small is what makes always-rebuilding affordable -- the full
// checkout crosses drvfs at ~200 MB per build, these are a few hundred KB --
// and it also keeps the bus, deploy/local/.env and .git out of the daemon.
export const DEPS_CONTEXT_PATHS = [
  'package.json',
  'yarn.lock',
  '.yarnrc.yml',
  'tsconfig.base.json',
  'nx.json',
  '.yarn/releases',
  '.yarn/patches',
  'packages/twenty-docker/twenty/Dockerfile',
  'packages/twenty-emails/package.json',
  'packages/twenty-server/package.json',
  'packages/twenty-server/patches',
  'packages/twenty-shared/package.json',
  'packages/twenty-client-sdk/package.json',
  'packages/twenty-oxlint-rules/package.json',
];

// The specs need these four workspaces and nothing else. Mounted one by one,
// read-only, instead of the whole checkout: a container that can read
// deploy/local/.env, .aos/ or .git does not need to for this measurement.
export const SPEC_SOURCE_PACKAGES = [
  'twenty-emails',
  'twenty-shared',
  'twenty-client-sdk',
  'twenty-server',
];

// Jest's own summary is the only thing we trust for a verdict. "exit 0" is not
// enough: a config that matched zero files also exits 0, and that would be a
// green gate measuring nothing.
export function parseJestSummary(output) {
  const suites = output.match(/^Test Suites:.*?(\d+) passed, (\d+) total$/m);
  const tests = output.match(/^Tests:.*?(\d+) passed, (\d+) total$/m);
  if (!suites || !tests) return { ok: false, detail: 'no Test Suites/Tests summary in jest output' };
  const [, suitesPassed, suitesTotal] = suites.map(Number);
  const [, testsPassed, testsTotal] = tests.map(Number);
  if (suitesTotal < EXPECTED_SUITES) {
    return { ok: false, detail: `expected at least ${EXPECTED_SUITES} suites, jest ran ${suitesTotal}` };
  }
  if (testsTotal === 0) return { ok: false, detail: 'jest ran 0 tests' };
  if (suitesPassed !== suitesTotal || testsPassed !== testsTotal) {
    return { ok: false, detail: `${suitesPassed}/${suitesTotal} suites and ${testsPassed}/${testsTotal} tests passed` };
  }
  return { ok: true, detail: `${suitesPassed}/${suitesTotal} suites, ${testsPassed}/${testsTotal} tests passed` };
}

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function run() {
  const linuxRoot = wsl(['wslpath', '-a', REPO_ROOT]);
  if (linuxRoot.status !== 0 || !linuxRoot.stdout.trim()) {
    fail(`could not reach WSL distro '${DISTRO}' to translate the repo path (status=${linuxRoot.status})`);
  }
  const root = linuxRoot.stdout.trim();

  for (const relative of DEPS_CONTEXT_PATHS) {
    const probe = wsl(['test', '-e', `${root}/${relative}`]);
    if (probe.status !== 0) fail(`server-deps build input is missing from the checkout: ${relative}`);
  }
  console.log('[INFO] rebuilding the server-deps stage from the official Dockerfile (Docker layer cache makes this seconds once warm)');
  const buildCommand =
    `cd ${JSON.stringify(root)} && tar -cf - ${DEPS_CONTEXT_PATHS.map((p) => JSON.stringify(p)).join(' ')} | ` +
    `docker build --target server-deps -f packages/twenty-docker/twenty/Dockerfile -t ${DEPS_IMAGE} -`;
  const build = wsl(['sh', '-c', buildCommand], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (build.status !== 0) fail(`docker build --target server-deps exited ${build.status}`);

  // Copied into the container rather than run from the read-only mounts: jest
  // and the workspace builds write next to the sources, and the checkout must
  // come back untouched.
  const script = [
    'set -e',
    `cp -r ${SPEC_SOURCE_PACKAGES.map((p) => `/src/${p}`).join(' ')} /app/packages/`,
    'cd /app',
    'export NX_DAEMON=false NX_NO_CLOUD=true',
    // The build log stays in the container so jest's summary is the only thing
    // on stdout, but a FAILING build must not be silent: without this, `set -e`
    // aborts with an empty stdout and the gate can only say "the container
    // exited 1", which is what happened on 2026-10-28 and left nothing to read.
    'if ! npx nx run-many -t build -p twenty-shared twenty-client-sdk twenty-emails --skip-nx-cache >/tmp/build.log 2>&1; then',
    '  echo "AOS_DEPS_BUILD_FAILED"; tail -n 40 /tmp/build.log; exit 11',
    'fi',
    'cd /app/packages/twenty-server',
    `npx jest --config jest.config.mjs --runInBand ${SPECS.join(' ')}`,
  ].join('\n');

  const mounts = SPEC_SOURCE_PACKAGES.flatMap((p) => ['-v', `${root}/packages/${p}:/src/${p}:ro`]);
  const res = wsl(['docker', 'run', '--rm', '--network', 'none',
    ...mounts, DEPS_IMAGE, 'sh', '-c', script]);
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  if (res.status !== 0) {
    const tail = output.split('\n').filter((l) => l.trim()).slice(-25);
    console.error(tail.length ? tail.join('\n') : '(the container produced no output at all)');
    if (res.error) console.error(`spawn error: ${res.error.code || res.error.message}`);
    fail(`the privacy specs container exited ${res.status}`);
  }
  const verdict = parseJestSummary(output);
  if (!verdict.ok) fail(`privacy specs: ${verdict.detail}`);

  console.log(`[PASS] CRM-003 privacy specs executed against the real classes: ${verdict.detail}`);
  console.log('Scope: TelemetryService.publish() with an HTTP spy and TwentyConfigService ENV-vs-DB precedence, run with no network in a server-deps image rebuilt from this run\'s lockfile. This does NOT start the CRM or observe runtime traffic.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  record('parseJestSummary: a clean two-suite run passes', () => {
    const r = parseJestSummary('Test Suites: 2 passed, 2 total\nTests:       4 passed, 4 total\n');
    assert(r.ok, r.detail);
  });
  record('parseJestSummary: a failing suite is rejected', () => {
    const r = parseJestSummary('Test Suites: 1 failed, 1 passed, 2 total\nTests:       1 failed, 3 passed, 4 total\n');
    assert(!r.ok, 'expected a failing suite to be rejected');
  });
  record('parseJestSummary: a run that matched no spec file is rejected, not read as green', () => {
    const r = parseJestSummary('Test Suites: 0 total\nTests:       0 total\n');
    assert(!r.ok, 'expected zero suites to be rejected');
  });
  record('parseJestSummary: fewer suites than expected is rejected even if all passed', () => {
    const r = parseJestSummary('Test Suites: 1 passed, 1 total\nTests:       2 passed, 2 total\n');
    assert(!r.ok, 'expected a short run to be rejected');
  });
  record('parseJestSummary: output with no summary at all is rejected', () => {
    assert(!parseJestSummary('some unrelated output').ok, 'expected missing summary to be rejected');
  });
  record('the spec paths this gate claims to run exist in the checkout', () => {
    for (const spec of SPECS) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])',
        resolve(REPO_ROOT, 'packages', 'twenty-server', spec)]);
    }
  });
  record('every server-deps build input exists in the checkout, so the stage is rebuilt from a complete context', () => {
    for (const relative of DEPS_CONTEXT_PATHS) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, relative)]);
    }
  });
  record('the build context declares every path the server-deps stage COPYs (a missing one would install from a partial context)', () => {
    const dockerfile = readFileSync(resolve(REPO_ROOT, 'packages/twenty-docker/twenty/Dockerfile'), 'utf8');
    const stage = dockerfile.split(/^FROM .* AS server-deps$/m)[1].split(/^FROM /m)[0];
    const copied = [...stage.matchAll(/^COPY\s+(.+?)\s+\/app/gm)]
      .flatMap((m) => m[1].trim().split(/\s+/))
      .map((p) => p.replace(/^\.\//, ''));
    assert(copied.length > 0, 'parsed no COPY source out of the server-deps stage');
    const missing = copied.filter((p) => !DEPS_CONTEXT_PATHS.includes(p));
    assert(missing.length === 0, `the stage COPYs path(s) absent from DEPS_CONTEXT_PATHS: ${missing.join(', ')}`);
  });
  record('the container mounts only the four workspaces the specs need, never the checkout root', () => {
    assert(SPEC_SOURCE_PACKAGES.length === 4, `expected 4 spec source packages, got ${SPEC_SOURCE_PACKAGES.length}`);
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(!/-v['"\s,]+\$\{root\}:/.test(source), 'the whole checkout is mounted into the container again');
    for (const pkg of SPEC_SOURCE_PACKAGES) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, 'packages', pkg)]);
    }
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
