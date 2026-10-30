// CRM-014 (R1/R2/R3): the boundary between two workspaces of the SAME local
// deployment, measured against the real containers over the real published
// loopback port, on the beta profile the AWS beta runs.
//
// @e2e: two synthetic workspaces are opened by the operator (the only server
// admin) at their own subdomains, one of them handed to a synthetic friend
// through an invitation link and no outbound email -> each gets its own
// synthetic records, its own ADMIN-role API key and, for the friend, an OAuth
// access token obtained with dynamic registration + PKCE S256 exactly as a
// ChatGPT/Claude connector does -> then every credential of one workspace is
// pointed at the other's record ids, names, object metadata ids and file ids
// over REST, GraphQL, the metadata API and /mcp (including execute_tool and the
// search surfaces), and each refusal is measured against the OWN credential of
// the target workspace running the SAME call, so a refusal can never be the
// call being wrong -> the friend, who is not a server admin, is refused
// workspace creation -> a login token minted for one workspace is refused at
// the other's origin -> both synthetic workspaces are destroyed and their data
// schemas confirmed gone, with the founder's own workspace and its records
// untouched throughout.
// @e2e-falla-si: set IS_MULTIWORKSPACE_ENABLED back to false (no second
// workspace can be opened and this suite stops at setup), set
// IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS to false (the friend opens a
// workspace and R2 fails), or break the workspace scoping of any of those
// surfaces: each leak fails the assertion that names it. Everything asserted
// here comes from a real HTTP connection to the published loopback port and
// from psql inside this project's db container; there is no double to pass
// instead.
//
// Requires the stack to be up on the beta profile (scripts/aos/local.ps1
// -Action Start). It does not build the image and does not create the stack: if
// the services are not running, this fails closed and says so.
//
// Secrets: the operator's credentials come from the ignored deploy/local/.env;
// the synthetic friend's password is generated in process with crypto
// randomness and never printed, written or compared by value; the invitation
// token is read out of core."appToken" into memory only. Every API key this run
// mints is revoked, and every other credential dies with the workspace it
// belongs to. Failure messages carry booleans, ids, counts and fixed text only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, PG_DB, WEB_PORT,
  compose, exchangeLoginToken, founderWorkspaceOrigin, graphql, http,
  loginWithOrigin, mcpCall, oneShotRedirectListener, pkcePair, psql,
  unwrapToolResult,
} from '../mcp/lib.mjs';
import { findAdminRoleId, gqlErrors, mintApiKeyForRole, revokeApiKey } from '../mcp/team-role.mjs';

const CORE = '/graphql';
const METADATA = '/metadata';
const HEALTH_TIMEOUT_MS = 180_000;
const SETUP_TIMEOUT_MS = 600_000;
const DESTRUCTION_TIMEOUT_MS = 300_000;
const SEARCH_INDEX_TIMEOUT_MS = 60_000;
// Unique per run: the subdomain of a workspace is unique per deployment, so a
// fixed one would collide with a leftover from an interrupted run.
const RUN = randomUUID().slice(0, 8);
// A reserved TLD (RFC 2606): no mailbox can exist for this address, and this
// profile's EMAIL_DRIVER is LOGGER, so nothing leaves the host either.
const FRIEND_EMAIL = `amiga.sintetica.${RUN}@aos-crm.invalid`;
// 1x1 PNG: the smallest real image the logo upload accepts, so the file check
// has an actual file to be refused.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

let operatorFounderToken = null;
let founderWorkspaceId = null;
let founderBaseline = null;
const workspaces = { A: null, B: null };
const mintedKeys = [];

function nameOf(side) {
  return `AOS-CRM aislamiento ${side} ${RUN}`;
}

