// CRM-007: the MCP connector path of the local AOS-CRM stack, run against the
// real containers over the real published loopback port.
//
// @e2e: /mcp refused without a credential (401 + resource_metadata) -> the
// OAuth discovery documents an MCP client reads, consistent with the effective
// SERVER_URL -> initialize and tools/list with a real credential -> no tool
// that posts workspace content to a third party offered, in tools/list, in the
// tool catalog or in the server instructions, and refused through execute_tool
// -> a least-privilege team role created over the API, whose key does record
// CRUD but cannot mint API keys, create roles or read the role list, each
// refusal checked against an Admin credential running the same call so it is
// the permission and not the request that was refused -> a
// uniquely named synthetic company created through execute_tool, that exact
// row read with psql inside this project's own PostgreSQL container, deleted
// through MCP and its deletion confirmed in the same database -> an expired
// API key and a revoked API key both refused with 401
// @e2e-falla-si: stop the `server` container, point PG_DATABASE_URL at another
// database, put search_help_center back in the MCP tool set, widen the team
// role's switches, or make /mcp accept an unauthenticated call. Every
// assertion below reads the published loopback port over a real HTTP
// connection and psql inside the db container; there is no double to pass
// instead.
//
// Requires the stack to be up (scripts/aos/local.ps1 -Action Start). It does
// not build the image and does not create the stack: a gate command that could
// spend forty minutes building is not a gate command. If the stack is not
// running, this fails closed and says so.
//
// Secrets: the local administrator's credentials are read out of the ignored
// deploy/local/.env into memory to mint this run's own API keys, and no
// credential is ever printed, logged or asserted on by value -- only its
// length. Every key this suite mints is revoked before it exits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, COMPOSE_PROJECT, DISTRO, PG_DB, PG_USER,
  REPO_ROOT, SERVER_URL, founderWorkspaceOrigin, http, mcpCall, unwrapToolResult,
} from '../mcp/lib.mjs';
import {
  TEAM_ROLE_LABEL,
  checkRolePermissions, ensureTeamRole, expireApiKey, findAdminRoleId, loginAsAdmin, mintApiKeyForRole,
  probeEscalationRefusals, probeTeamKeyPrivileges, revokeApiKey,
} from '../mcp/team-role.mjs';

const HEALTH_TIMEOUT_MS = 180_000;
const RUN_MARKER = `aos-crm-mcp-e2e-${randomUUID()}`;
// The tool surface an MCP client is offered. search_help_center is absent on
// purpose (CRM-007 R3) and the assertion below is written as an exact set, so
// a tool coming BACK fails here and not only in the unit specs.
const EXPECTED_ENTRY_TOOLS = [
  'execute_tool',
  'get_tool_catalog',
  'learn_tools',
  'list_object_metadata_names',
  'list_skills',
  'load_skills',
];
// Tools whose request leaves this deployment for a destination the caller does
// not choose. Mirrors MCP_EXCLUDED_TOOL_NAMES in the server; kept here as the
// runtime half of the same claim.
const THIRD_PARTY_TOOLS = ['search_help_center', 'http_request', 'code_interpreter'];

let linuxRoot = null;
let adminToken = null;
let workspaceSchema = null;
let teamRole = null;
const mintedApiKeyIds = [];

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

function compose(args) {
  assert.ok(linuxRoot, 'the repo path was never translated into the distro');
  return wsl(['docker', 'compose', '-f', `${linuxRoot}/deploy/local/compose.yaml`, '-p', COMPOSE_PROJECT, ...args]);
}

function psql(sql) {
  const res = compose(['exec', '-T', 'db', 'psql', '-U', PG_USER, '-d', PG_DB, '-t', '-A', '-c', sql]);
  assert.equal(res.status, 0, `psql exited ${res.status}: ${(res.stderr || '').slice(-300)}`);
  return res.stdout.trim();
}

