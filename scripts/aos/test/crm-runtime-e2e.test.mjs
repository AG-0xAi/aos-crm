// CRM-004: the end-to-end path of the local AOS-CRM stack, run against the
// real containers over the real published loopback port.
//
// @e2e: HTTP /healthz on the published loopback port -> the frontend bundle the image was built with -> GraphQL login as the first administrator -> a record written through the API -> the same row read back with psql inside this project's own PostgreSQL container -> the db container restarted -> the row still there -> an invalid gzip body rejected without killing the server -> a second public signup refused -> the worker alive with its own Redis queue
// @e2e-falla-si: stop the `server` container, or point PG_DATABASE_URL at another database. Every assertion below reads the published port with fetch(), psql inside the db container and redis-cli inside the redis container; there is no double to pass instead.
//
// Requires the stack to be up (scripts/aos/local.ps1 -Action Start, which also
// builds the image and holds the WSL session open). It does not build the
// image and does not create the stack: a gate command that could spend forty
// minutes building is not a gate command. If the stack is not running, this
// fails closed and says so.
//
// Secrets: deploy/local/.env is read into memory to reach the services and is
// never printed, logged or asserted on by value. The administrator password is
// generated with crypto randomness on first run and stored there.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
const PROJECT = 'aos-crm-local';
const ENV_PATH = resolve(REPO_ROOT, 'deploy/local/.env');
const HEALTH_TIMEOUT_MS = 180_000;
const RUN_MARKER = `aos-crm-e2e-${randomUUID()}`;

const env = readEnvFile(ENV_PATH);
const WEB_PORT = Number(env.AOS_CRM_WEB_PORT || '43000');
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
const ORIGIN = env.AOS_CRM_SERVER_URL || BASE_URL;
const PG_USER = env.AOS_CRM_PG_USER || 'aos_crm';
const PG_DB = env.AOS_CRM_PG_DB || 'aos_crm_local';

let linuxRoot = null;
let adminToken = null;
let workspaceSchema = null;

// --------------------------------------------------------------------------
// Host-crossing helpers. Every one of them returns data or throws; none of
// them ever echoes a value read out of deploy/local/.env.
// --------------------------------------------------------------------------

function readEnvFile(path) {
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

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

function compose(args) {
  assert.ok(linuxRoot, 'the repo path was never translated into the distro');
  return wsl(['docker', 'compose', '-f', `${linuxRoot}/deploy/local/compose.yaml`, '-p', PROJECT, ...args]);
}

function psql(sql) {
  const res = compose(['exec', '-T', 'db', 'psql', '-U', PG_USER, '-d', PG_DB, '-t', '-A', '-c', sql]);
  assert.equal(res.status, 0, `psql exited ${res.status}: ${(res.stderr || '').slice(-300)}`);
  return res.stdout.trim();
}

function redis(args) {
  const res = compose(['exec', '-T', 'redis', 'redis-cli', ...args]);
  assert.equal(res.status, 0, `redis-cli exited ${res.status}: ${(res.stderr || '').slice(-300)}`);
  return res.stdout.trim();
}

async function httpGet(path, init = {}) {
  return fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(30_000), ...init });
}

// Twenty serves two GraphQL schemas: the workspace records live at /graphql
// (@CoreResolver) and auth/user/admin operations at /metadata
// (@MetadataResolver). Posting signUp to /graphql comes back as
// "Authentication required", which looks like a closed instance and is really
// the wrong endpoint, so the path is explicit at every call site.
const CORE = '/graphql';
const METADATA = '/metadata';

async function gql(query, { variables, token, path = CORE } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json();
  return { status: res.status, body };
}

function gqlErrorMessages(body) {
  return (body.errors || []).map((e) => e.message).join(' | ');
}

