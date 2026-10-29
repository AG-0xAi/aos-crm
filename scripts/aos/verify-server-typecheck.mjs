#!/usr/bin/env node
// CRM-004: the real typecheck of twenty-server.
//
// CRM-004's first attempt ran `tsgo` inside the runtime-focused `server-deps`
// tree and got 14 errors, every one of them an absent module. That is not a
// red typecheck and it is not a green one either: the environment did not hold
// twenty-server's declared dependencies, so the measurement did not measure
// the code. This runs it in a tree built for the purpose
// (scripts/aos/typecheck.Dockerfile + scripts/aos/typecheck-sources.Dockerfile),
// bypassing the Nx cache entirely so a cached PASS can never stand in for a
// run.
//
// CRM-004-fix1 then allowed ONE unresolved import -- twenty-server's
// scripts/build-seed-front-components.ts importing the twenty-sdk build output
// `twenty-sdk/front-component-renderer/build` -- because the environment did
// not build the SDK. fix2 removed that allowance by supplying the artifact
// instead: upstream's own `twenty-server:typecheck` target depends on `^build`,
// and the declaration half of twenty-sdk's official build target now runs in
// the source image. There is no missing-module allowlist left; `tsgo` has to
// exit 0 over the project's own tsconfig.json.
//
// It also proves the run can fail: a deliberately ill-typed canary file is
// added to the same project and tsgo must reject it WITH the diagnostic that
// file deserves. A tsgo that exits 0 on both is a tsgo that measured nothing;
// a tsgo that died on a signal is not a verdict either. Both are failures.
//
// Fail-closed: if WSL, Docker, either image build, the container run or any
// marker cannot be measured, this exits non-zero. It never degrades to
// "skipped" and never reads a crash as a pass.
//
//   node scripts/aos/verify-server-typecheck.mjs
//   node scripts/aos/verify-server-typecheck.mjs --self-test   (no WSL/Docker)
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const CANARY_REL = 'src/aos-typecheck-canary.ts';

// CRM-004 fix5: every temporary resource this run creates is named after the
// RUN, not after the gate. They used to be one fixed name each -- the tar
// /tmp/aos-crm-typecheck-sources.tar and the ':gate' tags -- shared by every
// run on the distro, so two gates at once (one worker per worktree, the
// supported way to run them in parallel) would overwrite each other's tar and
// move each other's tag: a compiler could read another tree's sources, and one
// run's cleanup would delete the other's input. The uuid is there because pids
// are reused. The BuildKit layer cache is keyed on context content and on the
// base image's digest, not on the output tag, so per-run names change what is
// NAMED and not what is rebuilt.
export function newRunId() {
  return `${process.pid}-${randomUUID().slice(0, 8)}`;
}

export function runResourceNames(runId) {
  return {
    depsImage: `aos-crm-local/server-typecheck-deps:gate-${runId}`,
    sourcesImage: `aos-crm-local/server-typecheck:gate-${runId}`,
    sourceTar: `/tmp/aos-crm-typecheck-sources-${runId}.tar`,
    containerName: `aos-crm-typecheck-gate-${runId}`,
  };
}

const RUN_ID = newRunId();
const {
  depsImage: DEPS_IMAGE,
  sourcesImage: SOURCES_IMAGE,
  sourceTar: SOURCE_TAR,
  containerName: CONTAINER_NAME,
} = runResourceNames(RUN_ID);

// Budgets, not "however long it takes": the harness gives this command the
// quota .aos/verify.json declares for it, and the self-test below checks the
// sum of these deadlines against that file rather than against a number
// repeated here (fix4 left a stale one in this comment). Exceeding the quota
// used to leave the compiler container running into the NEXT gate (observed
// 2026-10-28, .aos/reports/CRM-004-fix1-coordinator-review.md), so the wrapper
// owns its own deadlines and tears down ONLY what it created itself.
// Measured on this host, 2026-10-28: the cold source/SDK build 562 s (a warm
// one is a layer cache hit), `tsgo -p tsconfig.json` 609 s and the canary run
// 273 s. The budgets are those numbers with room, not round guesses.
const BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_TYPECHECK_BUILD_TIMEOUT_MS || 900_000);
const RUN_TIMEOUT_MS = Number(process.env.AOS_CRM_TYPECHECK_RUN_TIMEOUT_MS || 1_500_000);
// One deadline for the WHOLE teardown: four calls that each waited a minute on
// a daemon that stopped answering would outlast the gate quota, and then the
// harness kills this process before the cleanup it is waiting for.
const CLEANUP_TIMEOUT_MS = Number(process.env.AOS_CRM_CLEANUP_TIMEOUT_MS || 30_000);

