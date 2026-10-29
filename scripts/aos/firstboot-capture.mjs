#!/usr/bin/env node
// CRM-005 (R3): brings up the throwaway first-boot stack
// (scripts/aos/firstboot-capture.yaml), waits for it to become healthy,
// registers its first administrator, and destroys it -- in one command, so the
// window a traffic capture has to cover is exactly this command's lifetime:
//
//   node scripts/aos/capture-traffic.mjs --label firstboot -- node scripts/aos/firstboot-capture.mjs
//
// WHY A SECOND STACK AT ALL. R3 asks for the traffic of a FIRST startup and of
// the initial registration. The stack the founder uses went through both weeks
// ago, and the only way to see them again on it would be to destroy its data,
// which is forbidden. This stack has its own project name, network, volumes and
// port, shares the application image and deploy/local/privacy.env, and is torn
// down with `down -v` -- which removes the three volumes ITS OWN compose file
// declares and nothing else.
//
// FAIL-CLOSED. If the real stack's project/network/volume names ever appear in
// this file's compose project, it refuses to run. If the stack does not become
// healthy inside its budget, it reports that and still tears everything down.
// The teardown runs on every exit path, including a thrown error.
//
// Secrets: the administrator password is generated with crypto randomness, used
// in memory, and never printed or written anywhere. The database password and
// encryption key come from the ignored deploy/local/.env through compose's
// --env-file, so they never cross a command line.
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const PROJECT = 'aos-crm-firstboot';
const COMPOSE_FILE = 'scripts/aos/firstboot-capture.yaml';
const PORT = Number(process.env.AOS_CRM_FIRSTBOOT_PORT || '43010');
const PROTECTED_NAMES = ['aos-crm-local', 'aos-crm-local-db', 'aos-crm-local-redis', 'aos-crm-local-storage'];
const HEALTH_TIMEOUT_MS = Number(process.env.AOS_CRM_FIRSTBOOT_HEALTH_TIMEOUT_MS || 1_200_000);
const RUN_ID = randomUUID().slice(0, 8);

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

let linuxRoot = null;

function compose(args, opts = {}) {
  return wsl(['docker', 'compose',
    '--env-file', `${linuxRoot}/deploy/local/.env`,
    '-f', `${linuxRoot}/${COMPOSE_FILE}`,
    '-p', PROJECT, ...args], opts);
}