async function waitForHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'never answered';
  while (Date.now() < deadline) {
    try {
      const res = await httpGet('/healthz');
      if (res.status === 200) return true;
      last = `status ${res.status}`;
    } catch (e) {
      last = e.name === 'TimeoutError' ? 'request timed out' : e.code || e.name;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${BASE_URL}/healthz never became healthy within ${timeoutMs}ms (last: ${last})`);
}

// The first administrator: created once with a crypto-random password kept in
// the ignored deploy/local/.env, then reused. Never printed.
function ensureAdminCredentials() {
  if (env.AOS_CRM_ADMIN_EMAIL && env.AOS_CRM_ADMIN_PASSWORD) {
    return { email: env.AOS_CRM_ADMIN_EMAIL, password: env.AOS_CRM_ADMIN_PASSWORD, generated: false };
  }
  const email = env.AOS_CRM_ADMIN_EMAIL || 'admin@aos-crm.local';
  // 48 base64url chars of crypto randomness: far above the server's own
  // minimum, and no part of it is derived from anything guessable.
  const password = randomBytes(36).toString('base64url');
  appendFileSync(ENV_PATH, `AOS_CRM_ADMIN_EMAIL=${email}\nAOS_CRM_ADMIN_PASSWORD=${password}\n`, 'utf8');
  env.AOS_CRM_ADMIN_EMAIL = email;
  env.AOS_CRM_ADMIN_PASSWORD = password;
  return { email, password, generated: true };
}

async function loginAsAdmin({ email, password }) {
  const login = await gql(
    'mutation($email: String!, $password: String!, $origin: String!) {' +
    ' getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }',
    { variables: { email, password, origin: ORIGIN }, path: METADATA },
  );
  if (login.body.errors) return { ok: false, detail: gqlErrorMessages(login.body) };
  const loginToken = login.body.data.getLoginTokenFromCredentials.loginToken.token;
  const exchanged = await gql(
    'mutation($loginToken: String!, $origin: String!) {' +
    ' getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { variables: { loginToken, origin: ORIGIN }, path: METADATA },
  );
  if (exchanged.body.errors) return { ok: false, detail: gqlErrorMessages(exchanged.body) };
  return { ok: true, token: exchanged.body.data.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token };
}

// Idempotent from any partial state: signUp creates the user WITHOUT a
// workspace, so a run interrupted between the two steps leaves a user that
// cannot log in yet (there is no workspace for the origin to resolve to).
// Signing in workspace-agnostically recovers from that instead of failing with
// "User already exists".
async function obtainWorkspaceAgnosticToken({ email, password }) {
  const signUp = await gql(
    'mutation($email: String!, $password: String!) {' +
    ' signUp(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { variables: { email, password }, path: METADATA },
  );
  if (!signUp.body.errors) {
    return signUp.body.data.signUp.tokens.accessOrWorkspaceAgnosticToken.token;
  }
  const detail = gqlErrorMessages(signUp.body);
  assert.match(detail, /already exists/i, `signUp failed: ${detail}`);
  const signIn = await gql(
    'mutation($email: String!, $password: String!) {' +
    ' signIn(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { variables: { email, password }, path: METADATA },
  );
  assert.equal(signIn.body.errors, undefined, `signIn failed: ${gqlErrorMessages(signIn.body)}`);
  return signIn.body.data.signIn.tokens.accessOrWorkspaceAgnosticToken.token;
}

async function createFirstAdmin(credentials) {
  const agnostic = await obtainWorkspaceAgnosticToken(credentials);
  // displayName is nullable in the input type but required by the service
  // ("Workspace name is required"), so the single local workspace is named here.
  const workspace = await gql(
    'mutation($input: SignUpInNewWorkspaceInput) {' +
    ' signUpInNewWorkspace(input: $input) { loginToken { token } workspace { id } } }',
    { variables: { input: { displayName: 'AOS-CRM Local' } }, token: agnostic, path: METADATA },
  );
  assert.equal(workspace.body.errors, undefined, `signUpInNewWorkspace failed: ${gqlErrorMessages(workspace.body)}`);
  return workspace.body.data.signUpInNewWorkspace.workspace.id;
}

// --------------------------------------------------------------------------

before(async () => {
  const translated = wsl(['wslpath', '-a', REPO_ROOT]);
  assert.equal(translated.status, 0, `could not reach WSL distro '${DISTRO}'`);
  linuxRoot = translated.stdout.trim();
  assert.ok(linuxRoot.startsWith('/'), `wslpath returned '${linuxRoot}'`);
});

test('this project own services are running (fail closed, never assumed)', () => {
  const ps = compose(['ps', '--format', 'json', '--status', 'running']);
  assert.equal(ps.status, 0, `docker compose ps exited ${ps.status}: ${(ps.stderr || '').slice(-300)}`);
  const services = ps.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line).Service);
  for (const expected of ['server', 'worker', 'db', 'redis']) {
    assert.ok(services.includes(expected),
      `service '${expected}' is not running (running: ${services.join(', ') || 'none'}). Run scripts/aos/local.ps1 -Action Start first.`);
  }
});

test('the server answers its own health endpoint on the published loopback port', async () => {
  await waitForHealthy(HEALTH_TIMEOUT_MS);
  const res = await httpGet('/healthz');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok', `healthz reported ${JSON.stringify(body).slice(0, 200)}`);
});

test('migrations really created the core schema in this project own PostgreSQL', () => {
  const coreTables = Number(psql("select count(*) from information_schema.tables where table_schema = 'core'"));
  assert.ok(coreTables > 20, `expected the core schema to be migrated, found ${coreTables} table(s)`);
  for (const table of ['user', 'workspace', 'userWorkspace']) {
    const exists = psql(`select to_regclass('core."${table}"') is not null`);
    assert.equal(exists, 't', `core."${table}" is missing: migrations did not complete`);
  }
  // TypeORM's journal, named by Twenty's own datasource config. Its emptiness
  // is the difference between "the schema exists" and "the migrations ran":
  // the image entrypoint only probes whether the core SCHEMA exists, so a
  // schema created and then abandoned leaves a healthy server on an empty
  // database (this track hit exactly that).
  const applied = Number(psql('select count(*) from core."_typeorm_migrations"'));
  assert.ok(applied > 0, 'core._typeorm_migrations is empty: no migration ever ran');
});

test('the entrypoint did not swallow a migration or cron failure (healthz alone would never say so)', () => {
  // packages/twenty-docker/twenty/entrypoint.sh runs `upgrade`, `cache:flush`
  // and `cron:register:all` behind `if ! ...; then echo "Warning: ...
  // continuing startup"`. The container therefore reports healthy whether or
  // not those succeeded, so the real exit codes have to be read off the log.
  const logs = compose(['logs', '--no-color', 'server']);
  assert.equal(logs.status, 0, `docker compose logs server exited ${logs.status}`);
  const swallowed = logs.stdout.split(/\r?\n/).filter((l) => /Warning: (Failed|Upgrade)/.test(l));
  assert.equal(swallowed.length, 0,
    `the entrypoint swallowed ${swallowed.length} failure(s): ${swallowed.slice(0, 2).join(' / ').slice(0, 300)}`);
  assert.ok(logs.stdout.includes('Successfully migrated DB!'),
    'the entrypoint never reported a completed database setup/migration');
  assert.ok(logs.stdout.includes('Successfully registered all background sync jobs!'),
    'cron job registration never reported success');
});

