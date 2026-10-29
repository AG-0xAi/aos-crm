// CRM-002 local-security gate. Static contract checks over the committed
// local profile (compose.yaml, .dockerignore, .gitignore, .yarnrc.yml, the
// twenty-docker Dockerfile, .claude/settings.json, the merge guard). Never
// builds the CRM image, never starts a CRM service, never reads a real
// secret file. The compose and .dockerignore checks below prefer real
// Docker/BuildKit output (normalized JSON / an actual build-context export
// against synthetic fixtures) over a raw-text regex, because a regex can
// match a comment or a YAML merge anchor and produce a false PASS that
// misses a per-service override -- see docs/aos/bootstrap/LOCAL_SECURITY.md.
// When Docker/WSL is unreachable, those specific checks FAIL CLOSED by
// default (an unmeasured control is not a passed one). Pass --static to
// explicitly accept a reduced, Docker-less check set instead (reported
// `[INFO] ... not measured`) -- scripts/aos/local.ps1's Start/Restart never
// pass this flag, so they always see the fail-closed default.
// Run: node scripts/aos/verify-local-config.mjs
// Run (reduced, Docker-less, explicit): node scripts/aos/verify-local-config.mjs --static
// Self-test (isolated fixtures/subprocess only, never Docker, never network;
// it does read this repo's real .claude/settings.json and
// .claude/hooks/aos-merge-guard.cjs to exercise the merge-guard wiring
// itself, same as the existing hook-coverage self-test already did):
//   node scripts/aos/verify-local-config.mjs --self-test
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, lstatSync } from 'node:fs';
import { join, dirname, basename, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..', '..');
const WSL_DISTRO = process.env.AOS_WSL_DISTRO || 'AOS-CRM-Ubuntu-24.04';

function safeMessage(err) {
  const msg = err && err.message ? String(err.message).split('\n')[0] : String(err);
  return msg.slice(0, 200);
}

function readRepoFile(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

// Refuses to recursively delete anything that is not, right now, a real
// directory strictly inside expectedParentDir with a leaf name starting
// with expectedPrefix, and refuses outright if the target is a symlink:
// its target could point anywhere, so ancestor-path containment alone
// (verify-provenance.mjs's assertSafeToRemove) is not a full guarantee
// here. Re-resolves immediately before deleting rather than trusting an
// earlier snapshot. Mirrors scripts/aos/local.ps1's Remove-ContainedTempDir
// for the same fail-closed contract on the Node side.
function assertContainedTempDirSafeToRemove(targetDir, expectedParentDir, expectedPrefix) {
  let stat;
  try {
    stat = lstatSync(targetDir);
  } catch {
    return null; // already gone; nothing to remove
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`refusing to remove '${targetDir}': it is a symlink, not a plain directory`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`refusing to remove '${targetDir}': not a directory`);
  }
  const resolvedTarget = resolvePath(targetDir);
  const resolvedParent = resolvePath(expectedParentDir);
  const leaf = basename(resolvedTarget);
  const parentOfResolved = dirname(resolvedTarget);
  const isRoot = parentOfResolved === resolvedTarget;
  const isDirectChild = parentOfResolved === resolvedParent;
  const hasPrefix = leaf.startsWith(expectedPrefix);
  if (isRoot || !isDirectChild || !hasPrefix) {
    throw new Error(`refusing to remove '${resolvedTarget}': not a contained temp dir directly under '${resolvedParent}' with prefix '${expectedPrefix}'`);
  }
  return resolvedTarget;
}

function removeContainedTempDir(targetDir, expectedParentDir, expectedPrefix) {
  const safePath = assertContainedTempDirSafeToRemove(targetDir, expectedParentDir, expectedPrefix);
  if (safePath) rmSync(safePath, { recursive: true, force: true });
}

// ---- .dockerignore / .gitignore / .yarnrc.yml / Dockerfile: flat,
// non-anchored text, so a literal-line regex is not exposed to the
// comment/anchor ambiguity that the compose checks below are built to avoid
// ----

// Requires the **/ (any-depth) form of each pattern, not a root-only
// literal: a root-only `.mcp.json` passed this check while leaving
// packages/twenty-agent-skills/.mcp.json uncovered -- confirmed via the real
// Docker build-context export in checkDockerignoreViaRealDocker below.
function checkDockerignoreExcludesAosState(text) {
  const required = ['.aos', '.codegraph-aos', '.claude', '.git', '.mcp.json'];
  const missingAnyDepth = required.filter((p) => !new RegExp(`^\\*\\*/${p.replace(/\./g, '\\.')}\\s*$`, 'm').test(text));
  const hasEnvAnyDepth = /^\*\*\/\.env\s*$/m.test(text);
  const hasEnvSuffixAnyDepth = /^\*\*\/\.env\.\*\s*$/m.test(text);
  const hasExampleReincluded = /^!\*\*\/\.env\.example\s*$/m.test(text);
  const ok = missingAnyDepth.length === 0 && hasEnvAnyDepth && hasEnvSuffixAnyDepth && hasExampleReincluded;
  return {
    ok,
    detail: ok
      ? 'excludes .aos/.codegraph-aos/.claude/.git/.mcp.json at any depth (**/) plus **/.env and **/.env.* at any depth, with *.env.example re-included'
      : `missing any-depth (**/) exclude(s): ${missingAnyDepth.join(', ')}; **/.env=${hasEnvAnyDepth}, **/.env.*=${hasEnvSuffixAnyDepth}, !**/.env.example=${hasExampleReincluded}`,
  };
}

// deploy/local/privacy.env (CRM-003) is a non-secret, versioned profile, not
// credentials: it must be ABSENT from .gitignore. deploy/local/.env (the
// real per-install secrets) must be ignored. Checked against real git
// (check-ignore), not by grepping .gitignore's text for a line that could
// exist without actually taking effect (or vice versa).
function checkGitIgnoresRealEnvNotPrivacyProfile(repoRoot) {
  function isIgnored(relPath) {
    const res = spawnSync('git', ['check-ignore', '-q', relPath], { cwd: repoRoot });
    if (res.error) return null;
    return res.status === 0;
  }
  const envIgnored = isIgnored('deploy/local/.env');
  const privacyIgnored = isIgnored('deploy/local/privacy.env');
  if (envIgnored === null || privacyIgnored === null) {
    return { ok: false, detail: 'git check-ignore could not run (is git on PATH?)' };
  }
  const ok = envIgnored && !privacyIgnored;
  return {
    ok,
    detail: ok
      ? 'git check-ignore: deploy/local/.env is ignored, deploy/local/privacy.env is not (CRM-003 profile is versioned, not a secret)'
      : `git check-ignore: deploy/local/.env ignored=${envIgnored} (want true), deploy/local/privacy.env ignored=${privacyIgnored} (want false)`,
  };
}

function checkYarnrcTelemetryOff(text) {
  const ok = /^enableTelemetry:\s*false\s*$/m.test(text);
  return { ok, detail: ok ? 'enableTelemetry: false' : 'enableTelemetry: false not found' };
}

function checkYarnrcHardenedModeIntact(text) {
  const ok = /^enableHardenedMode:\s*true\s*$/m.test(text) && /^enableScripts:\s*false\s*$/m.test(text);
  return { ok, detail: ok ? 'enableHardenedMode/enableScripts untouched' : 'hardened mode or enableScripts was weakened' };
}

// Confirms the opt-out ENV precedes the first yarn/nx RUN so every
// downstream stage (including stages that do not derive from node-base
// through a later COPY-only path) inherits it before any install/build.
function checkDockerfileTelemetryOptOut(text) {
  const envIdx = text.search(/ENV\s+YARN_ENABLE_TELEMETRY=0/);
  const firstRunIdx = text.search(/RUN\s+(yarn|npx\s+nx)\b/);
  const hasNxCloud = /NX_NO_CLOUD=true/.test(text);
  const hasNxDaemon = /NX_DAEMON=false/.test(text);
  const ok = envIdx !== -1 && firstRunIdx !== -1 && envIdx < firstRunIdx && hasNxCloud && hasNxDaemon;
  return { ok, detail: ok ? 'YARN_ENABLE_TELEMETRY/NX_NO_CLOUD/NX_DAEMON set before the first yarn/nx RUN' : `envIdx=${envIdx}, firstRunIdx=${firstRunIdx}, nxCloud=${hasNxCloud}, nxDaemon=${hasNxDaemon}` };
}

function checkSettingsJsonRestrictions(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, detail: `.claude/settings.json is not valid JSON: ${safeMessage(e)}` };
  }
  const disabled = new Set(json.disabledMcpjsonServers || []);
  const hasDisabled = ['context7', 'playwright', 'postgres'].every((s) => disabled.has(s));
  const hasConnectorsOff = json.disableClaudeAiConnectors === true;
  const env = json.env || {};
  const hasEnv = env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1' && env.DO_NOT_TRACK === '1';
  const ok = hasDisabled && hasConnectorsOff && hasEnv;
  return { ok, detail: ok ? 'disabledMcpjsonServers/disableClaudeAiConnectors/env opt-outs all present' : `disabled=${hasDisabled}, connectorsOff=${hasConnectorsOff}, env=${hasEnv}` };
}

