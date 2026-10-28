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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const IMAGE = 'aos-crm-local/server-typecheck:gate';
const CANARY_REL = 'src/aos-typecheck-canary.ts';

// Manifests only: the dependency inputs of the typecheck image. The sources
// are mounted read-only at run time instead, one workspace at a time.
export const CONTEXT_PATHS = [
  'package.json',
  'yarn.lock',
  '.yarnrc.yml',
  'tsconfig.base.json',
  'nx.json',
  '.yarn/releases',
  '.yarn/patches',
  'packages/twenty-server/package.json',
  'packages/twenty-server/patches',
  'packages/twenty-emails/package.json',
  'packages/twenty-shared/package.json',
  'packages/twenty-client-sdk/package.json',
  'packages/twenty-oxlint-rules/package.json',
];

export const SOURCE_PACKAGES = [
  'twenty-emails',
  'twenty-shared',
  'twenty-client-sdk',
  'twenty-oxlint-rules',
  'twenty-server',
];

// tsgo prints nothing on success, so the verdict is read from the markers the
// container echoes, never from the exit code of the shell that wrapped it.
export function parseTypecheckOutput(output) {
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
  if (tsgo !== 0) {
    const errors = output.split('\n').filter((l) => /error TS\d+/.test(l));
    return {
      ok: false,
      detail: `tsgo -p tsconfig.json exited ${tsgo} with ${errors.length} error line(s)`,
      errors: errors.slice(0, 20),
    };
  }
  return { ok: true, detail: `tsgo exited 0, the canary was rejected (${canary}), ${sharedArtifacts} dependency artifact(s) present` };
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
    // summary without running the compiler.
    'npx tsgo -p tsconfig.json 2>&1 | tail -n 40',
    'echo "AOS_TSGO_EXIT=${PIPESTATUS[0]}"',
    `printf 'export const aosTypecheckCanary: number = "not a number";\\n' > ${CANARY_REL}`,
    'npx tsgo -p tsconfig.json >/tmp/canary.log 2>&1',
    'echo "AOS_CANARY_EXIT=$?"',
    `grep -c 'aos-typecheck-canary' /tmp/canary.log | sed 's/^/AOS_CANARY_MATCHED_LINES=/'`,
    `rm -f ${CANARY_REL}`,
  ].join('\n');

  const mounts = SOURCE_PACKAGES.flatMap((p) => ['-v', `${root}/packages/${p}:/src/${p}:ro`]);
  const res = wsl(['docker', 'run', '--rm', '--network', 'none', ...mounts, IMAGE, 'bash', '-c', script]);
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const verdict = parseTypecheckOutput(output);
  if (!verdict.ok) {
    for (const line of verdict.errors || []) console.error(`  ${line}`);
    fail(`twenty-server typecheck: ${verdict.detail}`);
  }
  console.log(`[PASS] twenty-server typecheck: ${verdict.detail}`);
  console.log('Scope: tsgo -p tsconfig.json over twenty-server with its declared dependency closure installed (devDependencies kept, no --production prune) and twenty-shared/twenty-client-sdk/twenty-emails built from source, with no network. This is a type check, not a runtime check.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const clean = 'AOS_DEPS_BUILD_EXIT=0\nAOS_SHARED_DIST_FILES=120\nAOS_TSGO_EXIT=0\nAOS_CANARY_EXIT=2\n';

  record('parseTypecheckOutput: a clean run with a rejected canary passes', () => {
    assert(parseTypecheckOutput(clean).ok, parseTypecheckOutput(clean).detail);
  });
  record('parseTypecheckOutput: tsgo exiting 0 on the ill-typed canary is rejected, not read as green', () => {
    const r = parseTypecheckOutput(clean.replace('AOS_CANARY_EXIT=2', 'AOS_CANARY_EXIT=0'));
    assert(!r.ok, 'expected a canary that passed to invalidate the run');
  });
  record('parseTypecheckOutput: real type errors are reported with their TS lines', () => {
    const r = parseTypecheckOutput(`src/a.ts(1,1): error TS2322: Type 'string' is not assignable.\n${clean.replace('AOS_TSGO_EXIT=0', 'AOS_TSGO_EXIT=1')}`);
    assert(!r.ok, 'expected a non-zero tsgo exit to fail');
    assert(r.errors.length === 1, `expected 1 error line captured, got ${r.errors?.length}`);
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
    const missing = declared.filter((d) => !dockerfile.includes(d));
    assert(missing.length === 0, `workspace dependencies absent from the focus: ${missing.join(', ')}`);
    const notMounted = declared.filter((d) => !SOURCE_PACKAGES.includes(d));
    assert(notMounted.length === 0, `workspace dependencies whose sources are never mounted: ${notMounted.join(', ')}`);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
