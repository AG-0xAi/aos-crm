#!/usr/bin/env node
// CRM-004 fix2: the gate actually BUILDS the application from this source.
//
// R3 asks for a source build inside the gate. CRM-004-fix1 answered it with
// scripts/aos/verify-image-provenance.mjs, which inspects an image's labels --
// useful, but it only ever says "whatever built this claimed to be at commit X".
// An inspection is not a build: it passes just as happily on bytes produced
// weeks ago by a command nobody can re-run.
//
// This runs the official target, the official way:
//   docker build --target twenty -f packages/twenty-docker/twenty/Dockerfile .
// with the same build arg and the same five labels deploy/local/compose.yaml
// passes, from the same repo-root context, under the same image reference. The
// stages, arguments and labels are not reimplemented here: the self-test parses
// compose.yaml and fails if this command stops matching what the deployment
// builds.
//
// Cheap when nothing changed, honest when something did. The official
// Dockerfile only ever COPYs named paths (manifests, .yarn, and the workspace
// directories it needs), so a change under scripts/, deploy/ or .aos/ does not
// invalidate a single layer and the build is a cache hit; a change under
// packages/ rebuilds exactly the stages that depend on it. A new AOS commit
// changes only the labels, which are image config rather than a layer, so a
// per-commit image reference does NOT force the application to recompile.
//
// Fail-closed: a build that cannot run, a non-zero exit, an image reference
// that disagrees with the deployment profile, or a missing artifact inside the
// result are all failures. The verdict comes from the exit code AND from
// artifacts measured inside the image, never from the absence of red text.
//
//   node scripts/aos/verify-image-build.mjs
//   node scripts/aos/verify-image-build.mjs --self-test   (no WSL/Docker)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const ENV_PATH = resolve(REPO_ROOT, 'deploy/local/.env');
const PROVENANCE_PATH = resolve(REPO_ROOT, 'docs/aos/bootstrap/provenance.json');
const COMPOSE_PATH = resolve(REPO_ROOT, 'deploy/local/compose.yaml');
const DOCKERFILE = 'packages/twenty-docker/twenty/Dockerfile';
const TARGET = 'twenty';
// Measured on this host 2026-10-28: a warm build of this target is seconds
// plus the context transfer; the cold one that produced the first image took
// ~40 min and is recorded in docs/aos/bootstrap/BUILD_BASELINE.md.
const BUILD_TIMEOUT_MS = Number(process.env.AOS_CRM_BUILD_TIMEOUT_MS || 3_300_000);

// Measured inside the built image, not inferred from the target name. Each one
// is the output of a stage that has actually failed in this track: the server
// compile, the worker entry point, the frontend bundle, and the Lingui
// catalogs whose extract step was the deterministic build blocker.
export const REQUIRED_ARTIFACTS = [
  '/app/packages/twenty-server/dist/main.js',
  '/app/packages/twenty-server/dist/queue-worker/queue-worker.js',
  '/app/packages/twenty-server/dist/front/index.html',
  '/app/packages/twenty-server/dist/engine/core-modules/i18n/locales/generated/fr-FR.js',
  '/app/entrypoint.sh',
];

export function readEnvKeys(path) {
  const found = {};
  let raw = '';
  try { raw = readFileSync(path, 'utf8'); } catch { return found; }
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    found[key.trim()] = rest.join('=').trim();
  }
  return found;
}

// The same reference scripts/aos/local.ps1 derives (Get-SourcePinnedImageTag):
// upstream version, upstream pin, and the AOS commit these bytes came from.
export function imageReference({ upstreamTag, upstreamSha, aosCommit }) {
  const version = String(upstreamTag).split('/').pop();
  return `aos-crm-local/twenty:${version}-${upstreamSha.slice(0, 10)}-aos${aosCommit.slice(0, 12)}`;
}