test('the frontend bundle the image was built with is served by the server', async () => {
  const index = await httpGet('/');
  assert.equal(index.status, 200);
  const html = await index.text();
  const asset = (html.match(/src="(\/assets\/[^"]+\.js)"/) || [])[1];
  assert.ok(asset, `index.html names no built asset: ${html.slice(0, 200)}`);
  const bundle = await httpGet(asset);
  assert.equal(bundle.status, 200, `the asset index.html points at returned ${bundle.status}`);
  const bytes = (await bundle.arrayBuffer()).byteLength;
  assert.ok(bytes > 50_000, `the served bundle is only ${bytes} bytes`);
});

test('the EFFECTIVE runtime configuration keeps analytics and Sentry off and serves the published port', async () => {
  // The values the running server actually hands the frontend, read from the
  // public /client-config endpoint: not the contents of privacy.env, and not
  // a static read of the source.
  const res = await httpGet('/client-config');
  assert.equal(res.status, 200);
  const config = await res.json();
  assert.equal(config.analyticsEnabled, false, 'analytics is enabled at runtime');
  assert.ok(!config.sentry?.dsn, 'the running server handed the frontend a Sentry DSN');
  assert.equal(new URL(config.serverUrl).port, String(WEB_PORT),
    `the effective serverUrl is ${config.serverUrl}, which is not the published port ${WEB_PORT}`);
});