async function waitForHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'never answered';
  while (Date.now() < deadline) {
    try {
      const res = await http('/healthz', { timeoutMs: 15_000 });
      if (res.status === 200) return;
      last = `status ${res.status}`;
    } catch (error) {
      last = error.code || error.name;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${BASE_URL}/healthz never became healthy within ${timeoutMs}ms (last: ${last})`);
}

function callTool(toolName, toolArguments, credential) {
  return mcpCall(
    'tools/call',
    { name: 'execute_tool', arguments: { toolName, arguments: toolArguments } },
    credential,
  );
}

before(async () => {
  const translated = wsl(['wslpath', '-a', resolve(REPO_ROOT)]);
  assert.equal(translated.status, 0, `could not reach WSL distro '${DISTRO}' to translate the repo path`);
  linuxRoot = translated.stdout.trim();
  assert.ok(linuxRoot.startsWith('/'), `wslpath returned something that is not a Linux path: ${linuxRoot}`);

  assert.ok(ADMIN_EMAIL && ADMIN_PASSWORD,
    'deploy/local/.env carries no AOS_CRM_ADMIN_EMAIL/AOS_CRM_ADMIN_PASSWORD: run scripts/aos/test/crm-runtime-e2e.test.mjs once to create the first administrator');

  await waitForHealthy(HEALTH_TIMEOUT_MS);
  adminToken = await loginAsAdmin();
  assert.ok(adminToken, 'the administrator sign-in produced no token');

  // One workspace per local deployment, so one workspace schema. Finding it
  // here is what makes the psql assertions below address this project's own
  // data instead of a schema name hardcoded from a previous run.
  const schemas = psql("select nspname from pg_namespace where nspname like 'workspace_%' order by nspname;")
    .split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(schemas.length, 1, `expected exactly one workspace schema in ${PG_DB}, found ${schemas.length}: ${schemas.join(', ')}`);
  workspaceSchema = schemas[0];
});

after(async () => {
  for (const apiKeyId of mintedApiKeyIds) {
    try {
      await revokeApiKey(adminToken, apiKeyId);
    } catch {
      // Best effort: a key this suite could not revoke is reported by the
      // assertions above, and leaving the loop would hide the others.
    }
  }
});

test('/mcp refuses a call with no credential and points at its resource metadata', async () => {
  const res = await mcpCall('tools/list');
  assert.equal(res.status, 401, `expected 401 without a credential, got ${res.status}`);
  const challenge = res.headers['www-authenticate'] ?? '';
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  assert.ok(metadataUrl, `the 401 carried no resource_metadata pointer: ${challenge}`);
  // The host the CLIENT asked, not the configured SERVER_URL: mcp-auth.guard.ts
  // builds this pointer from `request.get('host')`, which is what makes a
  // per-workspace connector URL discover its own workspace (CRM-014, measured
  // in the next test). This suite dials the published loopback address, so that
  // is the host it must be answered with.
  assert.equal(metadataUrl, `${BASE_URL}/.well-known/oauth-protected-resource/mcp`);
});

test('the OAuth discovery an MCP client reads is published for the exact host it asked', async () => {
  const resource = await http('/.well-known/oauth-protected-resource/mcp');
  assert.equal(resource.status, 200, `protected resource metadata answered ${resource.status}`);
  const resourceDoc = JSON.parse(resource.body);
  assert.equal(resourceDoc.resource, `${BASE_URL}/mcp`);
  assert.deepEqual(resourceDoc.authorization_servers, [BASE_URL]);

  const server = await http('/.well-known/oauth-authorization-server');
  assert.equal(server.status, 200, `authorization server metadata answered ${server.status}`);
  const serverDoc = JSON.parse(server.body);
  assert.equal(serverDoc.issuer, BASE_URL);
  assert.equal(serverDoc.registration_endpoint, `${BASE_URL}/oauth/register`);
  assert.ok(serverDoc.code_challenge_methods_supported.includes('S256'),
    `PKCE S256 is not advertised: ${JSON.stringify(serverDoc.code_challenge_methods_supported)}`);
  assert.ok(serverDoc.grant_types_supported.includes('authorization_code'),
    `the authorization code grant is not advertised: ${JSON.stringify(serverDoc.grant_types_supported)}`);
});

test("a workspace's own connector URL discovers that workspace's authorization page, and the API host points at the sign-in host instead (CRM-014 R3)", async () => {
  // The URL each beta user pastes into ChatGPT or Claude is their OWN
  // workspace's host + /mcp. Asked with that Host header -- the transport still
  // dials the published loopback port, so no DNS is involved -- every discovery
  // value has to name that host, including the /authorize page the user is sent
  // to, which is the page where they are already signed in.
  const workspaceHost = new URL(founderWorkspaceOrigin()).host;
  const resource = await http('/.well-known/oauth-protected-resource/mcp', { headers: { host: workspaceHost } });
  assert.equal(resource.status, 200, `the workspace host answered ${resource.status} for its resource metadata`);
  const resourceDoc = JSON.parse(resource.body);
  assert.equal(resourceDoc.resource, `http://${workspaceHost}/mcp`);
  assert.deepEqual(resourceDoc.authorization_servers, [`http://${workspaceHost}`]);

  const server = await http('/.well-known/oauth-authorization-server', { headers: { host: workspaceHost } });
  const serverDoc = JSON.parse(server.body);
  assert.equal(serverDoc.issuer, `http://${workspaceHost}`);
  assert.equal(serverDoc.authorization_endpoint, `http://${workspaceHost}/authorize`,
    'the workspace host does not send the user to its own authorization page');

  // And the other branch of the same decision (oauth-discovery.controller.ts
  // isApiHost): asked on the configured SERVER_URL, which serves no workspace
  // of its own, the authorization endpoint is the DEFAULT_SUBDOMAIN sign-in
  // host and carries the issuer along.
  const apiHost = new URL(SERVER_URL).host;
  const apiDoc = JSON.parse((await http('/.well-known/oauth-authorization-server', { headers: { host: apiHost } })).body);
  assert.equal(apiDoc.issuer, `http://${apiHost}`);
  assert.match(apiDoc.authorization_endpoint, /^http:\/\/[a-z0-9-]+\.[^/]+\/authorize\?iss=/,
    `the API host's authorization endpoint is not a subdomain sign-in page with an issuer: ${apiDoc.authorization_endpoint}`);
});