// 401 (no principal), 403 (principal without the permission) and 404 (the
// record does not exist FOR THIS WORKSPACE, which is what cross-workspace
// addressing looks like from the other side) are all refusals on this
// deployment. A 5xx is not a refusal, it is a crash, and a 2xx carrying the
// other workspace's payload is the leak this suite exists to catch -- so the
// band is deliberately 4xx and not "anything that is not 200".
function isRefusedStatus(status) {
  return status >= 400 && status < 500;
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

async function rest(path, { method = 'GET', token, body } = {}) {
  const res = await http(`/rest${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, raw: res.body };
}

// The data schema Twenty provisions for a workspace. There is no column for it:
// the server derives it from the workspace id, base36 of the uuid
// (workspace-datasource/utils/get-workspace-schema-name.util.ts over
// twenty-shared/src/utils/uuidToBase36.ts), so the same derivation is done here
// and then CONFIRMED against pg_namespace -- a ported formula that silently
// drifted would otherwise make every psql assertion below address a schema that
// does not exist, and read as "nothing leaked".
function dataSchemaOf(workspaceId) {
  const name = `workspace_${BigInt(`0x${workspaceId.replace(/-/g, '')}`).toString(36)}`;
  assert.ok(schemaExists(name),
    `the schema name derived for workspace ${workspaceId} (${name}) does not exist in ${PG_DB}: the derivation no longer matches the server's`);
  return name;
}

function workspaceRowExists(workspaceId) {
  return psql(`select count(*) from core.workspace where id = '${workspaceId}'`) !== '0';
}

function schemaExists(schemaName) {
  return psql(`select count(*) from pg_namespace where nspname = '${schemaName}'`) !== '0';
}

function callTool(toolName, toolArguments, credential) {
  return mcpCall('tools/call', { name: 'execute_tool', arguments: { toolName, arguments: toolArguments } }, credential);
}

async function createSyntheticWorkspace(side) {
  const subdomain = `aos-iso-${side.toLowerCase()}-${RUN}`;
  const created = await graphql(
    METADATA,
    'mutation($input: SignUpInNewWorkspaceInput) {' +
      ' signUpInNewWorkspace(input: $input) { loginToken { token } workspace { id workspaceUrls { subdomainUrl } } } }',
    { input: { displayName: nameOf(side), subdomain } },
    operatorFounderToken,
  );
  assert.equal(created.errors, undefined, `the operator could not open workspace ${side}: ${gqlErrors(created)}`);
  const workspace = created.data.signUpInNewWorkspace.workspace;

  // The origin the SERVER built for this workspace, not one assembled here.
  const url = new URL(workspace.workspaceUrls.subdomainUrl);
  assert.equal(url.hostname.split('.')[0], subdomain,
    `the server put workspace ${side} on ${url.hostname}, which is not the subdomain it was asked for`);
  assert.equal(url.port, String(WEB_PORT),
    `the server built workspace ${side}'s URL on port ${url.port}, which is not the published ${WEB_PORT}`);
  const origin = url.origin;

  // A new workspace is PENDING_CREATION: activation is what provisions its
  // data schema and standard objects, and the token minted before it carries no
  // workspace member (same step the runtime e2e documents).
  const pendingToken = await exchangeLoginToken(created.data.signUpInNewWorkspace.loginToken.token, origin);
  const activated = await graphql(METADATA, 'mutation { activateWorkspace(data: {}) { id activationStatus } }', {}, pendingToken);
  assert.equal(activated.errors, undefined, `activating workspace ${side} failed: ${gqlErrors(activated)}`);
  assert.equal(activated.data.activateWorkspace.activationStatus, 'ACTIVE');

  const operatorToken = await loginWithOrigin(ADMIN_EMAIL, ADMIN_PASSWORD, origin);
  const adminRoleId = await findAdminRoleId(operatorToken);
  const key = await mintApiKeyForRole(operatorToken, {
    roleId: adminRoleId,
    name: `CRM-014 isolation ${side} ${RUN}`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mintedKeys.push({ operatorToken, apiKeyId: key.apiKeyId });

  return {
    side,
    id: workspace.id,
    subdomain,
    origin,
    operatorToken,
    adminRoleId,
    // An ADMIN-role key on purpose: when it cannot touch the other workspace,
    // the refusal cannot be explained by a missing privilege.
    apiKeyToken: key.token,
    schema: dataSchemaOf(workspace.id),
  };
}

// The runbook's handover, executed: an invitation created by the operator, its
// token read out of the database (the API deliberately never returns it -- see
// loadWorkspaceInvitations' `select: { value: false }`), and a sign-up that
// consumes it. Nothing is emailed anywhere.
async function inviteFriendAsAdmin(workspace, email) {
  const invited = await graphql(
    METADATA,
    'mutation($emails: [String!]!, $roleId: UUID) { sendInvitations(emails: $emails, roleId: $roleId) { success result { id email } errors } }',
    { emails: [email], roleId: workspace.adminRoleId },
    workspace.operatorToken,
  );
  assert.equal(invited.errors, undefined, `the invitation for ${workspace.side} failed: ${gqlErrors(invited)}`);
  assert.equal(invited.data.sendInvitations.success, true,
    `sendInvitations reported no success: ${JSON.stringify(invited.data.sendInvitations.errors)}`);

  const inviteToken = psql(
    `select value from core."appToken" where type = 'INVITATION_TOKEN' and "workspaceId" = '${workspace.id}' and context->>'email' = '${email}' and "deletedAt" is null`,
  );
  assert.equal(inviteToken.length, 64,
    'the invitation token is not in the shape this flow stores it in, so the sign-up below would prove nothing');
  const inviteHash = psql(`select "inviteHash" from core.workspace where id = '${workspace.id}'`);
  assert.ok(inviteHash.length > 0, 'the workspace carries no invite hash');

  const password = randomBytes(36).toString('base64url');
  const signedUp = await graphql(
    METADATA,
    'mutation($email: String!, $password: String!, $workspaceId: UUID, $hash: String, $token: String) {' +
      ' signUpInWorkspace(email: $email, password: $password, workspaceId: $workspaceId,' +
      ' workspaceInviteHash: $hash, workspacePersonalInviteToken: $token) { loginToken { token } workspace { id } } }',
    { email, password, workspaceId: workspace.id, hash: inviteHash, token: inviteToken },
  );
  assert.equal(signedUp.errors, undefined, `the friend could not accept the invitation: ${gqlErrors(signedUp)}`);
  assert.equal(signedUp.data.signUpInWorkspace.workspace.id, workspace.id);

  return {
    email,
    token: await exchangeLoginToken(signedUp.data.signUpInWorkspace.loginToken.token, workspace.origin),
  };
}

async function createCompany(workspace, token, name) {
  const created = await graphql(
    CORE,
    'mutation($name: String!) { createCompany(data: { name: $name }) { id name } }',
    { name },
    token,
  );
  assert.equal(created.errors, undefined, `creating the synthetic company in ${workspace.side} failed: ${gqlErrors(created)}`);
  const id = created.data.createCompany.id;
  assert.equal(psql(`select name from ${workspace.schema}.company where id = '${id}'`), name,
    `the company created in ${workspace.side} is not in ${workspace.side}'s own data schema`);
  return { id, name };
}

async function searchHits(token, query) {
  const searched = await graphql(
    CORE,
    'query($q: String!) { search(searchInput: $q, limit: 30) { edges { node { recordId objectNameSingular } } } }',
    { q: query },
    token,
  );
  assert.equal(searched.errors, undefined, `the search surface itself failed: ${gqlErrors(searched)}`);
  return (searched.data?.search?.edges ?? []).map((edge) => edge.node.recordId);
}

async function objectMetadata(token, nameSingular) {
  const objects = await graphql(
    METADATA,
    'query { objects(paging: { first: 200 }) { edges { node { id nameSingular icon } } } }',
    {},
    token,
  );
  assert.equal(objects.errors, undefined, `listing object metadata failed: ${gqlErrors(objects)}`);
  const nodes = objects.data.objects.edges.map((edge) => edge.node);
  const found = nodes.find((node) => node.nameSingular === nameSingular);
  assert.ok(found, `this workspace has no '${nameSingular}' object metadata`);
  return { id: found.id, icon: found.icon, allIds: nodes.map((node) => node.id) };
}

// graphql-upload multipart, built by hand: the only way to put a real file in a
// workspace over the public API. Apollo's CSRF prevention refuses multipart
// without a preflight header, which is why it is set here.
async function uploadWorkspaceLogo(token) {
  const boundary = `----aos-crm-${randomUUID()}`;
  const operations = JSON.stringify({
    query: 'mutation($file: Upload!) { uploadWorkspaceLogo(file: $file) { id path size url } }',
    variables: { file: null },
  });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="operations"\r\n\r\n${operations}\r\n`, 'utf8'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="map"\r\n\r\n${JSON.stringify({ 0: ['variables.file'] })}\r\n`, 'utf8'),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="0"; filename="logo-${RUN}.png"\r\nContent-Type: image/png\r\n\r\n`, 'utf8'),
    PNG_1X1,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const res = await http(METADATA, {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'apollo-require-preflight': 'true',
      'x-apollo-operation-name': 'uploadWorkspaceLogo',
      authorization: `Bearer ${token}`,
    },
    body,
  });
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { /* reported by the caller */ }
  return { status: res.status, body: parsed, raw: res.body };
}

async function destroySyntheticWorkspace(workspace) {
  // The synthetic USER first, while it still has a session: a user row is
  // server-level, not workspace-level, so destroying the workspace would leave
  // it behind forever -- and nobody can delete it afterwards, because
  // user.resolver.ts deleteUser is self-only and this password exists only in
  // this process's memory. Measured on 2026-10-30: without this, every run of
  // this suite left one more orphan identity in the founder's deployment.
  if (workspace.friend) {
    const removed = await graphql(METADATA, 'mutation { deleteUser { id } }', {}, workspace.friend.token);
    if (removed.errors) console.error(`[CLEANUP] the synthetic friend of ${workspace.side} survived: ${gqlErrors(removed)}`);
    workspace.friend = null;
  }
  // Then the workspace, with its own API KEY and not with a user session: by
  // this point the operator may have left it (the R2 procedure) and the friend
  // is gone, while an API key belongs to the workspace itself.
  const deleted = await graphql(METADATA, 'mutation { deleteCurrentWorkspace { id deletedAt } }', {}, workspace.apiKeyToken);
  if (deleted.errors && !/not found|suspended|deleted/i.test(gqlErrors(deleted))) {
    throw new Error(`deleteCurrentWorkspace(${workspace.side}) failed: ${gqlErrors(deleted)}`);
  }
  // deleteCurrentWorkspace SOFT deletes (workspace.service.ts deleteWorkspace
  // with softDelete=true): the row, the data schema and every record stay until
  // the destruction runs. The operator's hard delete is this command, which
  // ENQUEUES the job the worker performs
  // (destroy-soft-deleted-workspace.job.ts) -- so the effect is waited for in
  // the database below instead of trusted from an exit code.
  const destroyed = compose([
    'exec', '-T', 'server', 'yarn', 'command:prod', 'workspace:clean',
    '--workspace-id', workspace.id, '--only-operation', 'destroy', '--ignore-destroy-grace-period',
  ]);
  if (destroyed.status !== 0) {
    throw new Error(`workspace:clean(${workspace.side}) exited ${destroyed.status}: ${(destroyed.stderr || '').slice(-400)}`);
  }
  const deadline = Date.now() + DESTRUCTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!workspaceRowExists(workspace.id) && !schemaExists(workspace.schema)) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

before(async () => {
  const ps = compose(['ps', '--format', 'json', '--status', 'running']);
  assert.equal(ps.status, 0, `docker compose ps exited ${ps.status}: ${(ps.stderr || '').slice(-300)}`);
  const services = ps.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).Service);
  for (const expected of ['server', 'worker', 'db', 'redis']) {
    assert.ok(services.includes(expected),
      `service '${expected}' is not running (running: ${services.join(', ') || 'none'}). Run scripts/aos/local.ps1 -Action Start first.`);
  }
  assert.ok(ADMIN_EMAIL && ADMIN_PASSWORD,
    'deploy/local/.env carries no AOS_CRM_ADMIN_EMAIL/AOS_CRM_ADMIN_PASSWORD: run scripts/aos/test/crm-runtime-e2e.test.mjs once to create the first administrator');

  await waitForHealthy(HEALTH_TIMEOUT_MS);

  operatorFounderToken = await loginWithOrigin(ADMIN_EMAIL, ADMIN_PASSWORD, founderWorkspaceOrigin());
  founderWorkspaceId = psql('select id from core.workspace order by "createdAt" asc limit 1');
  const schema = dataSchemaOf(founderWorkspaceId);
  founderBaseline = {
    schema,
    companies: psql(`select count(*) from ${schema}.company`),
    people: psql(`select count(*) from ${schema}.person`),
  };

  // Server admin is what makes the two workspaces below possible at all, and
  // the friend's lack of it is what R2 measures.
  assert.equal(psql(`select "canAccessFullAdminPanel" from core."user" where email = '${ADMIN_EMAIL}'`), 't',
    'the operator is not a server admin on this deployment, so no workspace can be opened here');

  workspaces.A = await createSyntheticWorkspace('A');
  workspaces.B = await createSyntheticWorkspace('B');
  assert.notEqual(workspaces.A.schema, workspaces.B.schema, 'both synthetic workspaces landed in the same data schema');

  workspaces.A.record = await createCompany(workspaces.A, workspaces.A.operatorToken, `${nameOf('A')} empresa`);
  workspaces.B.friend = await inviteFriendAsAdmin(workspaces.B, FRIEND_EMAIL);
  workspaces.B.record = await createCompany(workspaces.B, workspaces.B.friend.token, `${nameOf('B')} empresa`);
}, { timeout: SETUP_TIMEOUT_MS });

// The net under the teardown test: a run that failed earlier must still not
// leave a synthetic workspace behind. The teardown test nulls each entry it
// destroys, so nothing is destroyed twice, and a cleanup that could not happen
// is printed rather than swallowed.
after(async () => {
  for (const key of mintedKeys) {
    try { await revokeApiKey(key.operatorToken, key.apiKeyId); } catch { /* the workspace is about to be destroyed anyway */ }
  }
  for (const side of ['A', 'B']) {
    const workspace = workspaces[side];
    if (workspace === null) continue;
    try {
      const gone = await destroySyntheticWorkspace(workspace);
      if (!gone) console.error(`[CLEANUP] workspace ${side} (${workspace.id}) was still in the database when this run ended`);
    } catch (error) {
      console.error(`[CLEANUP] ${side}: ${error.message}`);
    }
  }
});

test('the two synthetic workspaces are separate workspaces, with separate data schemas and separate records', () => {
  for (const side of ['A', 'B']) {
    const workspace = workspaces[side];
    assert.match(workspace.id, /^[0-9a-f-]{36}$/, `workspace ${side} has no id`);
    assert.ok(schemaExists(workspace.schema), `workspace ${side} has no data schema`);
    assert.equal(psql(`select count(*) from ${workspace.schema}.company where id = '${workspace.record.id}'`), '1',
      `workspace ${side}'s own record is not in its own schema`);
  }
  // Each side's record id is absent from the other's schema: the floor every
  // assertion below stands on.
  assert.equal(psql(`select count(*) from ${workspaces.A.schema}.company where id = '${workspaces.B.record.id}'`), '0',
    "B's record id exists inside A's schema");
  assert.equal(psql(`select count(*) from ${workspaces.B.schema}.company where id = '${workspaces.A.record.id}'`), '0',
    "A's record id exists inside B's schema");
});

test("A's API key cannot read, change or delete B's record over REST, and B's own key can", async () => {
  const path = `/companies/${workspaces.B.record.id}`;

  const own = await rest(path, { token: workspaces.B.apiKeyToken });
  assert.equal(own.status, 200, `B's own key could not read B's record (${own.status}), so the refusals below would prove nothing`);
  assert.ok(own.raw.includes(workspaces.B.record.name), "B's own key did not get B's record");

  const read = await rest(path, { token: workspaces.A.apiKeyToken });
  assert.ok(isRefusedStatus(read.status), `A's key read B's record over REST with ${read.status}`);
  assert.ok(!read.raw.includes(workspaces.B.record.name), "A's key received B's record name over REST");

  const updated = await rest(path, { method: 'PATCH', token: workspaces.A.apiKeyToken, body: { name: `tocado por A ${RUN}` } });
  assert.ok(isRefusedStatus(updated.status), `A's key updated B's record over REST with ${updated.status}`);

  const deleted = await rest(path, { method: 'DELETE', token: workspaces.A.apiKeyToken });
  assert.ok(isRefusedStatus(deleted.status), `A's key deleted B's record over REST with ${deleted.status}`);

  assert.equal(
    psql(`select name, "deletedAt" is null from ${workspaces.B.schema}.company where id = '${workspaces.B.record.id}'`),
    `${workspaces.B.record.name}|t`,
    "B's record changed while A was being refused",
  );
});

test("A's credentials cannot query, search, update, delete or destroy B's record over GraphQL", async () => {
  const byId = await graphql(
    CORE,
    'query($id: UUID!) { company(filter: { id: { eq: $id } }) { id name } }',
    { id: workspaces.B.record.id },
    workspaces.A.apiKeyToken,
  );
  assert.equal(JSON.stringify(byId.data?.company ?? null).includes(workspaces.B.record.name), false,
    "A's key read B's record by id over GraphQL");

  const byName = await graphql(
    CORE,
    'query($name: String!) { companies(filter: { name: { ilike: $name } }) { edges { node { id } } } }',
    { name: `%aislamiento B ${RUN}%` },
    workspaces.A.operatorToken,
  );
  assert.deepEqual(byName.data?.companies?.edges ?? [], [],
    "A's own operator token found B's records by name");

  // The positive control for the search surface: B's own token DOES find it, so
  // an empty result for A is isolation and not a search that never works. The
  // index is polled because the search vector is maintained on write and this
  // record was created moments ago.
  const deadline = Date.now() + SEARCH_INDEX_TIMEOUT_MS;
  let ownHits = [];
  while (Date.now() < deadline) {
    ownHits = await searchHits(workspaces.B.friend.token, nameOf('B'));
    if (ownHits.includes(workspaces.B.record.id)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.ok(ownHits.includes(workspaces.B.record.id),
    "B's own search never found B's record, so A's empty search would prove nothing");

  const foreignHits = await searchHits(workspaces.A.operatorToken, nameOf('B'));
  assert.equal(foreignHits.includes(workspaces.B.record.id), false, "A's search returned B's record");

  for (const [name, mutation, variables] of [
    ['updateCompany', 'mutation($id: UUID!, $name: String!) { updateCompany(id: $id, data: { name: $name }) { id name } }',
      { id: workspaces.B.record.id, name: `tocado por A ${RUN}` }],
    ['deleteCompany', 'mutation($id: UUID!) { deleteCompany(id: $id) { id deletedAt } }', { id: workspaces.B.record.id }],
    ['destroyCompany', 'mutation($id: UUID!) { destroyCompany(id: $id) { id } }', { id: workspaces.B.record.id }],
  ]) {
    const res = await graphql(CORE, mutation, variables, workspaces.A.apiKeyToken);
    assert.ok(res.errors, `${name} on B's record answered A's key without an error`);
  }

  assert.equal(
    psql(`select name, "deletedAt" is null from ${workspaces.B.schema}.company where id = '${workspaces.B.record.id}'`),
    `${workspaces.B.record.name}|t`,
    "B's record changed while A's GraphQL mutations were being refused",
  );
});

test("A cannot read or change B's object metadata, and B can", async () => {
  const ownObject = await objectMetadata(workspaces.B.friend.token, 'company');
  const foreignObject = await objectMetadata(workspaces.A.operatorToken, 'company');
  assert.notEqual(ownObject.id, foreignObject.id,
    'both workspaces share one company object metadata id, so there is no boundary here to measure');
  assert.equal(foreignObject.allIds.includes(ownObject.id), false,
    "A's object metadata list contains B's company object id");

  // The positive control first: B's own token DOES read that id, so a null for
  // A is isolation and not a query that never answers anything.
  const ownRead = await graphql(
    METADATA,
    'query($id: UUID!) { object(id: $id) { id nameSingular icon } }',
    { id: ownObject.id },
    workspaces.B.friend.token,
  );
  assert.equal(ownRead.errors, undefined, `B could not read its own object metadata by id: ${gqlErrors(ownRead)}`);
  assert.equal(ownRead.data?.object?.id, ownObject.id, "B's own object metadata read came back empty");

  const read = await graphql(
    METADATA,
    'query($id: UUID!) { object(id: $id) { id nameSingular icon } }',
    { id: ownObject.id },
    workspaces.A.operatorToken,
  );
  assert.equal((read.data?.object ?? null) !== null, false, "A read B's object metadata by id");

  // Positive control for the write path too: B changes its own icon, so the
  // refusal below cannot be the mutation being wrong for everybody.
  const updateIcon = (token, icon) => graphql(
    METADATA,
    'mutation($id: UUID!, $icon: String!) { updateOneObject(input: { id: $id, update: { icon: $icon } }) { id icon } }',
    { id: ownObject.id, icon },
    token,
  );
  const ownChange = await updateIcon(workspaces.B.friend.token, 'IconGhost');
  assert.equal(ownChange.errors, undefined, `B could not change its own object icon: ${gqlErrors(ownChange)}`);
  assert.equal(ownChange.data.updateOneObject.icon, 'IconGhost');

  const changed = await updateIcon(workspaces.A.operatorToken, 'IconMoon');
  assert.ok(changed.errors, "A's updateOneObject on B's company object answered without an error");
  assert.equal((await objectMetadata(workspaces.B.friend.token, 'company')).icon, 'IconGhost',
    "B's company object icon changed while A was being refused");

  const reverted = await updateIcon(workspaces.B.friend.token, ownObject.icon);
  assert.equal(reverted.errors, undefined, `B could not restore its own object icon: ${gqlErrors(reverted)}`);
});

test("a file of B is reachable only through B's own signed URL, and no credential of A opens it", async () => {
  const uploaded = await uploadWorkspaceLogo(workspaces.B.apiKeyToken);
  assert.equal(uploaded.status, 200, `the logo upload answered ${uploaded.status}: ${uploaded.raw.slice(0, 300)}`);
  const file = uploaded.body?.data?.uploadWorkspaceLogo;
  assert.ok(file?.id && file?.url, `the logo upload returned no file with a signed URL: ${uploaded.raw.slice(0, 300)}`);
  // The folder prefix of the stored path ('core-picture/<name>.png' ->
  // 'core-picture'), which is what the by-id route matches on
  // (file.service.ts getFilePresignedUrlOrStreamById: path LIKE '<folder>/%').
  // `/file/...` is singular: ApiPath.File is 'file' and ApiPath.Files is a
  // different route family, which answers 404 to everybody and would have
  // looked exactly like isolation.
  const folder = String(file.path).replace(/^\/+/, '').split('/')[0];
  const signed = new URL(file.url);
  const unsignedPath = `/file/${folder}/${file.id}`;

  // Positive control: B's own signed URL serves the bytes. The transport still
  // dials the published loopback port; only the path and query come from the
  // URL the server minted.
  const own = await http(`${signed.pathname}${signed.search}`);
  assert.equal(own.status, 200, `B's own signed URL did not serve its own file (${own.status}), so the refusals below would prove nothing`);

  // MEASURED, and not what a reader would assume: this route authorizes ONLY
  // by that signature (file-by-id.guard.ts reads request.query.token, takes the
  // workspace from the JWT payload and never looks at a bearer credential), so
  // an API key of the OWNING workspace is refused too. The isolation claim is
  // therefore sharper than "A is refused": no credential of any workspace
  // reaches a file by id, and the signature itself is bound to one workspace
  // AND one file id.
  for (const [name, headers] of [
    ["A's Admin API key", { authorization: `Bearer ${workspaces.A.apiKeyToken}` }],
    ["A's operator session", { authorization: `Bearer ${workspaces.A.operatorToken}` }],
    ["B's own Admin API key", { authorization: `Bearer ${workspaces.B.apiKeyToken}` }],
    ['no credential at all', {}],
  ]) {
    const res = await http(unsignedPath, { headers });
    assert.ok(isRefusedStatus(res.status), `${name} fetched B's file without the signature, with ${res.status}`);
  }

  // The signature does not travel to another file: same token, different id.
  const otherId = randomUUID();
  const swapped = await http(`/file/${folder}/${otherId}${signed.search}`);
  assert.ok(isRefusedStatus(swapped.status),
    `B's file token served a different file id with ${swapped.status}`);

  // And the row itself belongs to B in the database: nothing of this file is
  // addressable inside A's workspace.
  assert.equal(psql(`select count(*) from core.file where id = '${file.id}' and "workspaceId" = '${workspaces.A.id}'`), '0',
    "B's file row is attributed to A's workspace");
  assert.equal(psql(`select count(*) from core.file where id = '${file.id}' and "workspaceId" = '${workspaces.B.id}'`), '1',
    "B's file row is not attributed to B's workspace");
});

test("A's API key sees only A through MCP: not B's record by id, not by name, and no write to B", async () => {
  const listed = await mcpCall('tools/list', {}, { token: workspaces.A.apiKeyToken });
  assert.equal(listed.status, 200, `tools/list answered ${listed.status} for A's key`);

  const ownRead = unwrapToolResult(
    await callTool('find_many_companies', { id: { eq: workspaces.B.record.id }, select: ['id', 'name'], limit: 5 }, { token: workspaces.B.apiKeyToken }),
  );
  assert.equal(ownRead.ok, true, `B's own key could not read B's record over MCP: ${String(ownRead.payload?.error ?? ownRead.raw).slice(0, 200)}`);
  assert.ok(JSON.stringify(ownRead.payload.result).includes(workspaces.B.record.name),
    "B's own key did not get B's record over MCP, so the refusals below would prove nothing");

  const byId = unwrapToolResult(
    await callTool('find_many_companies', { id: { eq: workspaces.B.record.id }, select: ['id', 'name'], limit: 5 }, { token: workspaces.A.apiKeyToken }),
  );
  assert.equal(JSON.stringify(byId.payload ?? byId.raw).includes(workspaces.B.record.name), false,
    "A's key read B's record over MCP by id");

  const byName = unwrapToolResult(
    await callTool('find_many_companies', { name: { ilike: `%aislamiento B ${RUN}%` }, select: ['id', 'name'], limit: 20 }, { token: workspaces.A.apiKeyToken }),
  );
  assert.equal(JSON.stringify(byName.payload ?? byName.raw).includes(workspaces.B.record.id), false,
    "A's key found B's record over MCP by name");

  for (const [tool, args] of [
    ['update_one_company', { id: workspaces.B.record.id, name: `tocado por A ${RUN}` }],
    ['delete_one_company', { id: workspaces.B.record.id }],
  ]) {
    const res = unwrapToolResult(await callTool(tool, args, { token: workspaces.A.apiKeyToken }));
    assert.equal(res.ok, false, `A's key ran ${tool} on B's record over MCP`);
  }

  assert.equal(
    psql(`select name, "deletedAt" is null from ${workspaces.B.schema}.company where id = '${workspaces.B.record.id}'`),
    `${workspaces.B.record.name}|t`,
    "B's record changed while A's MCP writes were being refused",
  );
});

test("the OAuth token a connector obtains for B's user sees B and is refused on A (R3)", async () => {
  const listener = oneShotRedirectListener();
  await listener.ready;
  const redirectUri = listener.redirectUri;

  const registration = await http('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: `AOS-CRM CRM-014 isolation ${RUN}`,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  assert.equal(registration.status, 201, `dynamic registration answered ${registration.status}: ${registration.body.slice(0, 200)}`);
  const clientId = JSON.parse(registration.body).client_id;
  assert.ok(clientId, 'dynamic registration returned no client id');

  const pkce = pkcePair();
  const authorized = await graphql(
    METADATA,
    'mutation($clientId: String!, $codeChallenge: String!, $redirectUrl: String!, $state: String!, $scope: String!) {' +
      ' authorizeApp(clientId: $clientId, codeChallenge: $codeChallenge, redirectUrl: $redirectUrl, state: $state, scope: $scope) { redirectUrl } }',
    { clientId, codeChallenge: pkce.challenge, redirectUrl: redirectUri, state: `aos-crm-${RUN}`, scope: 'api profile' },
    workspaces.B.friend.token,
  );
  await listener.close();
  assert.equal(authorized.errors, undefined, `authorizeApp failed for B's user: ${gqlErrors(authorized)}`);
  const code = new URL(authorized.data.authorizeApp.redirectUrl).searchParams.get('code');
  assert.ok(code, 'the authorization step issued no code');

  const exchanged = await http('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    }),
  });
  assert.equal(exchanged.status, 200, `the token exchange answered ${exchanged.status}: ${exchanged.body.slice(0, 200)}`);
  const accessToken = JSON.parse(exchanged.body).access_token;
  assert.ok(accessToken, 'the token exchange returned no access token');

  const initialized = await mcpCall(
    'initialize',
    { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aos-crm-isolation', version: '1' } },
    { token: accessToken },
  );
  assert.equal(initialized.status, 200, `initialize answered ${initialized.status} for the OAuth token`);

  const ownRead = unwrapToolResult(
    await callTool('find_many_companies', { id: { eq: workspaces.B.record.id }, select: ['id', 'name'], limit: 5 }, { token: accessToken }),
  );
  assert.equal(ownRead.ok, true, `the OAuth token could not read its own workspace: ${String(ownRead.payload?.error ?? ownRead.raw).slice(0, 200)}`);
  assert.ok(JSON.stringify(ownRead.payload.result).includes(workspaces.B.record.name),
    "the OAuth token did not see B's own record, so the refusals below would prove nothing");

  const foreignById = unwrapToolResult(
    await callTool('find_many_companies', { id: { eq: workspaces.A.record.id }, select: ['id', 'name'], limit: 5 }, { token: accessToken }),
  );
  assert.equal(JSON.stringify(foreignById.payload ?? foreignById.raw).includes(workspaces.A.record.name), false,
    "the OAuth token of B's user read A's record over MCP");

  const foreignByName = unwrapToolResult(
    await callTool('find_many_companies', { name: { ilike: `%aislamiento A ${RUN}%` }, select: ['id', 'name'], limit: 20 }, { token: accessToken }),
  );
  assert.equal(JSON.stringify(foreignByName.payload ?? foreignByName.raw).includes(workspaces.A.record.id), false,
    "the OAuth token of B's user found A's record by name over MCP");

  for (const [tool, args] of [
    ['update_one_company', { id: workspaces.A.record.id, name: `tocado por B ${RUN}` }],
    ['delete_one_company', { id: workspaces.A.record.id }],
  ]) {
    const res = unwrapToolResult(await callTool(tool, args, { token: accessToken }));
    assert.equal(res.ok, false, `the OAuth token of B's user ran ${tool} on A's record`);
  }

  // The same token on A's REST surface, not only on MCP.
  const restRead = await rest(`/companies/${workspaces.A.record.id}`, { token: accessToken });
  assert.equal(restRead.raw.includes(workspaces.A.record.name), false,
    `the OAuth token of B's user read A's record over REST with ${restRead.status}`);

  assert.equal(
    psql(`select name, "deletedAt" is null from ${workspaces.A.schema}.company where id = '${workspaces.A.record.id}'`),
    `${workspaces.A.record.name}|t`,
    "A's record changed while B's OAuth token was being refused",
  );
});

test("a login token minted for one workspace is refused at the other workspace's origin", async () => {
  const login = await graphql(
    METADATA,
    'mutation($email: String!, $password: String!, $origin: String!) {' +
      ' getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }',
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, origin: workspaces.A.origin },
  );
  assert.equal(login.errors, undefined, `the operator could not sign in at A: ${gqlErrors(login)}`);

  const crossed = await graphql(
    METADATA,
    'mutation($loginToken: String!, $origin: String!) {' +
      ' getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { loginToken: login.data.getLoginTokenFromCredentials.loginToken.token, origin: workspaces.B.origin },
  );
  assert.ok(crossed.errors, "a login token for A was exchanged at B's origin");
  assert.equal((crossed.data?.getAuthTokensFromLoginToken ?? null) !== null, false,
    'the refused cross-workspace exchange still returned a token payload (not printed)');
});

test('a user who is not a server admin cannot open a workspace (R2)', async () => {
  assert.equal(psql(`select "canAccessFullAdminPanel" from core."user" where email = '${FRIEND_EMAIL}'`), 'f',
    'the invited friend was granted server-admin access, which this profile must not do');

  const before = psql('select count(*) from core.workspace');
  const refused = await graphql(
    METADATA,
    'mutation($input: SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input: $input) { workspace { id } } }',
    { input: { displayName: `AOS-CRM intruso ${RUN}` } },
    workspaces.B.friend.token,
  );
  assert.ok(refused.errors, 'a user who is not a server admin created a workspace');
  assert.match(gqlErrors(refused), /restricted to admins|forbidden|permission/i,
    `the refusal was not the workspace-creation restriction: ${gqlErrors(refused)}`);
  assert.equal(psql('select count(*) from core.workspace'), before, 'the refused call still created a workspace');

  // The other half of the same restriction: a brand-new identity cannot
  // register itself a workspace either.
  const stranger = await graphql(
    METADATA,
    'mutation($email: String!, $password: String!) { signUp(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { email: `extrano.${RUN}@aos-crm.invalid`, password: randomBytes(24).toString('base64url') },
  );
  assert.ok(stranger.errors, 'a public sign-up without an invitation succeeded on the beta profile');
  assert.equal((stranger.data?.signUp ?? null) !== null, false,
    'the refused sign-up still returned a payload (not printed: it would carry tokens)');
});

test('the rest of the operator procedure runs for the synthetic friend: the operator leaves B, and a password reset travels without email (R2)', async () => {
  // 1. The operator leaves the workspace they handed over. Their own member row
  //    in B is what they delete (user.resolver.ts deleteUserFromWorkspace); the
  //    friend stays as B's admin, which is why the teardown can still delete it.
  const member = await graphql(
    CORE,
    'query($userId: UUID!) { workspaceMembers(filter: { userId: { eq: $userId } }) { edges { node { id userId } } } }',
    { userId: psql(`select id from core."user" where email = '${ADMIN_EMAIL}'`) },
    workspaces.B.operatorToken,
  );
  assert.equal(member.errors, undefined, `the operator could not find their own member row in B: ${gqlErrors(member)}`);
  const memberId = member.data.workspaceMembers.edges[0]?.node?.id;
  assert.ok(memberId, "the operator has no workspace member row in B, so there is nothing to leave");

  const left = await graphql(
    METADATA,
    'mutation($id: String!) { deleteUserFromWorkspace(workspaceMemberIdToDelete: $id) { id } }',
    { id: memberId },
    workspaces.B.operatorToken,
  );
  assert.equal(left.errors, undefined, `the operator could not leave B: ${gqlErrors(left)}`);

  assert.equal(
    psql(`select count(*) from core."userWorkspace" where "workspaceId" = '${workspaces.B.id}' and "userId" = (select id from core."user" where email = '${ADMIN_EMAIL}')`),
    '0',
    "the operator still belongs to B after leaving it",
  );
  // And the operator can no longer sign in there.
  let refusedAtB = false;
  try {
    await loginWithOrigin(ADMIN_EMAIL, ADMIN_PASSWORD, workspaces.B.origin);
  } catch {
    refusedAtB = true;
  }
  assert.equal(refusedAtB, true, "the operator could still sign in at B after leaving it");

  // 2. The password reset, by the only route this deployment has: the link is
  //    written to the server's own log (EMAIL_DRIVER=LOGGER) and the database
  //    keeps only a sha256 of the token, so the log is where the operator reads
  //    it -- which is exactly what the runbook tells them to do.
  const asked = await graphql(
    METADATA,
    'mutation($email: String!, $workspaceId: UUID) { emailPasswordResetLink(email: $email, workspaceId: $workspaceId) { success } }',
    { email: FRIEND_EMAIL, workspaceId: workspaces.B.id },
  );
  assert.equal(asked.errors, undefined, `the reset link could not be requested: ${gqlErrors(asked)}`);
  assert.equal(asked.data.emailPasswordResetLink.success, true, 'emailPasswordResetLink reported no success');

  // The mutation answers before the link is generated (it fires the work and
  // returns), so the stored token is polled first.
  const tokenDeadline = Date.now() + 60_000;
  let stored = '0';
  while (Date.now() < tokenDeadline) {
    stored = psql(
      `select count(*) from core."appToken" where type = 'PASSWORD_RESET_TOKEN' and "revokedAt" is null and "userId" = (select id from core."user" where email = '${FRIEND_EMAIL}')`,
    );
    if (stored !== '0') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(stored, '1', 'no live password reset token was stored for the friend');

  // The plaintext token exists ONLY in that log line: the database keeps a
  // sha256 of it (reset-password.service.ts rotatePasswordResetToken), and the
  // API never returns it. It is the WORKER's log and not the server's --
  // EmailService.send enqueues an EmailSenderJob and the worker is what runs
  // the LOGGER driver -- which is the single most important detail of this step
  // for whoever follows the runbook. Read with --tail and not --since:
  // `docker compose logs --since <duration>` came back empty on this host even
  // for lines seconds old, which would read as "the mail never went out".
  // Extracted, never printed: the assertions below carry length and booleans.
  let resetToken = null;
  const logDeadline = Date.now() + 60_000;
  while (Date.now() < logDeadline && resetToken === null) {
    const logs = compose(['logs', '--no-log-prefix', '--tail', '4000', 'worker']);
    const matches = [...(logs.stdout || '').matchAll(/\/reset-password\/([0-9a-f]{64})/g)];
    // The LAST one in the log: older runs leave their own (already revoked)
    // links behind, and the one that matters is the newest. Which run it
    // belongs to is then PROVEN by the address the server validates it for.
    if (matches.length > 0) resetToken = matches[matches.length - 1][1];
    else await new Promise((r) => setTimeout(r, 2000));
  }
  assert.ok(resetToken, "the reset link never appeared in the worker log, so the operator has no way to deliver it");
  assert.equal(resetToken.length, 64, 'the reset token in the log is not the shape this flow mints');

  const valid = await graphql(
    METADATA,
    'query($token: String!) { validatePasswordResetToken(passwordResetToken: $token) { id email } }',
    { token: resetToken },
  );
  assert.equal(valid.errors, undefined, `the reset token from the log did not validate: ${gqlErrors(valid)}`);
  // This is what ties the token to THIS run: the address carries the run id.
  assert.equal(valid.data.validatePasswordResetToken.email, FRIEND_EMAIL);

  const newPassword = randomBytes(36).toString('base64url');
  const changed = await graphql(
    METADATA,
    'mutation($token: String!, $password: String!) { updatePasswordViaResetToken(passwordResetToken: $token, newPassword: $password) { success } }',
    { token: resetToken, password: newPassword },
  );
  assert.equal(changed.errors, undefined, `the password could not be changed with the reset token: ${gqlErrors(changed)}`);
  assert.equal(changed.data.updatePasswordViaResetToken.success, true);

  // The friend signs in with the new password, at their own workspace's origin.
  const reauthenticated = await loginWithOrigin(FRIEND_EMAIL, newPassword, workspaces.B.origin);
  assert.ok(reauthenticated.length > 0, 'the friend could not sign in with the new password');
  workspaces.B.friend.token = reauthenticated;

  // And the token cannot be used twice.
  const replayed = await graphql(
    METADATA,
    'mutation($token: String!, $password: String!) { updatePasswordViaResetToken(passwordResetToken: $token, newPassword: $password) { success } }',
    { token: resetToken, password: randomBytes(36).toString('base64url') },
  );
  assert.ok(replayed.errors, 'the password reset token was accepted a second time');
});

// The exposure the CRM-005 preflight pointed at, re-measured on the profile
// that changes its answer: with multi-workspace on, a sign-up by an address
// that merely HAS a pending invitation is allowed
// (sign-in-up.service.ts assertSignUpWithoutWorkspaceAllowed ->
// 'requiresDestination' -> hasProvisionedDestination), so an identity that only
// CLAIMS an invited address can create a user. What must not follow from that
// is reaching the workspace: neither its invitation credential nor its records.
test('an identity that only claims an invited address reaches no records, and is offered no workspace it was not invited to (measured limit: it IS handed the pending invitation)', async () => {
  const claimedEmail = `reclamo.${RUN}@aos-crm.invalid`;
  const claimedPassword = randomBytes(36).toString('base64url');

  const invited = await graphql(
    METADATA,
    'mutation($emails: [String!]!) { sendInvitations(emails: $emails) { success result { id } } }',
    { emails: [claimedEmail] },
    workspaces.B.friend.token,
  );
  assert.equal(invited.errors, undefined, `the invitation for the claim probe failed: ${gqlErrors(invited)}`);
  assert.equal(invited.data.sendInvitations.success, true, 'the invitation for the claim probe was not created');

  // The whole payload the stranger receives, including the one field that would
  // hand them the invitation: availableWorkspaces is NOT a root query on this
  // deployment ("Cannot query field availableWorkspaces on type Query",
  // measured), it travels inside the sign-up answer, which is why it is read
  // from there and not probed separately.
  const claimed = await graphql(
    METADATA,
    'mutation($e: String!, $p: String!) { signUp(email: $e, password: $p) {' +
      ' tokens { accessOrWorkspaceAgnosticToken { token } }' +
      ' availableWorkspaces { availableWorkspacesForSignUp { id personalInviteToken inviteHash } } } }',
    { e: claimedEmail, p: claimedPassword },
  );
  const claimerToken = claimed.data?.signUp?.tokens?.accessOrWorkspaceAgnosticToken?.token ?? null;
  const offered = claimed.data?.signUp?.availableWorkspaces?.availableWorkspacesForSignUp ?? [];
  const forB = offered.find((workspace) => workspace.id === workspaces.B.id) ?? null;
  // Booleans and ids from here on: this payload carries an invitation
  // credential, and an assert.equal that fails prints its ACTUAL value.
  const wasHandedTheInvitation = typeof forB?.personalInviteToken === 'string' && forB.personalInviteToken.length > 0;

  try {
    // MEASURED LIMIT, not a pass: on this profile the sign-up answer DOES hand
    // the pending invitation token to whoever claims the address, and with it
    // the address can join. It is upstream's design -- the invitation is
    // addressed to an email and nothing proves the address while
    // IS_EMAIL_VERIFICATION_REQUIRED is false -- so it is reported to the
    // founder (.aos/reports/CRM-014.md, docs/aos/product/BETA_RUNBOOK.md) with
    // its mitigation (invite, have it accepted, and delete anything pending)
    // instead of being asserted away here. What IS asserted below is the shape
    // of that exposure: it reaches only the workspace the address was really
    // invited to, and it buys no records without redeeming the invitation.
    let joinedWorkspaceId = null;
    if (claimerToken !== null && wasHandedTheInvitation) {
      const joined = await graphql(
        METADATA,
        'mutation($e: String!, $p: String!, $w: UUID, $h: String, $t: String) {' +
          ' signUpInWorkspace(email: $e, password: $p, workspaceId: $w, workspaceInviteHash: $h,' +
          ' workspacePersonalInviteToken: $t) { workspace { id } } }',
        { e: claimedEmail, p: claimedPassword, w: workspaces.B.id, h: forB.inviteHash, t: forB.personalInviteToken },
      );
      joinedWorkspaceId = joined.data?.signUpInWorkspace?.workspace?.id ?? null;
    }
    console.log(
      `[LIMIT] a claimed invited address was handed the pending invitation token: ${wasHandedTheInvitation}; ` +
      `redeeming it joined the workspace: ${joinedWorkspaceId === workspaces.B.id}`,
    );

    // The exposure is bounded to the invitation that exists: no other workspace
    // of this deployment is offered to that address.
    assert.deepEqual(
      offered.map((workspace) => workspace.id).filter((id) => id !== workspaces.B.id),
      [],
      'the sign-up answer offered a workspace the claimed address was never invited to',
    );
    assert.equal(offered.length <= 1, true, `the claimed address was offered ${offered.length} workspaces`);

    // And the token a bare sign-up produces, on its own, reaches no records.
    if (claimerToken !== null) {
      const records = await graphql(CORE, '{ companies { edges { node { id } } } }', {}, claimerToken);
      assert.ok(records.errors, 'the bare sign-up token answered a records query');
    }
  } finally {
    // The claimer deletes its own account (user.resolver.ts deleteUser is
    // self-only), so this probe leaves no identity behind.
    if (claimerToken !== null) {
      const removed = await graphql(METADATA, 'mutation { deleteUser { id } }', {}, claimerToken);
      if (removed.errors) console.error(`[CLEANUP] the claim probe user survived: ${gqlErrors(removed)}`);
    }
  }
});

test("the founder's own workspace and its records were never touched by this run", () => {
  assert.equal(psql(`select count(*) from core.workspace where id = '${founderWorkspaceId}' and "deletedAt" is null`), '1',
    "the founder's workspace is gone or soft deleted");
  assert.equal(psql(`select count(*) from ${founderBaseline.schema}.company`), founderBaseline.companies,
    "the founder's company count changed during this run");
  assert.equal(psql(`select count(*) from ${founderBaseline.schema}.person`), founderBaseline.people,
    "the founder's person count changed during this run");
  assert.equal(psql(`select count(*) from ${founderBaseline.schema}.company where name like '%${RUN}%'`), '0',
    "this run's synthetic marker reached the founder's workspace");
});

test('both synthetic workspaces are destroyed, with their data schemas and rows gone', async () => {
  for (const side of ['A', 'B']) {
    const workspace = workspaces[side];
    assert.ok(workspace, `workspace ${side} was already gone before the teardown`);
    const gone = await destroySyntheticWorkspace(workspace);
    assert.equal(gone, true,
      `workspace ${side} (${workspace.id}) or its data schema ${workspace.schema} was still in the database ${DESTRUCTION_TIMEOUT_MS}ms after its destruction was enqueued`);
    workspaces[side] = null;
  }

  // Exactly the founder's workspace is left, which is what every other suite in
  // this gate assumes.
  assert.equal(psql('select count(*) from core.workspace'), '1',
    'this deployment does not hold exactly the founder workspace after cleanup');
  assert.equal(psql("select count(*) from pg_namespace where nspname like 'workspace_%'"), '1',
    'a synthetic workspace data schema survived cleanup');
});