function checkMergeGuardWiringCoversBothShells(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, detail: `.claude/settings.json is not valid JSON: ${safeMessage(e)}` };
  }
  const entry = (json.hooks?.PreToolUse || []).find((e) => /aos-merge-guard\.cjs/.test(JSON.stringify(e)));
  if (!entry) return { ok: false, detail: 'no PreToolUse entry references aos-merge-guard.cjs' };
  const matcherCoversBoth = /Bash/.test(entry.matcher) && /PowerShell/.test(entry.matcher);
  const hook = (entry.hooks || [])[0] || {};
  const usesExecForm = Array.isArray(hook.args) && hook.args.some((a) => /aos-merge-guard\.cjs/.test(a));
  const failsClosed = hook.onFailure === 'block';
  const ok = matcherCoversBoth && usesExecForm && failsClosed;
  return { ok, detail: ok ? "matcher covers Bash|PowerShell, exec form, onFailure:block" : `matcher=${entry.matcher}, execForm=${usesExecForm}, onFailure=${hook.onFailure}` };
}

function checkMergeGuardMessageAttributesMergeToHuman(text) {
  const mentionsS00Merging = /S-00[^.]*fusion/i.test(text);
  const mentionsHuman = /humano/i.test(text);
  const ok = !mentionsS00Merging && mentionsHuman;
  return { ok, detail: ok ? 'guard message attributes the merge to a human, not S-00' : `mentionsS00Merging=${mentionsS00Merging}, mentionsHuman=${mentionsHuman}` };
}

// ---- merge-guard subprocess behavior: real hook, synthetic stdin ----
// Builds the risky command strings from pieces so the fixture text never
// appears as a literal substring anywhere a PreToolUse matcher could see it
// as this process's own argv/command.
function buildSyntheticCommand(parts) {
  return parts.join(' ');
}

// Exercises the HOOK SCRIPT's own logic directly (process.execPath + the
// file path), bypassing .claude/settings.json's command/args wiring
// entirely. This proves the script's blocking logic is correct; it does NOT
// prove settings.json actually invokes it the way Claude Code does (PATH
// resolution of "node", ${CLAUDE_PROJECT_DIR} substitution) -- that is what
// runMergeGuardCoverageViaSettingsWiring below is for.
function invokeMergeGuard(hookPath, toolName, command) {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: { command } });
  const res = spawnSync(process.execPath, [hookPath], { input: payload, encoding: 'utf8' });
  return { status: res.status, blocked: res.status === 2 };
}

function runMergeGuardCoverage(hookPath) {
  const mergeCmd = buildSyntheticCommand(['gh', 'pr', 'merge', '123']);
  const pushCmd = buildSyntheticCommand(['git', 'push', 'origin', 'main']);
  const innocuousCmd = buildSyntheticCommand(['git', 'status']);
  const cases = [
    ['Bash', mergeCmd, true],
    ['PowerShell', mergeCmd, true],
    ['Bash', pushCmd, true],
    ['PowerShell', pushCmd, true],
    ['Bash', innocuousCmd, false],
    ['PowerShell', innocuousCmd, false],
  ];
  return cases.map(([toolName, command, expectBlocked]) => {
    const { blocked } = invokeMergeGuard(hookPath, toolName, command);
    const ok = blocked === expectBlocked;
    return {
      name: `merge-guard-script-direct:${toolName}/${expectBlocked ? 'blocks-merge' : 'allows-innocuous'}`,
      ok,
      detail: ok ? `blocked=${blocked} as expected (direct subprocess, not through settings.json)` : `expected blocked=${expectBlocked}, got blocked=${blocked}`,
    };
  });
}

// Reads the REAL PreToolUse hook entry for aos-merge-guard.cjs from
// settings.json and substitutes ${CLAUDE_PROJECT_DIR} the same way Claude
// Code's exec form does (https://code.claude.com/docs/en/hooks#exec-form-and-shell-form),
// without hardcoding this machine's path.
function loadMergeGuardHookDefinition(settingsText, repoRoot) {
  let json;
  try {
    json = JSON.parse(settingsText);
  } catch {
    return null;
  }
  const entry = (json.hooks?.PreToolUse || []).find((e) => /aos-merge-guard\.cjs/.test(JSON.stringify(e)));
  const hookDef = entry && (entry.hooks || [])[0];
  if (!hookDef || !hookDef.command) return null;
  const args = (hookDef.args || []).map((a) => a.split('${CLAUDE_PROJECT_DIR}').join(repoRoot));
  return { command: hookDef.command, args };
}

// Exercises the ACTUAL settings.json wiring: `command` is literally the
// string "node" from settings.json, resolved via PATH exactly as Claude
// Code's exec form resolves it (never process.execPath), with
// ${CLAUDE_PROJECT_DIR} substituted. Strict exit-code equality throughout:
// an innocuous command must be exit 0 EXACTLY and a blocked one exit 2
// EXACTLY, so a spawn failure (null status / ENOENT) can never be misread
// as either an allow or a block.
function runMergeGuardCoverageViaSettingsWiring(settingsText, repoRoot) {
  const hookDef = loadMergeGuardHookDefinition(settingsText, repoRoot);
  if (!hookDef) {
    return [{ name: 'merge-guard-wiring:settings-json-loadable', ok: false, detail: 'no loadable PreToolUse hook definition for aos-merge-guard.cjs in settings.json' }];
  }
  const mergeCmd = buildSyntheticCommand(['gh', 'pr', 'merge', '123']);
  const pushCmd = buildSyntheticCommand(['git', 'push', 'origin', 'main']);
  const innocuousCmd = buildSyntheticCommand(['git', 'status']);
  const cases = [
    ['Bash', mergeCmd, 2],
    ['PowerShell', mergeCmd, 2],
    ['Bash', pushCmd, 2],
    ['PowerShell', pushCmd, 2],
    ['Bash', innocuousCmd, 0],
    ['PowerShell', innocuousCmd, 0],
  ];
  return cases.map(([toolName, command, expectedStatus]) => {
    const payload = JSON.stringify({ tool_name: toolName, tool_input: { command } });
    const res = spawnSync(hookDef.command, hookDef.args, { input: payload, encoding: 'utf8' });
    const ok = res.status === expectedStatus;
    return {
      name: `merge-guard-wiring:${toolName}/${expectedStatus === 0 ? 'allows-innocuous' : 'blocks'}`,
      ok,
      detail: ok
        ? `status===${expectedStatus} exactly, via settings.json's own command/args ("${hookDef.command}", PATH-resolved)`
        : `expected status===${expectedStatus} exactly, got status=${JSON.stringify(res.status)}${res.error ? `, error=${safeMessage(res.error)}` : ''}`,
    };
  });
}

