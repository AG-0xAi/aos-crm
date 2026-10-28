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
// CRM-004 fix3 changed only HOW the sources and the dependency build reach
// that container, not what is measured: the same two specs, the same official
// server-deps tree, still with no network. The previous shape mounted four
// workspaces read-only off the Windows drive and copied them in with `cp -r`
// on every run; on 2026-10-28 that copy outlived the command's entire 1200 s
// quota (exit 124, ~3 % CPU, ~14500 files per workspace set crossing drvfs)
// and its unnamed container survived the cut into the next gate. Both halves
// are fixed here: the sources arrive as a clean `git archive` layer cached by
// content (scripts/aos/server-specs-sources.Dockerfile), and the run container
// is named by this process, has its own deadline under the gate quota, and is
// the only thing this wrapper ever tears down.
//
// Fail-closed throughout: if WSL, Docker, either image build or the container
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
const SOURCES_IMAGE = 'aos-crm-local/server-specs:gate';
const SOURCE_TAR = '/tmp/aos-crm-server-specs-sources.tar';
const SPECS = [
  'src/engine/core-modules/telemetry/__tests__/telemetry.service.spec.ts',
  'src/engine/core-modules/twenty-config/__tests__/twenty-config.service.spec.ts',
];
const EXPECTED_SUITES = SPECS.length;

// Budgets, not "however long it takes": the harness gives this command
// 1200000 ms (.aos/verify.json). Exceeding it used to leave the specs
// container running into the NEXT gate (observed 2026-10-28,
// .aos/reports/CRM-004-fix2-coordinator-review.md), so the wrapper owns its
// own deadlines and tears down ONLY the container it named itself. Their sum
// stays under the gate quota, which is what makes the teardown happen here
// instead of after the harness has already killed the process.
// Measured on this host, 2026-10-28 (fix3), whole command 192 s cold: warm
// server-deps rebuild 22 s (a cold one re-installs the focus and took 353 s in
// fix1), cold source/dependency-build image 134 s of which 81 s is the
// workspace build (a warm one is a layer cache hit), jest 36 s. The budgets
// are those numbers with room for a cold cache, not round guesses.
const DEPS_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_SPECS_DEPS_TIMEOUT_MS || 420_000);
const SOURCES_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_SPECS_SOURCES_TIMEOUT_MS || 420_000);
const RUN_TIMEOUT_MS = Number(process.env.AOS_CRM_SPECS_RUN_TIMEOUT_MS || 300_000);
const CONTAINER_NAME = `aos-crm-server-specs-gate-${process.pid}`;

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

// The specs need these four workspaces and nothing else -- the same four the
// official `twenty-server-build` stage copies. They arrive as a git archive
// layer, so the container never reads deploy/local/.env, .aos/ or .git, and
// the working tree is never written to.
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