test('the first administrator can sign in, and a strong password is the only one on file', async () => {
  const credentials = ensureAdminCredentials();
  assert.ok(credentials.password.length >= 24, 'the administrator password is too short to be controlled');
  let login = await loginAsAdmin(credentials);
  if (!login.ok) {
    await createFirstAdmin(credentials);
    login = await loginAsAdmin(credentials);
  }
  assert.ok(login.ok, `the first administrator could not sign in: ${login.detail}`);
  adminToken = login.token;

  // signUpInNewWorkspace leaves the workspace PENDING_CREATION: activation is
  // what provisions its data schema and standard objects, so without this step
  // the record API below does not exist yet ("Cannot query field
  // createCompany"). Idempotent: an already ACTIVE workspace is left alone.
  const workspace = await gql('{ currentWorkspace { id activationStatus } }', { token: adminToken, path: METADATA });
  assert.equal(workspace.body.errors, undefined, gqlErrorMessages(workspace.body));
  if (workspace.body.data.currentWorkspace.activationStatus !== 'ACTIVE') {
    const activated = await gql(
      'mutation { activateWorkspace(data: {}) { id activationStatus } }',
      { token: adminToken, path: METADATA },
    );
    assert.equal(activated.body.errors, undefined, `activateWorkspace failed: ${gqlErrorMessages(activated.body)}`);
    assert.equal(activated.body.data.activateWorkspace.activationStatus, 'ACTIVE');
    // The token issued before activation carries no workspace member, and the
    // record API needs one to stamp createdBy ("Unable to build actor
    // metadata"). Re-issue it now that the member exists.
    const reissued = await loginAsAdmin(credentials);
    assert.ok(reissued.ok, `could not re-issue the token after activation: ${reissued.detail}`);
    adminToken = reissued.token;
  }

  const me = await gql('{ currentUser { id email } }', { token: adminToken, path: METADATA });
  assert.equal(me.body.errors, undefined, gqlErrorMessages(me.body));
  assert.equal(me.body.data.currentUser.email, credentials.email);
});

test('a record written through the API lands in this project own PostgreSQL', async () => {
  assert.ok(adminToken, 'no administrator token: the sign-in step did not complete');
  const created = await gql(
    'mutation($name: String!) { createCompany(data: { name: $name }) { id name } }',
    { variables: { name: RUN_MARKER }, token: adminToken },
  );
  assert.equal(created.body.errors, undefined, gqlErrorMessages(created.body));
  assert.equal(created.body.data.createCompany.name, RUN_MARKER);

  workspaceSchema = psql("select nspname from pg_namespace where nspname like 'workspace\\_%' order by nspname limit 1");
  assert.ok(workspaceSchema, 'no workspace schema exists: the workspace was never provisioned');
  const rows = Number(psql(`select count(*) from "${workspaceSchema}".company where name = '${RUN_MARKER}'`));
  assert.equal(rows, 1, `expected exactly 1 row written by this run in ${workspaceSchema}.company, found ${rows}`);
});

