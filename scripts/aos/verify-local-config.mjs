// CRM-002 local-security gate. Static contract checks over the committed
// local profile (compose.yaml, .dockerignore, .gitignore, .yarnrc.yml, the
// twenty-docker Dockerfile, .claude/settings.json, the merge guard). Never
// builds an image, never starts a service, never reads a real secret file.
// Run: node scripts/aos/verify-local-config.mjs
// Self-test (isolated fixtures/subprocess only, never this repo's real
// files, never network, never Docker):
//   node scripts/aos/verify-local-config.mjs --self-test
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ---- pure text-contract checks (take raw text, so --self-test can feed
// synthetic fixtures instead of this repo's real files) ----

// Returns the text of a top-level (2-space indented) compose service block,
// or '' if the service is not found. Deliberately not a YAML parser: this
// profile's shape is simple and fixed, and a full parser would be a
// dependency added only to re-derive what docker compose config already
// resolves (see main()'s optional real-Docker check).
function extractServiceBlock(composeText, serviceName) {
  const lines = composeText.split('\n');
  const startIdx = lines.findIndex((l) => new RegExp(`^  ${serviceName}:\\s*$`).test(l));
  if (startIdx === -1) return '';
  const rest = lines.slice(startIdx + 1);
  const endIdx = rest.findIndex((l) => /^ {0,2}\S/.test(l));
  return rest.slice(0, endIdx === -1 ? rest.length : endIdx).join('\n');
}

// Only inspects actual `image:` value lines, not prose: a comment saying
// "never pulls twentycrm/twenty" is documentation, not a moving-image
// reference, and must not trip this check.
function checkComposeNoMovingImage(composeText) {
  const imageLines = composeText.split('\n').filter((l) => /^\s*image:\s*\S/.test(l));
  const hasRegistryImage = imageLines.some((l) => /twentycrm\/twenty/.test(l));
  const hasLatestTag = imageLines.some((l) => /:\$\{[A-Z_]+:-latest\}|:latest\b/.test(l));
  const ok = imageLines.length > 0 && !hasRegistryImage && !hasLatestTag;
  return { ok, detail: ok ? `${imageLines.length} image: line(s), none moving/registry` : `moving/registry image reference found (registry=${hasRegistryImage}, latestTag=${hasLatestTag}, imageLines=${imageLines.length})` };
}

function checkComposeBuildsFromSource(composeText) {
  const ok = /dockerfile:\s*packages\/twenty-docker\/twenty\/Dockerfile/.test(composeText)
    && /target:\s*twenty\b/.test(composeText);
  return { ok, detail: ok ? 'build: targets the official Dockerfile, target twenty' : 'no build: pointing at packages/twenty-docker/twenty/Dockerfile target twenty' };
}

function checkComposeConsumesPrivacyEnv(composeText) {
  const ok = /env_file:\s*\n\s*-\s*\.\/privacy\.env/.test(composeText);
  return { ok, detail: ok ? 'env_file references ./privacy.env' : 'no env_file: - ./privacy.env found' };
}

function checkComposeForcesDriversDisabled(composeText) {
  const okLogic = /LOGIC_FUNCTION_TYPE:\s*DISABLED/.test(composeText);
  const okCode = /CODE_INTERPRETER_TYPE:\s*DISABLED/.test(composeText);
  const ok = okLogic && okCode;
  return { ok, detail: ok ? 'LOGIC_FUNCTION_TYPE and CODE_INTERPRETER_TYPE are forced DISABLED' : `missing forced-disabled driver(s) (logic=${okLogic}, code=${okCode})` };
}

function checkComposeNoPrivilegedOrSocket(composeText) {
  const hasPrivileged = /privileged:\s*true/i.test(composeText);
  const hasSocket = /\/var\/run\/docker\.sock/.test(composeText);
  const ok = !hasPrivileged && !hasSocket;
  return { ok, detail: ok ? 'no privileged: true, no docker.sock mount' : `found privileged=${hasPrivileged} dockerSocket=${hasSocket}` };
}

function checkComposeDbRedisNotPublished(composeText) {
  const dbBlock = extractServiceBlock(composeText, 'db');
  const redisBlock = extractServiceBlock(composeText, 'redis');
  const dbOk = dbBlock !== '' && !/^\s*ports:/m.test(dbBlock);
  const redisOk = redisBlock !== '' && !/^\s*ports:/m.test(redisBlock);
  const ok = dbOk && redisOk;
  return { ok, detail: ok ? 'db/redis blocks found, neither publishes ports:' : `db ok=${dbOk}, redis ok=${redisOk} (missing service block or a ports: key present)` };
}

function checkComposeWebPortLoopback(composeText) {
  const serverBlock = extractServiceBlock(composeText, 'server');
  const portsMatch = serverBlock.match(/^\s*ports:\s*\n\s*-\s*"([^"]+)"/m);
  const ok = !!portsMatch && portsMatch[1].startsWith('127.0.0.1:');
  return { ok, detail: ok ? `server ports: bound to loopback (${portsMatch[1]})` : 'server ports: entry is missing or not bound to 127.0.0.1' };
}

