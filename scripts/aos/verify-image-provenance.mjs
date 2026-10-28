#!/usr/bin/env node
// CRM-004: the application image has to say which source produced its bytes.
//
// The upstream revision label alone does not: every AOS commit on top of the
// pin builds a different image while naming the same upstream SHA, and the tag
// itself is mutable -- `aos-crm-local/twenty:v2.51.0-15e4826d3b` can be made to
// point at any bytes at all, including an intermediate dependency image. So
// this checks the image Docker would actually run: its own config digest, the
// upstream pin, the AOS commit and tree it was built from, that the tree was
// clean when it was built, and that it really is the full application target
// (the frontend the server serves lives inside it).
//
// Fail-closed: a label that reads 'unset', a commit that is not this HEAD, a
// dirty build, or an image that cannot be inspected are all failures. There is
// no "could not determine, assuming fine" path.
//
//   node scripts/aos/verify-image-provenance.mjs
//   node scripts/aos/verify-image-provenance.mjs --self-test   (no WSL/Docker)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const ENV_PATH = resolve(REPO_ROOT, 'deploy/local/.env');
const PROVENANCE_PATH = resolve(REPO_ROOT, 'docs/aos/bootstrap/provenance.json');
const FRONT_INDEX = '/app/packages/twenty-server/dist/front/index.html';