test('initialize answers as the Betty MCP server, and its instructions name no third-party tool', async () => {
  const res = await mcpCall(
    'initialize',
    { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aos-crm-mcp-e2e', version: '1' } },
    { token: adminToken },
  );
  assert.equal(res.status, 200, `initialize answered ${res.status}`);
  assert.equal(res.result.serverInfo.name, 'Betty MCP Server');
  // MCP 2025-11-25 Implementation.title: what the assistant shows a human.
  assert.equal(res.result.serverInfo.title, 'Betty');
  assert.ok(
    !JSON.stringify(res.result.serverInfo).match(/twenty/i),
    `serverInfo still names Twenty: ${JSON.stringify(res.result.serverInfo)}`,
  );
  // This stack is published on plain http loopback, and buildMcpServerInfo
  // withholds the icons rather than publish an http URL an assistant refuses or
  // an https URL this deployment does not answer on. Over https the same code
  // publishes one icon on the request's own origin (measured by
  // packages/twenty-server/src/engine/api/mcp/utils/__tests__/build-mcp-server-info.util.spec.ts).
  assert.equal(new URL(BASE_URL).protocol, 'http:', 'this check assumes the local http profile');
  assert.equal(
    res.result.serverInfo.icons,
    undefined,
    `over plain http the server published icons anyway: ${JSON.stringify(res.result.serverInfo.icons)}`,
  );
  assert.ok(res.result.protocolVersion, 'initialize returned no protocol version');
  const instructions = res.result.instructions ?? '';
  assert.ok(instructions.length > 0, 'initialize returned empty instructions');

  // The ACTION line is the list of action tools the server tells the model it
  // can run. Asserting on this line and not on the whole text on purpose: two
  // other tools' descriptions mention `code_interpreter.files` as the shape of
  // a FILES value, which is documentation and not an offer, and a substring
  // search over the whole string cannot tell those apart.
  const actionLine = instructions.split('\n').find((line) => /^\s*ACTION:/.test(line));
  assert.ok(actionLine, `the server instructions carry no ACTION tool line:\n${instructions.slice(0, 400)}`);
  const offered = actionLine.replace(/^\s*ACTION:\s*/, '').split('|').map((name) => name.trim());
  for (const name of THIRD_PARTY_TOOLS) {
    assert.ok(!offered.includes(name), `the server instructions still offer ${name}: ${actionLine.trim()}`);
  }
  assert.ok(!instructions.includes('search_help_center'),
    'the server instructions still mention search_help_center anywhere');
});

test('tools/list offers exactly the entry tools, and no tool that posts workspace content to a third party', async () => {
  const res = await mcpCall('tools/list', {}, { token: adminToken });
  assert.equal(res.status, 200, `tools/list answered ${res.status}`);
  const names = res.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...EXPECTED_ENTRY_TOOLS].sort(),
    `the MCP tool surface changed: ${names.join(', ')}`);
  for (const name of THIRD_PARTY_TOOLS) {
    assert.ok(!names.includes(name), `${name} is offered in tools/list`);
  }
});

