#!/usr/bin/env node
// CRM-004: the real typecheck of twenty-server.
//
// CRM-004's first attempt ran `tsgo` inside the runtime-focused `server-deps`
// tree and got 14 errors, every one of them an absent module. That is not a
// red typecheck and it is not a green one either: the environment did not hold
// twenty-server's declared dependencies, so the measurement did not measure
// the code. This runs it in a tree built for the purpose
// (scripts/aos/typecheck.Dockerfile), bypassing the Nx cache entirely so a
// cached PASS can never stand in for a run.
//
// It also proves the run can fail: a deliberately ill-typed canary file is
// added to the same project and tsgo must reject it. A tsgo that exits 0 on
// both is a tsgo that measured nothing, and that is reported as a failure.
//
// Fail-closed: if WSL, Docker, the image build or the container cannot be
// measured, this exits non-zero. It never degrades to "skipped".
//
//   node scripts/aos/verify-server-typecheck.mjs
//   node scripts/aos/verify-server-typecheck.mjs --self-test   (no WSL/Docker)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const IMAGE = 'aos-crm-local/server-typecheck:gate';
const CANARY_REL = 'src/aos-typecheck-canary.ts';

// Manifests only: the dependency inputs of the typecheck image. The sources
// are mounted read-only at run time instead, one workspace at a time.
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

export const SOURCE_PACKAGES = [
  'twenty-emails',
  'twenty-shared',
  'twenty-client-sdk',
  'twenty-oxlint-rules',
  'twenty-server',
];

// The one error that survives a monorepo-wide install, enumerated instead of
// filtered by pattern: twenty-server's `scripts/` directory is inside its
// tsconfig and imports a BUILD OUTPUT of twenty-sdk (7 vite builds + a rollup
// pass over twenty-ui/twenty-front-component-renderer). Building that chain to
// typecheck the server would make this command a frontend build, so this
// environment does not build it and the import does not resolve.
//
// The allowance is bounded three ways: the file and the module are named, the
// count must match exactly, and it only applies while the file is byte-identical
// to the pinned upstream commit. The moment AOS edits that file, or a second
// error appears, this command goes red.
export const BASELINE_UNRESOLVED = [
  {
    file: 'packages/twenty-server/scripts/build-seed-front-components.ts',
    errorFile: 'scripts/build-seed-front-components.ts',
    module: 'twenty-sdk/front-component-renderer/build',
  },
];

