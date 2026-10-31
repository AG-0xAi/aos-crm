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
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const SOURCES_DOCKERFILE = 'scripts/aos/server-specs-sources.Dockerfile';

// CRM-004 fix5: every temporary resource this run creates is named after the
// RUN, not after the gate. The tar was /tmp/aos-crm-server-specs-sources.tar
// and the images were tagged ':gate' -- one fixed name each, shared by every
// run on the distro -- so two gates at once (one worker per worktree, the
// supported way to run them in parallel) would overwrite each other's tar and
// move each other's tag: jest could run over another worktree's sources, and
// one run's cleanup would delete the other's input. The uuid is there because
// pids are reused. The BuildKit layer cache is keyed on context content and on
// the base image's digest, not on the output tag, so per-run names change what
// is NAMED and not what is rebuilt -- which is also why this still shares its
// cache with scripts/aos/mcp/verify-mcp-specs.mjs.
export function newRunId() {
  return `${process.pid}-${randomUUID().slice(0, 8)}`;
}

export function runResourceNames(runId) {
  return {
    depsImage: `aos-crm-local/server-deps:gate-${runId}`,
    sourcesImage: `aos-crm-local/server-specs:gate-${runId}`,
    sourceTar: `/tmp/aos-crm-server-specs-sources-${runId}.tar`,
    containerName: `aos-crm-server-specs-gate-${runId}`,
  };
}

const RUN_ID = newRunId();
const {
  depsImage: DEPS_IMAGE,
  sourcesImage: SOURCES_IMAGE,
  sourceTar: SOURCE_TAR,
  containerName: CONTAINER_NAME,
} = runResourceNames(RUN_ID);

// The image tags THIS run built, in creation order. Nothing is ever removed by
// pattern, by age or by image: the daemon also holds the stack's own
// containers and another gate's images.
const ownImages = [];
// Without this, BuildKit attaches a provenance attestation whose contents
// include the build's own timestamps, so a FULLY CACHED rebuild of the
// dependency image still produces a new image id (measured on 2026-10-28:
// 63d83413 -> 5a2585be with every layer CACHED). `FROM ${DEPS_IMAGE}` then
// changes on every run and the source layer below can never be reused -- which
// is why the first fix3 run still paid 81 s of workspace build and 74 s of
// export per gate. With attestations off, a cached dependency rebuild is
// byte-identical and the source layer is keyed on the sources alone: measured
// by building the same sources from two DIFFERENT commits, the second came back
// as the same image config digest in 0.1 s. These are the gate's own throwaway
// images; the application artifact is built by compose and is untouched.
const NO_ATTESTATION = '--provenance=false';
const SPECS = [
  'src/engine/core-modules/telemetry/__tests__/telemetry.service.spec.ts',
  'src/engine/core-modules/twenty-config/__tests__/twenty-config.service.spec.ts',
  // CRM-016 (R4): the sign-up invitation. These cover the fail-closed paths no
  // e2e can force cheaply -- a token looked up by plaintext instead of by its
  // hash, a redemption whose conditional update matched a row count other than
  // one, and a resend of an already redeemed or revoked invitation.
  'src/engine/core-modules/sign-up-invitation/services/__tests__/sign-up-invitation.service.spec.ts',
  'src/engine/core-modules/sign-up-invitation/utils/__tests__/get-sign-up-invitation-status.util.spec.ts',
];
const EXPECTED_SUITES = SPECS.length;