// The whole verdict, so the self-test can cover the fail-closed paths without
// Docker. Both builds and the container run are things THIS wrapper executed:
// jest's summary is only believed once all three completed normally. A
// dependency build that failed, or a container the runtime killed, cannot
// produce a verdict about the specs no matter how clean its partial output.
export function judgeSpecsRun({ depsBuildStatus, sourcesBuildStatus, containerStatus, output = '' }) {
  if (depsBuildStatus !== 0) {
    return { ok: false, detail: `the official server-deps stage exited ${depsBuildStatus ?? 'unmeasured'}: the dependency tree these specs run against was never installed` };
  }
  if (sourcesBuildStatus !== 0) {
    return { ok: false, detail: `the source/dependency-build image exited ${sourcesBuildStatus ?? 'unmeasured'}: the workspace builds the specs resolve were not produced` };
  }
  if (containerStatus !== 0) {
    return { ok: false, detail: `the privacy specs container exited ${containerStatus ?? 'unmeasured'} instead of completing: jest's summary cannot be trusted` };
  }
  return parseJestSummary(output);
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

// Only ever the container THIS process named. Nothing is matched by image, by
// age or by pattern: a sweep here would take out another session's run, and
// the app/db/Redis/worker containers share this daemon.
function removeOwnContainer() {
  const inspect = wsl(['docker', 'inspect', '--format', '{{.Id}}', CONTAINER_NAME]);
  if (inspect.status !== 0) return;
  const removed = wsl(['docker', 'rm', '-f', CONTAINER_NAME]);
  console.error(`[INFO] removed this run's own specs container ${CONTAINER_NAME} (${removed.status === 0 ? 'ok' : `docker rm exited ${removed.status}`})`);
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

  const buildInputs = [...DEPS_CONTEXT_PATHS, 'scripts/aos/server-specs-sources.Dockerfile'];
  for (const relative of buildInputs) {
    if (wsl(['test', '-e', `${root}/${relative}`]).status !== 0) {
      fail(`server-specs build input is missing from the checkout: ${relative}`);
    }
  }

  // The source context is `git archive HEAD`, which is committed content by
  // definition. Running the specs against HEAD while the working tree says
  // something else would be a measurement of code nobody is running, so an
  // uncommitted change under these inputs fails closed instead. The dependency
  // manifests below are tarred from the working tree (see why there), and this
  // same check is what makes the two halves describe one commit.
  const trackedInputs = [
    ...SPEC_SOURCE_PACKAGES.map((p) => `packages/${p}`),
    ...DEPS_CONTEXT_PATHS,
  ];
  const dirty = git(['status', '--porcelain', '--', ...trackedInputs])
    .split('\n').filter((l) => l.trim() !== '');
  if (dirty.length > 0) {
    fail(`${dirty.length} uncommitted change(s) under the inputs this gate measures (${dirty.slice(0, 3).map((l) => l.trim().slice(0, 60)).join('; ')}). This gate runs the committed tree; commit or stash them first.`);
  }

  // A plain `tar` of the working tree, NOT a git archive: measured on
  // 2026-10-28, feeding these same manifests through `git archive` instead
  // changes the layer's cache key (git archive normalizes modes and mtimes),
  // and BuildKit then re-ran `yarn workspaces focus` from scratch -- 2390
  // packages, 1.53 GiB fetched, past this step's whole budget. The dirty check
  // above is what keeps this context equal to HEAD, so the measurement still
  // describes one commit.
  console.log('[INFO] rebuilding the server-deps stage from the official Dockerfile (Docker layer cache makes this seconds once warm)');
  const depsPaths = DEPS_CONTEXT_PATHS.map((p) => JSON.stringify(p)).join(' ');
  const depsBuild = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(root)}; ` +
    `tar -cf - ${depsPaths} | ` +
    `docker build --target server-deps -f packages/twenty-docker/twenty/Dockerfile -t ${DEPS_IMAGE} -`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: DEPS_BUILD_TIMEOUT_MS });
  const depsBuildStatus = depsBuild.status;
  if (depsBuildStatus !== 0) fail(`docker build --target server-deps exited ${depsBuildStatus ?? 'unmeasured'}`);

  // A clean `git archive` of the committed sources, appended with the
  // Dockerfile that consumes it, streamed straight into the daemon. No .git,
  // no .aos, no deploy/local/.env, no node_modules, no pre-built dist -- and
  // no per-gate walk of ~14500 files across drvfs, which is what the previous
  // in-container `cp -r` from the Windows mounts cost (it outlived the 1200 s
  // quota on 2026-10-28). The workspace dependency build moves into the same
  // image, so an unchanged source tree skips it on a layer cache hit; its log
  // streams here, where a failure is readable.
  console.log('[INFO] building the source/dependency-build image from a clean git archive of HEAD');
  const archivePaths = SPEC_SOURCE_PACKAGES.map((p) => JSON.stringify(`packages/${p}`)).join(' ');
  const sourcesBuild = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(root)}; rm -f ${SOURCE_TAR}; ` +
    `git archive --format=tar -o ${SOURCE_TAR} HEAD -- ${archivePaths}; ` +
    `tar --append -f ${SOURCE_TAR} scripts/aos/server-specs-sources.Dockerfile; ` +
    `docker build --build-arg DEPS_IMAGE=${DEPS_IMAGE} -f scripts/aos/server-specs-sources.Dockerfile ` +
    `-t ${SOURCES_IMAGE} - < ${SOURCE_TAR}; rm -f ${SOURCE_TAR}`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: SOURCES_BUILD_TIMEOUT_MS });
  const sourcesBuildStatus = sourcesBuild.status;
  if (sourcesBuildStatus !== 0) {
    wsl(['rm', '-f', SOURCE_TAR]);
    fail(`docker build -f scripts/aos/server-specs-sources.Dockerfile exited ${sourcesBuildStatus ?? 'unmeasured'}: the sources and workspace builds the specs need were not produced`);
  }

  console.log(`[INFO] running the two privacy specs (container ${CONTAINER_NAME}, no network)`);
  const res = wsl(['docker', 'run', '--rm', '--name', CONTAINER_NAME, '--network', 'none', SOURCES_IMAGE,
    'sh', '-c', `cd /app/packages/twenty-server && npx jest --config jest.config.mjs --runInBand ${SPECS.join(' ')}`,
  ], { timeout: RUN_TIMEOUT_MS });
  if (res.error?.code === 'ETIMEDOUT' || res.signal) {
    removeOwnContainer();
    fail(`the privacy specs container exceeded its ${RUN_TIMEOUT_MS} ms budget and was torn down; nothing was measured`);
  }
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const verdict = judgeSpecsRun({ depsBuildStatus, sourcesBuildStatus, containerStatus: res.status, output });
  if (!verdict.ok) {
    removeOwnContainer();
    const tail = output.split('\n').filter((l) => l.trim()).slice(-25);
    console.error(tail.length ? tail.join('\n') : '(the container produced no output at all)');
    if (res.error) console.error(`spawn error: ${res.error.code || res.error.message}`);
    fail(`privacy specs: ${verdict.detail}`);
  }

  console.log(`[PASS] CRM-003 privacy specs executed against the real classes: ${verdict.detail}`);
  console.log('Scope: TelemetryService.publish() with an HTTP spy and TwentyConfigService ENV-vs-DB precedence, run with no network in a server-deps image rebuilt from this run\'s lockfile, over a git archive of this commit\'s sources. This does NOT start the CRM or observe runtime traffic.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const measured = { depsBuildStatus: 0, sourcesBuildStatus: 0, containerStatus: 0 };
  const clean = 'Test Suites: 2 passed, 2 total\nTests:       4 passed, 4 total\n';

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

  record('judgeSpecsRun: a clean run with both builds and the container at 0 passes', () => {
    const r = judgeSpecsRun({ ...measured, output: clean });
    assert(r.ok, r.detail);
  });
  record('judgeSpecsRun: a FAILED server-deps build fails before jest output is believed', () => {
    for (const status of [1, 137, null, undefined]) {
      const r = judgeSpecsRun({ ...measured, depsBuildStatus: status, output: clean });
      assert(!r.ok, `expected deps build status ${status} to fail`);
      assert(/server-deps stage exited/.test(r.detail), `expected the detail to name the deps stage, got: ${r.detail}`);
    }
  });
  record('judgeSpecsRun: a FAILED source/dependency-build image fails, however green the summary looks', () => {
    for (const status of [1, 11, 137, null]) {
      const r = judgeSpecsRun({ ...measured, sourcesBuildStatus: status, output: clean });
      assert(!r.ok, `expected sources build status ${status} to fail`);
      assert(/source\/dependency-build image exited/.test(r.detail), `expected the detail to name the source image, got: ${r.detail}`);
    }
  });
  record('judgeSpecsRun: a container the runtime killed is not a verdict (exit 124/137 with a passing tail)', () => {
    for (const status of [124, 137, 1, null]) {
      const r = judgeSpecsRun({ ...measured, containerStatus: status, output: clean });
      assert(!r.ok, `expected container status ${status} to fail`);
      assert(/container exited/.test(r.detail), `expected the detail to name the container, got: ${r.detail}`);
    }
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

  // CRM-004 fix3. The drvfs copy this replaces is the measured defect: the
  // container sat in `cp -r` from the read-only /mnt/c mounts past the whole
  // 1200 s quota. The sources must arrive as committed content in a layer, and
  // nothing may be mounted off the Windows drive again.
  record('the sources arrive as a clean git archive layer: no drvfs copy, no mount, no bus, no dotenv, no Git', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/git archive --format=tar/.test(source), 'the source context is no longer a git archive');
    assert(!/\bcp -r \/src\//.test(source), 'the per-gate cp -r from the Windows mounts is back');
    assert(!/-v['"\s,]+\$\{root\}/.test(source), 'a Windows-side path is mounted into the container again');
    // Assembled, not written out: a literal here would match itself.
    const bindFlag = `'${['-', 'v'].join('')}',`;
    assert(!source.includes(bindFlag), 'the container takes a bind mount again instead of reading sources from its own layer');
    // git archive only ever emits committed, tracked content, so neither
    // context can contain .git, .aos, node_modules or deploy/local/.env.
    const archived = [...source.matchAll(/SPEC_SOURCE_PACKAGES\.map\(\(p\) => JSON\.stringify\(`packages\/\$\{p\}`\)\)/g)];
    assert(archived.length === 1, 'the archive paths are no longer derived from SPEC_SOURCE_PACKAGES alone');
    assert(SPEC_SOURCE_PACKAGES.length === 4, `expected 4 spec source packages, got ${SPEC_SOURCE_PACKAGES.length}`);
    for (const pkg of SPEC_SOURCE_PACKAGES) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, 'packages', pkg)]);
    }
  });
  record('the source image builds on the OFFICIAL server-deps stage and bypasses the Nx cache for the dependency build', () => {
    const dockerfilePath = resolve(REPO_ROOT, 'scripts/aos/server-specs-sources.Dockerfile');
    execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', dockerfilePath]);
    const sources = readFileSync(dockerfilePath, 'utf8');
    const instructions = sources.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert(/^ARG DEPS_IMAGE$/m.test(instructions) && /^FROM \$\{DEPS_IMAGE\}$/m.test(instructions),
      'the source image no longer derives from the image this wrapper builds from the official Dockerfile');
    const wrapper = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/--target server-deps -f packages\/twenty-docker\/twenty\/Dockerfile/.test(wrapper),
      'the dependency image is no longer the official Dockerfile\'s own server-deps stage');
    assert(/--skip-nx-cache/.test(instructions), 'the workspace dependency build no longer bypasses the Nx cache');
    assert(/npx nx run-many -t build -p twenty-shared twenty-client-sdk twenty-emails/.test(instructions),
      'the workspace dependency build changed shape; the specs would resolve whatever the layer happens to carry');
    assert(/find \/app\/packages\/twenty-shared\/dist/.test(instructions),
      'the source image no longer proves the dependency artifacts it exists to produce');
  });
  record('the specs, their config and the no-network isolation are unchanged by the fix3 source change', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/npx jest --config jest\.config\.mjs --runInBand/.test(source), 'the specs are no longer run with the project jest config in band');
    assert(/'--network', 'none'/.test(source), 'the specs container is no longer isolated from the network');
    assert(SPECS.length === 2, `expected exactly the 2 CRM-003 specs, got ${SPECS.length}`);
  });
  record('the wrapper tears down only the container it named itself', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/--name', CONTAINER_NAME/.test(source), 'the specs container is no longer named by this run');
    assert(/docker', 'rm', '-f', CONTAINER_NAME/.test(source), 'cleanup no longer targets this run\'s own container by name');
    assert(!/\bdocker.*(prune|kill \$\(|rm -f \$\()/.test(source), 'cleanup matches containers by pattern instead of by name');
    assert(/CONTAINER_NAME = `aos-crm-server-specs-gate-\$\{process\.pid\}`/.test(source), 'the container name is no longer unique to this process');
  });
  record('the run has its own deadline, and both builds plus the run fit inside the gate budget it is given', () => {
    const verify = JSON.parse(readFileSync(resolve(REPO_ROOT, '.aos/verify.json'), 'utf8'));
    const budget = verify.timeoutsMs['verify-server-specs.mjs'];
    assert(budget > 0, '.aos/verify.json declares no budget for this command');
    assert(RUN_TIMEOUT_MS < budget, `the internal run deadline (${RUN_TIMEOUT_MS}) must be under the gate budget (${budget}) so the teardown happens here`);
    // If the three deadlines can outlast the budget, the harness kills the
    // command first and the cleanup never runs, which is the exact sequence
    // that left a container behind on 2026-10-28.
    const worstCase = DEPS_BUILD_TIMEOUT_MS + SOURCES_BUILD_TIMEOUT_MS + RUN_TIMEOUT_MS;
    assert(worstCase < budget, `the worst case (${worstCase} ms) must stay under the gate budget (${budget} ms)`);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