function checkComposeDedicatedNetworkAndVolumes(composeText) {
  const hasNetwork = /^networks:\s*\n\s*aos-crm-local:\s*\n\s*name:\s*aos-crm-local/m.test(composeText);
  const hasVolumes = /aos-crm-local-db:/.test(composeText) && /aos-crm-local-storage:/.test(composeText);
  const ok = hasNetwork && hasVolumes;
  return { ok, detail: ok ? 'dedicated network aos-crm-local and named volumes present' : `network=${hasNetwork}, volumes=${hasVolumes}` };
}

function checkComposeHealthchecks(composeText) {
  const count = (composeText.match(/healthcheck:/g) || []).length;
  const ok = count >= 3; // server, db, redis
  return { ok, detail: `${count} healthcheck: block(s) found (need >= 3: server, db, redis)` };
}

const COMPOSE_CHECKS = [
  ['no-moving-image', checkComposeNoMovingImage],
  ['builds-from-source', checkComposeBuildsFromSource],
  ['consumes-privacy-env', checkComposeConsumesPrivacyEnv],
  ['forces-drivers-disabled', checkComposeForcesDriversDisabled],
  ['no-privileged-or-socket', checkComposeNoPrivilegedOrSocket],
  ['db-redis-not-published', checkComposeDbRedisNotPublished],
  ['web-port-loopback', checkComposeWebPortLoopback],
  ['dedicated-network-and-volumes', checkComposeDedicatedNetworkAndVolumes],
  ['healthchecks-present', checkComposeHealthchecks],
];

function runComposeChecks(composeText) {
  return COMPOSE_CHECKS.map(([name, fn]) => ({ name: `compose:${name}`, ...fn(composeText) }));
}

function checkDockerignoreExcludesAosState(text) {
  const required = ['.aos', '.codegraph-aos', '.claude', '.git'];
  const missing = required.filter((p) => !new RegExp(`^${p.replace('.', '\\.')}\\s*$`, 'm').test(text));
  const ok = missing.length === 0;
  return { ok, detail: ok ? 'excludes .aos, .codegraph-aos, .claude, .git' : `missing exclude(s): ${missing.join(', ')}` };
}

function checkGitignoreCoversLocalSecrets(text) {
  const ok = /\/deploy\/local\/privacy\.env/.test(text);
  return { ok, detail: ok ? 'deploy/local/privacy.env is gitignored' : 'deploy/local/privacy.env is not explicitly gitignored' };
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
      name: `merge-guard:${toolName}/${expectBlocked ? 'blocks-merge' : 'allows-innocuous'}`,
      ok,
      detail: ok ? `blocked=${blocked} as expected` : `expected blocked=${expectBlocked}, got blocked=${blocked}`,
    };
  });
}

// ---- optional real Docker Compose schema check (never required for PASS;
// see R3.1 -- a missing host is reported, not faked) ----

function checkComposeSchemaViaRealDocker(repoRoot, distro) {
  const pathProbe = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', repoRoot], { encoding: 'utf8' });
  if (pathProbe.error || pathProbe.status !== 0) {
    return { measured: false, ok: null, detail: 'not measured: wsl.exe/distro unavailable on this runtime (see HOST_RUNTIME.md)' };
  }
  const linuxRoot = pathProbe.stdout.trim();
  const composePath = `${linuxRoot}/deploy/local/compose.yaml`;
  const res = spawnSync('wsl.exe', ['-d', distro, '--exec', 'docker', 'compose', '-f', composePath, 'config', '--quiet', '--no-interpolate', '--no-env-resolution'], { encoding: 'utf8' });
  if (res.error) {
    return { measured: false, ok: null, detail: `not measured: docker unavailable (${safeMessage(res.error)})` };
  }
  const ok = res.status === 0;
  return { measured: true, ok, detail: ok ? 'docker compose config --no-interpolate --no-env-resolution: schema valid' : `docker compose config exited ${res.status}: ${(res.stderr || '').slice(0, 300)}` };
}