// The image tags THIS run built, in creation order. Nothing is ever removed by
// pattern, by age or by image: the daemon also holds the stack's own
// containers and another gate's images.
const ownImages = [];

// Manifests only: the dependency inputs of the typecheck image. The sources
// arrive separately, as a clean git archive.
// Every workspace manifest is included because the image runs a monorepo-wide
// `yarn install --immutable`: a partial manifest set would make Yarn resolve a
// different tree than the lockfile describes, which is the same class of
// mistake as measuring in the pruned runtime tree. The list is derived from the
// root package.json's workspaces, so a new workspace is picked up on its own.
export const CONTEXT_PATHS = buildContextPaths();

function buildContextPaths() {
  const root = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  const workspaceDirs = (root.workspaces?.packages || []).filter((p) => !p.includes('*'));
  const paths = [
    'package.json',
    'yarn.lock',
    '.yarnrc.yml',
    'tsconfig.base.json',
    'nx.json',
    '.yarn/releases',
    '.yarn/patches',
  ];
  for (const dir of workspaceDirs) {
    paths.push(`${dir}/package.json`);
    if (existsSync(resolve(REPO_ROOT, dir, 'patches'))) paths.push(`${dir}/patches`);
  }
  return paths;
}

// The workspaces whose SOURCES the typecheck reads. The first four are
// twenty-server's declared workspace dependencies; twenty-sdk is the undeclared
// one its scripts/ directory imports a build output of (see
// typecheck-sources.Dockerfile), and that directory is inside the tsconfig.
export const SOURCE_PACKAGES = [
  'twenty-emails',
  'twenty-shared',
  'twenty-client-sdk',
  'twenty-oxlint-rules',
  'twenty-sdk',
  'twenty-server',
];

// The diagnostic the canary file must provoke. Pinned to the code, not just
// "some error": a compiler that crashed, ran out of memory or could not read
// its config also prints the canary's PATH in its message, and that would make
// "the canary showed up in the errors" true while proving nothing about type
// checking. Measured against this image on 2026-10-28.
export const CANARY_DIAGNOSTIC = 'TS2322';

function numericMarker(output, name) {
  const matches = [...output.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))].map((m) => m[1].trim());
  if (matches.length === 0) return { ok: false, detail: `no ${name} marker: the step that reports it did not run to completion` };
  // Duplicates are ambiguous, and ambiguity resolved in the gate's favour is
  // how a second, failing run hides behind a first, passing one.
  if (matches.length > 1) {
    const distinct = [...new Set(matches)];
    return { ok: false, detail: `${name} appears ${matches.length} times (${distinct.join(', ')}): the container's output is ambiguous` };
  }
  if (!/^-?\d+$/.test(matches[0])) return { ok: false, detail: `${name} is '${matches[0]}', not an exit code` };
  return { ok: true, value: Number(matches[0]) };
}

