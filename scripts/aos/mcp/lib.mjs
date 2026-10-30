// CRM-007: shared helpers for the MCP connector probes and the MCP e2e suite.
//
// Every function here either returns data or throws. The local test credential
// is read into memory and never printed, logged or written anywhere: callers
// get an Authorization header value, not the token, and the only thing this
// module ever reports about it is its length.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DISTRO = process.env.AOS_CRM_DISTRO || 'AOS-CRM-Ubuntu-24.04';
export const COMPOSE_PROJECT = 'aos-crm-local';

export function readEnvFile(path) {
  const found = {};
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return found;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    found[key.trim()] = rest.join('=').trim();
  }
  return found;
}

const env = readEnvFile(resolve(REPO_ROOT, 'deploy/local/.env'));

export const WEB_PORT = Number(env.AOS_CRM_WEB_PORT || '43000');
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const SERVER_URL = env.AOS_CRM_SERVER_URL || BASE_URL;
export const PG_USER = env.AOS_CRM_PG_USER || 'aos_crm';
export const PG_DB = env.AOS_CRM_PG_DB || 'aos_crm_local';
export const ADMIN_EMAIL = env.AOS_CRM_ADMIN_EMAIL || '';
export const ADMIN_PASSWORD = env.AOS_CRM_ADMIN_PASSWORD || '';

// The coordinator's local Admin API key, kept outside the repo on purpose.
// AOS_CRM_MCP_API_KEY wins so a worker can pass its own credential without a
// file, which is how the Claude client probe receives one.
export function readLocalApiKey() {
  if (process.env.AOS_CRM_MCP_API_KEY) return process.env.AOS_CRM_MCP_API_KEY.trim();
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error('neither USERPROFILE nor HOME is set, cannot locate the local MCP key');
  return readFileSync(resolve(home, '.aos-crm', 'local-mcp-api-key'), 'utf8').trim();
}

// node:http with `agent: false`, not fetch(): one fresh connection per request.
// Measured in CRM-004 -- undici's pooled sockets get torn down by the
// Windows/WSL2 loopback relay and surface as ECONNRESET on unrelated
// assertions. See the comment in scripts/aos/test/crm-runtime-e2e.test.mjs.
export function http(path, { method = 'GET', headers = {}, body = null, timeoutMs = 60_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: WEB_PORT,
        path,
        method,
        headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms on ${method} ${path}`)));
    if (body) req.write(body);
    req.end();
  });
}

// Same transport, but honouring the host and port in an absolute URL: used to
// follow a redirect to the client's own loopback listener, which is NOT the
// CRM's port.
export function httpAbsolute(url, { method = 'GET', headers = {}, timeoutMs = 15_000 } = {}) {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        host: target.hostname,
        port: Number(target.port || 80),
        path: target.pathname + target.search,
        method,
        headers,
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms on ${method} ${url}`)));
    req.end();
  });
}

// `timeoutMs` is optional and additive: every existing caller keeps http()'s
// own 60 s inactivity deadline, which is right for a call that answers from
// data that already exists. It is here for the few mutations that PROVISION --
// a workspace's data schema and standard objects -- where the socket is idle
// while the server works and 60 s is a cap on the server's work, not on a hang.
export async function graphql(pathname, query, variables, token, { timeoutMs } = {}) {
  const res = await http(pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(`${pathname} returned non-JSON (${res.status}): ${res.body.slice(0, 200)}`);
  }
  return { status: res.status, ...parsed };
}

// The MCP transport answers either application/json or text/event-stream
// depending on what the client accepts; both carry the same JSON-RPC envelope.
export function parseJsonRpcBody(body) {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) throw new Error(`no JSON-RPC payload in: ${trimmed.slice(0, 200)}`);
  return JSON.parse(dataLines[dataLines.length - 1]);
}

export async function mcpCall(method, params, { token, sessionId, apiKey } = {}) {
  const credential = token ?? apiKey;
  const res = await http('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(8).toString('hex'), method, ...(params ? { params } : {}) }),
  });
  if (res.status !== 200) return { status: res.status, headers: res.headers, raw: res.body };
  return { status: res.status, headers: res.headers, ...parseJsonRpcBody(res.body) };
}

// An MCP tool result carries its payload as a JSON string inside
// content[0].text, and execute_tool wraps the inner tool's result in another
// envelope. Reading it with a regex over the escaped text is how a successful
// create gets misread as a failure, so unwrap it properly.
export function unwrapToolResult(response) {
  const text = response?.result?.content?.[0]?.text;
  if (typeof text !== 'string') return { ok: false, payload: null, raw: response };
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, payload: null, raw: text };
  }
  return { ok: payload.success === true, payload, raw: text };
}