test('the row survives restarting the database container (the volume is the state, not the container)', async () => {
  assert.ok(workspaceSchema, 'no workspace schema: the write step did not complete');
  const restart = compose(['restart', 'db']);
  assert.equal(restart.status, 0, `docker compose restart db exited ${restart.status}`);
  await waitForHealthy(HEALTH_TIMEOUT_MS);
  const rows = Number(psql(`select count(*) from "${workspaceSchema}".company where name = '${RUN_MARKER}'`));
  assert.equal(rows, 1, 'the row written before the restart is gone: PostgreSQL is not persisting');
  const read = await gql(
    'query($marker: String!) { companies(filter: { name: { eq: $marker } }) { edges { node { name } } } }',
    { variables: { marker: RUN_MARKER }, token: adminToken },
  );
  assert.equal(read.body.errors, undefined, gqlErrorMessages(read.body));
  assert.equal(read.body.data.companies.edges.length, 1, 'the API cannot read back its own row after the restart');
});

test('an invalid compressed request body is rejected without taking the server down (GHSA-27r3-jxmh-p828)', async () => {
  const res = await fetch(`${BASE_URL}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', origin: ORIGIN },
    body: Buffer.from('this is not gzip at all, not even close'),
    signal: AbortSignal.timeout(30_000),
  });
  // The contract (spec R1) is that the request is refused and the server
  // survives, not a particular status: Twenty's exception layer turns the
  // inflate failure into a 500 rather than a 400, which is ugly but is still a
  // rejection. What matters is that nothing was processed and the process is
  // still serving afterwards.
  assert.ok(res.status >= 400, `the undecodable body was not rejected (status ${res.status})`);
  const health = await httpGet('/healthz');
  assert.equal(health.status, 200,
    `the server stopped answering after an invalid compressed body (rejection status was ${res.status})`);
  const second = await httpGet('/client-config');
  assert.equal(second.status, 200, 'the server answers /healthz but no longer serves requests');
});

test('public registration is closed once the single local workspace exists', async () => {
  const res = await gql(
    'mutation($email: String!, $password: String!) {' +
    ' signUp(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    {
      variables: { email: `intruder-${randomUUID()}@example.invalid`, password: randomBytes(24).toString('base64url') },
      path: METADATA,
    },
  );
  assert.ok(res.body.errors, 'a second public signup succeeded: registration is still open');
  assert.equal(res.body.data?.signUp, undefined, 'the refused signup still returned tokens');
  // The specific refusal, not just any error: posting to the wrong schema also
  // errors ("Authentication required"), which would make this pass while
  // proving nothing about registration being closed.
  const messages = gqlErrorMessages(res.body);
  assert.match(messages, /New workspace setup is disabled/,
    `expected the SIGNUP_DISABLED refusal from sign-in-up.service, got: ${messages.slice(0, 200)}`);
});

test('the worker is alive and holds its queue in this project own Redis', () => {
  const ps = compose(['ps', '--format', 'json', '--status', 'running']);
  assert.ok(ps.stdout.includes('"Service":"worker"'), 'the worker container is not running');
  const keys = redis(['--scan', '--pattern', 'bull*']).split(/\r?\n/).filter(Boolean);
  assert.ok(keys.length > 0, 'this project Redis holds no queue key: the worker never registered one');
  // The queue is state: without append-only persistence on its own volume,
  // every `compose down` drops it and the stack comes back looking fine.
  assert.match(redis(['config', 'get', 'appendonly']), /\byes\b/,
    'Redis is running without append-only persistence, so the queue would not survive a container recreation');
  const logs = compose(['logs', '--tail', '200', 'worker']);
  assert.equal(logs.status, 0, `docker compose logs worker exited ${logs.status}`);
  const fatal = logs.stdout.split(/\r?\n/)
    .filter((l) => /FATAL|UnhandledPromiseRejection|Cannot connect to Redis/i.test(l));
  assert.equal(fatal.length, 0, `the worker log carries ${fatal.length} fatal line(s)`);
});
