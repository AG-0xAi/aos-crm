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

  const hasImage = wsl(['docker', 'image', 'inspect', DEPS_IMAGE]);
  if (hasImage.status !== 0) {
    console.log(`[INFO] ${DEPS_IMAGE} not present; building it from the official Dockerfile (first run only, several minutes)`);
    const build = wsl(['docker', 'build', '--target', 'server-deps',
      '-f', `${root}/packages/twenty-docker/twenty/Dockerfile`,
      '-t', DEPS_IMAGE, root], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (build.status !== 0) fail(`docker build --target server-deps exited ${build.status}`);
  }

  // Copied into the container rather than run from the read-only mount: jest
  // and the workspace builds write next to the sources, and the checkout must
  // come back untouched.
  const script = [
    'set -e',
    'cp -r /src/packages/twenty-emails /src/packages/twenty-shared /src/packages/twenty-client-sdk /src/packages/twenty-server /app/packages/',
    'cd /app',
    'export NX_DAEMON=false NX_NO_CLOUD=true',
    'npx nx run-many -t build -p twenty-shared twenty-client-sdk twenty-emails --skip-nx-cache >/tmp/build.log 2>&1',
    'cd /app/packages/twenty-server',
    `npx jest --config jest.config.mjs --runInBand ${SPECS.join(' ')}`,
  ].join('\n');

  const res = wsl(['docker', 'run', '--rm', '--network', 'none',
    '-v', `${root}:/src:ro`, DEPS_IMAGE, 'sh', '-c', script]);
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  if (res.status !== 0) {
    console.error(output.split('\n').slice(-25).join('\n'));
    fail(`the privacy specs container exited ${res.status}`);
  }
  const verdict = parseJestSummary(output);
  if (!verdict.ok) fail(`privacy specs: ${verdict.detail}`);

  console.log(`[PASS] CRM-003 privacy specs executed against the real classes: ${verdict.detail}`);
  console.log('Scope: TelemetryService.publish() with an HTTP spy and TwentyConfigService ENV-vs-DB precedence, run in the server-deps image with no network. This does NOT start the CRM, build its image, or observe runtime traffic.');
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

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