test('the tool catalog offers no tool that posts workspace content to a third party', async () => {
  for (const category of ['ACTION', 'DATABASE_CRUD', 'WORKFLOW', 'METADATA']) {
    const res = await mcpCall(
      'tools/call',
      { name: 'get_tool_catalog', arguments: { categories: [category] } },
      { token: adminToken },
    );
    assert.equal(res.status, 200, `get_tool_catalog ${category} answered ${res.status}`);
    const catalog = unwrapToolResult(res);
    // The names the catalog OFFERS, not every occurrence of the string in it:
    // other tools' descriptions legitimately mention `code_interpreter.files`.
    const entries = catalog.payload?.catalog?.[category] ?? [];
    assert.ok(Array.isArray(entries), `get_tool_catalog ${category} returned no catalog array: ${JSON.stringify(catalog.payload).slice(0, 200)}`);
    const names = entries.map((entry) => entry.name);
    for (const name of THIRD_PARTY_TOOLS) {
      assert.ok(!names.includes(name), `${name} is offered in the ${category} tool catalog`);
    }
  }

  const learn = await mcpCall(
    'tools/call',
    { name: 'learn_tools', arguments: { toolNames: THIRD_PARTY_TOOLS } },
    { token: adminToken },
  );
  const learned = unwrapToolResult(learn);
  const found = learned.payload?.tools ?? [];
  assert.deepEqual(found, [], `learn_tools returned schemas for ${found.map((t) => t.name).join(', ')}`);
});

test('execute_tool refuses every tool that posts workspace content to a third party', async () => {
  for (const name of THIRD_PARTY_TOOLS) {
    const res = await callTool(name, { query: RUN_MARKER, url: 'https://example.com', code: 'print(1)' }, { token: adminToken });
    const result = unwrapToolResult(res);
    assert.equal(result.ok, false, `execute_tool ran ${name}`);
    // Two refusal wordings, both from the exclusion: a name the registry does
    // not know at all comes back "not found", and one it knows but MCP
    // withholds comes back "not available in this context". Anything else
    // would be a different failure wearing the same exit.
    assert.match(
      String(result.payload?.error ?? result.raw),
      /not found|not available in this context/i,
      `execute_tool refused ${name} for an unexpected reason: ${String(result.payload?.error ?? result.raw).slice(0, 200)}`,
    );
  }
});