// tsgo prints nothing on success, so the verdict is read from the markers the
// container echoes, never from the exit code of the shell that wrapped it.
export function parseTypecheckOutput(output, { baselineFilesUnmodified = true } = {}) {
  const marker = (name) => {
    const m = output.match(new RegExp(`^${name}=(-?\\d+)$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const tsgo = marker('AOS_TSGO_EXIT');
  const canary = marker('AOS_CANARY_EXIT');
  const sharedArtifacts = marker('AOS_SHARED_DIST_FILES');
  if (tsgo === null) return { ok: false, detail: 'no AOS_TSGO_EXIT marker: tsgo did not run to completion' };
  if (canary === null) return { ok: false, detail: 'no AOS_CANARY_EXIT marker: the falsifiability check did not run' };
  if (sharedArtifacts === null || sharedArtifacts <= 0) {
    return { ok: false, detail: 'the workspace dependencies produced no build artifacts, so tsgo resolved them from nothing' };
  }
  if (canary === 0) {
    return { ok: false, detail: 'tsgo accepted a deliberately ill-typed file: this run proves nothing about the code' };
  }
  // A non-zero canary exit is not enough on its own: if the project already had
  // errors, the canary run would fail for reasons that have nothing to do with
  // the canary. The canary FILE has to appear in the errors.
  const canaryLines = marker('AOS_CANARY_MATCHED_LINES');
  if (canaryLines === null || canaryLines < 1) {
    return { ok: false, detail: 'the ill-typed canary is not among the reported errors: the falsifiability check did not land' };
  }
  const errors = output.split('\n')
    .filter((l) => /error TS\d+/.test(l))
    .filter((l) => !l.includes('aos-typecheck-canary'));
  const isBaseline = (line) => baselineFilesUnmodified && BASELINE_UNRESOLVED.some(
    (b) => line.includes(b.errorFile) && line.includes(b.module),
  );
  const unexpected = errors.filter((l) => !isBaseline(l));
  const baselineSeen = errors.length - unexpected.length;
  if (unexpected.length > 0) {
    return {
      ok: false,
      detail: `tsgo -p tsconfig.json exited ${tsgo} with ${unexpected.length} error(s) outside the declared baseline`,
      errors: unexpected.slice(0, 20),
    };
  }
  if (baselineSeen > BASELINE_UNRESOLVED.length) {
    return { ok: false, detail: `the declared baseline covers ${BASELINE_UNRESOLVED.length} error(s) but ${baselineSeen} matched` };
  }
  if (tsgo === 0 && errors.length > 0) {
    return { ok: false, detail: 'tsgo exited 0 while printing errors: the exit code and the output disagree' };
  }
  return {
    ok: true,
    detail: `no type error outside the ${baselineSeen} declared unresolved build-output import(s); the canary was rejected (exit ${canary}), ${sharedArtifacts} dependency artifact(s) present`,
  };
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

  for (const relative of [...CONTEXT_PATHS, 'scripts/aos/typecheck.Dockerfile']) {
    if (wsl(['test', '-e', `${root}/${relative}`]).status !== 0) {
      fail(`typecheck build input is missing from the checkout: ${relative}`);
    }
  }

  console.log('[INFO] rebuilding the typecheck dependency image (Docker layer cache makes this seconds once warm)');
  const contextPaths = [...CONTEXT_PATHS, 'scripts/aos/typecheck.Dockerfile'].map((p) => JSON.stringify(p)).join(' ');
  const build = wsl(['sh', '-c',
    `cd ${JSON.stringify(root)} && tar -cf - ${contextPaths} | ` +
    `docker build -f scripts/aos/typecheck.Dockerfile -t ${IMAGE} -`,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (build.status !== 0) fail(`docker build -f scripts/aos/typecheck.Dockerfile exited ${build.status}`);

  const script = [
    `cp -r ${SOURCE_PACKAGES.map((p) => `/src/${p}`).join(' ')} /app/packages/`,
    'cd /app',
    'export NX_DAEMON=false NX_NO_CLOUD=true',
    'npx nx run-many -t build -p twenty-shared twenty-client-sdk twenty-emails --skip-nx-cache >/tmp/deps-build.log 2>&1',
    'echo "AOS_DEPS_BUILD_EXIT=$?"',
    'echo "AOS_SHARED_DIST_FILES=$(find packages/twenty-shared/dist packages/twenty-client-sdk/dist packages/twenty-emails/dist -type f 2>/dev/null | wc -l)"',
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
    `grep -c 'aos-typecheck-canary' /tmp/canary.log | sed 's/^/AOS_CANARY_MATCHED_LINES=/'`,
    `rm -f ${CANARY_REL}`,
  ].join('\n');

  const mounts = SOURCE_PACKAGES.flatMap((p) => ['-v', `${root}/packages/${p}:/src/${p}:ro`]);
  // The baseline allowance only holds while upstream's file is untouched.
  const pinnedSha = JSON.parse(readFileSync(resolve(REPO_ROOT, 'docs/aos/bootstrap/provenance.json'), 'utf8')).upstream.sha;
  const baselineFilesUnmodified = BASELINE_UNRESOLVED.every((b) => {
    const diff = spawnSync('git', ['-C', REPO_ROOT, 'diff', '--quiet', pinnedSha, '--', b.file], { encoding: 'utf8' });
    return diff.status === 0;
  });
  if (!baselineFilesUnmodified) {
    console.log('[INFO] a file covered by the declared typecheck baseline differs from the pinned upstream commit; its allowance is withdrawn for this run');
  }

  const res = wsl(['docker', 'run', '--rm', '--network', 'none', ...mounts, IMAGE, 'sh', '-c', script]);
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const verdict = parseTypecheckOutput(output, { baselineFilesUnmodified });
  if (!verdict.ok) {
    // The container's own last lines, so a failure here is diagnosable instead
    // of just "no marker".
    console.error(output.split('\n').slice(-25).join('\n'));
    for (const line of verdict.errors || []) console.error(`  ${line}`);
    fail(`twenty-server typecheck: ${verdict.detail}`);
  }
  console.log(`[PASS] twenty-server typecheck: ${verdict.detail}`);
  for (const b of BASELINE_UNRESOLVED) {
    console.log(`  declared baseline: ${b.errorFile} imports ${b.module}, a build output of twenty-sdk that this environment does not build (file unmodified vs ${pinnedSha.slice(0, 10)})`);
  }
  console.log('Scope: tsgo -p tsconfig.json over twenty-server with the WHOLE monorepo installed (devDependencies kept, no --production prune) and twenty-shared/twenty-client-sdk/twenty-emails built from source, with no network. This is a type check, not a runtime check, and it does not build the frontend workspaces.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const clean = 'AOS_DEPS_BUILD_EXIT=0\nAOS_SHARED_DIST_FILES=120\nAOS_TSGO_EXIT=0\nAOS_CANARY_EXIT=2\nAOS_CANARY_MATCHED_LINES=1\n';

  record('parseTypecheckOutput: a clean run with a rejected canary passes', () => {
    assert(parseTypecheckOutput(clean).ok, parseTypecheckOutput(clean).detail);
  });
  record('parseTypecheckOutput: tsgo exiting 0 on the ill-typed canary is rejected, not read as green', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_CANARY_EXIT=2', 'AOS_CANARY_EXIT=0'));
    assert(!r.ok, 'expected a canary that passed to invalidate the run');
  });
  record('parseTypecheckOutput: a canary run that failed for unrelated reasons is rejected (the canary file must appear)', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_CANARY_MATCHED_LINES=1', 'AOS_CANARY_MATCHED_LINES=0'));
    assert(!r.ok, 'expected a canary that never showed up in the errors to invalidate the run');
  });
  record('parseTypecheckOutput: real type errors are reported with their TS lines', () => {
    const r = parseTypecheckOutput(`src/a.ts(1,1): error TS2322: Type 'string' is not assignable.\n${clean.replace('AOS_TSGO_EXIT=0', 'AOS_TSGO_EXIT=1')}`);
    assert(!r.ok, 'expected a non-zero tsgo exit to fail');
    assert(r.errors.length === 1, `expected 1 error line captured, got ${r.errors?.length}`);
  });
  const baselineLine = `${BASELINE_UNRESOLVED[0].errorFile}(9,47): error TS2307: Cannot find module '${BASELINE_UNRESOLVED[0].module}' or its corresponding type declarations.`;
  const withBaseline = `${baselineLine}\n${clean.replace('AOS_TSGO_EXIT=0', 'AOS_TSGO_EXIT=1')}`;
  record('parseTypecheckOutput: the single declared unresolved build-output import passes, and is reported as such', () => {
    const r = parseTypecheckOutput(withBaseline);
    assert(r.ok, r.detail);
    assert(/declared unresolved build-output/.test(r.detail), `expected the detail to name the allowance, got: ${r.detail}`);
  });
  record('parseTypecheckOutput: one more error beside the declared baseline fails', () => {
    const r = parseTypecheckOutput(`src/b.ts(3,3): error TS2345: nope.\n${withBaseline}`);
    assert(!r.ok, 'expected an extra error to fail');
    assert(r.errors.length === 1 && r.errors[0].includes('src/b.ts'), 'expected only the unexpected error to be reported');
  });
  record('parseTypecheckOutput: the allowance is withdrawn when the baseline file no longer matches upstream', () => {
    const r = parseTypecheckOutput(withBaseline, { baselineFilesUnmodified: false });
    assert(!r.ok, 'expected the baseline error to count once the file is no longer upstream\'s');
  });
  record('parseTypecheckOutput: an exit code of 0 printed alongside errors is a contradiction, not a pass', () => {
    const r = parseTypecheckOutput(`src/c.ts(1,1): error TS2322: nope.\n${clean}`);
    assert(!r.ok, 'expected errors with exit 0 to fail');
  });
  record('the declared baseline file exists and is byte-identical to the pinned upstream commit', () => {
    const pin = JSON.parse(readFileSync(resolve(REPO_ROOT, 'docs/aos/bootstrap/provenance.json'), 'utf8')).upstream.sha;
    for (const b of BASELINE_UNRESOLVED) {
      execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, b.file)]);
      execFileSync('git', ['-C', REPO_ROOT, 'diff', '--quiet', pin, '--', b.file]);
    }
  });
  record('parseTypecheckOutput: a missing tsgo marker fails closed instead of passing silently', () => {
    assert(!parseTypecheckOutput('some unrelated output').ok, 'expected missing markers to fail');
  });
  record('parseTypecheckOutput: dependencies that produced no artifacts fail closed', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_SHARED_DIST_FILES=120', 'AOS_SHARED_DIST_FILES=0'));
    assert(!r.ok, 'expected zero dependency artifacts to fail');
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
  record('every typecheck build input exists in the checkout', () => {
    for (const relative of [...CONTEXT_PATHS, 'scripts/aos/typecheck.Dockerfile']) {
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
    const notMounted = declared.filter((d) => !SOURCE_PACKAGES.includes(d));
    assert(notMounted.length === 0, `workspace dependencies whose sources are never mounted: ${notMounted.join(', ')}`);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