// Budgets, not "however long it takes": the harness gives this command
// 1200000 ms (.aos/verify.json). Exceeding it used to leave the specs
// container running into the NEXT gate (observed 2026-10-28,
// .aos/reports/CRM-004-fix2-coordinator-review.md), so the wrapper owns its
// own deadlines and tears down ONLY the container it named itself. Their sum
// stays under the gate quota, which is what makes the teardown happen here
// instead of after the harness has already killed the process.
// Measured on this host, 2026-10-28 (fix3): 192 s on a source tree the cache
// has not seen (server-deps rebuild 22 s, source/dependency-build image 134 s
// of which 81 s is the workspace build, jest 36 s) and 67 s / 75 s on two
// consecutive steady-state runs, where every heavy step comes back CACHED and
// the cost is the deps rebuild plus jest. A cold server-deps re-installs the
// focus and took 353 s in fix1. The budgets are those numbers with room for a
// cold cache, not round guesses.
const DEPS_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_SPECS_DEPS_TIMEOUT_MS || 420_000);
const SOURCES_BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_SPECS_SOURCES_TIMEOUT_MS || 420_000);
const RUN_TIMEOUT_MS = Number(process.env.AOS_CRM_SPECS_RUN_TIMEOUT_MS || 300_000);
// One deadline for the WHOLE teardown: four calls that each waited a minute on
// a daemon that stopped answering would outlast the gate quota, and then the
// harness kills this process before the cleanup it is waiting for.
const CLEANUP_TIMEOUT_MS = Number(process.env.AOS_CRM_CLEANUP_TIMEOUT_MS || 30_000);

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

// Everything that reaches a build context from the WORKING TREE rather than
// through `git archive HEAD`: the dependency manifests above (tarred from the
// tree, see why below) plus the Dockerfile appended to the source context.
// `git archive` content is committed by definition; these are not, so this is
// the exact list the uncommitted-change check below has to cover. CRM-004 fix4:
// the Dockerfile was in the context but outside that check, so an edit to it
// was packaged and measured while the gate still claimed to run HEAD.
export const WORKING_TREE_CONTEXT_PATHS = [...DEPS_CONTEXT_PATHS, SOURCES_DOCKERFILE];

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