// tsgo prints nothing on success, so the verdict is read from the markers the
// container echoes -- never from the exit code of the shell that wrapped them,
// and never from the absence of red text.
//
// containerStatus and depsBuildStatus are the exit codes of the two things this
// wrapper itself ran (`docker build` for the source/dependency image and
// `docker run` for the compiler). Both are required to be 0: a container the
// runtime killed, or an image build that failed, cannot produce a verdict about
// the code no matter how clean its partial output looks.
export function parseTypecheckOutput(output, { containerStatus, depsBuildStatus } = {}) {
  if (depsBuildStatus !== 0) {
    return { ok: false, detail: `the dependency/SDK build image exited ${depsBuildStatus ?? 'unmeasured'}: the environment the compiler needs was never built` };
  }
  if (containerStatus !== 0) {
    return { ok: false, detail: `the typecheck container exited ${containerStatus ?? 'unmeasured'} instead of completing: its markers cannot be trusted` };
  }
  for (const name of ['AOS_TSGO_EXIT', 'AOS_CANARY_EXIT', 'AOS_CANARY_MATCHED_LINES', 'AOS_SHARED_DIST_FILES', 'AOS_SDK_RENDERER_BUILD_DTS_BYTES']) {
    const marker = numericMarker(output, name);
    if (!marker.ok) return { ok: false, detail: marker.detail };
  }
  const tsgo = numericMarker(output, 'AOS_TSGO_EXIT').value;
  const canary = numericMarker(output, 'AOS_CANARY_EXIT').value;
  const canaryLines = numericMarker(output, 'AOS_CANARY_MATCHED_LINES').value;
  const sharedArtifacts = numericMarker(output, 'AOS_SHARED_DIST_FILES').value;
  const sdkDeclarationBytes = numericMarker(output, 'AOS_SDK_RENDERER_BUILD_DTS_BYTES').value;

  if (sharedArtifacts <= 0) {
    return { ok: false, detail: 'the workspace dependencies produced no build artifacts, so tsgo resolved them from nothing' };
  }
  if (sdkDeclarationBytes <= 0) {
    return { ok: false, detail: 'twenty-sdk/dist/front-component-renderer/build/index.d.ts is absent or empty: the build output twenty-server\'s scripts import was never produced' };
  }
  const errors = output.split('\n')
    .filter((l) => /error TS\d+/.test(l))
    .filter((l) => !l.includes('aos-typecheck-canary'));
  if (tsgo !== 0) {
    return {
      ok: false,
      detail: errors.length > 0
        ? `tsgo -p tsconfig.json exited ${tsgo} with ${errors.length} type error(s)`
        // A non-zero compiler with nothing to show for it is the failure mode
        // this gate used to certify as green: exit 137 (the runtime killed it)
        // with no diagnostics read as "no errors found".
        : `tsgo -p tsconfig.json exited ${tsgo} without printing a single diagnostic: it did not finish, so this is not a clean typecheck`,
      errors: errors.slice(0, 20),
    };
  }
  if (errors.length > 0) {
    return { ok: false, detail: 'tsgo exited 0 while printing errors: the exit code and the output disagree', errors: errors.slice(0, 20) };
  }
  if (canary === 0) {
    return { ok: false, detail: 'tsgo accepted a deliberately ill-typed file: this run proves nothing about the code' };
  }
  // 128+N is "killed by signal N". A compiler that was killed did not reject
  // the canary; it just stopped, and the canary's path can still appear in a
  // crash message.
  if (canary >= 128) {
    return { ok: false, detail: `the canary run was killed (exit ${canary}) rather than rejecting the file: the falsifiability check did not run` };
  }
  // A non-zero canary exit is not enough on its own: if the project already had
  // errors, the canary run would fail for reasons that have nothing to do with
  // the canary. The canary FILE has to appear in the errors, carrying the
  // diagnostic a `number` assigned a string actually earns.
  if (canaryLines < 1) {
    return { ok: false, detail: `no '${CANARY_DIAGNOSTIC}' diagnostic on the ill-typed canary: the falsifiability check did not land` };
  }
  return {
    ok: true,
    detail: `tsgo -p tsconfig.json exited 0 with no diagnostics; the canary was rejected with ${CANARY_DIAGNOSTIC} (exit ${canary}), ${sharedArtifacts} dependency artifact(s) and a ${sdkDeclarationBytes}-byte SDK declaration present`,
  };
}

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