// A broken hook path in the wiring must surface as a visibly distinct
// failure (here: node's own "module not found" exit code 1), never
// misread as exit 0 (allow) or exit 2 (block). settings.json's own
// onFailure:"block" is what makes Claude Code's harness treat a hook
// failure as blocking; this only proves the failure is visible to a
// caller, not the harness-side reaction (that part is not independently
// testable from here -- see the report's declared limitation).
function checkMergeGuardWiringFailsVisiblyOnBrokenExecutable(repoRoot) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } });
  const brokenPath = join(repoRoot, '.claude', 'hooks', 'this-file-does-not-exist.cjs');
  const res = spawnSync('node', [brokenPath], { input: payload, encoding: 'utf8' });
  const isExactAllow = res.status === 0;
  const isExactBlock = res.status === 2;
  const ok = !isExactAllow && !isExactBlock;
  return {
    ok,
    detail: ok
      ? `broken hook path surfaces visibly (status=${res.status}), not misread as an exact allow or block`
      : `broken hook path was misread as an exact allow/block (status=${res.status})`,
  };
}

// ---- compose.yaml: real Docker/BuildKit normalization only ----
// `docker compose config --no-interpolate --no-env-resolution --format json`
// resolves YAML anchors/merge keys (<<: *aos-crm-env) into each service's
// literal, effective fields -- including an override that only touches one
// service after the merge -- without needing (or being able to read) any
// real secret: --no-interpolate leaves every ${VAR} reference as literal
// text, and --no-env-resolution means a missing required var never errors.
function fetchComposeJsonViaRealDocker(repoRoot, distro) {
  const pathProbe = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', repoRoot], { encoding: 'utf8' });
  if (pathProbe.error || pathProbe.status !== 0) {
    return { measured: false, model: null, detail: 'not measured: wsl.exe/distro unavailable on this runtime (see HOST_RUNTIME.md)' };
  }
  const linuxRoot = pathProbe.stdout.trim();
  const composePath = `${linuxRoot}/deploy/local/compose.yaml`;
  const res = spawnSync(
    'wsl.exe',
    ['-d', distro, '--exec', 'docker', 'compose', '-f', composePath, '-p', 'aos-crm-local', 'config', '--no-interpolate', '--no-env-resolution', '--format', 'json'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (res.error) {
    return { measured: false, model: null, detail: `not measured: docker unavailable (${safeMessage(res.error)})` };
  }
  if (res.status !== 0) {
    // --no-interpolate/--no-env-resolution means no secret can ever appear
    // here, but the detail stays bounded anyway rather than echoing stderr.
    return { measured: true, model: null, detail: `docker compose config exited ${res.status}` };
  }
  try {
    return { measured: true, model: JSON.parse(res.stdout), detail: 'parsed' };
  } catch (e) {
    return { measured: true, model: null, detail: `docker compose config produced invalid JSON: ${safeMessage(e)}` };
  }
}

// A service that is PULLED (no build section) must name an immutable digest:
// `postgres:16` is a moving alias that can resolve to different bytes on two
// machines or two days, which is exactly what a reproducible local profile
// cannot afford. A service that is BUILT from this repo is excluded: its tag
// names a locally produced artifact whose digest does not exist until the
// build runs, so requiring one there would be unsatisfiable.
function checkJsonNoMovingImage(model) {
  const bad = [];
  for (const [name, svc] of Object.entries(model.services || {})) {
    const image = String(svc.image || '');
    if (/twentycrm\/twenty/.test(image) || /:latest\b/.test(image)) { bad.push(`${name} (vendor/latest)`); continue; }
    if (!svc.build && !/@sha256:[0-9a-f]{64}\b/.test(image)) bad.push(`${name} (pulled image not pinned to a digest)`);
  }
  const hasAnyImage = Object.values(model.services || {}).some((s) => s.image);
  const ok = hasAnyImage && bad.length === 0;
  return { ok, detail: ok ? 'no vendor/:latest image, and every pulled image is pinned to an immutable digest' : `moving/registry image reference in service(s): ${bad.join(', ')}` };
}

function checkJsonBuildsFromSource(model) {
  const buildServices = Object.entries(model.services || {}).filter(([, s]) => s.build);
  const bad = buildServices.filter(([, s]) => s.build.dockerfile !== 'packages/twenty-docker/twenty/Dockerfile' || s.build.target !== 'twenty').map(([n]) => n);
  const ok = buildServices.length > 0 && bad.length === 0;
  return { ok, detail: ok ? `${buildServices.length} service(s) build from packages/twenty-docker/twenty/Dockerfile target twenty` : `service(s) not building the official Dockerfile/target: ${bad.join(', ')}` };
}

function checkJsonConsumesPrivacyEnv(model) {
  const need = ['server', 'worker'];
  const bad = need.filter((name) => {
    const files = (model.services?.[name]?.env_file || []).map((f) => (typeof f === 'string' ? f : f.path));
    return !files.some((p) => p.endsWith('/privacy.env') || p === './privacy.env');
  });
  const ok = bad.length === 0;
  return { ok, detail: ok ? 'server and worker both have env_file pointing at privacy.env' : `missing privacy.env env_file on: ${bad.join(', ')}` };
}

// The effective (merged) environment, not a raw-text search for the first
// occurrence: a regex over the YAML would still find LOGIC_FUNCTION_TYPE:
// DISABLED in the x-aos-crm-env anchor even if one service's own block
// overrode it afterward -- exactly the false PASS this replaces.
function checkJsonDriversDisabledEffective(model) {
  const need = ['server', 'worker'];
  const bad = [];
  for (const name of need) {
    const env = model.services?.[name]?.environment || {};
    if (env.LOGIC_FUNCTION_TYPE !== 'DISABLED' || env.CODE_INTERPRETER_TYPE !== 'DISABLED') {
      bad.push(`${name}(LOGIC_FUNCTION_TYPE=${env.LOGIC_FUNCTION_TYPE},CODE_INTERPRETER_TYPE=${env.CODE_INTERPRETER_TYPE})`);
    }
  }
  const ok = bad.length === 0;
  return { ok, detail: ok ? 'server and worker both have the effective (merged) LOGIC_FUNCTION_TYPE=DISABLED, CODE_INTERPRETER_TYPE=DISABLED' : `effective driver override on: ${bad.join(', ')}` };
}

// `docker compose config` is read with --no-interpolate --no-env-resolution, so
// a value can still be a `${VAR:-default}` expression. Returns the value the
// stack would actually get when VAR is unset, or null when that cannot be
// determined from the file alone (a bare `${VAR}`, or a nested expression):
// null is a blocker for the caller, never a pass.
function composeFallbackValue(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value.includes('${')) return value;
  const simple = /^\$\{\s*[A-Za-z_][A-Za-z0-9_]*\s*:-([^${}]*)\}$/.exec(value);
  return simple ? simple[1].trim() : null;
}

// The BETA profile (CRM-014), on the effective merged environment of both
// services and not on the YAML text: one isolated workspace per person, each
// resolved from its own subdomain, and workspaces opened by server admins only.
//
// The two flags are measured together on purpose. Multi-workspace alone is open
// registration: sign-in-up.service.ts only consults
// IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS to decide whether a
// non-admin's signUp/signUpInNewWorkspace is refused, so a profile with the
// first flag on and the second off hands a workspace to anyone who can reach
// the port. The host is measured too: with multi-workspace on, an IP-literal
// SERVER_URL has no subdomain a browser can resolve
// (get-subdomain-and-custom-domain-from-hostname.util.ts maps every origin
// under it to "no workspace"), which starts a healthy stack nobody can sign in
// to -- the failure mode this check exists to refuse.
function checkJsonBetaWorkspaceProfile(model) {
  const bad = [];
  const serverUrls = new Set();
  for (const name of ['server', 'worker']) {
    const env = model.services?.[name]?.environment || {};
    if (env.IS_MULTIWORKSPACE_ENABLED !== 'true') {
      bad.push(`${name}(IS_MULTIWORKSPACE_ENABLED=${env.IS_MULTIWORKSPACE_ENABLED})`);
    }
    if (env.IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS !== 'true') {
      bad.push(`${name}(IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS=${env.IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS})`);
    }
    const subdomain = composeFallbackValue(env.DEFAULT_SUBDOMAIN);
    if (!subdomain) {
      bad.push(`${name}(DEFAULT_SUBDOMAIN=${env.DEFAULT_SUBDOMAIN ?? 'unset'})`);
    }
    const serverUrl = composeFallbackValue(env.SERVER_URL);
    if (!serverUrl) {
      bad.push(`${name}(SERVER_URL fallback undeterminable: ${env.SERVER_URL ?? 'unset'})`);
      continue;
    }
    serverUrls.add(serverUrl);
    let hostname = null;
    try { hostname = new URL(serverUrl).hostname; } catch { /* reported below */ }
    if (hostname === null) {
      bad.push(`${name}(SERVER_URL is not a URL)`);
    } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) {
      bad.push(`${name}(SERVER_URL host ${hostname} is an IP literal, which cannot carry a workspace subdomain)`);
    }
  }
  if (serverUrls.size > 1) {
    bad.push(`server and worker disagree on SERVER_URL (${[...serverUrls].join(' vs ')}), so they would build different workspace links`);
  }
  const ok = bad.length === 0;
  return {
    ok,
    detail: ok
      ? `beta profile effective on server and worker: multi-workspace on, creation limited to server admins, default subdomain set, SERVER_URL host carries subdomains (${[...serverUrls][0]})`
      : `beta profile not effective: ${bad.join(', ')}`,
  };
}