// Every exit path tears down what this run created first: an early failure used
// to leave the source tar behind for nobody to collect. The image tags this run
// built are KEPT on a failure -- a failed gate is the one time those bytes are
// evidence -- and named, so they can be inspected and then removed by hand.
function fail(message) {
  removeOwnResources({ keepImages: true });
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

// Only ever what THIS run created: the container it named, the image tags its
// own builds wrote, and its own source tar. Nothing is matched by image, by age
// or by pattern -- a sweep here would take out another session's run, and the
// app/db/Redis/worker containers share this daemon -- and every call shares one
// deadline, so a Docker daemon that stopped answering cannot turn teardown into
// a hang. A teardown step that could not be completed is reported, never
// assumed.
function removeOwnResources({ keepImages = false } = {}) {
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  const bounded = (args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: null, timedOut: true };
    const res = wsl(args, { timeout: remaining });
    return { ...res, timedOut: res.error?.code === 'ETIMEDOUT' || Boolean(res.signal) };
  };
  const describe = (res) => {
    if (res.timedOut) return `gave up after the teardown's ${CLEANUP_TIMEOUT_MS} ms deadline`;
    if (res.error) return `could not run (${res.error.code || res.error.message})`;
    return res.status === 0 ? 'ok' : `exited ${res.status}`;
  };

  const inspect = bounded(['docker', 'inspect', '--format', '{{.Id}}', CONTAINER_NAME]);
  if (inspect.timedOut) {
    console.error(`[INFO] could not ask Docker about this run's own container ${CONTAINER_NAME} (${describe(inspect)}): it may still be running`);
  } else if (inspect.status === 0) {
    const removed = bounded(['docker', 'rm', '-f', CONTAINER_NAME]);
    console.error(`[INFO] removed this run's own specs container ${CONTAINER_NAME} (${describe(removed)})`);
  }
  // Child tag before its parent: with the classic image store a tagged parent
  // cannot be untagged while an image derived from it still references it.
  for (const image of [...ownImages].reverse()) {
    if (keepImages) {
      console.error(`[INFO] kept this run's own image tag ${image} for inspection; remove it with: docker image rm ${image}`);
      continue;
    }
    const removed = bounded(['docker', 'image', 'rm', image]);
    console.error(`[INFO] removed this run's own image tag ${image} (${describe(removed)})`);
  }
  const tar = bounded(['rm', '-f', SOURCE_TAR]);
  if (tar.status !== 0) console.error(`[INFO] this run's own source tar ${SOURCE_TAR} (${describe(tar)})`);
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

  for (const relative of WORKING_TREE_CONTEXT_PATHS) {
    if (wsl(['test', '-e', `${root}/${relative}`]).status !== 0) {
      fail(`server-specs build input is missing from the checkout: ${relative}`);
    }
  }

  // The source context is `git archive HEAD`, which is committed content by
  // definition. Running the specs against HEAD while the working tree says
  // something else would be a measurement of code nobody is running, so an
  // uncommitted change under these inputs fails closed instead. The dependency
  // manifests and the sources Dockerfile are tarred from the working tree (see
  // why there), and this same check is what makes every half describe one
  // commit -- so it takes WORKING_TREE_CONTEXT_PATHS itself, never a copy.
  const trackedInputs = [
    ...SPEC_SOURCE_PACKAGES.map((p) => `packages/${p}`),
    ...WORKING_TREE_CONTEXT_PATHS,
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
    `docker build ${NO_ATTESTATION} --target server-deps -f packages/twenty-docker/twenty/Dockerfile -t ${DEPS_IMAGE} -`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: DEPS_BUILD_TIMEOUT_MS });
  const depsBuildStatus = depsBuild.status;
  if (depsBuildStatus !== 0) fail(`docker build --target server-deps exited ${depsBuildStatus ?? 'unmeasured'}`);
  ownImages.push(DEPS_IMAGE);

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
    `tar --append -f ${SOURCE_TAR} ${SOURCES_DOCKERFILE}; ` +
    `docker build ${NO_ATTESTATION} --build-arg DEPS_IMAGE=${DEPS_IMAGE} -f ${SOURCES_DOCKERFILE} ` +
    `-t ${SOURCES_IMAGE} - < ${SOURCE_TAR}; rm -f ${SOURCE_TAR}`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: SOURCES_BUILD_TIMEOUT_MS });
  const sourcesBuildStatus = sourcesBuild.status;
  if (sourcesBuildStatus !== 0) {
    fail(`docker build -f scripts/aos/server-specs-sources.Dockerfile exited ${sourcesBuildStatus ?? 'unmeasured'}: the sources and workspace builds the specs need were not produced`);
  }
  ownImages.push(SOURCES_IMAGE);

  console.log(`[INFO] running the two privacy specs (container ${CONTAINER_NAME}, no network)`);
  const res = wsl(['docker', 'run', '--rm', '--name', CONTAINER_NAME, '--network', 'none', SOURCES_IMAGE,
    'sh', '-c', `cd /app/packages/twenty-server && npx jest --config jest.config.mjs --runInBand ${SPECS.join(' ')}`,
  ], { timeout: RUN_TIMEOUT_MS });
  if (res.error?.code === 'ETIMEDOUT' || res.signal) {
    fail(`the privacy specs container exceeded its ${RUN_TIMEOUT_MS} ms budget and was torn down; nothing was measured`);
  }
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const verdict = judgeSpecsRun({ depsBuildStatus, sourcesBuildStatus, containerStatus: res.status, output });
  if (!verdict.ok) {
    const tail = output.split('\n').filter((l) => l.trim()).slice(-25);
    console.error(tail.length ? tail.join('\n') : '(the container produced no output at all)');
    if (res.error) console.error(`spawn error: ${res.error.code || res.error.message}`);
    fail(`privacy specs: ${verdict.detail}`);
  }

  removeOwnResources();
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
  // Derived from SPECS, not written out: a fixture carrying its own suite count
  // failed the self-test the moment the list grew, which reads as a broken gate
  // instead of a longer one.
  const cleanSummary = (suites) =>
    `Test Suites: ${suites} passed, ${suites} total\nTests:       ${suites * 2} passed, ${suites * 2} total\n`;
  const clean = cleanSummary(EXPECTED_SUITES);

  record('parseJestSummary: a clean run of every spec in the list passes', () => {
    assert(parseJestSummary(clean).ok, parseJestSummary(clean).detail);
  });
  record('parseJestSummary: a failing suite is rejected', () => {
    const r = parseJestSummary(`Test Suites: 1 failed, ${EXPECTED_SUITES - 1} passed, ${EXPECTED_SUITES} total\nTests:       1 failed, 3 passed, 4 total\n`);
    assert(!r.ok, 'expected a failing suite to be rejected');
  });
  record('parseJestSummary: a run that matched no spec file is rejected, not read as green', () => {
    const r = parseJestSummary('Test Suites: 0 total\nTests:       0 total\n');
    assert(!r.ok, 'expected zero suites to be rejected');
  });
  record('parseJestSummary: fewer suites than expected is rejected even if all passed', () => {
    const r = parseJestSummary(cleanSummary(EXPECTED_SUITES - 1));
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
  // CRM-004 fix4 (reviewer finding). `git archive HEAD` can only emit committed
  // content, but anything appended to that context from the WORKING TREE can
  // differ from HEAD, and then the gate measures a tree nobody committed. The
  // sources Dockerfile is exactly that case: it is tarred in from the working
  // tree, and it was not covered by the uncommitted-change check.
  record('every file that enters a build context from the working tree is covered by the uncommitted-change check', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(WORKING_TREE_CONTEXT_PATHS.includes(SOURCES_DOCKERFILE),
      `${SOURCES_DOCKERFILE} enters the build context from the working tree but is not checked for uncommitted changes`);
    for (const relative of DEPS_CONTEXT_PATHS) {
      assert(WORKING_TREE_CONTEXT_PATHS.includes(relative), `${relative} is tarred from the working tree but is not dirty-checked`);
    }
    // The dirty check must take the context list itself, not a hand-kept copy:
    // a path added to the context later would otherwise slip through unchecked.
    assert(/const trackedInputs = \[\s*\.\.\.SPEC_SOURCE_PACKAGES\.map\(\(p\) => `packages\/\$\{p\}`\),\s*\.\.\.WORKING_TREE_CONTEXT_PATHS,\s*\]/.test(source),
      'the uncommitted-change check no longer derives its inputs from the working-tree context list');
    // And no tar may name a path literally: that is how the Dockerfile escaped
    // the check in the first place.
    const appended = [...source.matchAll(/tar --append -f \$\{SOURCE_TAR\} ([^;\s]+)/g)].map((m) => m[1]);
    assert(appended.length === 1 && appended[0] === '${SOURCES_DOCKERFILE}',
      `a working-tree path is appended to the source context outside the checked list: ${appended.join(', ')}`);
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
  record('both builds disable the attestation that would make a cached rebuild non-reproducible', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(NO_ATTESTATION === '--provenance=false', `the attestation opt-out changed shape: ${NO_ATTESTATION}`);
    const builds = [...source.matchAll(/docker build \$\{NO_ATTESTATION\}/g)];
    assert(builds.length === 2, `expected both docker builds to pass it, found ${builds.length}`);
  });
  record('the specs, their config and the no-network isolation are unchanged by the fix3 source change', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/npx jest --config jest\.config\.mjs --runInBand/.test(source), 'the specs are no longer run with the project jest config in band');
    assert(/'--network', 'none'/.test(source), 'the specs container is no longer isolated from the network');
    assert(SPECS.length === 4, `expected exactly the 2 CRM-003 specs and the 2 CRM-016 ones, got ${SPECS.length}`);
    assert(SPECS.filter((spec) => spec.includes('/sign-up-invitation/')).length === 2,
      'the CRM-016 sign-up-invitation specs are no longer in this gate');
  });
  record('the wrapper tears down only the container it named itself', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/--name', CONTAINER_NAME/.test(source), 'the specs container is no longer named by this run');
    assert(/'docker', 'rm', '-f', CONTAINER_NAME/.test(source), 'cleanup no longer targets this run\'s own container by name');
    assert(!/\bdocker.*(prune|kill \$\(|rm -f \$\()/.test(source), 'cleanup matches containers by pattern instead of by name');
  });

  // CRM-004 fix5 (reviewer finding, R3: cleanup targets only the run's own test
  // resources). The container was already named after this process, but the tar
  // (/tmp/aos-crm-server-specs-sources.tar) and both image tags (':gate') were
  // one fixed name each for the whole distro. Two gates at once -- one worker
  // per worktree, the supported way to run them in parallel -- would overwrite
  // each other's tar and move each other's tag, so one run could run jest over
  // another worktree's sources and its cleanup would delete the other's input.
  record('two simultaneous runs collide on nothing: every temporary resource carries this run\'s own identity', () => {
    const a = runResourceNames(newRunId());
    const b = runResourceNames(newRunId());
    const kinds = Object.keys(a);
    assert(kinds.length === 4, `expected the four temporary resources this run creates, got ${kinds.join(', ')}`);
    for (const kind of kinds) {
      assert(a[kind] !== b[kind], `two runs on one distro would share ${kind}: ${a[kind]}`);
    }
    for (const [kind, live] of [['sourceTar', SOURCE_TAR], ['depsImage', DEPS_IMAGE], ['sourcesImage', SOURCES_IMAGE], ['containerName', CONTAINER_NAME]]) {
      assert(live === runResourceNames(RUN_ID)[kind], `${kind} is not derived from this run's id: ${live}`);
      assert(live.includes(RUN_ID), `${kind} ('${live}') does not carry this run's identity`);
    }
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/randomUUID\(\)/.test(source), 'the run id no longer mixes in a uuid, so a reused pid would collide');
    // Instructions only: the comments above explain the fixed names this
    // replaced, and they name them. Assembled rather than written out, because
    // a literal here would match itself.
    const instructions = source.split('function selfTest()')[0]
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert(!instructions.includes(`/tmp/${['aos-crm-server-specs-sources', 'tar'].join('.')}`), 'the fixed, distro-wide source tar is back');
    for (const repository of ['server-deps', 'server-specs']) {
      assert(!instructions.includes(`${[repository, 'gate'].join(':')}'`), `a fixed '${repository}:gate' tag is back, so two runs would build over each other`);
    }
  });
  record('the teardown names only the resources this run created, inside one bounded deadline', () => {
    const production = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('function selfTest()')[0];
    const teardown = (production.split('function removeOwnResources(')[1] || '').split('\nfunction ')[0];
    assert(teardown, 'there is no teardown function left to inspect');
    // A failed gate is the one time those image bytes are evidence, so they are
    // kept and named instead of deleted.
    assert(/removeOwnResources\(\{ keepImages: true \}\)/.test(production), 'a failing run no longer keeps its own image for inspection');
    assert(/kept this run's own image tag/.test(teardown), 'the kept image is no longer named, so nobody can inspect or remove it');
    assert(!/\bdocker.*(prune|kill \$\(|rm -f \$\(|--filter)/.test(production), 'cleanup matches resources by pattern instead of by name');
    assert(/ownImages\.push\(DEPS_IMAGE\)/.test(production) && /ownImages\.push\(SOURCES_IMAGE\)/.test(production),
      'a build no longer registers the image tag it created, so that tag would outlive the run');
    assert([...production.matchAll(/ownImages\.push\(/g)].length === 2,
      'the teardown list is fed from somewhere other than the two builds this command runs');
    // Bounded: a daemon that stopped answering must not turn teardown into a
    // hang. ONE deadline for the whole teardown, so the arithmetic against the
    // gate budget below holds however many resources it names.
    assert([...teardown.matchAll(/bounded\(\[/g)].length >= 4, 'not every teardown call goes through the shared deadline');
    assert(!/\bwsl\(\[/.test(teardown), 'a teardown call bypasses the shared deadline and can hang the gate');
    assert(CLEANUP_TIMEOUT_MS > 0, 'the teardown has no deadline');
  });
  record('the run has its own deadline, and both builds, the run and the teardown fit inside the gate budget it is given', () => {
    const verify = JSON.parse(readFileSync(resolve(REPO_ROOT, '.aos/verify.json'), 'utf8'));
    const budget = verify.timeoutsMs['verify-server-specs.mjs'];
    assert(budget > 0, '.aos/verify.json declares no budget for this command');
    assert(RUN_TIMEOUT_MS < budget, `the internal run deadline (${RUN_TIMEOUT_MS}) must be under the gate budget (${budget}) so the teardown happens here`);
    // If the four deadlines can outlast the budget, the harness kills the
    // command first and the cleanup never runs, which is the exact sequence
    // that left a container behind on 2026-10-28.
    const worstCase = DEPS_BUILD_TIMEOUT_MS + SOURCES_BUILD_TIMEOUT_MS + RUN_TIMEOUT_MS + CLEANUP_TIMEOUT_MS;
    assert(worstCase < budget, `the worst case (${worstCase} ms) must stay under the gate budget (${budget} ms)`);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
