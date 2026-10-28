// CRM-004: the end-to-end path of the local AOS-CRM stack, run against the
// real containers over the real published loopback port.
//
// @e2e: HTTP /healthz on the published loopback port -> the frontend bundle the image was built with -> GraphQL login as the first administrator -> a record written through the API -> the same row read back with psql inside this project's own PostgreSQL container -> the db container restarted -> the row still there -> an invalid gzip body rejected without killing the server -> a VALID gzip frame with trailing bytes (GHSA-27r3-jxmh-p828) answered with the same container, pid and RestartCount afterwards -> a second public signup refused -> the worker alive with its own Redis queue
// @e2e-falla-si: stop the `server` container, or point PG_DATABASE_URL at another database. Every assertion below reads the published loopback port over a real HTTP connection, psql inside the db container, redis-cli inside the redis container and `docker inspect` for the serving process's own identity; there is no double to pass instead.
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
import { gzipSync } from 'node:zlib';
import { connect } from 'node:net';
import { request } from 'node:http';
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

// The identity of the process currently serving, not just "a container called
// server". Compose declares `restart: unless-stopped`, so a server that dies is
// brought straight back and a later /healthz 200 would read as survival. The
// container id, its RestartCount and the pid of its main process are what tell
// a surviving process from a replaced one.
function serverProcessIdentity() {
  const id = compose(['ps', '-q', 'server']).stdout.trim().split(/\r?\n/)[0];
  assert.ok(id, 'docker compose ps -q server named no container');
  const res = wsl(['docker', 'inspect', '--format', '{{.Id}}|{{.RestartCount}}|{{.State.Pid}}|{{.State.StartedAt}}', id]);
  assert.equal(res.status, 0, `docker inspect exited ${res.status}: ${(res.stderr || '').slice(-200)}`);
  const [containerId, restartCount, pid, startedAt] = res.stdout.trim().split('|');
  return { containerId, restartCount: Number(restartCount), pid: Number(pid), startedAt };
}

// node:http with `agent: false`, not fetch(): one fresh connection per request
// and no keep-alive pool.
//
// Measured on 2026-10-28: a fetch()-based suite failed three different
// assertions with ECONNABORTED-on-write and ECONNRESET-on-read, at 6 ms and
// 55 ms -- the shape of undici reusing a pooled socket that the Windows/WSL2
// loopback relay had already torn down (and the same keep-alive class of
// problem as nodejs/node#64004, noted in the official Dockerfile). Retrying
// would hide it and would risk replaying a mutation; measuring the application
// over a connection it actually has is the fix. The responses this suite reads
// are small, so per-request connections cost nothing here.
function httpRequest(path, { method = 'GET', headers = {}, body = null, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: WEB_PORT,
      path,
      method,
      headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
      agent: false,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: async () => buffer.toString('utf8'),
          json: async () => JSON.parse(buffer.toString('utf8')),
          arrayBuffer: async () => buffer,
        });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`request to ${path} timed out`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function httpGet(path, init = {}) {
  return httpRequest(path, { method: 'GET', timeoutMs: 30_000, ...init });
}

// Twenty serves two GraphQL schemas: the workspace records live at /graphql
// (@CoreResolver) and auth/user/admin operations at /metadata
// (@MetadataResolver). Posting signUp to /graphql comes back as
// "Authentication required", which looks like a closed instance and is really
// the wrong endpoint, so the path is explicit at every call site.
const CORE = '/graphql';
const METADATA = '/metadata';