// Every exit path tears down what this run created first: an early failure used
// to leave the source tar and the image tags behind for nobody to collect.
function fail(message) {
  removeOwnResources();
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

// Only ever what THIS run created: the container it named, the image tags its
// own builds wrote, and its own source tar. Nothing is matched by image, by age
// or by pattern -- a sweep here would take out another session's compiler --
// and every call shares one deadline, so a Docker daemon that stopped
// answering cannot turn teardown into a hang. A teardown step that could not be
// completed is reported, never assumed.
function removeOwnResources() {
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
    console.error(`[INFO] removed this run's own typecheck container ${CONTAINER_NAME} (${describe(removed)})`);
  }
  // Child tag before its parent: with the classic image store a tagged parent
  // cannot be untagged while an image derived from it still references it.
  for (const image of [...ownImages].reverse()) {
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
  const buildInputs = [...CONTEXT_PATHS, 'scripts/aos/typecheck.Dockerfile', 'scripts/aos/typecheck-sources.Dockerfile'];

  for (const relative of buildInputs) {
    if (wsl(['test', '-e', `${root}/${relative}`]).status !== 0) {
      fail(`typecheck build input is missing from the checkout: ${relative}`);
    }
  }

  // The source context is `git archive HEAD`, which is committed content by
  // definition. Measuring HEAD while the working tree says something else
  // would be a typecheck of code nobody is running, so an uncommitted change
  // under these packages fails closed instead.
  const dirtySources = git(['status', '--porcelain', '--', ...SOURCE_PACKAGES.map((p) => `packages/${p}`)])
    .split('\n').filter((l) => l.trim() !== '');
  if (dirtySources.length > 0) {
    fail(`${dirtySources.length} uncommitted change(s) under the typechecked packages (${dirtySources.slice(0, 3).map((l) => l.trim().slice(0, 60)).join('; ')}). This gate compiles the committed tree; commit or stash them first.`);
  }

  console.log('[INFO] building the dependency image (Docker layer cache makes this seconds once warm)');
  const contextPaths = [...CONTEXT_PATHS, 'scripts/aos/typecheck.Dockerfile'].map((p) => JSON.stringify(p)).join(' ');
  const depsBuild = wsl(['sh', '-c',
    `cd ${JSON.stringify(root)} && tar -cf - ${contextPaths} | ` +
    `docker build -f scripts/aos/typecheck.Dockerfile -t ${DEPS_IMAGE} -`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: BUILD_TIMEOUT_MS });
  if (depsBuild.status !== 0) fail(`docker build -f scripts/aos/typecheck.Dockerfile exited ${depsBuild.status}`);
  ownImages.push(DEPS_IMAGE);

  // A clean `git archive` of the committed sources, appended with the
  // Dockerfile that consumes it, streamed straight into the daemon. No .git,
  // no .aos, no deploy/local/.env, no node_modules, no pre-built dist -- and
  // no per-gate walk of ~19000 files across drvfs, which is what the previous
  // in-container `cp -r` from the Windows mounts cost (~698 s measured).
  console.log('[INFO] building the source/dependency-artifact image from a clean git archive of HEAD');
  const archivePaths = SOURCE_PACKAGES.map((p) => JSON.stringify(`packages/${p}`)).join(' ');
  const sourcesBuild = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(root)}; rm -f ${SOURCE_TAR}; ` +
    `git archive --format=tar -o ${SOURCE_TAR} HEAD -- ${archivePaths}; ` +
    `tar --append -f ${SOURCE_TAR} scripts/aos/typecheck-sources.Dockerfile; ` +
    `docker build --build-arg DEPS_IMAGE=${DEPS_IMAGE} -f scripts/aos/typecheck-sources.Dockerfile ` +
    `-t ${SOURCES_IMAGE} - < ${SOURCE_TAR}; rm -f ${SOURCE_TAR}`,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: BUILD_TIMEOUT_MS });
  const depsBuildStatus = sourcesBuild.status;
  if (depsBuildStatus !== 0) {
    fail(`docker build -f scripts/aos/typecheck-sources.Dockerfile exited ${depsBuildStatus}: the dependency/SDK artifacts the typecheck needs were not produced`);
  }
  ownImages.push(SOURCES_IMAGE);

  const script = [
    // Measured inside the image, every run: a cached layer that lost an
    // artifact must read as a failure, not as "module not found" in the code.
    'echo "AOS_SHARED_DIST_FILES=$(find /app/packages/twenty-shared/dist /app/packages/twenty-client-sdk/dist /app/packages/twenty-emails/dist -type f 2>/dev/null | wc -l)"',
    'echo "AOS_SDK_RENDERER_BUILD_DTS_BYTES=$(wc -c < /app/packages/twenty-sdk/dist/front-component-renderer/build/index.d.ts 2>/dev/null || echo 0)"',
    'cd /app/packages/twenty-server',
    // Direct tsgo, never `nx typecheck`: an Nx cache hit would print a green
    // summary without running the compiler. Redirected to a file and tailed
    // afterwards rather than piped: the image is alpine, its shell is ash, and
    // ${PIPESTATUS} is a bashism that would silently lose the exit code.
    'npx tsgo -p tsconfig.json >/tmp/tsgo.log 2>&1',
    'echo "AOS_TSGO_EXIT=$?"',
    'tail -n 40 /tmp/tsgo.log',
    `printf 'export const aosTypecheckCanary: number = "not a number";\\n' > ${CANARY_REL}`,
    'npx tsgo -p tsconfig.json >/tmp/canary.log 2>&1',
    'echo "AOS_CANARY_EXIT=$?"',
    // The canary's own diagnostic, not merely its filename: a crash message
    // naming the file would otherwise count as a rejection.
    `grep -c "aos-typecheck-canary.*error ${CANARY_DIAGNOSTIC}" /tmp/canary.log | sed 's/^/AOS_CANARY_MATCHED_LINES=/'`,
    `grep "aos-typecheck-canary" /tmp/canary.log | head -n 3`,
    `rm -f ${CANARY_REL}`,
    // The container's own exit code is part of the verdict, so it ends on
    // something deterministic rather than on grep's match count.
    'true',
  ].join('\n');

  console.log(`[INFO] running tsgo and its canary (container ${CONTAINER_NAME}, no network)`);
  const res = wsl(['docker', 'run', '--rm', '--name', CONTAINER_NAME, '--network', 'none', SOURCES_IMAGE, 'sh', '-c', script],
    { timeout: RUN_TIMEOUT_MS });
  if (res.error?.code === 'ETIMEDOUT' || res.signal) {
    fail(`the typecheck container exceeded its ${RUN_TIMEOUT_MS} ms budget and was torn down; nothing was measured`);
  }
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const verdict = parseTypecheckOutput(output, { containerStatus: res.status, depsBuildStatus });
  if (!verdict.ok) {
    // The container's own last lines, so a failure here is diagnosable instead
    // of just "no marker".
    console.error(output.split('\n').slice(-25).join('\n'));
    for (const line of verdict.errors || []) console.error(`  ${line}`);
    fail(`twenty-server typecheck: ${verdict.detail}`);
  }
  removeOwnResources();
  console.log(`[PASS] twenty-server typecheck: ${verdict.detail}`);
  console.log('Scope: tsgo -p tsconfig.json over the WHOLE of twenty-server (src/ and scripts/, no exclusions and no missing-module allowlist) with the whole monorepo installed (devDependencies kept, no --production prune), twenty-shared/twenty-client-sdk/twenty-emails built from source and twenty-sdk\'s official declaration emit run, with no network. This is a type check, not a runtime check, and it does not build the frontend bundles.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const measured = { containerStatus: 0, depsBuildStatus: 0 };
  const clean = 'AOS_SHARED_DIST_FILES=120\nAOS_SDK_RENDERER_BUILD_DTS_BYTES=180\nAOS_TSGO_EXIT=0\nAOS_CANARY_EXIT=2\nAOS_CANARY_MATCHED_LINES=1\n';

  record('parseTypecheckOutput: a clean run with a rejected canary passes', () => {
    const r = parseTypecheckOutput(clean, measured);
    assert(r.ok, r.detail);
  });
  record('parseTypecheckOutput: tsgo exiting 0 on the ill-typed canary is rejected, not read as green', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_CANARY_EXIT=2', 'AOS_CANARY_EXIT=0'), measured);
    assert(!r.ok, 'expected a canary that passed to invalidate the run');
  });
  record('parseTypecheckOutput: a canary run that failed for unrelated reasons is rejected (the canary diagnostic must appear)', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_CANARY_MATCHED_LINES=1', 'AOS_CANARY_MATCHED_LINES=0'), measured);
    assert(!r.ok, 'expected a canary that never showed up in the errors to invalidate the run');
  });
  record('parseTypecheckOutput: a canary run KILLED by a signal is not a rejection', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_CANARY_EXIT=2', 'AOS_CANARY_EXIT=137'), measured);
    assert(!r.ok, 'expected a killed canary run to invalidate the run');
    assert(/killed/.test(r.detail), `expected the detail to say it was killed, got: ${r.detail}`);
  });
  record('parseTypecheckOutput: real type errors are reported with their TS lines', () => {
    const r = parseTypecheckOutput(`src/a.ts(1,1): error TS2322: Type 'string' is not assignable.\n${clean.replace('AOS_TSGO_EXIT=0', 'AOS_TSGO_EXIT=1')}`, measured);
    assert(!r.ok, 'expected a non-zero tsgo exit to fail');
    assert(r.errors.length === 1, `expected 1 error line captured, got ${r.errors?.length}`);
  });

  // The exact reproduction from .aos/reports/CRM-004-fix1-coordinator-review.md:
  // an interrupted/OOM-killed compiler prints no diagnostics, and the previous
  // parser read "no error lines" as "no errors".
  record('parseTypecheckOutput: a compiler killed at exit 137 with no diagnostics FAILS (the reproduced fix1 defect)', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_TSGO_EXIT=0', 'AOS_TSGO_EXIT=137'), measured);
    assert(!r.ok, 'expected exit 137 without diagnostics to fail');
    assert(/did not finish/.test(r.detail), `expected the detail to name the unfinished run, got: ${r.detail}`);
  });
  record('parseTypecheckOutput: any non-zero compiler exit without diagnostics fails, not just 137', () => {
    for (const code of ['1', '2', '-1', '143']) {
      const r = parseTypecheckOutput(clean.replace('AOS_TSGO_EXIT=0', `AOS_TSGO_EXIT=${code}`), measured);
      assert(!r.ok, `expected tsgo exit ${code} to fail`);
    }
  });
  record('parseTypecheckOutput: the baseline allowance is gone -- an unresolved module is now a plain failure', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    // Assembled, not written out: a literal here would match itself.
    const allowlist = ['BASELINE', 'UNRESOLVED'].join('_');
    assert(!source.includes(allowlist), 'the missing-module allowlist is back');
    const unresolved = "scripts/build-seed-front-components.ts(9,47): error TS2307: Cannot find module 'twenty-sdk/front-component-renderer/build'.";
    const r = parseTypecheckOutput(`${unresolved}\n${clean.replace('AOS_TSGO_EXIT=0', 'AOS_TSGO_EXIT=1')}`, measured);
    assert(!r.ok, 'expected the formerly allowed unresolved import to fail now');
    assert(r.errors.length === 1 && r.errors[0].includes('TS2307'), 'expected the unresolved import to be reported');
  });
  record('parseTypecheckOutput: an exit code of 0 printed alongside errors is a contradiction, not a pass', () => {
    const r = parseTypecheckOutput(`src/c.ts(1,1): error TS2322: nope.\n${clean}`, measured);
    assert(!r.ok, 'expected errors with exit 0 to fail');
  });
  record('parseTypecheckOutput: every missing marker fails closed instead of passing silently', () => {
    assert(!parseTypecheckOutput('some unrelated output', measured).ok, 'expected missing markers to fail');
    for (const name of ['AOS_TSGO_EXIT', 'AOS_CANARY_EXIT', 'AOS_CANARY_MATCHED_LINES', 'AOS_SHARED_DIST_FILES', 'AOS_SDK_RENDERER_BUILD_DTS_BYTES']) {
      const without = clean.split('\n').filter((l) => !l.startsWith(`${name}=`)).join('\n');
      const r = parseTypecheckOutput(without, measured);
      assert(!r.ok, `expected a missing ${name} to fail`);
      assert(r.detail.includes(name), `expected the failure to name ${name}, got: ${r.detail}`);
    }
  });
  record('parseTypecheckOutput: a DUPLICATED marker is ambiguous and fails, however green either copy looks', () => {
    const r = parseTypecheckOutput(`${clean}AOS_TSGO_EXIT=0\n`, measured);
    assert(!r.ok, 'expected a repeated marker to fail');
    const contradictory = parseTypecheckOutput(`${clean}AOS_TSGO_EXIT=137\n`, measured);
    assert(!contradictory.ok, 'expected a contradictory repeated marker to fail');
    assert(/appears 2 times/.test(r.detail), `expected the detail to name the duplication, got: ${r.detail}`);
  });
  record('parseTypecheckOutput: a non-numeric marker is not read as an exit code', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_TSGO_EXIT=0', 'AOS_TSGO_EXIT=ok'), measured);
    assert(!r.ok, 'expected a non-numeric marker to fail');
  });
  record('parseTypecheckOutput: a container that did not complete fails, whatever its partial markers say', () => {
    for (const status of [137, 1, null, undefined]) {
      const r = parseTypecheckOutput(clean, { containerStatus: status, depsBuildStatus: 0 });
      assert(!r.ok, `expected container status ${status} to fail`);
      assert(/container exited/.test(r.detail), `expected the detail to name the container, got: ${r.detail}`);
    }
  });
  record('parseTypecheckOutput: a FAILED dependency/SDK build fails before any marker is believed', () => {
    for (const status of [1, 137, null]) {
      const r = parseTypecheckOutput(clean, { containerStatus: 0, depsBuildStatus: status });
      assert(!r.ok, `expected deps build status ${status} to fail`);
      assert(/build image exited/.test(r.detail), `expected the detail to name the build, got: ${r.detail}`);
    }
  });
  record('parseTypecheckOutput: dependencies that produced no artifacts fail closed', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_SHARED_DIST_FILES=120', 'AOS_SHARED_DIST_FILES=0'), measured);
    assert(!r.ok, 'expected zero dependency artifacts to fail');
  });
  record('parseTypecheckOutput: an absent or empty SDK declaration fails closed (the artifact fix1 never produced)', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_SDK_RENDERER_BUILD_DTS_BYTES=180', 'AOS_SDK_RENDERER_BUILD_DTS_BYTES=0'), measured);
    assert(!r.ok, 'expected a missing SDK declaration to fail');
    assert(/front-component-renderer/.test(r.detail), `expected the detail to name the artifact, got: ${r.detail}`);
  });
  record('the typecheck Dockerfile exists, pins the same base as the official one and keeps the lifecycle-script policy', () => {
    const mine = readFileSync(resolve(REPO_ROOT, 'scripts/aos/typecheck.Dockerfile'), 'utf8');
    const official = readFileSync(resolve(REPO_ROOT, 'packages/twenty-docker/twenty/Dockerfile'), 'utf8');
    const base = (official.match(/^FROM (node:[^\s]+@sha256:[0-9a-f]+)/m) || [])[1];
    assert(base, 'could not read the pinned node base out of the official Dockerfile');
    assert(mine.includes(base), `the typecheck image must use the same pinned base (${base})`);
    const instructions = mine.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert(!/--production/.test(instructions), 'the typecheck tree must not be pruned to production');
    assert(!/enableScripts/.test(instructions), 'the typecheck image must not override the .yarnrc.yml script policy');
  });
  record('the source image runs twenty-sdk\'s OFFICIAL declaration step and fabricates no declaration of its own', () => {
    const sources = readFileSync(resolve(REPO_ROOT, 'scripts/aos/typecheck-sources.Dockerfile'), 'utf8');
    const project = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages/twenty-sdk/project.json'), 'utf8'));
    const official = project.targets.build.options.commands.find((c) => c.includes('emitDeclarationOnly'));
    assert(official, 'twenty-sdk\'s build target no longer has a declaration-emit command to mirror');
    // Every flag upstream passes, so this cannot quietly become a looser emit.
    for (const flag of ['tsconfig.lib.json', '--declaration', '--emitDeclarationOnly', '--noEmit false', '--outDir dist', '--rootDir src', 'tsc-alias']) {
      assert(official.includes(flag), `upstream's own command no longer contains '${flag}'`);
      assert(sources.includes(flag), `the source image no longer passes '${flag}'`);
    }
    const instructions = sources.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    // Reading a .d.ts is fine (the artifact assertions below do); WRITING one
    // is not, by redirection, heredoc or an inline `declare`.
    assert(!/>\s*\S*\.d\.ts|<<\s*\w*EOF|declare module/.test(instructions),
      'the source image writes a .d.ts by hand: a fabricated declaration is not a build output');
    assert(/--skip-nx-cache/.test(instructions), 'the dependency builds must bypass the Nx cache');
    assert(/test -s \/app\/packages\/twenty-sdk\/dist\/front-component-renderer\/build\/index\.d\.ts/.test(instructions),
      'the source image no longer proves the artifact it exists to produce');
  });
  record('the source context is a clean git archive: no bus, no dotenv, no Git, no agent state, no pre-built output', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/git archive --format=tar/.test(source), 'the source context is no longer a git archive');
    assert(!/-v['"\s,]+\$\{root\}:/.test(source), 'the whole checkout is mounted into the container again');
    assert(!/\bcp -r \/src\//.test(source), 'the per-gate cp -r from the Windows mounts is back');
    // git archive only ever emits committed, tracked content, so the context
    // cannot contain .git, .aos, node_modules or deploy/local/.env. The paths
    // are what bounds it further.
    const archived = [...source.matchAll(/SOURCE_PACKAGES\.map\(\(p\) => JSON\.stringify\(`packages\/\$\{p\}`\)\)/g)];
    assert(archived.length === 1, 'the archive paths are no longer derived from SOURCE_PACKAGES alone');
  });
  record('every typecheck build input exists in the checkout', () => {
    for (const relative of [...CONTEXT_PATHS, 'scripts/aos/typecheck.Dockerfile', 'scripts/aos/typecheck-sources.Dockerfile']) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, relative)]);
    }
  });
  record('twenty-server\'s declared workspace dependencies are all installed by the typecheck image', () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages/twenty-server/package.json'), 'utf8'));
    const declared = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
      .filter(([, v]) => String(v).startsWith('workspace:'))
      .map(([k]) => k);
    assert(declared.length > 0, 'parsed no workspace dependency out of twenty-server');
    const dockerfile = readFileSync(resolve(REPO_ROOT, 'scripts/aos/typecheck.Dockerfile'), 'utf8');
    assert(/yarn install --immutable/.test(dockerfile),
      'the typecheck image must install the whole monorepo: a focus leaves hoisted typings like @types/semver out');
    const root = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
    const workspaceDirs = (root.workspaces?.packages || []).filter((p) => !p.includes('*'));
    assert(workspaceDirs.length > 5, `expected the monorepo workspaces, parsed ${workspaceDirs.length}`);
    const missingManifests = workspaceDirs.filter((d) => !CONTEXT_PATHS.includes(`${d}/package.json`));
    assert(missingManifests.length === 0,
      `workspace manifest(s) absent from the build context: ${missingManifests.join(', ')}`);
    const notShipped = declared.filter((d) => !SOURCE_PACKAGES.includes(d));
    assert(notShipped.length === 0, `workspace dependencies whose sources never reach the image: ${notShipped.join(', ')}`);
  });
  record('every workspace twenty-server\'s tsconfig actually imports is in SOURCE_PACKAGES (including the undeclared twenty-sdk)', () => {
    // The import that fix1 could not resolve is in the project's scripts/
    // directory, which tsconfig.json does not exclude. Parsed from the real
    // file so a future upstream change cannot silently drop it.
    const script = readFileSync(resolve(REPO_ROOT, 'packages/twenty-server/scripts/build-seed-front-components.ts'), 'utf8');
    assert(/from 'twenty-sdk\/front-component-renderer\/build'/.test(script),
      'build-seed-front-components.ts no longer imports the twenty-sdk build output this environment exists to supply');
    const tsconfig = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages/twenty-server/tsconfig.json'), 'utf8'));
    assert(!(tsconfig.exclude || []).some((e) => e.startsWith('scripts')),
      'scripts/ is excluded from the tsconfig now, so this environment is carrying an artifact nobody typechecks');
    assert(SOURCE_PACKAGES.includes('twenty-sdk'), 'twenty-sdk is not among the sources');
    const sdk = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages/twenty-sdk/package.json'), 'utf8'));
    assert(sdk.exports['./front-component-renderer/build'].types === './dist/front-component-renderer/build/index.d.ts',
      'twenty-sdk resolves that subpath somewhere else now; the artifact this image builds would no longer be the one read');
  });
  record('the wrapper tears down only the container it named itself', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    assert(/--name', CONTAINER_NAME/.test(source), 'the typecheck container is no longer named by this run');
    assert(/'docker', 'rm', '-f', CONTAINER_NAME/.test(source), 'cleanup no longer targets this run\'s own container by name');
    assert(!/\bdocker.*(prune|kill \$\(|rm -f \$\()/.test(source), 'cleanup matches containers by pattern instead of by name');
  });

  // CRM-004 fix5 (reviewer finding, R3: cleanup targets only the run's own
  // test resources). The tar was /tmp/aos-crm-typecheck-sources.tar and the two
  // images were tagged ':gate': one fixed name each, shared by every run on the
  // distro. Two gates at once -- one worker per worktree, which is the
  // supported way to run them in parallel -- would overwrite each other's tar
  // and move each other's tag, so a compiler could read another tree's sources,
  // and one run's cleanup would delete the other's input.
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
    assert(!instructions.includes(`/tmp/${['aos-crm-typecheck-sources', 'tar'].join('.')}`), 'the fixed, distro-wide source tar is back');
    assert(!instructions.includes(`${['server-typecheck', 'gate'].join(':')}'`), 'a fixed ":gate" image tag is back, so two runs would build over each other');
  });
  record('the teardown names only the resources this run created, inside one bounded deadline', () => {
    const production = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('function selfTest()')[0];
    const teardown = (production.split('function removeOwnResources()')[1] || '').split('\nfunction ')[0];
    assert(teardown, 'there is no teardown function left to inspect');
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
  record('the source image proves an artifact for every workspace it builds, and each one is a declaration the package resolves', () => {
    const instructions = readFileSync(resolve(REPO_ROOT, 'scripts/aos/typecheck-sources.Dockerfile'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const runMany = (instructions.match(/nx run-many -t build -p ([a-z0-9 -]+?) --skip-nx-cache/) || [])[1];
    assert(runMany, 'could not parse the workspaces the source image builds');
    const built = [...runMany.trim().split(/\s+/), ...(/cd \/app\/packages\/twenty-sdk/.test(instructions) ? ['twenty-sdk'] : [])];
    assert(built.length === 4, `expected the four workspaces this image builds, parsed ${built.join(', ')}`);
    const proven = [...instructions.matchAll(/test -s \/app\/packages\/([\w-]+)(\/[^\s;]+)/g)].map((m) => ({ pkg: m[1], path: `.${m[2]}` }));
    for (const pkg of built) {
      const proofs = proven.filter((p) => p.pkg === pkg);
      assert(proofs.length > 0, `${pkg} is built in this image but no artifact of it is proven: a cached layer that lost one comes back as "module not found" and reads as a source error`);
      const exported = JSON.parse(readFileSync(resolve(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf8')).exports || {};
      const declared = Object.values(exported).map((e) => e && e.types).filter(Boolean);
      for (const proof of proofs) {
        assert(declared.includes(proof.path),
          `${pkg} does not resolve '${proof.path}' through its exports map, so proving it says nothing about what the typecheck reads`);
      }
    }
  });
  record('the run has its own deadline, and build + run + teardown fit inside the gate budget it is given', () => {
    const verify = JSON.parse(readFileSync(resolve(REPO_ROOT, '.aos/verify.json'), 'utf8'));
    const budget = verify.timeoutsMs['verify-server-typecheck.mjs'];
    assert(budget > 0, '.aos/verify.json declares no budget for this command');
    assert(RUN_TIMEOUT_MS < budget, `the internal run deadline (${RUN_TIMEOUT_MS}) must be under the gate budget (${budget}) so the teardown happens here`);
    // Two builds, the run and the teardown: if their deadlines can outlast the
    // budget, the harness kills the command first and the cleanup never runs,
    // which is the exact sequence that left a compiler container behind in fix1.
    const worstCase = 2 * BUILD_TIMEOUT_MS + RUN_TIMEOUT_MS + CLEANUP_TIMEOUT_MS;
    assert(worstCase <= budget, `the worst case (${worstCase} ms) exceeds the gate budget (${budget} ms)`);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

// Guarded, not run at import: `import()`ing this module to exercise its parser
// used to start the real Docker build and leave a compiler container behind.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else run();
}