function checkJsonNoPrivilegedOrSocket(model) {
  const bad = [];
  for (const [name, svc] of Object.entries(model.services || {})) {
    if (svc.privileged === true) { bad.push(`${name}:privileged`); continue; }
    for (const v of svc.volumes || []) {
      const src = typeof v === 'string' ? v.split(':')[0] : v.source;
      if (src && /docker\.sock$/.test(String(src))) { bad.push(`${name}:docker.sock`); break; }
    }
  }
  const ok = bad.length === 0;
  return { ok, detail: ok ? 'no service is privileged or mounts docker.sock' : `found: ${bad.join(', ')}` };
}

// Enumerates EVERY service's `ports` entries (not just the first match of a
// loopback-looking string): db/redis publishing anything, or a second
// wildcard port on server after a correct loopback one, both fail here --
// a first-match regex on raw text missed both.
function checkJsonOnlyServerPublishesLoopbackPort(model) {
  const published = [];
  for (const [name, svc] of Object.entries(model.services || {})) {
    for (const p of svc.ports || []) published.push({ service: name, raw: p });
  }
  const nonServer = published.filter((p) => p.service !== 'server');
  if (nonServer.length > 0) {
    return { ok: false, detail: `non-server service(s) publish ports: ${nonServer.map((p) => `${p.service}=${JSON.stringify(p.raw)}`).join(', ')}` };
  }
  if (published.length !== 1) {
    return { ok: false, detail: `expected exactly 1 published port (server only), found ${published.length}: ${JSON.stringify(published.map((p) => p.raw))}` };
  }
  const raw = published[0].raw;
  const hostIp = String(raw).split(':')[0];
  const ok = hostIp === '127.0.0.1';
  return { ok, detail: ok ? `exactly one published port, server-only, loopback-bound (${raw})` : `server's published port is not loopback-bound (host_ip=${hostIp}, entry=${raw})` };
}

function checkJsonDedicatedNetworkAndVolumes(model) {
  if (model.name !== 'aos-crm-local') {
    return { ok: false, detail: `project name is '${model.name}', expected 'aos-crm-local'` };
  }
  const net = model.networks?.['aos-crm-local'];
  if (!net || net.name !== 'aos-crm-local') {
    return { ok: false, detail: 'top-level networks.aos-crm-local missing or misnamed' };
  }
  const vols = model.volumes || {};
  if (!vols['aos-crm-local-db'] || !vols['aos-crm-local-storage']) {
    return { ok: false, detail: 'top-level volumes aos-crm-local-db/aos-crm-local-storage missing' };
  }
  const stray = [];
  for (const [name, svc] of Object.entries(model.services || {})) {
    const strayNets = Object.keys(svc.networks || {}).filter((n) => n !== 'aos-crm-local');
    if (strayNets.length > 0) stray.push(`${name}:${strayNets.join('/')}`);
  }
  const ok = stray.length === 0;
  return { ok, detail: ok ? 'dedicated project/network/volumes confirmed, no service on a stray network' : `service(s) attached to a non-dedicated network: ${stray.join(', ')}` };
}

function checkJsonHealthchecksPresent(model) {
  const need = ['server', 'db', 'redis'];
  const missing = need.filter((n) => !model.services?.[n]?.healthcheck);
  const ok = missing.length === 0;
  return { ok, detail: ok ? 'server/db/redis each define healthcheck' : `missing healthcheck on: ${missing.join(', ')}` };
}

const COMPOSE_JSON_CHECKS = [
  ['no-moving-image', checkJsonNoMovingImage],
  ['builds-from-source', checkJsonBuildsFromSource],
  ['consumes-privacy-env', checkJsonConsumesPrivacyEnv],
  ['drivers-disabled-effective', checkJsonDriversDisabledEffective],
  ['beta-workspace-profile-effective', checkJsonBetaWorkspaceProfile],
  ['no-privileged-or-socket', checkJsonNoPrivilegedOrSocket],
  ['only-server-publishes-loopback-port', checkJsonOnlyServerPublishesLoopbackPort],
  ['dedicated-network-and-volumes', checkJsonDedicatedNetworkAndVolumes],
  ['healthchecks-present', checkJsonHealthchecksPresent],
];

