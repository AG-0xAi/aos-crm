// CRM-007: shared helpers for the MCP connector probes and the MCP e2e suite.
//
// Every function here either returns data or throws. The local test credential
// is read into memory and never printed, logged or written anywhere: callers
// get an Authorization header value, not the token, and the only thing this
// module ever reports about it is its length.
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

export async function graphql(pathname, query, variables, token) {
  const res = await http(pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
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
