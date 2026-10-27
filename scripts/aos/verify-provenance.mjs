// CRM-001 provenance gate. Checks real Git/GitHub state against hardcoded
// expectations; never trusts a success receipt supplied by a worker.
// Run: node scripts/aos/verify-provenance.mjs
// Self-test (isolated tmp fixtures, does not touch this checkout or network):
//   node scripts/aos/verify-provenance.mjs --self-test
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  { name: 'private-key-block', re: /-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/ },
  { name: 'github-token', re: /gh[pousr]_[0-9A-Za-z]{36,}/ },
  { name: 'slack-token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
];

function safeMessage(err) {
  const msg = err && err.message ? String(err.message).split('\n')[0] : String(err);
  return msg.slice(0, 200);
}

function git(args, { cwd, env } = {}) {
  const res = spawnSync('git', args, { cwd, env: env ?? process.env, encoding: 'utf8' });
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

function checkRemoteUrl(repoDir, remoteName, expectedUrl) {
  const r = git(['-C', repoDir, 'remote', 'get-url', remoteName]);
  if (r.status !== 0) return { ok: false, detail: `remote '${remoteName}' not configured` };
  const ok = r.stdout === expectedUrl;
  return { ok, detail: ok ? `${remoteName}=${r.stdout}` : `${remoteName} expected ${expectedUrl}, got ${r.stdout}` };
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

function checkNoSecretsInDiff(repoDir, baseSha, headRef, patterns) {
  const diff = git(['-C', repoDir, 'diff', '--name-only', `${baseSha}..${headRef}`]);
  if (diff.status !== 0) return { ok: false, detail: 'diff listing failed' };
  const files = diff.stdout.split('\n').filter(Boolean);
  const hits = [];
  for (const file of files) {
    const base = file.split('/').pop() ?? file;
    if (/^\.env(\..+)?$/.test(base)) {
      hits.push(`${file}: dotenv-style filename`);
      continue;
    }
    const show = git(['-C', repoDir, 'show', `${headRef}:${file}`]);
    if (show.status !== 0) continue; // deleted at headRef, nothing to scan
    for (const { name, re } of patterns) {
      if (re.test(show.stdout)) hits.push(`${file}: matched ${name}`);
    }
  }
  const ok = hits.length === 0;
  return { ok, detail: ok ? `scanned ${files.length} changed file(s), clean` : `secret-like content: ${hits.join('; ')}` };
}

function checkLsRemoteTag(repoDir, remoteName, tag, expectedSha) {
  const r = git(['-C', repoDir, 'ls-remote', remoteName, `refs/tags/${tag}`]);
  if (r.status !== 0) return { ok: false, detail: `ls-remote ${remoteName} failed (network/auth?)` };
  const sha = (r.stdout.split('\n')[0] ?? '').split('\t')[0] ?? '';
  const ok = sha === expectedSha;
  return { ok, detail: ok ? `${remoteName} tag ${tag} -> ${sha}` : `${remoteName} tag ${tag} expected ${expectedSha}, got '${sha || '(not found)'}'` };
}

// ---- GitHub API checks: network call separated from the pure evaluator ----

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
      ? `fork=true parent=${expected.parentFullName} clone_url matches`
      : `fork=${json.fork} parent=${parentName ?? 'none'} clone_url=${json.clone_url ?? 'missing'}`,
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
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\nself-test: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  return failures.length === 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  main();
}