async function gql(query, { variables, token, path = CORE } = {}) {
  const res = await httpRequest(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
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
      last = e.code || e.name;
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
  const res = await httpRequest('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', origin: ORIGIN },
    body: Buffer.from('this is not gzip at all, not even close'),
    timeoutMs: 30_000,
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

test('a VALID compressed frame followed by trailing bytes does not kill the server process (GHSA-27r3-jxmh-p828)', async () => {
  // The test above sends bytes that are not gzip at all, which body-parser
  // refuses up front. That is a useful generic control but it is NOT this
  // advisory. CVE-2026-111181 is an UNCAUGHT EXCEPTION (CWE-248): body-parser
  // left the decompression stream piped with no error listener, so a request
  // made of one VALID frame plus extra bytes was parsed and answered, and only
  // then did the trailing bytes reach the already-finished decoder, whose error
  // nobody handled and which took the process down. No auth and no matching
  // route are needed, because body parsing runs before routing.
  //   advisory: https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828
  //   fix + its own regression: https://github.com/expressjs/body-parser/commit/1260c38
  // The bytes below are that regression's shape -- valid frame, one zero byte,
  // then a large trailing block -- and they are byte-identical to the input
  // that was measured killing body-parser 2.3.0 and being answered 200 by
  // 2.4.0 in an isolated throwaway container
  // (.aos/onboarding/crm004-fix2/bodyparser-affected-vs-patched.txt). That
  // comparison is what makes this the advisory's condition rather than "a gzip
  // body"; on the patched version the delayed error cannot occur at all, so
  // what this asserts here is SURVIVAL of the real process.
  //
  // Sent over a raw socket rather than fetch(): measured on this stack, the
  // server answers this request differently depending on framing (200 with the
  // decoded body under chunked encoding, and no response at all under
  // Content-Length, where Nest logs the 400-class decoder error and closes).
  // Asserting a status would be asserting that incidental behaviour; a
  // fetch() client is also reset mid-upload by it. Only our own synthetic local
  // instance is addressed.
  assert.ok(adminToken, 'no administrator token: the sign-in step did not complete');
  const before = serverProcessIdentity();

  const frame = gzipSync(Buffer.from(JSON.stringify({ query: '{ __typename }' })));
  const body = Buffer.concat([frame, Buffer.from([0x00]), Buffer.alloc(100 * 1024, 0x58)]);
  const request = Buffer.concat([
    Buffer.from([
      'POST /graphql HTTP/1.1',
      `Host: 127.0.0.1:${WEB_PORT}`,
      `Origin: ${ORIGIN}`,
      'Content-Type: application/json',
      'Content-Encoding: gzip',
      `Content-Length: ${body.length}`,
      'Connection: close',
      '', '',
    ].join('\r\n')),
    body,
  ]);

  const exchange = await new Promise((done) => {
    const socket = connect(WEB_PORT, '127.0.0.1');
    let statusLine = null;
    let bytes = 0;
    let socketError = null;
    socket.setTimeout(30_000, () => { socketError ??= 'ETIMEDOUT'; socket.destroy(); });
    socket.on('connect', () => { socket.write(request); socket.end(); });
    socket.on('data', (chunk) => { bytes += chunk.length; statusLine ??= chunk.toString('latin1').split('\r\n')[0]; });
    // A reset or a close with no response is not a pass or a failure on its
    // own: whether the process is still the same one is.
    socket.on('error', (e) => { socketError ??= e.code || e.message; });
    socket.on('close', () => done({ statusLine, bytes, socketError }));
  });

  // The advisory's failure is delayed by construction, so everything below has
  // to happen after the exchange is over and the trailing bytes drained.
  await new Promise((r) => setTimeout(r, 2000));

  const observed = `response='${exchange.statusLine ?? 'none'}' bytes=${exchange.bytes} socket=${exchange.socketError ?? 'closed cleanly'}`;
  const health = await httpGet('/healthz');
  assert.equal(health.status, 200,
    `the server stopped answering after a valid frame with trailing bytes (${observed})`);
  const authenticated = await gql('{ currentUser { id email } }', { token: adminToken, path: METADATA });
  assert.equal(authenticated.body.errors, undefined,
    `an authenticated operation broke after the trailing-bytes request (${observed}): ${gqlErrorMessages(authenticated.body)}`);
  assert.ok(authenticated.body.data.currentUser.id, 'the authenticated operation returned no user');

  // Compose declares `restart: unless-stopped`, so a crashed server comes
  // straight back and the two checks above would pass on a process that died.
  // These four are what separate survival from replacement.
  const after = serverProcessIdentity();
  assert.equal(after.containerId, before.containerId, 'the server container was replaced: that is not survival');
  assert.equal(after.restartCount, before.restartCount,
    `Docker restarted the server ${after.restartCount - before.restartCount} time(s): an automatic restart is a crash, not survival (${observed})`);
  assert.equal(after.pid, before.pid,
    `the server process was replaced (pid ${before.pid} -> ${after.pid}): the decoder error killed it and the entrypoint brought it back (${observed})`);
  assert.equal(after.startedAt, before.startedAt, 'the container reports a new start time, so it went down and came back');
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
  // Presence as a boolean, with a fixed message: comparing the payload itself
  // would make node's assert print the ACTUAL value on failure, and the only
  // way this assertion can fail is the one case where that value holds real
  // access tokens.
  const returnedSignUpPayload = (res.body.data?.signUp ?? null) !== null;
  assert.equal(returnedSignUpPayload, false, 'the refused signup still returned a signUp payload (not printed: it would carry tokens)');
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