// ---------------------------------------------------------------------------
// main: real repo files only
// ---------------------------------------------------------------------------

function main() {
  const results = [];
  results.push(...runComposeChecks(readRepoFile('deploy/local/compose.yaml')));
  results.push({ name: 'dockerignore:excludes-aos-state', ...checkDockerignoreExcludesAosState(readRepoFile('.dockerignore')) });
  results.push({ name: 'gitignore:covers-local-secrets', ...checkGitignoreCoversLocalSecrets(readRepoFile('.gitignore')) });
  results.push({ name: 'yarnrc:telemetry-off', ...checkYarnrcTelemetryOff(readRepoFile('.yarnrc.yml')) });
  results.push({ name: 'yarnrc:hardened-mode-intact', ...checkYarnrcHardenedModeIntact(readRepoFile('.yarnrc.yml')) });
  results.push({ name: 'dockerfile:telemetry-opt-out-before-first-run', ...checkDockerfileTelemetryOptOut(readRepoFile('packages/twenty-docker/twenty/Dockerfile')) });
  const settingsText = readRepoFile('.claude/settings.json');
  results.push({ name: 'settings:restrictions-present', ...checkSettingsJsonRestrictions(settingsText) });
  results.push({ name: 'settings:merge-guard-wiring', ...checkMergeGuardWiringCoversBothShells(settingsText) });
  const guardText = readRepoFile('.claude/hooks/aos-merge-guard.cjs');
  results.push({ name: 'merge-guard:message-attributes-to-human', ...checkMergeGuardMessageAttributesMergeToHuman(guardText) });
  results.push(...runMergeGuardCoverage(join(REPO_ROOT, '.claude/hooks/aos-merge-guard.cjs')));

  for (const r of results) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}: ${r.detail}`);

  const dockerCheck = checkComposeSchemaViaRealDocker(REPO_ROOT, WSL_DISTRO);
  if (dockerCheck.measured) {
    console.log(`[${dockerCheck.ok ? 'PASS' : 'FAIL'}] compose:schema-via-real-docker: ${dockerCheck.detail}`);
    results.push({ name: 'compose:schema-via-real-docker', ok: dockerCheck.ok, detail: dockerCheck.detail });
  } else {
    console.log(`[INFO] compose:schema-via-real-docker: ${dockerCheck.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length}/${results.length} local-security checks failed.`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${results.length} local-security checks passed.`);
  console.log('Scope: static configuration contract only. No image was built, no container/network/volume was created, and no service was started by this script.');
  console.log('deploy/local/privacy.env is a separate CRM-003 deliverable: its absence is expected right now and is exactly what makes docker compose refuse to start (see R2.1); this gate does not create or require it.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// self-test: synthetic fixtures + the real merge-guard subprocess, isolated
// from this repo's actual compose.yaml/settings.json content.
// ---------------------------------------------------------------------------

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

  const GOOD_COMPOSE = [
    'services:',
    '  server:',
    '    image: aos-crm-local/twenty:v2.51.0-15e4826d3b',
    '    build:',
    '      dockerfile: packages/twenty-docker/twenty/Dockerfile',
    '      target: twenty',
    '    env_file:',
    '      - ./privacy.env',
    '    environment:',
    '      LOGIC_FUNCTION_TYPE: DISABLED',
    '      CODE_INTERPRETER_TYPE: DISABLED',
    '    ports:',
    '      - "127.0.0.1:43000:3000"',
    '    healthcheck:',
    '      test: ["CMD", "curl", "--fail", "http://localhost:3000/healthz"]',
    '  db:',
    '    image: postgres:16',
    '    healthcheck:',
    '      test: ["CMD-SHELL", "pg_isready"]',
    '  redis:',
    '    image: redis:7',
    '    healthcheck:',
    '      test: ["CMD", "redis-cli", "ping"]',
    'networks:',
    '  aos-crm-local:',
    '    name: aos-crm-local',
    'volumes:',
    '  aos-crm-local-db:',
    '  aos-crm-local-storage:',
    '',
  ].join('\n');

  record('checkComposeNoMovingImage: a clean local tag passes', () => assertOk(checkComposeNoMovingImage(GOOD_COMPOSE), true));
  record('checkComposeNoMovingImage: twentycrm/twenty registry image is rejected', () =>
    assertOk(checkComposeNoMovingImage(GOOD_COMPOSE.replace('aos-crm-local/twenty:v2.51.0-15e4826d3b', 'twentycrm/twenty:${TAG:-latest}')), false),
  );
  record('checkComposeBuildsFromSource: positive', () => assertOk(checkComposeBuildsFromSource(GOOD_COMPOSE), true));
  record('checkComposeBuildsFromSource: missing target is rejected', () => assertOk(checkComposeBuildsFromSource(GOOD_COMPOSE.replace('      target: twenty\n', '')), false));
  record('checkComposeConsumesPrivacyEnv: positive', () => assertOk(checkComposeConsumesPrivacyEnv(GOOD_COMPOSE), true));
  record('checkComposeConsumesPrivacyEnv: missing env_file is rejected', () => assertOk(checkComposeConsumesPrivacyEnv(GOOD_COMPOSE.replace('    env_file:\n      - ./privacy.env\n', '')), false));
  record('checkComposeForcesDriversDisabled: positive', () => assertOk(checkComposeForcesDriversDisabled(GOOD_COMPOSE), true));
  record('checkComposeForcesDriversDisabled: LOCAL instead of DISABLED is rejected', () => assertOk(checkComposeForcesDriversDisabled(GOOD_COMPOSE.replace('LOGIC_FUNCTION_TYPE: DISABLED', 'LOGIC_FUNCTION_TYPE: LOCAL')), false));
  record('checkComposeNoPrivilegedOrSocket: positive', () => assertOk(checkComposeNoPrivilegedOrSocket(GOOD_COMPOSE), true));
  record('checkComposeNoPrivilegedOrSocket: privileged: true is rejected', () => assertOk(checkComposeNoPrivilegedOrSocket(`${GOOD_COMPOSE}\n    privileged: true\n`), false));
  record('checkComposeNoPrivilegedOrSocket: docker.sock mount is rejected', () => assertOk(checkComposeNoPrivilegedOrSocket(`${GOOD_COMPOSE}\n      - /var/run/docker.sock:/var/run/docker.sock\n`), false));
  record('checkComposeDbRedisNotPublished: positive (no ports: in db/redis blocks)', () => assertOk(checkComposeDbRedisNotPublished(GOOD_COMPOSE), true));
  record('checkComposeDbRedisNotPublished: a published db port is rejected', () => {
    const bad = GOOD_COMPOSE.replace('  db:\n    image: postgres:16\n', '  db:\n    image: postgres:16\n    ports:\n      - "5432:5432"\n');
    assertOk(checkComposeDbRedisNotPublished(bad), false);
  });
  record('checkComposeWebPortLoopback: positive', () => assertOk(checkComposeWebPortLoopback(GOOD_COMPOSE), true));
  record('checkComposeWebPortLoopback: a 0.0.0.0/unbound port is rejected', () => assertOk(checkComposeWebPortLoopback(GOOD_COMPOSE.replace('127.0.0.1:43000:3000', '43000:3000')), false));
  record('checkComposeDedicatedNetworkAndVolumes: positive', () => assertOk(checkComposeDedicatedNetworkAndVolumes(GOOD_COMPOSE), true));
  record('checkComposeDedicatedNetworkAndVolumes: a shared/default network is rejected', () => assertOk(checkComposeDedicatedNetworkAndVolumes(GOOD_COMPOSE.replace('networks:\n  aos-crm-local:\n    name: aos-crm-local\n', '')), false));
  record('checkComposeHealthchecks: positive (>= 3 blocks)', () => assertOk(checkComposeHealthchecks(GOOD_COMPOSE), true));
  record('checkComposeHealthchecks: fewer than 3 healthcheck blocks is rejected', () => assertOk(checkComposeHealthchecks(GOOD_COMPOSE.split('\n').filter((l) => !l.includes('healthcheck:')).join('\n')), false));

  record('checkDockerignoreExcludesAosState: positive', () => assertOk(checkDockerignoreExcludesAosState('.git\n.aos\n.codegraph-aos\n.claude\n'), true));
  record('checkDockerignoreExcludesAosState: missing .aos is rejected', () => assertOk(checkDockerignoreExcludesAosState('.git\n.claude\n'), false));
  record('checkGitignoreCoversLocalSecrets: positive', () => assertOk(checkGitignoreCoversLocalSecrets('/deploy/local/privacy.env\n'), true));
  record('checkGitignoreCoversLocalSecrets: missing entry is rejected', () => assertOk(checkGitignoreCoversLocalSecrets('/.aos/\n'), false));
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

  console.log(`\nself-test: ${failures.length === 0 ? 'ALL PASSED' : `${failures.length} FAILED`}`);
  return failures.length === 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
} else {
  main();
}
