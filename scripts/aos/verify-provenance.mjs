// CRM-001 provenance gate. Checks real Git/GitHub state against hardcoded
// expectations; never trusts a success receipt supplied by a worker.
// Run: node scripts/aos/verify-provenance.mjs
// Self-test (isolated tmp fixtures, does not touch this checkout or network):
//   node scripts/aos/verify-provenance.mjs --self-test
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED = {
  upstreamUrl: 'https://github.com/twentyhq/twenty.git',
  originUrl: 'https://github.com/AG-0xAi/aos-crm.git',
  forkFullName: 'AG-0xAi/aos-crm',
  parentFullName: 'twentyhq/twenty',
  tag: 'twenty/v2.51.0',
  sha: '15e4826d3b5fc5867baeabeeb42b253892b2d4da',
};

// Patterns only; detail strings never include the matched substring.
const SECRET_PATTERNS = [
  { name: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private-key-block', re: /-----BEGIN (?:(?:RSA|OPENSSH|EC|DSA|PGP) )?PRIVATE KEY-----/ },
  { name: 'github-token', re: /gh[pousr]_[0-9A-Za-z]{36,}/ },
  { name: 'slack-token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
];

function safeMessage(err) {
  const msg = err && err.message ? String(err.message).split('\n')[0] : String(err);
  return msg.slice(0, 200);
}

// Fail-closed guard for any recursive delete of generated fixtures: refuses
// to remove a path that does not resolve inside the given temp root.
function assertSafeToRemove(targetDir, allowedRoot) {
  const resolvedTarget = resolvePath(targetDir);
  const resolvedRoot = resolvePath(allowedRoot);
  const withinRoot = resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep);
  if (!withinRoot) {
    throw new Error(`refusing to remove '${resolvedTarget}': outside allowed root '${resolvedRoot}'`);
  }
  return resolvedTarget;
}

// spawnSync's default 1 MiB buffer is smaller than real files this repo
// tracks: `git show HEAD:yarn.lock` (about 1.9 MiB) overflowed it, and the
// secret scanner correctly-but-wrongly reported the blob "unreadable" and
// failed the gate. The blob was perfectly readable; our own buffer was the
// limit. 64 MiB covers lockfile-sized text while still being bounded, so a
// genuinely enormous blob keeps failing closed instead of being skipped.
const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function git(args, { cwd, env } = {}) {
  const res = spawnSync('git', args, { cwd, env: env ?? process.env, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER_BYTES });
  if (res.error) return { status: -1, stdout: '', stderr: safeMessage(res.error) };
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

function ghApiJson(apiPath) {
  const res = spawnSync('gh', ['api', apiPath], { encoding: 'utf8' });
  if (res.error) return { ok: false, error: 'gh CLI unavailable' };
  if (res.status !== 0) return { ok: false, error: `gh api call failed (exit ${res.status})` };
  try {
    return { ok: true, json: JSON.parse(res.stdout) };
  } catch {
    return { ok: false, error: 'gh api returned non-JSON' };
  }
}

// ---- pure local checks (take explicit repoDir/expected so self-test can reuse them) ----

// Never prints the received remote URL: a mismatch is reported as a fixed
// diagnostic plus the known-safe expected value, nothing derived from input.
function checkRemoteUrl(repoDir, remoteName, expectedUrl) {
  const r = git(['-C', repoDir, 'remote', 'get-url', remoteName]);
  if (r.status !== 0) return { ok: false, detail: `remote '${remoteName}' not configured` };
  const ok = r.stdout === expectedUrl;
  return { ok, detail: ok ? `${remoteName}=${expectedUrl}` : `${remoteName} does not match expected ${expectedUrl}` };
}

function checkTagSha(repoDir, tag, expectedSha) {
  const r = git(['-C', repoDir, 'rev-parse', `refs/tags/${tag}^{commit}`]);
  if (r.status !== 0) return { ok: false, detail: `tag '${tag}' not found` };
  const ok = r.stdout === expectedSha;
  return { ok, detail: ok ? `tag ${tag} -> ${r.stdout}` : `tag ${tag} expected ${expectedSha}, got ${r.stdout}` };
}

function checkNonShallow(repoDir) {
  const r = git(['-C', repoDir, 'rev-parse', '--is-shallow-repository']);
  if (r.status !== 0) return { ok: false, detail: 'is-shallow-repository check failed' };
  return { ok: r.stdout === 'false', detail: `is-shallow-repository=${r.stdout}` };
}

function checkAncestry(repoDir, sha, ref) {
  const r = git(['-C', repoDir, 'merge-base', '--is-ancestor', sha, ref]);
  return { ok: r.status === 0, detail: r.status === 0 ? `${sha} is ancestor of ${ref}` : `${sha} is not an ancestor of ${ref}` };
}

function checkNoTrackedRuntime(repoDir) {
  const r = git(['-C', repoDir, 'ls-files', '--', '.aos', '.codegraph-aos']);
  if (r.status !== 0) return { ok: false, detail: 'ls-files check failed' };
  const ok = r.stdout === '';
  return { ok, detail: ok ? 'no tracked .aos/.codegraph-aos paths' : 'tracked AOS runtime paths found' };
}

function checkVerifyJsonIgnored(repoDir) {
  const r = git(['-C', repoDir, 'check-ignore', '-q', '.aos/verify.json']);
  return { ok: r.status === 0, detail: r.status === 0 ? '.aos/verify.json is gitignored' : '.aos/verify.json is NOT gitignored' };
}

// Parses `git diff --name-status -z` output. NUL-delimited fields sidestep
// the path quoting git applies by default to unicode/space/newline names.
function parseNameStatusZ(output) {
  const fields = output.split('\0').filter((s) => s.length > 0);
  const entries = [];
  let i = 0;
  while (i < fields.length) {
    const status = fields[i++];
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = fields[i++];
      const path = fields[i++];
      entries.push({ status: status[0], path, oldPath });
    } else {
      entries.push({ status: status[0], path: fields[i++] });
    }
  }
  return entries;
}

function checkNoSecretsInDiff(repoDir, baseSha, headRef, patterns) {
  const diff = git(['-C', repoDir, 'diff', '--name-status', '-z', `${baseSha}..${headRef}`]);
  if (diff.status !== 0) return { ok: false, detail: 'diff listing failed' };
  const entries = parseNameStatusZ(diff.stdout);
  const hits = [];
  let scanned = 0;
  let deletions = 0;
  for (const entry of entries) {
    if (entry.status === 'D') {
      deletions += 1; // confirmed deletion from diff metadata, nothing to scan
      continue;
    }
    const file = entry.path;
    const base = file.split('/').pop() ?? file;
    const isEnvExample = base === '.env.example';
    if (/^\.env(\..+)?$/.test(base) && !isEnvExample) {
      hits.push(`${file}: dotenv-style filename`);
      continue;
    }
    const show = git(['-C', repoDir, 'show', `${headRef}:${file}`]);
    if (show.status !== 0) {
      // Present in the diff (not a deletion) but unreadable: fail closed,
      // never assume it was safely removed.
      hits.push(`${file}: blob unreadable at ${headRef}, cannot be scanned`);
      continue;
    }
    scanned += 1;
    for (const { name, re } of patterns) {
      if (re.test(show.stdout)) hits.push(`${file}: matched ${name}`);
    }
  }
  const ok = hits.length === 0;
  return {
    ok,
    detail: ok
      ? `pattern scan clean over diff (${scanned} file(s) read, ${deletions} deletion(s) skipped)`
      : `secret-like content: ${hits.join('; ')}`,
  };
}

function checkLsRemoteTag(repoDir, remoteName, tag, expectedSha) {
  const r = git(['-C', repoDir, 'ls-remote', remoteName, `refs/tags/${tag}`]);
  if (r.status !== 0) return { ok: false, detail: `ls-remote ${remoteName} failed (network/auth?)` };
  const sha = (r.stdout.split('\n')[0] ?? '').split('\t')[0] ?? '';
  const ok = sha === expectedSha;
  return { ok, detail: ok ? `${remoteName} tag ${tag} -> ${sha}` : `${remoteName} tag ${tag} expected ${expectedSha}, got '${sha || '(not found)'}'` };
}

// ---- GitHub API checks: network call separated from the pure evaluator ----

// Never prints the received fork/parent/clone_url: a mismatch is reported as
// a fixed diagnostic plus the known-safe expected values, nothing from input.
function evaluateForkApiResponse(json, expected) {
  if (!json || typeof json !== 'object') return { ok: false, detail: 'no API response' };
  const forkOk = json.fork === true;
  const parentName = json.parent && json.parent.full_name;
  const parentOk = parentName === expected.parentFullName;
  const cloneOk = json.clone_url === expected.originUrl;
  const ok = forkOk && parentOk && cloneOk;
  return {
    ok,
    detail: ok
      ? `fork=true parent=${expected.parentFullName} clone_url=${expected.originUrl}`
      : `fork/parent/clone_url do not match expected fork=true parent=${expected.parentFullName} clone_url=${expected.originUrl}`,
  };
}

function evaluateBranchDiversity(json, min) {
  const ok = Array.isArray(json) && json.length >= min;
  return { ok, detail: ok ? `branches>=${min}` : `branches returned ${Array.isArray(json) ? json.length : 'invalid'}` };
}

function checkForkApi(expected) {
  const res = ghApiJson(`repos/${expected.forkFullName}`);
  if (!res.ok) return { ok: false, detail: `github api unavailable: ${res.error}` };
  return evaluateForkApiResponse(res.json, expected);
}

function checkBranchDiversity(expected, min = 2) {
  const res = ghApiJson(`repos/${expected.forkFullName}/branches?per_page=${min}`);
  if (!res.ok) return { ok: false, detail: `github api unavailable: ${res.error}` };
  return evaluateBranchDiversity(res.json, min);
}

// ---- full run against the real checkout ----

function runFullCheck(repoDir, expected) {
  const checks = [
    ['origin-url', () => checkRemoteUrl(repoDir, 'origin', expected.originUrl)],
    ['upstream-url', () => checkRemoteUrl(repoDir, 'upstream', expected.upstreamUrl)],
    ['tag-sha', () => checkTagSha(repoDir, expected.tag, expected.sha)],
    ['non-shallow', () => checkNonShallow(repoDir)],
    ['ancestry', () => checkAncestry(repoDir, expected.sha, 'HEAD')],
    ['no-tracked-aos-runtime', () => checkNoTrackedRuntime(repoDir)],
    ['verify-json-ignored', () => checkVerifyJsonIgnored(repoDir)],
    ['no-secrets-in-diff', () => checkNoSecretsInDiff(repoDir, expected.sha, 'HEAD', SECRET_PATTERNS)],
    ['ls-remote-origin-tag', () => checkLsRemoteTag(repoDir, 'origin', expected.tag, expected.sha)],
    ['ls-remote-upstream-tag', () => checkLsRemoteTag(repoDir, 'upstream', expected.tag, expected.sha)],
    ['github-fork-api', () => checkForkApi(expected)],
    ['github-branch-diversity', () => checkBranchDiversity(expected)],
  ];
  return checks.map(([name, fn]) => {
    try {
      return { name, ...fn() };
    } catch (err) {
      return { name, ok: false, detail: `threw: ${safeMessage(err)}` };
    }
  });
}

function main() {
  const results = runFullCheck(process.cwd(), EXPECTED);
  for (const r of results) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}: ${r.detail}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length}/${results.length} provenance checks failed.`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${results.length} provenance checks passed.`);
  console.log('Scope: provenance only. The CRM application is not built, not running, and not covered by this gate (see CRM-004).');
  console.log('Secret scanning is a fixed set of known patterns over the diff tip only: no entropy analysis, no full-history scan. A clean result means no known pattern matched, not that the diff is free of secrets.');
  process.exit(0);
}