function http(path, { method = 'GET', headers = {}, body = null, timeoutMs = 30_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    import('node:http').then(({ request }) => {
      const req = request({
        host: '127.0.0.1', port: PORT, path, method, agent: false, timeout: timeoutMs,
        headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolvePromise({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms on ${method} ${path}`)));
      if (body) req.write(body);
      req.end();
    });
  });
}

async function graphql(pathname, query, variables, token) {
  const res = await http(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  try {
    return { status: res.status, ...JSON.parse(res.body) };
  } catch {
    throw new Error(`${pathname} answered non-JSON (${res.status}): ${res.body.slice(0, 160)}`);
  }
}

function errorsOf(answer) {
  return (answer.errors || []).map((e) => e.message).join(' | ');
}

function teardown() {
  const down = compose(['down', '-v', '--remove-orphans'], { timeout: 300_000 });
  console.log(`[INFO] teardown: compose down -v exited ${down.status ?? 'unmeasured'}`);
  if (down.status !== 0) {
    console.error((down.stderr || '').slice(-400));
    console.error('[WARN] the throwaway stack may still exist; its resources are the ones named aos-crm-firstboot*');
  }
  // Proof, not assumption: nothing of this project may be left behind, and the
  // real stack's volumes must still be there.
  const volumes = wsl(['docker', 'volume', 'ls', '--format', '{{.Name}}']).stdout ?? '';
  const leftovers = volumes.split('\n').map((v) => v.trim()).filter((v) => v.startsWith('aos-crm-firstboot'));
  console.log(leftovers.length === 0
    ? '[INFO] no aos-crm-firstboot volume is left'
    : `[WARN] volumes left behind: ${leftovers.join(', ')}`);
  const real = volumes.split('\n').map((v) => v.trim()).filter((v) => v.startsWith('aos-crm-local'));
  console.log(`[INFO] the real stack still has ${real.length} volume(s): ${real.join(', ')}`);
}

async function main() {
  const translated = wsl(['wslpath', '-a', REPO_ROOT]);
  if (translated.status !== 0 || !translated.stdout.trim()) {
    throw new Error(`could not reach WSL distro '${DISTRO}' (status ${translated.status})`);
  }
  linuxRoot = translated.stdout.trim();

  // Fail closed BEFORE touching Docker: if this compose project resolves to any
  // of the real stack's names, stop. `config` renders the file with its
  // variables substituted, which is what the daemon would act on.
  const config = compose(['config', '--format', 'json']);
  if (config.status !== 0) {
    throw new Error(`docker compose config exited ${config.status}: ${(config.stderr || '').slice(-300)}`);
  }
  const rendered = JSON.parse(config.stdout);
  if (rendered.name !== PROJECT) {
    throw new Error(`the compose project is '${rendered.name}', not '${PROJECT}'`);
  }
  const names = [
    ...Object.values(rendered.networks ?? {}).map((n) => n.name),
    ...Object.values(rendered.volumes ?? {}).map((v) => v.name),
  ];
  const collisions = names.filter((n) => PROTECTED_NAMES.includes(n));
  if (collisions.length > 0) {
    throw new Error(`this throwaway stack would share ${collisions.join(', ')} with the real one; refusing to start`);
  }
  console.log(`[INFO] throwaway stack '${PROJECT}' on port ${PORT} with ${names.join(', ')}`);

  const up = compose(['up', '-d'], { timeout: HEALTH_TIMEOUT_MS, stdio: ['ignore', 'inherit', 'inherit'] });
  if (up.status !== 0) throw new Error(`compose up exited ${up.status}`);

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let last = 'never answered';
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const res = await http('/healthz', { timeoutMs: 15_000 });
      if (res.status === 200) { healthy = true; break; }
      last = `status ${res.status}`;
    } catch (error) {
      last = error.code || error.message?.slice(0, 60) || 'error';
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!healthy) throw new Error(`the first boot never became healthy within ${HEALTH_TIMEOUT_MS} ms (last: ${last})`);
  console.log('[INFO] first boot healthy; registering the first administrator');

  // The initial registration: the flow R3 asks to have covered, on a database
  // that has never seen a user. The credential is crypto-random, used here and
  // thrown away with the stack.
  const email = `primer.admin.${RUN_ID}@aos-crm.invalid`;
  const password = randomBytes(36).toString('base64url');
  const signUp = await graphql('/metadata',
    'mutation($email: String!, $password: String!) { signUp(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { email, password });
  if (signUp.errors) throw new Error(`signUp failed: ${errorsOf(signUp)}`);
  const agnostic = signUp.data.signUp.tokens.accessOrWorkspaceAgnosticToken.token;
  const workspace = await graphql('/metadata',
    'mutation($input: SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input: $input) { workspace { id activationStatus } } }',
    { input: { displayName: `AOS-CRM first boot ${RUN_ID}` } }, agnostic);
  if (workspace.errors) throw new Error(`signUpInNewWorkspace failed: ${errorsOf(workspace)}`);
  console.log(`[INFO] first workspace created (${workspace.data.signUpInNewWorkspace.workspace.activationStatus})`);

  const config2 = await http('/client-config');
  console.log(`[INFO] /client-config answered ${config2.status} on the first boot`);
  const logs = compose(['logs', '--no-color', 'server'], { timeout: 120_000 });
  const migrated = (logs.stdout || '').includes('Successfully migrated DB!');
  const crons = (logs.stdout || '').includes('Successfully registered all background sync jobs!');
  console.log(`[INFO] first boot ran migrations: ${migrated}; registered cron jobs: ${crons}`);
  if (!migrated || !crons) {
    throw new Error('the first boot did not report both a completed migration and cron registration');
  }
}

let exitCode = 0;
try {
  await main();
  console.log('[PASS] first boot observed: migrations, cron registration and the initial registration all completed');
} catch (error) {
  exitCode = 1;
  console.error(`[FAIL] ${String(error?.message ?? error).slice(0, 400)}`);
} finally {
  teardown();
}
process.exit(exitCode);