// Pure: the verdict, so the self-test covers every rule without Docker.
export function judgeBuild({ buildStatus, missingArtifacts, imageAppVersion, expectedAppVersion, builtImageId }) {
  const problems = [];
  if (buildStatus !== 0) problems.push(`docker build --target ${TARGET} exited ${buildStatus ?? 'unmeasured'}`);
  if (!Array.isArray(missingArtifacts)) {
    problems.push('the built image could not be probed for its artifacts, so the build result was never measured');
  } else if (missingArtifacts.length > 0) {
    problems.push(`the built image is missing ${missingArtifacts.length} artifact(s) the official target produces: ${missingArtifacts.join(', ')}`);
  }
  if (imageAppVersion !== expectedAppVersion) {
    problems.push(`the built image carries APP_VERSION='${imageAppVersion}', not the '${expectedAppVersion}' the deployment profile builds with`);
  }
  if (!builtImageId || !/^sha256:[0-9a-f]{64}$/.test(builtImageId)) {
    problems.push(`the build produced no usable image id (got '${builtImageId}')`);
  }
  return { ok: problems.length === 0, problems };
}

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

function git(args) {
  const res = spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) fail(`git ${args.join(' ')} exited ${res.status}`);
  return res.stdout;
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

// The build args and labels are read out of compose.yaml rather than copied
// here, so this command cannot drift from what the deployment builds.
export function parseComposeBuild(composeText) {
  const labels = {};
  // Scoped to the build's own `labels:` block: the services' `environment:`
  // entries sit at the same indentation and would otherwise be read as labels.
  const lines = composeText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s{4}labels:\s*$/.test(l));
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (!/^\s{6}\S/.test(line)) break;
      const match = line.match(/^\s{6}([\w.]+):\s*"([^"]*)"\s*$/);
      if (match) labels[match[1]] = match[2];
    }
  }
  const appVersion = (composeText.match(/^\s*APP_VERSION:\s*(\S+)\s*$/m) || [])[1];
  const target = (composeText.match(/^\s*target:\s*(\S+)\s*$/m) || [])[1];
  const dockerfile = (composeText.match(/^\s*dockerfile:\s*(\S+)\s*$/m) || [])[1];
  return { labels, appVersion, target, dockerfile };
}

// '${AOS_CRM_APP_VERSION:-2.51.0+15e4826d3b}' -> the env value, or the default.
export function resolveComposeValue(expression, env) {
  const match = String(expression).match(/^\$\{([A-Z_0-9]+)(?::-(.*))?\}$/);
  if (!match) return String(expression);
  const [, name, fallback] = match;
  return env[name] || fallback || '';
}