function readEnvKeys(path) {
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

// The services that must be running the verified image. A tag that describes
// the right bytes while the containers run older ones is not provenance.
export const APP_SERVICES = ['server', 'worker'];

// The AOS half of the image reference. scripts/aos/local.ps1's
// Get-SourcePinnedImageTag builds the name; this is the part of it that pins
// the name to one AOS commit, and the self-test checks the two agree.
export function aosTagSuffix(head) {
  return `aos${head.slice(0, 12)}`;
}

// Pure: the whole verdict, so every rule is covered by the self-test without
// Docker. Takes the labels Docker reported, the stamp Git reports now, and the
// image every running app service actually resolved to.
export function judgeImage({ tag, labels, imageId, expectedUpstreamSha, head, tree, dirty, servesFrontend, runningServices }) {
  const problems = [];
  const shortPin = expectedUpstreamSha.slice(0, 10);
  if (!tag) problems.push('AOS_CRM_IMAGE_TAG is not set in deploy/local/.env');
  else if (/:latest$/.test(tag) || !tag.includes(':')) problems.push(`the image tag '${tag}' is a moving tag`);
  else if (!tag.includes(shortPin)) problems.push(`the image tag '${tag}' does not name the pinned upstream source ${shortPin}`);
  // CRM-004-fix1 named every build after the upstream pin alone, so each AOS
  // commit silently overwrote the previous image behind the same reference
  // (observed twice on 2026-10-28: ImageID 86a21ef0, then 353a1cf2). The pin
  // is necessary but not sufficient: the reference has to name this tree too,
  // or it is a base reference that any commit can claim.
  else if (!tag.includes(aosTagSuffix(head))) {
    problems.push(`the image reference '${tag}' names the upstream pin but not this AOS commit (expected it to carry ${aosTagSuffix(head)}): a reference every AOS tree overwrites cannot identify these bytes`);
  }
  if (!imageId || !/^sha256:[0-9a-f]{64}$/.test(imageId)) problems.push(`the image has no usable config digest (got '${imageId}')`);
  const revision = labels['org.opencontainers.image.revision'];
  if (revision !== expectedUpstreamSha) problems.push(`org.opencontainers.image.revision is '${revision}', expected the pinned ${expectedUpstreamSha}`);
  const commit = labels['ai.aos.crm.source.commit'];
  if (commit !== head) problems.push(`ai.aos.crm.source.commit is '${commit}', but this checkout is at ${head}: the image was built from different sources`);
  if (labels['ai.aos.crm.source.tree'] !== tree) problems.push(`ai.aos.crm.source.tree is '${labels['ai.aos.crm.source.tree']}', expected ${tree}`);
  if (labels['ai.aos.crm.source.dirty'] !== 'false') problems.push(`ai.aos.crm.source.dirty is '${labels['ai.aos.crm.source.dirty']}': an image built from uncommitted changes cannot be traced to a source`);
  if (dirty) problems.push('this checkout has uncommitted changes, so no image built from it can be traced to a commit');
  if (!servesFrontend) problems.push(`the image does not carry ${FRONT_INDEX}: it is not the full application target, so a dependency image may be wearing the application tag`);
  // Measured off the containers, not inferred from the tag: inspecting a
  // freshly built image while the stack still serves the previous one is
  // exactly what fix1's provenance check could not tell apart.
  if (!Array.isArray(runningServices)) {
    problems.push('the running services could not be read, so there is no evidence the verified image is the one being served');
  } else {
    for (const service of APP_SERVICES) {
      const found = runningServices.filter((s) => s.service === service);
      if (found.length === 0) {
        problems.push(`the '${service}' service is not running, so this image is not the one serving anything`);
        continue;
      }
      for (const instance of found) {
        if (instance.imageId !== imageId) {
          problems.push(`the running '${service}' container uses image ${instance.imageId || 'unknown'}, not the verified ${imageId}: the tag was rebuilt under a service that is still on older bytes`);
        }
      }
    }
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
  if (res.status !== 0) {
    console.error(`[FAIL] git ${args[0]} exited ${res.status}`);
    process.exit(1);
  }
  return res.stdout;
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

// What the containers of THIS compose project actually resolved their image to,
// by container id. Returns null when it cannot be read, which judgeImage treats
// as a failure rather than as "nothing to check".
function readRunningServices() {
  const compose = wsl(['docker', 'ps', '--filter', 'label=com.docker.compose.project=aos-crm-local',
    '--format', '{{.ID}}']);
  if (compose.status !== 0) return null;
  const ids = compose.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (ids.length === 0) return [];
  const inspect = wsl(['docker', 'inspect',
    '--format', '{{index .Config.Labels "com.docker.compose.service"}}|{{.Image}}', ...ids]);
  if (inspect.status !== 0) return null;
  return inspect.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const [service, imageId] = line.split('|');
    return { service, imageId };
  });
}

function run() {
  const tag = readEnvKeys(ENV_PATH).AOS_CRM_IMAGE_TAG || '';
  const expectedUpstreamSha = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')).upstream.sha;

  const inspect = wsl(['docker', 'image', 'inspect', tag || '-']);
  if (inspect.status !== 0) {
    fail(`docker image inspect '${tag}' exited ${inspect.status}: no application image to verify. Build it with scripts/aos/local.ps1 -Action Start.`);
  }
  let parsed;
  try { parsed = JSON.parse(inspect.stdout)[0]; } catch { parsed = null; }
  if (!parsed) fail('docker image inspect returned output this gate could not parse');

  // Measured inside the image, not inferred from the tag or the target name.
  const frontProbe = wsl(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'test', tag, '-f', FRONT_INDEX]);
  if (frontProbe.status !== 0 && frontProbe.status !== 1) {
    fail(`could not probe the image for its frontend (status=${frontProbe.status}): ${(frontProbe.stderr || '').slice(-200)}`);
  }

  const verdict = judgeImage({
    tag,
    labels: parsed.Config?.Labels || {},
    imageId: parsed.Id,
    expectedUpstreamSha,
    head: git(['rev-parse', 'HEAD']).trim(),
    tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
    dirty: git(['status', '--porcelain']).split('\n').some((l) => l.trim() !== ''),
    servesFrontend: frontProbe.status === 0,
    runningServices: readRunningServices(),
  });

  if (!verdict.ok) {
    for (const problem of verdict.problems) console.error(`  - ${problem}`);
    fail(`the application image is not traceable to this source (${verdict.problems.length} problem(s))`);
  }
  console.log(`[PASS] application image ${tag}`);
  console.log(`  config digest: ${parsed.Id}`);
  console.log(`  upstream: ${parsed.Config.Labels['org.opencontainers.image.version']} @ ${expectedUpstreamSha}`);
  console.log(`  AOS commit: ${parsed.Config.Labels['ai.aos.crm.source.commit']} (tree ${parsed.Config.Labels['ai.aos.crm.source.tree']}, clean)`);
  console.log(`  created: ${parsed.Created}, carries the served frontend at ${FRONT_INDEX}`);
  console.log('Scope: identity and completeness of the built artifact. It does not start the app, measure its behaviour, or scan the image for vulnerabilities.');
}