// ---- self-test: isolated tmp fixtures only, never the real checkout or network ----

function makeFixtureEnv(tmpRoot) {
  const configPath = join(tmpRoot, 'gitconfig');
  writeFileSync(
    configPath,
    '[user]\n\tname = aos-fixture\n\temail = aos-fixture@example.invalid\n[init]\n\tdefaultBranch = main\n',
  );
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: configPath,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'aos-fixture',
    GIT_AUTHOR_EMAIL: 'aos-fixture@example.invalid',
    GIT_COMMITTER_NAME: 'aos-fixture',
    GIT_COMMITTER_EMAIL: 'aos-fixture@example.invalid',
  };
}

function fixtureGit(repoDir, args, env) {
  const res = spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', env });
  if (res.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${safeMessage({ message: res.stderr })}`);
  return (res.stdout || '').trim();
}

function assertOk(result, expectedOk) {
  if (result.ok !== expectedOk) {
    throw new Error(`expected ok=${expectedOk}, got ok=${result.ok} (${result.detail})`);
  }
}

function selfTest() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'aos-provenance-selftest-'));
  const failures = [];
  const record = (label, fn) => {
    try {
      fn();
      console.log(`[PASS] self-test: ${label}`);
    } catch (err) {
      failures.push(label);
      console.log(`[FAIL] self-test: ${label} -- ${safeMessage(err)}`);
    }
  };

  try {
    const env = makeFixtureEnv(tmpRoot);
    const workDir = join(tmpRoot, 'work');
    mkdirSync(workDir, { recursive: true });
    fixtureGit(workDir, ['init', '-q'], env);
    writeFileSync(join(workDir, '.gitignore'), '/.aos/\n/.codegraph-aos/\n');
    fixtureGit(workDir, ['add', '.gitignore'], env);
    fixtureGit(workDir, ['commit', '-q', '-m', 'base'], env);
    const baseSha = fixtureGit(workDir, ['rev-parse', 'HEAD'], env);
    fixtureGit(workDir, ['tag', 'twenty/v2.51.0'], env);

    fixtureGit(workDir, ['checkout', '-q', '-b', 'side'], env);
    writeFileSync(join(workDir, 'side.txt'), 'side\n');
    fixtureGit(workDir, ['add', 'side.txt'], env);
    fixtureGit(workDir, ['commit', '-q', '-m', 'side change'], env);
    const sideSha = fixtureGit(workDir, ['rev-parse', 'HEAD'], env);
    fixtureGit(workDir, ['checkout', '-q', 'main'], env);

    writeFileSync(join(workDir, 'aos.txt'), 'aos change\n');
    fixtureGit(workDir, ['add', 'aos.txt'], env);
    fixtureGit(workDir, ['commit', '-q', '-m', 'aos change'], env);

    const selfUrl = pathToFileURL(workDir).href;
    fixtureGit(workDir, ['remote', 'add', 'origin', selfUrl], env);
    fixtureGit(workDir, ['remote', 'add', 'upstream', selfUrl], env);

    record('positive: origin-url', () => assertOk(checkRemoteUrl(workDir, 'origin', selfUrl), true));
    record('positive: upstream-url', () => assertOk(checkRemoteUrl(workDir, 'upstream', selfUrl), true));
    record('positive: tag-sha', () => assertOk(checkTagSha(workDir, 'twenty/v2.51.0', baseSha), true));
    record('positive: non-shallow', () => assertOk(checkNonShallow(workDir), true));
    record('positive: ancestry', () => assertOk(checkAncestry(workDir, baseSha, 'HEAD'), true));
    record('positive: no-tracked-aos-runtime', () => assertOk(checkNoTrackedRuntime(workDir), true));
    record('positive: verify-json-ignored', () => assertOk(checkVerifyJsonIgnored(workDir), true));
    record('positive: no-secrets-in-diff', () => assertOk(checkNoSecretsInDiff(workDir, baseSha, 'HEAD', SECRET_PATTERNS), true));
    record('positive: ls-remote origin tag', () => assertOk(checkLsRemoteTag(workDir, 'origin', 'twenty/v2.51.0', baseSha), true));
    record('positive: ls-remote upstream tag', () => assertOk(checkLsRemoteTag(workDir, 'upstream', 'twenty/v2.51.0', baseSha), true));

    record('negative: wrong origin url', () => assertOk(checkRemoteUrl(workDir, 'origin', 'https://github.com/someone-else/wrong.git'), false));
    record('negative: wrong upstream url', () => assertOk(checkRemoteUrl(workDir, 'upstream', 'https://github.com/someone-else/wrong.git'), false));
    record('negative: wrong tag sha', () => assertOk(checkTagSha(workDir, 'twenty/v2.51.0', '0'.repeat(40)), false));
    record('negative: sha not ancestor', () => assertOk(checkAncestry(workDir, sideSha, 'HEAD'), false));
    record('negative: ls-remote wrong sha', () => assertOk(checkLsRemoteTag(workDir, 'origin', 'twenty/v2.51.0', '0'.repeat(40)), false));

    const shallowDir = join(tmpRoot, 'shallow');
    cpSync(workDir, shallowDir, { recursive: true });
    // git determines shallowness purely by presence of $GIT_DIR/shallow; faking it is a valid, minimal fixture.
    writeFileSync(join(shallowDir, '.git', 'shallow'), `${baseSha}\n`);
    record('negative: shallow repository', () => assertOk(checkNonShallow(shallowDir), false));

    const trackedAosDir = join(tmpRoot, 'tracked-aos');
    cpSync(workDir, trackedAosDir, { recursive: true });
    mkdirSync(join(trackedAosDir, '.aos'), { recursive: true });
    writeFileSync(join(trackedAosDir, '.aos', 'x.txt'), 'runtime\n');
    fixtureGit(trackedAosDir, ['add', '-f', '.aos/x.txt'], env);
    fixtureGit(trackedAosDir, ['commit', '-q', '-m', 'add aos runtime file'], env);
    record('negative: tracked AOS runtime path', () => assertOk(checkNoTrackedRuntime(trackedAosDir), false));

    const noIgnoreDir = join(tmpRoot, 'no-ignore');
    mkdirSync(noIgnoreDir, { recursive: true });
    fixtureGit(noIgnoreDir, ['init', '-q'], env);
    writeFileSync(join(noIgnoreDir, 'README.txt'), 'no gitignore here\n');
    fixtureGit(noIgnoreDir, ['add', 'README.txt'], env);
    fixtureGit(noIgnoreDir, ['commit', '-q', '-m', 'base'], env);
    record('negative: verify.json not ignored', () => assertOk(checkVerifyJsonIgnored(noIgnoreDir), false));

    const tokenDir = join(tmpRoot, 'token');
    cpSync(workDir, tokenDir, { recursive: true });
    const plantedToken = ['gh', 'p_', 'B'.repeat(36)].join(''); // built at runtime, never a literal token-shaped string
    writeFileSync(join(tokenDir, 'secret.txt'), `token=${plantedToken}\n`);
    fixtureGit(tokenDir, ['add', 'secret.txt'], env);
    fixtureGit(tokenDir, ['commit', '-q', '-m', 'add token'], env);
    record('negative: planted token detected', () => assertOk(checkNoSecretsInDiff(tokenDir, baseSha, 'HEAD', SECRET_PATTERNS), false));

    const dotenvDir = join(tmpRoot, 'dotenv');
    cpSync(workDir, dotenvDir, { recursive: true });
    writeFileSync(join(dotenvDir, '.env'), 'FOO=bar\n');
    fixtureGit(dotenvDir, ['add', '-f', '.env'], env);
    fixtureGit(dotenvDir, ['commit', '-q', '-m', 'add dotenv'], env);
    record('negative: tracked dotenv file', () => assertOk(checkNoSecretsInDiff(dotenvDir, baseSha, 'HEAD', SECRET_PATTERNS), false));

    const envExampleDir = join(tmpRoot, 'env-example');
    cpSync(workDir, envExampleDir, { recursive: true });
    writeFileSync(join(envExampleDir, '.env.example'), 'API_KEY=changeme\n');
    fixtureGit(envExampleDir, ['add', '-f', '.env.example'], env);
    fixtureGit(envExampleDir, ['commit', '-q', '-m', 'add env example'], env);
    record('positive: .env.example without secret pattern is allowed', () =>
      assertOk(checkNoSecretsInDiff(envExampleDir, baseSha, 'HEAD', SECRET_PATTERNS), true),
    );

    const envExampleSecretDir = join(tmpRoot, 'env-example-secret');
    cpSync(workDir, envExampleSecretDir, { recursive: true });
    writeFileSync(join(envExampleSecretDir, '.env.example'), `AWS_KEY=AKIA${'0'.repeat(16)}\n`);
    fixtureGit(envExampleSecretDir, ['add', '-f', '.env.example'], env);
    fixtureGit(envExampleSecretDir, ['commit', '-q', '-m', 'add env example with planted secret'], env);
    record('negative: secret pattern inside .env.example is still rejected', () =>
      assertOk(checkNoSecretsInDiff(envExampleSecretDir, baseSha, 'HEAD', SECRET_PATTERNS), false),
    );

    const pkcs8Dir = join(tmpRoot, 'pkcs8');
    cpSync(workDir, pkcs8Dir, { recursive: true });
    const pkcs8Marker = ['-----BEGIN', 'PRIVATE KEY-----'].join(' '); // PEM header only, not a real key
    writeFileSync(join(pkcs8Dir, 'key.pem'), `${pkcs8Marker}\nFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n`);
    fixtureGit(pkcs8Dir, ['add', '-f', 'key.pem'], env);
    fixtureGit(pkcs8Dir, ['commit', '-q', '-m', 'add pkcs8-style key marker'], env);
    record('negative: PKCS#8 private key marker (no RSA/etc type) detected', () =>
      assertOk(checkNoSecretsInDiff(pkcs8Dir, baseSha, 'HEAD', SECRET_PATTERNS), false),
    );

    const credRemoteDir = join(tmpRoot, 'cred-remote');
    cpSync(workDir, credRemoteDir, { recursive: true });
    fixtureGit(credRemoteDir, ['remote', 'remove', 'origin'], env);
    const sentinelCredUrl = 'https://sentinel-user:sentinel-pass@example.invalid/sentinel-org/sentinel-repo.git?token=sentinel-token-xyz#sentinel-frag';
    fixtureGit(credRemoteDir, ['remote', 'add', 'origin', sentinelCredUrl], env);
    record('redaction: mismatched remote url does not leak credentials/host/path/query/fragment', () => {
      const result = checkRemoteUrl(credRemoteDir, 'origin', 'https://example.invalid/expected/repo.git');
      if (result.ok) throw new Error('expected mismatch, url matched unexpectedly');
      const leaked = ['sentinel-user', 'sentinel-pass', 'sentinel-org', 'sentinel-repo', 'sentinel-token-xyz', 'sentinel-frag'].filter((s) =>
        result.detail.includes(s),
      );
      if (leaked.length > 0) throw new Error(`redaction leaked: ${leaked.join(',')}`);
    });

    const pathOnlyRemoteDir = join(tmpRoot, 'path-only-remote');
    cpSync(workDir, pathOnlyRemoteDir, { recursive: true });
    fixtureGit(pathOnlyRemoteDir, ['remote', 'remove', 'origin'], env);
    const sentinelPathOnlyUrl = 'https://example.invalid/sentinel-pathonly-org/sentinel-pathonly-repo.git';
    fixtureGit(pathOnlyRemoteDir, ['remote', 'add', 'origin', sentinelPathOnlyUrl], env);
    record('redaction: mismatched remote url with no credentials still does not leak its host/path', () => {
      const result = checkRemoteUrl(pathOnlyRemoteDir, 'origin', 'https://example.invalid/expected/repo.git');
      if (result.ok) throw new Error('expected mismatch, url matched unexpectedly');
      const leaked = ['sentinel-pathonly-org', 'sentinel-pathonly-repo'].filter((s) => result.detail.includes(s));
      if (leaked.length > 0) throw new Error(`redaction leaked: ${leaked.join(',')}`);
    });

    const unparseableRemoteDir = join(tmpRoot, 'unparseable-remote');
    cpSync(workDir, unparseableRemoteDir, { recursive: true });
    fixtureGit(unparseableRemoteDir, ['remote', 'remove', 'origin'], env);
    const sentinelUnparseableUrl = 'sentinel-unparseable-not-a-url';
    fixtureGit(unparseableRemoteDir, ['remote', 'add', 'origin', sentinelUnparseableUrl], env);
    record('redaction: mismatched remote that is not a parseable URL does not leak its raw value', () => {
      const result = checkRemoteUrl(unparseableRemoteDir, 'origin', 'https://example.invalid/expected/repo.git');
      if (result.ok) throw new Error('expected mismatch, url matched unexpectedly');
      if (result.detail.includes(sentinelUnparseableUrl)) throw new Error(`redaction leaked unparseable value: ${result.detail}`);
    });

    record('redaction: github fork api clone_url mismatch does not leak credentials/host/path/query', () => {
      const result = evaluateForkApiResponse(
        {
          fork: true,
          parent: { full_name: EXPECTED.parentFullName },
          clone_url: 'https://sentinel-user2:sentinel-pass2@example.invalid/sentinel-path-org/x.git?token=sentinel-token2',
        },
        EXPECTED,
      );
      if (result.ok) throw new Error('expected mismatch for wrong clone_url');
      const leaked = ['sentinel-user2', 'sentinel-pass2', 'sentinel-path-org', 'sentinel-token2'].filter((s) => result.detail.includes(s));
      if (leaked.length > 0) throw new Error(`redaction leaked: ${leaked.join(',')}`);
    });

    record('redaction: github fork api clone_url that is not a parseable URL does not leak its raw value', () => {
      const sentinelUnparseableCloneUrl = 'sentinel-unparseable-clone-url';
      const result = evaluateForkApiResponse(
        { fork: true, parent: { full_name: EXPECTED.parentFullName }, clone_url: sentinelUnparseableCloneUrl },
        EXPECTED,
      );
      if (result.ok) throw new Error('expected mismatch for wrong clone_url');
      if (result.detail.includes(sentinelUnparseableCloneUrl)) throw new Error(`redaction leaked unparseable value: ${result.detail}`);
    });

    record('parseNameStatusZ: filename containing a newline is kept as one path', () => {
      const weirdName = 'weird\nname.txt';
      const entries = parseNameStatusZ(`A\0${weirdName}\0`);
      if (entries.length !== 1) throw new Error(`expected 1 entry, got ${entries.length}`);
      if (entries[0].path !== weirdName) throw new Error(`path mangled: ${JSON.stringify(entries[0].path)}`);
    });

    record('parseNameStatusZ: rename entry keeps old+new path distinct from a following modify', () => {
      const entries = parseNameStatusZ('R100\0old-path.txt\0new-path.txt\0M\0other.txt\0');
      if (entries.length !== 2) throw new Error(`expected 2 entries, got ${entries.length}`);
      if (entries[0].status !== 'R' || entries[0].path !== 'new-path.txt' || entries[0].oldPath !== 'old-path.txt') {
        throw new Error(`rename entry malformed: ${JSON.stringify(entries[0])}`);
      }
      if (entries[1].status !== 'M' || entries[1].path !== 'other.txt') {
        throw new Error(`modify entry malformed: ${JSON.stringify(entries[1])}`);
      }
    });

    const unicodeDir = join(tmpRoot, 'unicode-names');
    cpSync(workDir, unicodeDir, { recursive: true });
    const unicodeFileName = 'config caña 配置.txt';
    writeFileSync(join(unicodeDir, unicodeFileName), `token=${plantedToken}\n`);
    fixtureGit(unicodeDir, ['add', '-f', unicodeFileName], env);
    fixtureGit(unicodeDir, ['commit', '-q', '-m', 'add unicode/space named file with planted token'], env);
    record('negative: unicode/space filename is scanned, not skipped', () =>
      assertOk(checkNoSecretsInDiff(unicodeDir, baseSha, 'HEAD', SECRET_PATTERNS), false),
    );

    // A lockfile-sized blob is readable; only our own child-process buffer
    // made it look otherwise. Both halves matter: a large clean file must be
    // scanned instead of reported unreadable, and a secret hiding past the
    // old 1 MiB cut-off must still be found.
    const largeCleanDir = join(tmpRoot, 'large-clean-blob');
    cpSync(workDir, largeCleanDir, { recursive: true });
    const filler = `${'lockfile-ish line with no secret in it\n'.repeat(40000)}`;
    writeFileSync(join(largeCleanDir, 'big.lock'), filler);
    fixtureGit(largeCleanDir, ['add', 'big.lock'], env);
    fixtureGit(largeCleanDir, ['commit', '-q', '-m', 'add a >1MiB clean lockfile-sized blob'], env);
    record('positive: a >1MiB clean blob is actually scanned, not reported unreadable', () => {
      const result = checkNoSecretsInDiff(largeCleanDir, baseSha, 'HEAD', SECRET_PATTERNS);
      if (!result.ok && result.detail.includes('unreadable')) {
        throw new Error(`a large but perfectly readable blob was reported unreadable: ${result.detail}`);
      }
      assertOk(result, true);
    });

    const largeSecretDir = join(tmpRoot, 'large-secret-blob');
    cpSync(workDir, largeSecretDir, { recursive: true });
    writeFileSync(join(largeSecretDir, 'big-with-secret.lock'), `${filler}token=${plantedToken}\n`);
    fixtureGit(largeSecretDir, ['add', 'big-with-secret.lock'], env);
    fixtureGit(largeSecretDir, ['commit', '-q', '-m', 'add a >1MiB blob with a planted token at the end'], env);
    record('negative: a token past the 1MiB mark is still detected', () => {
      const result = checkNoSecretsInDiff(largeSecretDir, baseSha, 'HEAD', SECRET_PATTERNS);
      assertOk(result, false);
      // Must be rejected for the token, not for being unreadable: an
      // unreadable verdict here would be the right answer by accident.
      if (result.detail.includes('unreadable')) {
        throw new Error(`rejected as unreadable instead of detecting the token: ${result.detail}`);
      }
    });

    const unreadableDir = join(tmpRoot, 'unreadable-blob');
    cpSync(workDir, unreadableDir, { recursive: true });
    writeFileSync(join(unreadableDir, 'needs-review.txt'), 'will become unreadable\n');
    fixtureGit(unreadableDir, ['add', 'needs-review.txt'], env);
    fixtureGit(unreadableDir, ['commit', '-q', '-m', 'add file that will become unreadable'], env);
    const unreadableHead = fixtureGit(unreadableDir, ['rev-parse', 'HEAD'], env);
    const unreadableBlobSha = fixtureGit(unreadableDir, ['rev-parse', `${unreadableHead}:needs-review.txt`], env);
    rmSync(join(unreadableDir, '.git', 'objects', unreadableBlobSha.slice(0, 2), unreadableBlobSha.slice(2)), { force: true });
    record('negative: blob present in diff but unreadable fails closed, not treated as deleted', () => {
      const result = checkNoSecretsInDiff(unreadableDir, baseSha, unreadableHead, SECRET_PATTERNS);
      assertOk(result, false);
      if (!result.detail.includes('unreadable')) throw new Error(`expected 'unreadable' in detail, got: ${result.detail}`);
    });

    record('assertSafeToRemove: accepts a path nested inside the allowed root', () => {
      const nested = join(tmpRoot, 'nested-ok');
      mkdirSync(nested, { recursive: true });
      const resolved = assertSafeToRemove(nested, tmpRoot);
      if (resolved !== resolvePath(nested)) throw new Error('resolved path mismatch');
    });

    record('assertSafeToRemove: rejects a path outside the allowed root', () => {
      const outside = resolvePath(tmpdir(), '..');
      let threw = false;
      try {
        assertSafeToRemove(outside, tmpRoot);
      } catch {
        threw = true;
      }
      if (!threw) throw new Error('expected rejection for path outside allowed root');
    });

    record('github api evaluator: positive', () =>
      assertOk(evaluateForkApiResponse({ fork: true, parent: { full_name: EXPECTED.parentFullName }, clone_url: EXPECTED.originUrl }, EXPECTED), true),
    );
    record('github api evaluator: fork=false', () =>
      assertOk(evaluateForkApiResponse({ fork: false, parent: { full_name: EXPECTED.parentFullName }, clone_url: EXPECTED.originUrl }, EXPECTED), false),
    );
    record('github api evaluator: wrong parent', () =>
      assertOk(evaluateForkApiResponse({ fork: true, parent: { full_name: 'someone/else' }, clone_url: EXPECTED.originUrl }, EXPECTED), false),
    );
    record('github api evaluator: wrong clone_url', () =>
      assertOk(evaluateForkApiResponse({ fork: true, parent: { full_name: EXPECTED.parentFullName }, clone_url: 'https://github.com/someone/else.git' }, EXPECTED), false),
    );
    record('branch diversity evaluator: positive', () => assertOk(evaluateBranchDiversity([{ name: 'a' }, { name: 'b' }], 2), true));
    record('branch diversity evaluator: too few', () => assertOk(evaluateBranchDiversity([{ name: 'a' }], 2), false));
  } finally {
    const safeTmpRoot = assertSafeToRemove(tmpRoot, tmpdir());
    rmSync(safeTmpRoot, { recursive: true, force: true });
  }

  console.log(`\nself-test: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  return failures.length === 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  main();
}