test('the team role for assistant connections is least privilege, and its key cannot escalate', async () => {
  teamRole = await ensureTeamRole(adminToken);
  assert.equal(teamRole.label, TEAM_ROLE_LABEL);
  // Every switch the role declares, and a switch the server did not return is
  // a failure here: skipping it silently is what left three of the ten
  // unchecked.
  for (const check of checkRolePermissions(teamRole)) {
    assert.ok(check.ok, `the team role's ${check.name}: ${check.detail}`);
  }

  const { apiKeyId, token } = await mintApiKeyForRole(adminToken, {
    roleId: teamRole.id,
    name: `${RUN_MARKER} team key`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mintedApiKeyIds.push(apiKeyId);

  const { results, recordId } = await probeTeamKeyPrivileges(token, { companyName: `${RUN_MARKER} privileges` });
  for (const result of results) {
    assert.ok(result.ok, `${result.name}: ${result.detail}`);
  }
  if (recordId) {
    await callTool('delete_one_company', { id: recordId }, { token });
  }

  // The refusals, each one measured against an Admin credential running the
  // same call with the same arguments. Without that half a refusal could be the
  // request being malformed, which is how the all-zero roleId used to pass.
  const adminKey = await mintApiKeyForRole(adminToken, {
    roleId: await findAdminRoleId(adminToken),
    name: `${RUN_MARKER} admin reference key`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mintedApiKeyIds.push(adminKey.apiKeyId);

  const refusals = await probeEscalationRefusals({
    teamToken: token,
    adminToken,
    adminKeyToken: adminKey.token,
    assignableRoleId: teamRole.id,
  });
  for (const refusal of refusals) {
    assert.ok(refusal.ok, `${refusal.name}: ${refusal.detail}`);
  }
});

test('a synthetic company created over MCP is in this project\'s database, and its deletion is confirmed there', async () => {
  assert.ok(teamRole, 'the team role test has to run first: it is what this record is created with');
  const { apiKeyId, token } = await mintApiKeyForRole(adminToken, {
    roleId: teamRole.id,
    name: `${RUN_MARKER} crud key`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mintedApiKeyIds.push(apiKeyId);

  const companyName = `${RUN_MARKER} company`;
  const created = unwrapToolResult(await callTool('create_one_company', { name: companyName }, { token }));
  assert.equal(created.ok, true, `create_one_company failed: ${String(created.payload?.error ?? created.raw).slice(0, 300)}`);
  const recordId = created.payload.result.id;
  assert.match(recordId, /^[0-9a-f-]{36}$/, `create_one_company returned no record id: ${JSON.stringify(created.payload)}`);

  // The row itself, by the id the API returned, read inside this project's own
  // container. Counting rows with a LIKE would pass on a leftover from another
  // run; this addresses exactly the record this test created.
  const row = psql(`select name, "deletedAt" is null from ${workspaceSchema}.company where id = '${recordId}';`);
  assert.equal(row, `${companyName}|t`, `psql did not find this run's company row as live: ${row}`);

  const readBack = unwrapToolResult(
    await callTool('find_many_companies', { id: { eq: recordId }, select: ['id', 'name'], limit: 1 }, { token }),
  );
  assert.equal(readBack.ok, true, `find_many_companies failed: ${String(readBack.payload?.error ?? readBack.raw).slice(0, 300)}`);
  assert.ok(JSON.stringify(readBack.payload.result).includes(companyName), 'the record did not come back through MCP');

  const deleted = unwrapToolResult(await callTool('delete_one_company', { id: recordId }, { token }));
  assert.equal(deleted.ok, true, `delete_one_company failed: ${String(deleted.payload?.error ?? deleted.raw).slice(0, 300)}`);

  // MCP exposes the soft delete and no destroy tool, so "deleted" means the
  // row carries a deletedAt and the API no longer returns it. Both halves are
  // measured: the database directly, and the same read path the assistant has.
  const afterDelete = psql(`select "deletedAt" is not null from ${workspaceSchema}.company where id = '${recordId}';`);
  assert.equal(afterDelete, 't', `psql does not show this run's company row as deleted: ${afterDelete}`);

  const readAfterDelete = unwrapToolResult(
    await callTool('find_many_companies', { id: { eq: recordId }, select: ['id', 'name'], limit: 1 }, { token }),
  );
  assert.ok(
    !JSON.stringify(readAfterDelete.payload?.result ?? []).includes(companyName),
    'the deleted record is still returned through MCP',
  );
});

test('an expired API key and a revoked API key are both refused by /mcp with 401', async () => {
  assert.ok(teamRole, 'the team role test has to run first: these keys are bound to it');

  const expiring = await mintApiKeyForRole(adminToken, {
    roleId: teamRole.id,
    name: `${RUN_MARKER} expired key`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mintedApiKeyIds.push(expiring.apiKeyId);
  const beforeExpiry = await mcpCall('tools/list', {}, { token: expiring.token });
  assert.equal(beforeExpiry.status, 200, `the key was already refused before it was expired (${beforeExpiry.status}), so the next assertion would prove nothing`);

  await expireApiKey(adminToken, expiring.apiKeyId);
  const afterExpiry = await mcpCall('tools/list', {}, { token: expiring.token });
  assert.equal(afterExpiry.status, 401, `an API key whose expiresAt is an hour in the past was accepted with ${afterExpiry.status}`);

  const live = await mintApiKeyForRole(adminToken, {
    roleId: teamRole.id,
    name: `${RUN_MARKER} revoked key`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mintedApiKeyIds.push(live.apiKeyId);
  const beforeRevoke = await mcpCall('tools/list', {}, { token: live.token });
  assert.equal(beforeRevoke.status, 200, `the key was already refused before revocation (${beforeRevoke.status}), so the next assertion would prove nothing`);

  await revokeApiKey(adminToken, live.apiKeyId);
  const afterRevoke = await mcpCall('tools/list', {}, { token: live.token });
  assert.equal(afterRevoke.status, 401, `a revoked API key was accepted with ${afterRevoke.status}`);
});