function selfTest() {
  let failures = 0;
  const record = (name, body) => {
    try { body(); console.log(`[PASS] ${name}`); } catch (e) { console.log(`[FAIL] ${name}: ${e.message}`); failures++; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  const pin = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const tree = 'c'.repeat(40);
  const imageId = `sha256:${'d'.repeat(64)}`;
  const good = {
    tag: `aos-crm-local/twenty:v2.51.0-${pin.slice(0, 10)}-${aosTagSuffix(head)}`,
    labels: {
      'org.opencontainers.image.revision': pin,
      'ai.aos.crm.source.commit': head,
      'ai.aos.crm.source.tree': tree,
      'ai.aos.crm.source.dirty': 'false',
    },
    imageId,
    expectedUpstreamSha: pin,
    head,
    tree,
    dirty: false,
    servesFrontend: true,
    runningServices: APP_SERVICES.map((service) => ({ service, imageId })),
  };

  record('judgeImage: a complete, clean, pinned image passes', () => {
    const r = judgeImage(good);
    assert(r.ok, r.problems.join('; '));
  });
  record('judgeImage: the compose default label value (unset) is rejected', () => {
    const r = judgeImage({ ...good, labels: { ...good.labels, 'ai.aos.crm.source.commit': 'unset' } });
    assert(!r.ok && r.problems.some((p) => p.includes('source.commit')), 'expected an unset commit label to fail');
  });
  record('judgeImage: an image built from a different commit than this checkout is rejected', () => {
    const r = judgeImage({ ...good, labels: { ...good.labels, 'ai.aos.crm.source.commit': 'e'.repeat(40) } });
    assert(!r.ok, 'expected a stale image to fail');
  });
  record('judgeImage: an image built from a dirty tree is rejected even when the commit matches', () => {
    const r = judgeImage({ ...good, labels: { ...good.labels, 'ai.aos.crm.source.dirty': 'true' } });
    assert(!r.ok && r.problems.some((p) => p.includes('dirty')), 'expected a dirty build to fail');
  });
  record('judgeImage: a dirty checkout fails now, whatever the image says', () => {
    assert(!judgeImage({ ...good, dirty: true }).ok, 'expected a dirty checkout to fail');
  });
  record('judgeImage: a dependency image wearing the application tag is rejected (no frontend inside)', () => {
    const r = judgeImage({ ...good, servesFrontend: false });
    assert(!r.ok && r.problems.some((p) => p.includes('full application target')), 'expected a non-application image to fail');
  });
  record('judgeImage: a moving tag is rejected', () => {
    assert(!judgeImage({ ...good, tag: 'aos-crm-local/twenty:latest' }).ok, 'expected :latest to fail');
    assert(!judgeImage({ ...good, tag: 'aos-crm-local/twenty:v2.51.0' }).ok, 'expected a tag without the pin to fail');
  });
  record('judgeImage: the base reference alone -- upstream pin, no AOS commit -- is rejected (the fix1 overwrite)', () => {
    const r = judgeImage({ ...good, tag: `aos-crm-local/twenty:v2.51.0-${pin.slice(0, 10)}` });
    assert(!r.ok, 'expected a reference without the AOS commit to fail');
    assert(r.problems.some((p) => p.includes(aosTagSuffix(head))), `expected the problem to name the missing AOS commit: ${r.problems.join('; ')}`);
    // And a reference naming a DIFFERENT AOS commit must not pass either.
    const other = judgeImage({ ...good, tag: `aos-crm-local/twenty:v2.51.0-${pin.slice(0, 10)}-${aosTagSuffix('e'.repeat(40))}` });
    assert(!other.ok, 'expected a reference naming another AOS commit to fail');
  });
  record('judgeImage: a service still running OTHER bytes is rejected, however correct the inspected tag is', () => {
    const stale = `sha256:${'9'.repeat(64)}`;
    for (const service of APP_SERVICES) {
      const runningServices = good.runningServices.map((s) => (s.service === service ? { ...s, imageId: stale } : s));
      const r = judgeImage({ ...good, runningServices });
      assert(!r.ok, `expected a stale '${service}' container to fail`);
      assert(r.problems.some((p) => p.includes(service) && p.includes(stale)),
        `expected the problem to name the stale service and image: ${r.problems.join('; ')}`);
    }
  });
  record('judgeImage: an app service that is not running at all is rejected, not treated as nothing to check', () => {
    for (const service of APP_SERVICES) {
      const runningServices = good.runningServices.filter((s) => s.service !== service);
      const r = judgeImage({ ...good, runningServices });
      assert(!r.ok, `expected a missing '${service}' service to fail`);
    }
    assert(!judgeImage({ ...good, runningServices: [] }).ok, 'expected an empty stack to fail');
    assert(!judgeImage({ ...good, runningServices: null }).ok, 'expected unreadable services to fail closed');
    assert(!judgeImage({ ...good, runningServices: undefined }).ok, 'expected unreadable services to fail closed');
  });
  record('the image reference this gate demands is the one local.ps1 builds', () => {
    const local = readFileSync(resolve(REPO_ROOT, 'scripts/aos/local.ps1'), 'utf8');
    assert(/function Get-SourcePinnedImageTag/.test(local), 'local.ps1 no longer derives the image reference');
    // Both sides must take the first 12 hex of the AOS commit, prefixed 'aos'.
    assert(/-aos\$\(\$AosCommit\.Substring\(0, 12\)\)/.test(local),
      'local.ps1 builds the AOS half of the reference differently than this gate expects');
    assert(/Substring\(0, 10\)/.test(local), 'local.ps1 no longer embeds the 10-char upstream pin this gate looks for');
    assert(/Update-SourceStamp[\s\S]{0,800}AOS_CRM_IMAGE_TAG/.test(local),
      'local.ps1 no longer rewrites AOS_CRM_IMAGE_TAG when it stamps the source');
  });
  record('judgeImage: the wrong upstream revision is rejected', () => {
    const r = judgeImage({ ...good, labels: { ...good.labels, 'org.opencontainers.image.revision': 'f'.repeat(40) } });
    assert(!r.ok, 'expected a wrong upstream revision to fail');
  });
  record('judgeImage: an image with no config digest is rejected', () => {
    assert(!judgeImage({ ...good, imageId: '' }).ok, 'expected a missing digest to fail');
  });
  record('the upstream pin this gate reads cannot drift from the CRM-001 provenance gate', () => {
    const fromJson = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')).upstream.sha;
    const verifier = readFileSync(resolve(REPO_ROOT, 'scripts/aos/verify-provenance.mjs'), 'utf8');
    assert(/^[0-9a-f]{40}$/.test(fromJson), `provenance.json holds '${fromJson}', not a commit sha`);
    assert(verifier.includes(fromJson), 'verify-provenance.mjs expects a different upstream sha than provenance.json');
  });
  record('compose.yaml labels the image with the three source values this gate requires', () => {
    const compose = readFileSync(resolve(REPO_ROOT, 'deploy/local/compose.yaml'), 'utf8');
    for (const label of ['ai.aos.crm.source.commit', 'ai.aos.crm.source.tree', 'ai.aos.crm.source.dirty']) {
      assert(compose.includes(label), `compose.yaml never sets ${label}, so no build can satisfy this gate`);
    }
  });
  record('local.ps1 stamps those values before it builds', () => {
    const local = readFileSync(resolve(REPO_ROOT, 'scripts/aos/local.ps1'), 'utf8');
    assert(/function Update-SourceStamp/.test(local), 'local.ps1 has no source stamping step');
    assert(/Update-SourceStamp[\s\S]{0,400}up', '--build'/.test(local), 'local.ps1 does not stamp the source before building');
  });
  record('provenance.json is readable and this script resolves the repo root correctly', () => {
    execFileSync('node', ['-e', 'require("fs").statSync(process.argv[1])', PROVENANCE_PATH]);
  });

  console.log(failures === 0 ? 'self-test: ALL PASSED' : `self-test: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else run();