function run() {
  const linuxRoot = wsl(['wslpath', '-a', REPO_ROOT]);
  if (linuxRoot.status !== 0 || !linuxRoot.stdout.trim()) {
    fail(`could not reach WSL distro '${DISTRO}' to translate the repo path (status=${linuxRoot.status})`);
  }
  const root = linuxRoot.stdout.trim();

  const dirty = git(['status', '--porcelain']).split('\n').some((l) => l.trim() !== '');
  if (dirty) fail('this checkout has uncommitted changes: an image built from it could not be labelled with a commit that describes its bytes');

  const head = git(['rev-parse', 'HEAD']).trim();
  const tree = git(['rev-parse', 'HEAD^{tree}']).trim();
  const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')).upstream;
  const expectedTag = imageReference({ upstreamTag: provenance.tag, upstreamSha: provenance.sha, aosCommit: head });

  const env = readEnvKeys(ENV_PATH);
  if (env.AOS_CRM_IMAGE_TAG !== expectedTag) {
    fail(`deploy/local/.env names the image '${env.AOS_CRM_IMAGE_TAG || '(unset)'}' but this commit's artifact is '${expectedTag}'. Run scripts/aos/local.ps1 -Action Restart so the profile, the build and the running services agree on one reference.`);
  }

  const compose = parseComposeBuild(readFileSync(COMPOSE_PATH, 'utf8'));
  if (compose.target !== TARGET || compose.dockerfile !== DOCKERFILE) {
    fail(`compose.yaml builds target '${compose.target}' from '${compose.dockerfile}'; this command builds '${TARGET}' from '${DOCKERFILE}'`);
  }
  const appVersion = resolveComposeValue(compose.appVersion, env);
  if (!appVersion) fail('could not resolve APP_VERSION out of compose.yaml and deploy/local/.env');

  // Every label compose passes, with the live source values substituted in:
  // the upstream ones are literals in compose.yaml, the ai.aos.crm.source.*
  // ones come from Git right now.
  const sourceValues = {
    AOS_CRM_SOURCE_COMMIT: head,
    AOS_CRM_SOURCE_TREE: tree,
    AOS_CRM_SOURCE_DIRTY: 'false',
  };
  const labelArgs = [];
  for (const [key, expression] of Object.entries(compose.labels)) {
    const value = resolveComposeValue(expression, sourceValues);
    if (!value || value === 'unset') fail(`compose label ${key} resolves to '${value}', which would make the artifact untraceable`);
    labelArgs.push('--label', `${key}=${value}`);
  }
  if (labelArgs.length !== 10) fail(`expected compose.yaml's five build labels, parsed ${labelArgs.length / 2}`);

  // Same context (the repo root, filtered by .dockerignore), same Dockerfile,
  // same target, same arg, same labels, same reference as compose: that is what
  // makes the layer cache shared instead of a second, parallel 40-minute build.
  console.log(`[INFO] docker build --target ${TARGET} -f ${DOCKERFILE} -t ${expectedTag} (context: the checkout root, filtered by .dockerignore)`);
  const started = Date.now();
  const build = wsl(['docker', 'build',
    '--target', TARGET,
    '-f', `${root}/${DOCKERFILE}`,
    '--build-arg', `APP_VERSION=${appVersion}`,
    ...labelArgs,
    '-t', expectedTag,
    root,
  ], { stdio: ['ignore', 'inherit', 'inherit'], timeout: BUILD_TIMEOUT_MS });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (build.error?.code === 'ETIMEDOUT' || build.signal) {
    fail(`the build exceeded its ${BUILD_TIMEOUT_MS} ms budget after ${seconds}s`);
  }

  // Probed inside the result, so "the build exited 0" cannot stand in for "the
  // build produced the application".
  let missingArtifacts = null;
  let imageAppVersion = null;
  let builtImageId = null;
  if (build.status === 0) {
    missingArtifacts = [];
    for (const artifact of REQUIRED_ARTIFACTS) {
      const probe = wsl(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'test', expectedTag, '-s', artifact]);
      if (probe.status === 1) missingArtifacts.push(artifact);
      else if (probe.status !== 0) {
        missingArtifacts = null;
        console.error(`[INFO] could not probe ${artifact} (status=${probe.status}): ${(probe.stderr || '').slice(-200)}`);
        break;
      }
    }
    const inspect = wsl(['docker', 'image', 'inspect', '--format', '{{.Id}}|{{range .Config.Env}}{{println .}}{{end}}', expectedTag]);
    if (inspect.status === 0) {
      const [id, ...envLines] = inspect.stdout.split('|');
      builtImageId = id.trim();
      imageAppVersion = (envLines.join('|').split('\n').find((l) => l.startsWith('APP_VERSION=')) || '').slice('APP_VERSION='.length).trim();
    }
  }

  const verdict = judgeBuild({ buildStatus: build.status, missingArtifacts, imageAppVersion, expectedAppVersion: appVersion, builtImageId });
  if (!verdict.ok) {
    for (const problem of verdict.problems) console.error(`  - ${problem}`);
    fail(`the application build did not produce a usable artifact (${verdict.problems.length} problem(s), ${seconds}s)`);
  }
  console.log(`[PASS] built ${expectedTag} in ${seconds}s (exit 0)`);
  console.log(`  image id: ${builtImageId}`);
  console.log(`  APP_VERSION: ${imageAppVersion}`);
  console.log(`  artifacts measured inside the image: ${REQUIRED_ARTIFACTS.join(', ')}`);
  console.log('Scope: the official `twenty` target, built from this commit with compose.yaml\'s own arg and labels. It does not start the stack, does not run migrations and does not scan the image.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const good = {
    buildStatus: 0,
    missingArtifacts: [],
    imageAppVersion: '2.51.0+15e4826d3b',
    expectedAppVersion: '2.51.0+15e4826d3b',
    builtImageId: `sha256:${'a'.repeat(64)}`,
  };

  record('judgeBuild: a build that exited 0 and produced every artifact passes', () => {
    const r = judgeBuild(good);
    assert(r.ok, r.problems.join('; '));
  });
  record('judgeBuild: a non-zero build is a failure, whatever is already in the image', () => {
    for (const status of [1, 137, null, undefined]) {
      const r = judgeBuild({ ...good, buildStatus: status });
      assert(!r.ok, `expected build status ${status} to fail`);
    }
  });
  record('judgeBuild: a build that exited 0 without producing the artifacts fails', () => {
    const r = judgeBuild({ ...good, missingArtifacts: ['/app/packages/twenty-server/dist/front/index.html'] });
    assert(!r.ok, 'expected a missing artifact to fail');
    assert(r.problems.some((p) => p.includes('index.html')), `expected the problem to name it: ${r.problems.join('; ')}`);
  });
  record('judgeBuild: artifacts that could not be probed fail closed, never "assumed present"', () => {
    assert(!judgeBuild({ ...good, missingArtifacts: null }).ok, 'expected an unmeasured probe to fail');
  });
  record('judgeBuild: an image built with a different APP_VERSION than the profile is rejected', () => {
    const r = judgeBuild({ ...good, imageAppVersion: 'twenty-v2.51.0' });
    assert(!r.ok, 'expected a mismatched APP_VERSION to fail');
  });
  record('judgeBuild: a build with no resulting image id is rejected', () => {
    assert(!judgeBuild({ ...good, builtImageId: '' }).ok, 'expected a missing image id to fail');
    assert(!judgeBuild({ ...good, builtImageId: 'latest' }).ok, 'expected a non-digest image id to fail');
  });

  record('the official stages, target, Dockerfile, arg and labels are read from compose.yaml, not reimplemented', () => {
    const compose = parseComposeBuild(readFileSync(COMPOSE_PATH, 'utf8'));
    assert(compose.target === TARGET, `compose.yaml builds target '${compose.target}', this command builds '${TARGET}'`);
    assert(compose.dockerfile === DOCKERFILE, `compose.yaml uses '${compose.dockerfile}'`);
    assert(/^\$\{AOS_CRM_APP_VERSION/.test(compose.appVersion), `could not parse APP_VERSION out of compose.yaml (got '${compose.appVersion}')`);
    const expected = [
      'org.opencontainers.image.revision',
      'org.opencontainers.image.version',
      'ai.aos.crm.source.commit',
      'ai.aos.crm.source.tree',
      'ai.aos.crm.source.dirty',
    ];
    for (const label of expected) {
      assert(Object.prototype.hasOwnProperty.call(compose.labels, label), `compose.yaml label ${label} is no longer parsed by this command`);
    }
    assert(Object.keys(compose.labels).length === expected.length,
      `compose.yaml now passes ${Object.keys(compose.labels).length} build labels; this command would drop the new one(s): ${Object.keys(compose.labels).join(', ')}`);
  });
  record('the official Dockerfile keeps every stage this target depends on', () => {
    const dockerfile = readFileSync(resolve(REPO_ROOT, DOCKERFILE), 'utf8');
    for (const stage of ['node-base', 'front-deps', 'server-deps', 'twenty-server-build', 'twenty-front-build', 'twenty-server', 'twenty']) {
      assert(new RegExp(`^FROM .* AS ${stage}$`, 'm').test(dockerfile), `the official Dockerfile no longer defines the '${stage}' stage`);
    }
    // The one AOS change inside the official Dockerfile, still the only one.
    assert(/THREADS_WORKER_INIT_TIMEOUT=180000/.test(dockerfile), 'the approved Lingui worker timeout is gone, so the build blocker is back');
  });
  record('resolveComposeValue: substitutes the profile value and falls back to compose\'s own default', () => {
    assert(resolveComposeValue('${AOS_CRM_APP_VERSION:-2.51.0+15e4826d3b}', {}) === '2.51.0+15e4826d3b', 'the default was not used');
    assert(resolveComposeValue('${AOS_CRM_APP_VERSION:-2.51.0+15e4826d3b}', { AOS_CRM_APP_VERSION: '9.9.9' }) === '9.9.9', 'the profile value was not used');
    assert(resolveComposeValue('"literal"', {}) === '"literal"', 'a literal should come back unchanged');
    assert(resolveComposeValue('${AOS_CRM_SOURCE_COMMIT:-unset}', {}) === 'unset', 'the unset default should surface so the caller can reject it');
  });
  record('the image reference this command builds is the one local.ps1 and the provenance gate expect', () => {
    const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')).upstream;
    const head = 'b'.repeat(40);
    const reference = imageReference({ upstreamTag: provenance.tag, upstreamSha: provenance.sha, aosCommit: head });
    assert(reference === `aos-crm-local/twenty:v2.51.0-15e4826d3b-aos${'b'.repeat(12)}`, `unexpected reference: ${reference}`);
    const provenanceGate = readFileSync(resolve(REPO_ROOT, 'scripts/aos/verify-image-provenance.mjs'), 'utf8');
    assert(/aosTagSuffix/.test(provenanceGate), 'the provenance gate no longer checks the AOS half of the reference');
    const local = readFileSync(resolve(REPO_ROOT, 'scripts/aos/local.ps1'), 'utf8');
    assert(/Get-SourcePinnedImageTag/.test(local), 'local.ps1 no longer derives the same reference');
  });
  record('the context is the checkout root that compose builds from, so the layer cache is shared and not duplicated', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const compose = readFileSync(COMPOSE_PATH, 'utf8');
    assert(/^\s*context:\s*\.\.\/\.\.$/m.test(compose), 'compose.yaml no longer builds from the checkout root, so this command would miss its cache');
    // A different context (a tar, a subdirectory) changes the content hash of
    // every COPY and would mean a second full build rather than a cache hit.
    assert(/'-t', expectedTag,\s*\n\s*root,/.test(source), 'the build no longer passes the checkout root as its context');
    // Assembled so this assertion cannot match itself. A tar context and the
    // .dockerignore-filtered tree do not hash the same, and a mismatch means a
    // second full build instead of a cache hit.
    assert(!source.includes(['git', 'archive'].join(' ')), 'the build context diverged from the one compose builds from');
  });
  record('every artifact this gate requires is named by the official Dockerfile\'s own stages', () => {
    const dockerfile = readFileSync(resolve(REPO_ROOT, DOCKERFILE), 'utf8');
    assert(/dist\/front/.test(dockerfile), 'the Dockerfile no longer places the frontend where this gate looks for it');
    assert(/entrypoint\.sh \/app\/entrypoint\.sh/.test(dockerfile), 'the entrypoint moved');
    assert(REQUIRED_ARTIFACTS.every((p) => p.startsWith('/app/')), 'an artifact path escaped /app');
    assert(REQUIRED_ARTIFACTS.length >= 5, 'the artifact list shrank');
  });
  record('the build budget fits inside the gate budget declared for this command', () => {
    const verify = JSON.parse(readFileSync(resolve(REPO_ROOT, '.aos/verify.json'), 'utf8'));
    assert(verify.commands.includes('node scripts/aos/verify-image-build.mjs'),
      '.aos/verify.json does not run this command, so R3 still has no build in the gate');
    const budget = verify.timeoutsMs['verify-image-build.mjs'];
    assert(budget > 0, '.aos/verify.json declares no budget for this command');
    assert(BUILD_TIMEOUT_MS < budget, `the internal build deadline (${BUILD_TIMEOUT_MS}) must be under the gate budget (${budget})`);
  });
  record('provenance.json and the compose profile are readable from here', () => {
    execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', PROVENANCE_PATH]);
    execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', COMPOSE_PATH]);
    execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', resolve(REPO_ROOT, DOCKERFILE)]);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