// ---------------------------------------------------------------------------
// Beta profile (CRM-014): which workspace a request belongs to is resolved from
// the SUBDOMAIN of SERVER_URL, so an origin is no longer a constant. The
// transport above still dials 127.0.0.1 on the published port -- only the
// `origin` ARGUMENT of the sign-in mutations (auth.resolver.ts takes it as
// @Args('origin'), not as a header) and the browser's own address carry the
// subdomain, so none of this needs DNS.
// ---------------------------------------------------------------------------

export function originForSubdomain(subdomain) {
  const url = new URL(SERVER_URL);
  url.hostname = `${subdomain}.${url.hostname}`;
  return url.origin;
}

export function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

let cachedLinuxRoot = null;

export function linuxRepoRoot() {
  if (cachedLinuxRoot !== null) return cachedLinuxRoot;
  const translated = wsl(['wslpath', '-a', REPO_ROOT]);
  if (translated.status !== 0) throw new Error(`could not reach WSL distro '${DISTRO}' to translate the repo path`);
  const path = translated.stdout.trim();
  if (!path.startsWith('/')) throw new Error(`wslpath returned something that is not a Linux path: ${path}`);
  cachedLinuxRoot = path;
  return path;
}

export function compose(args, opts = {}) {
  return wsl(['docker', 'compose', '-f', `${linuxRepoRoot()}/deploy/local/compose.yaml`, '-p', COMPOSE_PROJECT, ...args], opts);
}

// Argv, never a shell: the SQL travels as one `--exec` argument, so camelCase
// identifiers keep their double quotes without any quoting layer in between.
export function psql(sql) {
  const res = compose(['exec', '-T', 'db', 'psql', '-U', PG_USER, '-d', PG_DB, '-t', '-A', '-c', sql]);
  if (res.status !== 0) throw new Error(`psql exited ${res.status}: ${(res.stderr || '').slice(-300)}`);
  return res.stdout.trim();
}

// The operator's own workspace: the first one ever created on this deployment,
// which is the one the founder signed up and the only one that outlives a test
// run. Read from the database rather than configured anywhere, so it cannot
// drift from what the server would resolve.
export function founderWorkspaceOrigin() {
  const subdomain = psql('select subdomain from core.workspace order by "createdAt" asc limit 1');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(subdomain)) {
    throw new Error(`could not read the first workspace's subdomain from core.workspace (got ${subdomain.length} chars)`);
  }
  return originForSubdomain(subdomain);
}

// The two-step password sign-in, with the workspace carried by `origin`:
// getLoginTokenFromCredentials resolves the workspace from it, and
// getAuthTokensFromLoginToken refuses the exchange when the login token was
// minted for a different workspace than the origin resolves to
// (auth.resolver.ts validateWorkspaceAccess) -- which is itself one of the
// isolation boundaries crm-isolation-e2e.test.mjs measures.
export async function loginWithOrigin(email, password, origin) {
  const login = await graphql(
    '/metadata',
    'mutation($email: String!, $password: String!, $origin: String!) {' +
      ' getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }',
    { email, password, origin },
  );
  if (login.errors) throw new Error(`sign-in failed: ${(login.errors || []).map((e) => e.message).join(' | ')}`);
  return exchangeLoginToken(login.data.getLoginTokenFromCredentials.loginToken.token, origin);
}

export async function exchangeLoginToken(loginToken, origin) {
  const exchanged = await graphql(
    '/metadata',
    'mutation($loginToken: String!, $origin: String!) {' +
      ' getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { loginToken, origin },
  );
  if (exchanged.errors) throw new Error(`login-token exchange failed: ${(exchanged.errors || []).map((e) => e.message).join(' | ')}`);
  return exchanged.data.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
}

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, method: 'S256' };
}

// A one-shot loopback listener standing in for the redirect target an MCP
// client would register. Resolves with the query string of the first request.
export function oneShotRedirectListener() {
  let resolveHit;
  const hit = new Promise((r) => (resolveHit = r));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    resolveHit(new URL(req.url, 'http://127.0.0.1').searchParams);
  });
  const ready = new Promise((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    ready,
    hit,
    get redirectUri() {
      return `http://127.0.0.1:${server.address().port}/callback`;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
