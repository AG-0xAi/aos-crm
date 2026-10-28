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
// CRM-004 fix4 adds the half the labels cannot give: they are a claim by
// whoever built the image, so this also compares the deployed image's layers
// (RootFS diff ids) with those of the gate's own build of this commit, which
// scripts/aos/verify-image-build.mjs produces under its own reference. By
// layer, not by image id: two BuildKit builds of one context get two ids and
// two config digests while carrying the same bytes, so a config difference is
// not a failure and a layer difference is.
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
// One derivation of the gate's image reference, imported rather than copied:
// if these two disagreed, this check would look for an image that does not
// exist and the comparison below could never run.
import { gateImageReference } from './verify-image-build.mjs';

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

// The first layer the two images do not share, or null when they carry exactly
// the same stack. Layers (RootFS diff ids) are the comparable thing: two
// BuildKit builds of one context get two image ids and two config digests, so
// comparing ids would reject bytes that are identical.
export function firstLayerDifference(deployed, built) {
  const depth = Math.max(deployed.length, built.length);
  for (let index = 0; index < depth; index++) {
    if (deployed[index] !== built[index]) {
      return { index, deployed: deployed[index] || '(no such layer)', built: built[index] || '(no such layer)' };
    }
  }
  return null;
}

// Pure: the whole verdict, so every rule is covered by the self-test without
// Docker. Takes the labels Docker reported, the stamp Git reports now, the
// image every running app service actually resolved to, and the gate's own
// build of this commit.
export function judgeImage({ tag, labels, imageId, expectedUpstreamSha, head, tree, dirty, servesFrontend, runningServices, layers, gateImage }) {
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
  // CRM-004 fix4. Everything above is a claim made by whoever built the image:
  // the labels say which commit the builder believed it was on. What proves the
  // running bytes are the ones THIS source produces is building it again and
  // comparing the result -- by layer, because the ids will differ (measured
  // 2026-10-29: the same commit, built twice, gave f6f2c342 and 6361980c with
  // the same 26 diff ids). A different config under the same layers is not a
  // difference in bytes and is not a failure here.
  if (!Array.isArray(layers) || layers.length === 0) {
    problems.push('the deployed image reported no layers, so there is nothing a build of this source could be compared against');
  }
  if (!gateImage) {
    problems.push("the gate's own build of this commit is not in this daemon: run 'node scripts/aos/verify-image-build.mjs' first. Without it, nothing here measures whether the running bytes are the ones this source builds");
  } else if (gateImage.commit !== head) {
    problems.push(`the gate image ${gateImage.reference} is labelled ai.aos.crm.source.commit '${gateImage.commit}', not this HEAD ${head}: it is not a build of this source`);
  } else if (!Array.isArray(gateImage.layers) || gateImage.layers.length === 0) {
    problems.push(`the gate image ${gateImage.reference} reported no layers, so the comparison never happened`);
  } else if (Array.isArray(layers) && layers.length > 0) {
    const difference = firstLayerDifference(layers, gateImage.layers);
    if (difference) {
      problems.push(`the running bytes are not the ones this source builds: layer ${difference.index} of the deployed image is ${difference.deployed}, while building this commit produces ${difference.built} (${layers.length} deployed layers vs ${gateImage.layers.length} built)`);
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

// The gate's own build of this commit, by the reference verify-image-build.mjs
// writes. Null when there is none, which judgeImage treats as a failure: an
// image nobody rebuilt cannot answer "do these bytes come from this source?".
function readGateImage(reference) {
  const inspect = wsl(['docker', 'image', 'inspect', reference]);
  if (inspect.status !== 0) return null;
  let parsed;
  try { parsed = JSON.parse(inspect.stdout)[0]; } catch { parsed = null; }
  return {
    reference,
    imageId: parsed?.Id || null,
    layers: parsed?.RootFS?.Layers || null,
    commit: parsed?.Config?.Labels?.['ai.aos.crm.source.commit'] || null,
  };
}

function run() {
  const tag = readEnvKeys(ENV_PATH).AOS_CRM_IMAGE_TAG || '';
  const upstream = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')).upstream;
  const expectedUpstreamSha = upstream.sha;
  const head = git(['rev-parse', 'HEAD']).trim();

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

  const gateReference = gateImageReference({ upstreamTag: upstream.tag, upstreamSha: upstream.sha, aosCommit: head });
  const gateImage = readGateImage(gateReference);

  const verdict = judgeImage({
    tag,
    labels: parsed.Config?.Labels || {},
    imageId: parsed.Id,
    expectedUpstreamSha,
    head,
    tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
    dirty: git(['status', '--porcelain']).split('\n').some((l) => l.trim() !== ''),
    servesFrontend: frontProbe.status === 0,
    runningServices: readRunningServices(),
    layers: parsed.RootFS?.Layers || null,
    gateImage,
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
  console.log(`  same bytes as this source builds: all ${gateImage.layers.length} layers of ${gateReference} (${gateImage.imageId}) match the deployed image, which is what server and worker run`);
  console.log('Scope: identity and completeness of the built artifact, and that its layers are the ones a build of this commit produces. It does not start the app, measure its behaviour, or scan the image for vulnerabilities. The layer comparison is against a build on THIS daemon\'s cache: it proves the bytes agree, not that the build is bit-reproducible from cold.');
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
  const layers = ['1', '2', '3', '4'].map((d) => `sha256:${d.repeat(64)}`);
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
    layers,
    // The gate's own build of the same source: a DIFFERENT image id (BuildKit
    // gives two builds of one context two identities) carrying the SAME layers.
    gateImage: {
      reference: `aos-crm-local/twenty-gate:v2.51.0-${pin.slice(0, 10)}-${aosTagSuffix(head)}`,
      imageId: `sha256:${'e'.repeat(64)}`,
      layers: [...layers],
      commit: head,
    },
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
  // CRM-004 fix4. The labels say which commit the builder CLAIMED; they cannot
  // say the bytes are what that commit builds today. The gate's own build of
  // this commit answers that, by layers: two BuildKit builds of one context get
  // two image ids (measured 2026-10-29: f6f2c342 vs the running 6361980c, same
  // commit, same labels, identical 26 layers), so the config digest is not the
  // comparable thing and the diff IDs are.
  record('judgeImage: identical layers under a different config digest pass -- two builds of one source do not share an image id', () => {
    const r = judgeImage(good);
    assert(r.ok, r.problems.join('; '));
    assert(good.gateImage.imageId !== good.imageId, 'this case is only meaningful when the two image ids differ');
  });
  record('judgeImage: bytes the current source does not build are rejected, naming the first differing layer', () => {
    const changed = [...layers];
    changed[2] = `sha256:${'9'.repeat(64)}`;
    const r = judgeImage({ ...good, gateImage: { ...good.gateImage, layers: changed } });
    assert(!r.ok, 'expected a layer the source does not produce to fail');
    assert(r.problems.some((p) => p.includes('layer 2') && p.includes(layers[2]) && p.includes(changed[2])),
      `expected the problem to name the first difference and both diff ids: ${r.problems.join('; ')}`);
    // A layer set of a different length is a difference too, at the first
    // index that exists on one side only.
    const shorter = judgeImage({ ...good, gateImage: { ...good.gateImage, layers: layers.slice(0, 3) } });
    assert(!shorter.ok, 'expected a shorter layer set to fail');
    const longer = judgeImage({ ...good, gateImage: { ...good.gateImage, layers: [...layers, `sha256:${'8'.repeat(64)}`] } });
    assert(!longer.ok, 'expected an extra layer to fail');
  });
  record('judgeImage: with no gate build of this commit there is nothing to compare, and that fails closed', () => {
    for (const gateImage of [null, undefined]) {
      const r = judgeImage({ ...good, gateImage });
      assert(!r.ok, `expected a missing gate build (${gateImage}) to fail`);
      assert(r.problems.some((p) => p.includes('verify-image-build.mjs')),
        `expected the problem to name the command that produces it: ${r.problems.join('; ')}`);
    }
    assert(!judgeImage({ ...good, gateImage: { ...good.gateImage, layers: null } }).ok, 'expected unreadable gate layers to fail closed');
    assert(!judgeImage({ ...good, gateImage: { ...good.gateImage, layers: [] } }).ok, 'expected an empty gate layer set to fail closed');
    assert(!judgeImage({ ...good, layers: null }).ok, 'expected unreadable deployment layers to fail closed');
    assert(!judgeImage({ ...good, layers: [] }).ok, 'expected an empty deployment layer set to fail closed');
  });
  record('judgeImage: a gate image built from another commit cannot stand in for this one', () => {
    const r = judgeImage({ ...good, gateImage: { ...good.gateImage, commit: 'f'.repeat(40) } });
    assert(!r.ok, 'expected a gate image labelled with another commit to fail');
  });
  record('the gate build writes its OWN reference, so running it can never move the deployment image', () => {
    // Its production half: its own self-test names the patterns forbidden here.
    const build = readFileSync(resolve(REPO_ROOT, 'scripts/aos/verify-image-build.mjs'), 'utf8').split('function selfTest()')[0];
    assert(/export function gateImageReference/.test(build), 'verify-image-build.mjs no longer derives a gate-owned reference');
    const gateRef = gateImageReference({ upstreamTag: 'twenty/v2.51.0', upstreamSha: pin, aosCommit: head });
    assert(!gateRef.startsWith('aos-crm-local/twenty:'), `the gate reference shares the deployment repository: ${gateRef}`);
    assert(gateRef.includes(aosTagSuffix(head)), `the gate reference does not name the commit it was built from: ${gateRef}`);
    // The tag it hands `docker build` must be the gate one, not the deployment
    // one: retagging the deployment reference is what broke this gate on
    // 2026-10-29 (the tag moved to the rebuild while the containers kept the
    // bytes they were created from, which the daemon then dropped entirely).
    assert(/'-t', gateReference,/.test(build), 'the gate build no longer tags its own reference');
    assert(!/'-t', expectedTag,/.test(build), 'the gate build still tags the deployment reference');
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