// ---- .dockerignore: real Docker build-context export against synthetic
// fixtures (never the real repo, never the CRM Dockerfile/image) ----
// `FROM scratch` + `-o <dir>` (BuildKit local export) asks Docker's actual
// matcher which files land in the context, instead of re-implementing
// dockerignore's gitignore-derived "**"/pattern semantics by hand -- see
// https://docs.docker.com/build/concepts/context/.
function checkDockerignoreViaRealDocker(repoRoot, distro) {
  const pathProbe = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', repoRoot], { encoding: 'utf8' });
  if (pathProbe.error || pathProbe.status !== 0) {
    return { measured: false, ok: null, detail: 'not measured: wsl.exe/distro unavailable on this runtime (see HOST_RUNTIME.md)' };
  }
  const linuxRoot = pathProbe.stdout.trim();
  // Context AND exported output live under the SAME mkdtemp-owned scratch
  // root, so one contained cleanup removes both -- plus any partial output
  // left behind by a failed build -- without ever needing a separate
  // Linux-rooted `rm -rf` to reach back across the WSL boundary.
  const scratchRoot = mkdtempSync(join(tmpdir(), 'aos-crm-dockerignore-probe-'));
  const winCtx = join(scratchRoot, 'ctx');
  const winOut = join(scratchRoot, 'out');
  try {
    mkdirSync(winCtx, { recursive: true });
    mkdirSync(winOut, { recursive: true });
    const fixtures = {
      '.env': 'FIXTURE_SECRET=root-env',
      '.git': 'not-a-real-git-dir-just-a-fixture',
      '.mcp.json': '{}',
      'package.json': '{"name":"fixture"}',
      LICENSE: 'MIT License fixture, keep-me',
      'deploy/local/.env': 'FIXTURE_SECRET=local-env',
      'deploy/local/.env.local': 'FIXTURE_SECRET=local-env-local',
      'deploy/local/.env.production': 'FIXTURE_SECRET=local-env-prod',
      'deploy/local/.env.example': 'EXAMPLE=keep-me',
      'deploy/local/privacy.env': 'TELEMETRY_ENABLED=false',
      'packages/twenty-server/.env.test': 'FIXTURE_SECRET=server-env-test',
      'packages/twenty-server/.env.example': 'EXAMPLE=keep-me-too',
      'nested/deeper/dir/.env': 'FIXTURE_SECRET=deep-env',
      'nested/deeper/dir/asset.txt': 'keep-me-asset',
      // Real, confirmed nested miss a root-only .mcp.json pattern left
      // uncovered (packages/twenty-agent-skills/.mcp.json), plus nested
      // agent/bus/graph/Git fixtures proving the **/ fix in .dockerignore.
      'packages/twenty-agent-skills/.mcp.json': '{"servers":{}}',
      'packages/twenty-agent-skills/skill.json': 'keep-me-skill-asset',
      'nested/sub/.claude/settings.json': '{"fixture":true}',
      'nested/sub/.aos/state.json': '{"fixture":true}',
      'nested/sub/.codegraph-aos/index.sqlite': 'fixture',
      'vendor/thirdparty/.git/HEAD': 'ref: refs/heads/main',
    };
    for (const [rel, content] of Object.entries(fixtures)) {
      const dest = join(winCtx, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content, 'utf8');
    }
    copyFileSync(join(repoRoot, '.dockerignore'), join(winCtx, '.dockerignore'));
    writeFileSync(join(winCtx, 'Dockerfile'), 'FROM scratch\nCOPY . /\n', 'utf8');

    const expectKept = [
      'deploy/local/.env.example',
      'packages/twenty-server/.env.example',
      'package.json',
      'LICENSE',
      'nested/deeper/dir/asset.txt',
      'packages/twenty-agent-skills/skill.json',
    ];
    const expectExcluded = [
      '.env', '.git', '.mcp.json',
      'deploy/local/.env', 'deploy/local/.env.local', 'deploy/local/.env.production', 'deploy/local/privacy.env',
      'packages/twenty-server/.env.test', 'nested/deeper/dir/.env',
      'packages/twenty-agent-skills/.mcp.json',
      'nested/sub/.claude/settings.json',
      'nested/sub/.aos/state.json',
      'nested/sub/.codegraph-aos/index.sqlite',
      'vendor/thirdparty/.git/HEAD',
    ];

    const ctxProbe = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', winCtx], { encoding: 'utf8' });
    const outProbe = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', winOut], { encoding: 'utf8' });
    if (ctxProbe.error || ctxProbe.status !== 0 || outProbe.error || outProbe.status !== 0) {
      return { measured: false, ok: null, detail: 'not measured: wslpath translation of the synthetic probe context/output failed' };
    }
    const linuxCtx = ctxProbe.stdout.trim();
    const linuxOut = outProbe.stdout.trim();
    const build = spawnSync('wsl.exe', ['-d', distro, '--exec', 'docker', 'build', '-f', `${linuxCtx}/Dockerfile`, '-o', linuxOut, linuxCtx], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (build.error || build.status !== 0) {
      return { measured: false, ok: null, detail: `not measured: synthetic scratch-image build/export failed (status=${build.status}${build.error ? `, ${safeMessage(build.error)}` : ''})` };
    }
    const find = spawnSync('wsl.exe', ['-d', distro, '--exec', 'find', linuxOut, '-type', 'f'], { encoding: 'utf8' });
    if (find.error || find.status !== 0) {
      return { measured: false, ok: null, detail: 'not measured: could not list the exported probe output' };
    }
    const exported = new Set(find.stdout.split('\n').filter(Boolean).map((p) => p.slice(linuxOut.length + 1)));
    const wronglyKept = expectExcluded.filter((p) => exported.has(p));
    const wronglyExcluded = expectKept.filter((p) => !exported.has(p));
    const ok = wronglyKept.length === 0 && wronglyExcluded.length === 0;
    return {
      measured: true,
      ok,
      detail: ok
        ? `real Docker build-context export: ${expectExcluded.length} dotenv/agent-bus-git-graph fixture(s) excluded at various depths (including nested, e.g. packages/twenty-agent-skills/.mcp.json), ${expectKept.length} example(s)/license/asset file(s) kept`
        : `wronglyKept=${JSON.stringify(wronglyKept)}, wronglyExcluded=${JSON.stringify(wronglyExcluded)}`,
    };
  } finally {
    removeContainedTempDir(scratchRoot, tmpdir(), 'aos-crm-dockerignore-probe-');
  }
}

// ---------------------------------------------------------------------------
// main: real repo files/Docker only
// ---------------------------------------------------------------------------

// Only main() (never --self-test) reads this: an explicit, visible opt-out
// for a reduced Docker-less check set. scripts/aos/local.ps1's
// Invoke-LocalConfigVerifier never passes it -- Start/Restart always run
// the fail-closed default, so an unreachable Docker/WSL on that path blocks
// instead of quietly running with fewer controls.
const STATIC_ONLY = process.argv.includes('--static');

function main() {
  const results = [];

  const composeJson = fetchComposeJsonViaRealDocker(REPO_ROOT, WSL_DISTRO);
  if (composeJson.measured && composeJson.model) {
    for (const [name, fn] of COMPOSE_JSON_CHECKS) {
      results.push({ name: `compose-json:${name}`, ...fn(composeJson.model) });
    }
  } else if (composeJson.measured) {
    results.push({ name: 'compose-json:parseable', ok: false, detail: composeJson.detail });
  } else if (STATIC_ONLY) {
    console.log(`[INFO] compose-json: ${composeJson.detail} (effective Compose structure not measured by this run; --static mode, local.ps1 Start/Restart never pass this flag)`);
  } else {
    results.push({ name: 'compose-json:measured', ok: false, detail: `${composeJson.detail}; fails closed by default -- pass --static to explicitly accept a reduced, Docker-less check set (Start/Restart never do)` });
  }

  results.push({ name: 'dockerignore:excludes-aos-state', ...checkDockerignoreExcludesAosState(readRepoFile('.dockerignore')) });
  results.push({ name: 'gitignore:real-env-ignored-privacy-not', ...checkGitIgnoresRealEnvNotPrivacyProfile(REPO_ROOT) });
  results.push({ name: 'yarnrc:telemetry-off', ...checkYarnrcTelemetryOff(readRepoFile('.yarnrc.yml')) });
  results.push({ name: 'yarnrc:hardened-mode-intact', ...checkYarnrcHardenedModeIntact(readRepoFile('.yarnrc.yml')) });
  results.push({ name: 'dockerfile:telemetry-opt-out-before-first-run', ...checkDockerfileTelemetryOptOut(readRepoFile('packages/twenty-docker/twenty/Dockerfile')) });
  const settingsText = readRepoFile('.claude/settings.json');
  results.push({ name: 'settings:restrictions-present', ...checkSettingsJsonRestrictions(settingsText) });
  results.push({ name: 'settings:merge-guard-wiring', ...checkMergeGuardWiringCoversBothShells(settingsText) });
  const guardText = readRepoFile('.claude/hooks/aos-merge-guard.cjs');
  results.push({ name: 'merge-guard:message-attributes-to-human', ...checkMergeGuardMessageAttributesMergeToHuman(guardText) });
  results.push(...runMergeGuardCoverage(join(REPO_ROOT, '.claude/hooks/aos-merge-guard.cjs')));
  results.push(...runMergeGuardCoverageViaSettingsWiring(settingsText, REPO_ROOT));
  results.push({ name: 'merge-guard-wiring:broken-path-visible-not-misread', ...checkMergeGuardWiringFailsVisiblyOnBrokenExecutable(REPO_ROOT) });

  for (const r of results) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}: ${r.detail}`);

  const dockerignoreCheck = checkDockerignoreViaRealDocker(REPO_ROOT, WSL_DISTRO);
  if (dockerignoreCheck.measured) {
    console.log(`[${dockerignoreCheck.ok ? 'PASS' : 'FAIL'}] dockerignore:real-docker-build-context: ${dockerignoreCheck.detail}`);
    results.push({ name: 'dockerignore:real-docker-build-context', ok: dockerignoreCheck.ok, detail: dockerignoreCheck.detail });
  } else if (STATIC_ONLY) {
    console.log(`[INFO] dockerignore:real-docker-build-context: ${dockerignoreCheck.detail} (--static mode, local.ps1 Start/Restart never pass this flag)`);
  } else {
    results.push({ name: 'dockerignore:real-docker-build-context:measured', ok: false, detail: `${dockerignoreCheck.detail}; fails closed by default -- pass --static to explicitly accept a reduced, Docker-less check set (Start/Restart never do)` });
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length}/${results.length} local-security checks failed.`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${results.length} local-security checks passed.`);
  console.log('Scope: static configuration contract only. No CRM image was built, no CRM container/network/volume was created, and no CRM service was started by this script -- the .dockerignore check DOES build and export a throwaway `FROM scratch` image, but only from synthetic fixtures in an isolated temp dir, never the CRM Dockerfile/image/context.');
  console.log('deploy/local/privacy.env is a separate CRM-003 deliverable: its absence is expected right now and is exactly what makes docker compose refuse to start (see R2.1); this gate does not create or require it.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// self-test: synthetic fixtures + real subprocesses (git/node on isolated
// fixtures, and this repo's actual merge-guard hook + settings.json wiring,
// same precedent as the pre-existing hook-coverage test), isolated from this
// repo's real compose.yaml/.dockerignore content and never touching Docker
// or the network.
// ---------------------------------------------------------------------------

function cloneGoodComposeModel() {
  return JSON.parse(JSON.stringify({
    name: 'aos-crm-local',
    networks: { 'aos-crm-local': { name: 'aos-crm-local', driver: 'bridge' } },
    volumes: { 'aos-crm-local-db': { name: 'aos-crm-local-db' }, 'aos-crm-local-storage': { name: 'aos-crm-local-storage' } },
    services: {
      server: {
        image: '${AOS_CRM_IMAGE_TAG:?set in deploy/local/.env to aos-crm-local/twenty:v2.51.0-15e4826d3b}',
        build: { dockerfile: 'packages/twenty-docker/twenty/Dockerfile', target: 'twenty' },
        env_file: [{ path: '/repo/deploy/local/privacy.env', required: true }],
        environment: {
          LOGIC_FUNCTION_TYPE: 'DISABLED',
          CODE_INTERPRETER_TYPE: 'DISABLED',
          SERVER_URL: '${AOS_CRM_SERVER_URL:-http://localhost:43000}',
          IS_MULTIWORKSPACE_ENABLED: 'true',
          IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS: 'true',
          DEFAULT_SUBDOMAIN: '${AOS_CRM_DEFAULT_SUBDOMAIN:-app}',
        },
        networks: { 'aos-crm-local': null },
        ports: ['127.0.0.1:${AOS_CRM_WEB_PORT:-43000}:3000'],
        healthcheck: { test: ['CMD', 'curl'] },
        security_opt: ['no-new-privileges:true'],
        volumes: [{ source: 'aos-crm-local-storage', target: '/app/x', type: 'volume' }],
      },
      worker: {
        image: '${AOS_CRM_IMAGE_TAG:?set in deploy/local/.env}',
        build: { dockerfile: 'packages/twenty-docker/twenty/Dockerfile', target: 'twenty' },
        env_file: [{ path: '/repo/deploy/local/privacy.env', required: true }],
        environment: {
          LOGIC_FUNCTION_TYPE: 'DISABLED',
          CODE_INTERPRETER_TYPE: 'DISABLED',
          SERVER_URL: '${AOS_CRM_SERVER_URL:-http://localhost:43000}',
          IS_MULTIWORKSPACE_ENABLED: 'true',
          IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS: 'true',
          DEFAULT_SUBDOMAIN: '${AOS_CRM_DEFAULT_SUBDOMAIN:-app}',
        },
        networks: { 'aos-crm-local': null },
        security_opt: ['no-new-privileges:true'],
        volumes: [{ source: 'aos-crm-local-storage', target: '/app/x', type: 'volume' }],
      },
      db: {
        image: 'postgres:16.15@sha256:9e2cf6287f25c3151f4c9421ccce2b17f3e60061c111a29165e0d2cdd9ff0a97',
        environment: {},
        networks: { 'aos-crm-local': null },
        healthcheck: { test: ['CMD-SHELL', 'pg_isready'] },
        volumes: [{ source: 'aos-crm-local-db', target: '/var/lib/postgresql/data', type: 'volume' }],
      },
      redis: {
        image: 'redis:7.4.12@sha256:bd28fff4b665fdf1b73e8b5b73ec05d2f858f4fa3c8ea0d7c9bc09f7f6bf7039',
        networks: { 'aos-crm-local': null },
        healthcheck: { test: ['CMD', 'redis-cli', 'ping'] },
      },
    },
  }));
}

function makeTmpGitRepo(gitignoreContent) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-crm-gitignore-selftest-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), gitignoreContent, 'utf8');
  return dir;
}

function selfTest() {
  const failures = [];
  function record(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
    } catch (e) {
      console.log(`[FAIL] ${name}: ${safeMessage(e)}`);
      failures.push(name);
    }
  }
  function assertOk(result, expectedOk) {
    if (result.ok !== expectedOk) {
      throw new Error(`expected ok=${expectedOk}, got ok=${result.ok} (${result.detail})`);
    }
  }

  record('checkDockerignoreExcludesAosState: positive', () => assertOk(checkDockerignoreExcludesAosState('**/.git\n**/.aos\n**/.codegraph-aos\n**/.claude\n**/.mcp.json\n**/.env\n**/.env.*\n!**/.env.example\n'), true));
  record('checkDockerignoreExcludesAosState: missing .aos is rejected', () => assertOk(checkDockerignoreExcludesAosState('**/.git\n**/.claude\n**/.mcp.json\n**/.env\n**/.env.*\n!**/.env.example\n'), false));
  record('checkDockerignoreExcludesAosState: missing .mcp.json is rejected', () => assertOk(checkDockerignoreExcludesAosState('**/.git\n**/.aos\n**/.codegraph-aos\n**/.claude\n**/.env\n**/.env.*\n!**/.env.example\n'), false));
  record('checkDockerignoreExcludesAosState: missing the any-depth dotenv patterns is rejected', () => assertOk(checkDockerignoreExcludesAosState('**/.git\n**/.aos\n**/.codegraph-aos\n**/.claude\n**/.mcp.json\n.env\n'), false));
  record('checkDockerignoreExcludesAosState: a root-only .mcp.json (no **/) is rejected (the exact gap packages/twenty-agent-skills/.mcp.json exposed)', () => assertOk(checkDockerignoreExcludesAosState('**/.git\n**/.aos\n**/.codegraph-aos\n**/.claude\n.mcp.json\n**/.env\n**/.env.*\n!**/.env.example\n'), false));

  record('removeContainedTempDir: deletes a directory that is directly inside the expected parent with the expected prefix', () => {
    const parent = mkdtempSync(join(tmpdir(), 'aos-crm-contained-selftest-'));
    try {
      const victim = join(parent, 'contained-victim');
      mkdirSync(victim, { recursive: true });
      writeFileSync(join(victim, 'file.txt'), 'x', 'utf8');
      removeContainedTempDir(victim, parent, 'contained-');
      let stillExists = true;
      try { lstatSync(victim); } catch { stillExists = false; }
      if (stillExists) throw new Error('expected the contained directory to be deleted');
    } finally {
      removeContainedTempDir(parent, tmpdir(), 'aos-crm-contained-selftest-');
    }
  });
  record('removeContainedTempDir: refuses a directory outside the expected parent', () => {
    const parent = mkdtempSync(join(tmpdir(), 'aos-crm-contained-selftest-'));
    const outside = mkdtempSync(join(tmpdir(), 'aos-crm-contained-selftest-outside-'));
    try {
      let threw = false;
      try { removeContainedTempDir(outside, parent, 'anything-'); } catch { threw = true; }
      if (!threw) throw new Error('expected removeContainedTempDir to refuse a path outside the expected parent');
    } finally {
      removeContainedTempDir(outside, tmpdir(), 'aos-crm-contained-selftest-outside-');
      removeContainedTempDir(parent, tmpdir(), 'aos-crm-contained-selftest-');
    }
  });
  record('removeContainedTempDir: refuses a directory with the wrong prefix even inside the expected parent', () => {
    const parent = mkdtempSync(join(tmpdir(), 'aos-crm-contained-selftest-'));
    try {
      const wrongPrefix = join(parent, 'not-the-expected-name');
      mkdirSync(wrongPrefix, { recursive: true });
      let threw = false;
      try { removeContainedTempDir(wrongPrefix, parent, 'contained-'); } catch { threw = true; }
      if (!threw) throw new Error('expected removeContainedTempDir to refuse a directory with the wrong prefix');
      let stillExists = false;
      try { lstatSync(wrongPrefix); stillExists = true; } catch { /* unexpected */ }
      if (!stillExists) throw new Error('expected the wrong-prefix directory to survive');
    } finally {
      removeContainedTempDir(parent, tmpdir(), 'aos-crm-contained-selftest-');
    }
  });

  record('checkGitIgnoresRealEnvNotPrivacyProfile: deploy/local/.env ignored, privacy.env not -> pass', () => {
    const dir = makeTmpGitRepo('**/**/.env\n');
    try {
      assertOk(checkGitIgnoresRealEnvNotPrivacyProfile(dir), true);
    } finally {
      removeContainedTempDir(dir, tmpdir(), 'aos-crm-gitignore-selftest-');
    }
  });
  record('checkGitIgnoresRealEnvNotPrivacyProfile: privacy.env wrongly gitignored is rejected (the bug this track fixed)', () => {
    const dir = makeTmpGitRepo('**/**/.env\n/deploy/local/privacy.env\n');
    try {
      assertOk(checkGitIgnoresRealEnvNotPrivacyProfile(dir), false);
    } finally {
      removeContainedTempDir(dir, tmpdir(), 'aos-crm-gitignore-selftest-');
    }
  });
  record('checkGitIgnoresRealEnvNotPrivacyProfile: deploy/local/.env NOT ignored is rejected', () => {
    const dir = makeTmpGitRepo('# nothing relevant here\n');
    try {
      assertOk(checkGitIgnoresRealEnvNotPrivacyProfile(dir), false);
    } finally {
      removeContainedTempDir(dir, tmpdir(), 'aos-crm-gitignore-selftest-');
    }
  });

  record('checkYarnrcTelemetryOff: positive', () => assertOk(checkYarnrcTelemetryOff('enableTelemetry: false\n'), true));
  record('checkYarnrcTelemetryOff: missing key is rejected', () => assertOk(checkYarnrcTelemetryOff('enableScripts: false\n'), false));
  record('checkYarnrcHardenedModeIntact: positive', () => assertOk(checkYarnrcHardenedModeIntact('enableHardenedMode: true\nenableScripts: false\n'), true));
  record('checkYarnrcHardenedModeIntact: weakened hardened mode is rejected', () => assertOk(checkYarnrcHardenedModeIntact('enableHardenedMode: false\nenableScripts: false\n'), false));

  const GOOD_DOCKERFILE = 'FROM node:24 AS node-base\nENV YARN_ENABLE_TELEMETRY=0 NX_NO_CLOUD=true NX_DAEMON=false\nFROM node-base AS deps\nRUN yarn workspaces focus\n';
  record('checkDockerfileTelemetryOptOut: positive (env before first RUN yarn)', () => assertOk(checkDockerfileTelemetryOptOut(GOOD_DOCKERFILE), true));
  record('checkDockerfileTelemetryOptOut: env set after the first RUN is rejected', () => {
    const bad = 'FROM node:24 AS node-base\nFROM node-base AS deps\nRUN yarn workspaces focus\nENV YARN_ENABLE_TELEMETRY=0 NX_NO_CLOUD=true NX_DAEMON=false\n';
    assertOk(checkDockerfileTelemetryOptOut(bad), false);
  });

  const GOOD_SETTINGS = JSON.stringify({
    disabledMcpjsonServers: ['context7', 'playwright', 'postgres'],
    disableClaudeAiConnectors: true,
    env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DO_NOT_TRACK: '1' },
    hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.claude/hooks/aos-merge-guard.cjs'], onFailure: 'block' }] }] },
  });
  record('checkSettingsJsonRestrictions: positive', () => assertOk(checkSettingsJsonRestrictions(GOOD_SETTINGS), true));
  record('checkSettingsJsonRestrictions: a re-enabled connector is rejected', () => {
    const bad = JSON.parse(GOOD_SETTINGS);
    bad.disableClaudeAiConnectors = false;
    assertOk(checkSettingsJsonRestrictions(JSON.stringify(bad)), false);
  });
  record('checkMergeGuardWiringCoversBothShells: positive', () => assertOk(checkMergeGuardWiringCoversBothShells(GOOD_SETTINGS), true));
  record('checkMergeGuardWiringCoversBothShells: Bash-only matcher is rejected (the real coverage gap this track fixed)', () => {
    const bad = JSON.parse(GOOD_SETTINGS);
    bad.hooks.PreToolUse[0].matcher = 'Bash';
    assertOk(checkMergeGuardWiringCoversBothShells(JSON.stringify(bad)), false);
  });
  record('checkMergeGuardWiringCoversBothShells: missing onFailure:block is rejected', () => {
    const bad = JSON.parse(GOOD_SETTINGS);
    delete bad.hooks.PreToolUse[0].hooks[0].onFailure;
    assertOk(checkMergeGuardWiringCoversBothShells(JSON.stringify(bad)), false);
  });

  record('checkMergeGuardMessageAttributesMergeToHuman: positive', () => assertOk(checkMergeGuardMessageAttributesMergeToHuman("abre el PR y detente: el merge lo hace un humano"), true));
  record('checkMergeGuardMessageAttributesMergeToHuman: the old "S-00 merges" phrasing is rejected', () => assertOk(checkMergeGuardMessageAttributesMergeToHuman('deja que el S-00 lo revise y fusione'), false));

  const hookPath = join(REPO_ROOT, '.claude', 'hooks', 'aos-merge-guard.cjs');
  for (const r of runMergeGuardCoverage(hookPath)) {
    record(r.name, () => {
      if (!r.ok) throw new Error(r.detail);
    });
  }

  // Exercises the REAL settings.json content on disk, same precedent as the
  // real-hook-file coverage above: this is deterministic, local, reads no
  // secret, and never touches the network or Docker.
  const realSettingsText = readRepoFile('.claude/settings.json');
  for (const r of runMergeGuardCoverageViaSettingsWiring(realSettingsText, REPO_ROOT)) {
    record(r.name, () => {
      if (!r.ok) throw new Error(r.detail);
    });
  }
  record('merge-guard-wiring:broken-path-visible-not-misread', () => {
    const r = checkMergeGuardWiringFailsVisiblyOnBrokenExecutable(REPO_ROOT);
    if (!r.ok) throw new Error(r.detail);
  });

  record('checkJsonNoMovingImage: a clean local tag passes', () => assertOk(checkJsonNoMovingImage(cloneGoodComposeModel()), true));
  record('checkJsonNoMovingImage: a twentycrm/twenty:latest registry image is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.server.image = 'twentycrm/twenty:latest';
    assertOk(checkJsonNoMovingImage(m), false);
  });
  record('checkJsonNoMovingImage: a pulled service on a bare tag is rejected -- a tag is mutable, a digest is not (CRM-004)', () => {
    const m = cloneGoodComposeModel();
    m.services.db.image = 'postgres:16';
    assertOk(checkJsonNoMovingImage(m), false);
    const m2 = cloneGoodComposeModel();
    m2.services.redis.image = 'redis:7';
    assertOk(checkJsonNoMovingImage(m2), false);
  });
  record('checkJsonNoMovingImage: a built service keeps using its local tag without a digest (only pulled images can be pinned)', () => {
    const m = cloneGoodComposeModel();
    if (m.services.server.image.includes('@sha256:')) throw new Error('fixture should keep the server on a plain local tag');
    assertOk(checkJsonNoMovingImage(m), true);
  });
  record('checkJsonBuildsFromSource: positive', () => assertOk(checkJsonBuildsFromSource(cloneGoodComposeModel()), true));
  record('checkJsonBuildsFromSource: a worker pointed at a different target is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.worker.build.target = 'twenty-server-aws';
    assertOk(checkJsonBuildsFromSource(m), false);
  });
  record('checkJsonConsumesPrivacyEnv: positive', () => assertOk(checkJsonConsumesPrivacyEnv(cloneGoodComposeModel()), true));
  record('checkJsonConsumesPrivacyEnv: worker missing the privacy.env env_file is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.worker.env_file = [];
    assertOk(checkJsonConsumesPrivacyEnv(m), false);
  });
  record('checkJsonDriversDisabledEffective: positive', () => assertOk(checkJsonDriversDisabledEffective(cloneGoodComposeModel()), true));
  record('checkJsonDriversDisabledEffective: an override on worker ONLY is caught (the exact false-PASS a raw-text regex missed)', () => {
    const m = cloneGoodComposeModel();
    m.services.worker.environment.LOGIC_FUNCTION_TYPE = 'LOCAL';
    assertOk(checkJsonDriversDisabledEffective(m), false);
  });
  record('checkJsonBetaWorkspaceProfile: positive', () => assertOk(checkJsonBetaWorkspaceProfile(cloneGoodComposeModel()), true));
  record('checkJsonBetaWorkspaceProfile: multi-workspace off on worker ONLY is caught (the worker would resolve workspaces the other way round)', () => {
    const m = cloneGoodComposeModel();
    m.services.worker.environment.IS_MULTIWORKSPACE_ENABLED = 'false';
    assertOk(checkJsonBetaWorkspaceProfile(m), false);
  });
  record('checkJsonBetaWorkspaceProfile: multi-workspace on with creation NOT limited to server admins is rejected (that profile is open registration)', () => {
    const m = cloneGoodComposeModel();
    for (const s of ['server', 'worker']) m.services[s].environment.IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS = 'false';
    assertOk(checkJsonBetaWorkspaceProfile(m), false);
  });
  record('checkJsonBetaWorkspaceProfile: an IP-literal SERVER_URL is rejected (healthy stack, nobody can sign in)', () => {
    const m = cloneGoodComposeModel();
    for (const s of ['server', 'worker']) m.services[s].environment.SERVER_URL = '${AOS_CRM_SERVER_URL:-http://127.0.0.1:43000}';
    assertOk(checkJsonBetaWorkspaceProfile(m), false);
  });
  record('checkJsonBetaWorkspaceProfile: a SERVER_URL whose fallback cannot be read fails closed instead of passing', () => {
    const m = cloneGoodComposeModel();
    for (const s of ['server', 'worker']) m.services[s].environment.SERVER_URL = '${AOS_CRM_SERVER_URL}';
    assertOk(checkJsonBetaWorkspaceProfile(m), false);
  });
  record('checkJsonBetaWorkspaceProfile: an empty DEFAULT_SUBDOMAIN fallback is rejected', () => {
    const m = cloneGoodComposeModel();
    for (const s of ['server', 'worker']) m.services[s].environment.DEFAULT_SUBDOMAIN = '${AOS_CRM_DEFAULT_SUBDOMAIN:-}';
    assertOk(checkJsonBetaWorkspaceProfile(m), false);
  });
  record('checkJsonBetaWorkspaceProfile: server and worker on different SERVER_URLs is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.worker.environment.SERVER_URL = '${AOS_CRM_SERVER_URL:-http://localhost:43001}';
    assertOk(checkJsonBetaWorkspaceProfile(m), false);
  });
  record('composeFallbackValue: reads a ${VAR:-default}, keeps a plain literal, and refuses a bare ${VAR}', () => {
    if (composeFallbackValue('${A:-http://localhost:43000}') !== 'http://localhost:43000') throw new Error('expected the :- default to be read');
    if (composeFallbackValue('app') !== 'app') throw new Error('expected a plain literal to pass through');
    if (composeFallbackValue('${A}') !== null) throw new Error('expected a bare ${VAR} to be undeterminable');
    if (composeFallbackValue(undefined) !== null) throw new Error('expected an absent value to be undeterminable');
  });
  record('checkJsonNoPrivilegedOrSocket: positive', () => assertOk(checkJsonNoPrivilegedOrSocket(cloneGoodComposeModel()), true));
  record('checkJsonNoPrivilegedOrSocket: privileged:true on db is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.db.privileged = true;
    assertOk(checkJsonNoPrivilegedOrSocket(m), false);
  });
  record('checkJsonNoPrivilegedOrSocket: a docker.sock bind mount is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.server.volumes.push({ source: '/var/run/docker.sock', target: '/var/run/docker.sock', type: 'bind' });
    assertOk(checkJsonNoPrivilegedOrSocket(m), false);
  });
  record('checkJsonOnlyServerPublishesLoopbackPort: positive', () => assertOk(checkJsonOnlyServerPublishesLoopbackPort(cloneGoodComposeModel()), true));
  record('checkJsonOnlyServerPublishesLoopbackPort: db publishing a port is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.db.ports = ['5432:5432'];
    assertOk(checkJsonOnlyServerPublishesLoopbackPort(m), false);
  });
  record('checkJsonOnlyServerPublishesLoopbackPort: a second wildcard port on server after the loopback one is rejected (the exact false-PASS a first-match regex missed)', () => {
    const m = cloneGoodComposeModel();
    m.services.server.ports.push('9999:9999');
    assertOk(checkJsonOnlyServerPublishesLoopbackPort(m), false);
  });
  record('checkJsonOnlyServerPublishesLoopbackPort: an unbound (wildcard) port is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.server.ports = ['43000:3000'];
    assertOk(checkJsonOnlyServerPublishesLoopbackPort(m), false);
  });
  record('checkJsonDedicatedNetworkAndVolumes: positive', () => assertOk(checkJsonDedicatedNetworkAndVolumes(cloneGoodComposeModel()), true));
  record('checkJsonDedicatedNetworkAndVolumes: a service on a stray extra network is rejected', () => {
    const m = cloneGoodComposeModel();
    m.services.worker.networks.bridge = null;
    assertOk(checkJsonDedicatedNetworkAndVolumes(m), false);
  });
  record('checkJsonHealthchecksPresent: positive', () => assertOk(checkJsonHealthchecksPresent(cloneGoodComposeModel()), true));
  record('checkJsonHealthchecksPresent: db missing healthcheck is rejected', () => {
    const m = cloneGoodComposeModel();
    delete m.services.db.healthcheck;
    assertOk(checkJsonHealthchecksPresent(m), false);
  });

  console.log(`\nself-test: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  return failures.length === 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  main();
}
