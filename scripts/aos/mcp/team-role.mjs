#!/usr/bin/env node
// CRM-007 R4: the least-privilege team role for assistant connections, created
// over the API, plus an API key bound to it.
//
// Everything here is AGPL core: a role with object-record permissions and the
// settings switches off. No row-level permission predicates and no other
// Enterprise feature is touched.
//
// Exported so scripts/aos/test/crm-mcp-e2e.test.mjs builds the same role it
// documents; run directly it creates (or reuses) the role, mints a key and
// prints what that key can and cannot do.
//
//   node scripts/aos/mcp/team-role.mjs
//
// The key it mints is printed as a length, never as a value, and is revoked
// before the script exits unless --keep is passed.
import { pathToFileURL } from 'node:url';

import { ADMIN_EMAIL, ADMIN_PASSWORD, SERVER_URL, graphql, mcpCall, unwrapToolResult } from './lib.mjs';

const METADATA = '/metadata';

export const TEAM_ROLE_LABEL = 'Assistant connection (team)';
export const TEAM_ROLE_DESCRIPTION =
  'CRM-007: for a team member who drives this workspace from their own ChatGPT or Claude over MCP. Business-object CRUD only: no workspace settings, no API keys, no roles, no members, no workspace-wide tool access.';

// Exactly the switches that make it least privilege. The four `false` ones are
// the point of the role: canUpdateAllSettings is what gates API keys, roles and
// members, canAccessAllTools is what would hand it the action tools, and
// canDestroyAllObjectRecords keeps permanent purges an administrator action.
export const TEAM_ROLE_PERMISSIONS = {
  canUpdateAllSettings: false,
  canAccessAllTools: false,
  canAccessAllAgentChatChannels: false,
  canDestroyAllObjectRecords: false,
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: true,
  canBeAssignedToUsers: true,
  canBeAssignedToAgents: true,
  canBeAssignedToApiKeys: true,
};

const ROLE_FIELDS =
  'id label description canUpdateAllSettings canAccessAllTools canReadAllObjectRecords ' +
  'canUpdateAllObjectRecords canSoftDeleteAllObjectRecords canDestroyAllObjectRecords canBeAssignedToApiKeys';

export function gqlErrors(body) {
  return (body.errors || []).map((e) => e.message).join(' | ');
}

export async function loginAsAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('deploy/local/.env carries no AOS_CRM_ADMIN_EMAIL/AOS_CRM_ADMIN_PASSWORD');
  }
  const login = await graphql(
    METADATA,
    'mutation($email: String!, $password: String!, $origin: String!) {' +
      ' getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) { loginToken { token } } }',
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, origin: SERVER_URL },
  );
  if (login.errors) throw new Error(`administrator sign-in failed: ${gqlErrors(login)}`);
  const exchanged = await graphql(
    METADATA,
    'mutation($loginToken: String!, $origin: String!) {' +
      ' getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { loginToken: login.data.getLoginTokenFromCredentials.loginToken.token, origin: SERVER_URL },
  );
  if (exchanged.errors) throw new Error(`login-token exchange failed: ${gqlErrors(exchanged)}`);
  return exchanged.data.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
}

// Idempotent: a second run reuses the role instead of creating a twin, and
// still rewrites the switches, so a role someone widened by hand comes back to
// least privilege.
export async function ensureTeamRole(adminToken) {
  const existing = await graphql(METADATA, `{ getRoles { ${ROLE_FIELDS} } }`, {}, adminToken);
  if (existing.errors) throw new Error(`getRoles failed: ${gqlErrors(existing)}`);
  const found = existing.data.getRoles.find((role) => role.label === TEAM_ROLE_LABEL);

  if (!found) {
    const created = await graphql(
      METADATA,
      `mutation($input: CreateRoleInput!) { createOneRole(createRoleInput: $input) { ${ROLE_FIELDS} } }`,
      { input: { label: TEAM_ROLE_LABEL, description: TEAM_ROLE_DESCRIPTION, icon: 'IconRobot', ...TEAM_ROLE_PERMISSIONS } },
      adminToken,
    );
    if (created.errors) throw new Error(`createOneRole failed: ${gqlErrors(created)}`);
    return created.data.createOneRole;
  }

  const updated = await graphql(
    METADATA,
    `mutation($input: UpdateRoleInput!) { updateOneRole(updateRoleInput: $input) { ${ROLE_FIELDS} } }`,
    { input: { id: found.id, update: { description: TEAM_ROLE_DESCRIPTION, ...TEAM_ROLE_PERMISSIONS } } },
    adminToken,
  );
  if (updated.errors) throw new Error(`updateOneRole failed: ${gqlErrors(updated)}`);
  return updated.data.updateOneRole;
}

// Returns { apiKeyId, token }. The token is a credential: callers pass it in an
// Authorization header and never log it.
export async function mintApiKeyForRole(adminToken, { roleId, name, expiresAt }) {
  const created = await graphql(
    METADATA,
    'mutation($input: CreateApiKeyInput!) { createApiKey(input: $input) { id name expiresAt revokedAt } }',
    { input: { name, roleId, expiresAt } },
    adminToken,
  );
  if (created.errors) throw new Error(`createApiKey failed: ${gqlErrors(created)}`);
  const apiKeyId = created.data.createApiKey.id;
  const token = await graphql(
    METADATA,
    'mutation($apiKeyId: UUID!, $expiresAt: String!) {' +
      ' generateApiKeyToken(apiKeyId: $apiKeyId, expiresAt: $expiresAt) { token } }',
    { apiKeyId, expiresAt },
    adminToken,
  );
  if (token.errors) throw new Error(`generateApiKeyToken failed: ${gqlErrors(token)}`);
  return { apiKeyId, token: token.data.generateApiKeyToken.token };
}

// Backdating expiresAt on an existing key, which is how an expired credential
// is produced at all: generateApiKeyToken calls validateApiKey first and
// refuses to sign for a key whose expiresAt is already past ("This API Key has
// expired"), so a key has to be minted live and then expired. The JWT it
// issued stays signature-valid; what rejects it afterwards is the database
// record, which is exactly the check worth proving.
export async function expireApiKey(adminToken, apiKeyId) {
  const updated = await graphql(
    METADATA,
    'mutation($input: UpdateApiKeyInput!) { updateApiKey(input: $input) { id expiresAt } }',
    { input: { id: apiKeyId, expiresAt: new Date(Date.now() - 3600_000).toISOString() } },
    adminToken,
  );
  if (updated.errors) throw new Error(`updateApiKey failed: ${gqlErrors(updated)}`);
  return updated.data.updateApiKey;
}

export async function revokeApiKey(adminToken, apiKeyId) {
  const revoked = await graphql(
    METADATA,
    'mutation($input: RevokeApiKeyInput!) { revokeApiKey(input: $input) { id revokedAt } }',
    { input: { id: apiKeyId } },
    adminToken,
  );
  if (revoked.errors) throw new Error(`revokeApiKey failed: ${gqlErrors(revoked)}`);
  return revoked.data.revokeApiKey;
}

// What the team key must be able to do, and what it must not. Both halves are
// measured through the same MCP surface a connected assistant uses, except the
// two refusals that only exist on GraphQL (an API key cannot reach them
// through MCP at all, which is itself part of the answer).
export async function probeTeamKeyPrivileges(teamToken, { companyName }) {
  const results = [];
  const add = (name, ok, detail) => results.push({ name, ok, detail });

  const created = unwrapToolResult(
    await mcpCall(
      'tools/call',
      { name: 'execute_tool', arguments: { toolName: 'create_one_company', arguments: { name: companyName } } },
      { token: teamToken },
    ),
  );
  const recordId = created.payload?.result?.id;
  add(
    'the team key creates a company record over MCP',
    created.ok && Boolean(recordId),
    recordId ? `record ${recordId}` : String(created.payload?.error ?? created.raw).slice(0, 200),
  );

  const read = unwrapToolResult(
    await mcpCall(
      'tools/call',
      // Filter fields are top-level arguments, not nested under `filter`, and
      // `select` is a required array of field names: both are stated in the
      // tool's own schema, which learn_tools returns.
      { name: 'execute_tool', arguments: { toolName: 'find_many_companies', arguments: { name: { ilike: `%${companyName}%` }, select: ['id', 'name'], limit: 5 } } },
      { token: teamToken },
    ),
  );
  add(
    'the team key reads company records over MCP',
    read.ok && JSON.stringify(read.payload.result ?? '').includes(companyName),
    read.ok ? 'the record it just created came back' : String(read.payload?.error ?? read.raw).slice(0, 200),
  );

  const apiKeyAttempt = await graphql(
    METADATA,
    'mutation($input: CreateApiKeyInput!) { createApiKey(input: $input) { id } }',
    { input: { name: 'CRM-007 escalation attempt', roleId: '00000000-0000-0000-0000-000000000000', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } },
    teamToken,
  );
  add(
    'the team key cannot create an API key',
    Boolean(apiKeyAttempt.errors),
    apiKeyAttempt.errors ? gqlErrors(apiKeyAttempt).slice(0, 120) : 'IT SUCCEEDED, which is an escalation',
  );

  const roleAttempt = await graphql(
    METADATA,
    'mutation($input: CreateRoleInput!) { createOneRole(createRoleInput: $input) { id } }',
    { input: { label: 'CRM-007 escalation attempt', canUpdateAllSettings: true } },
    teamToken,
  );
  add(
    'the team key cannot create a role',
    Boolean(roleAttempt.errors),
    roleAttempt.errors ? gqlErrors(roleAttempt).slice(0, 120) : 'IT SUCCEEDED, which is an escalation',
  );

  const membersAttempt = await graphql(
    METADATA,
    '{ getRoles { id label canUpdateAllSettings } }',
    {},
    teamToken,
  );
  add(
    'the team key cannot administer roles and members',
    Boolean(membersAttempt.errors),
    membersAttempt.errors ? gqlErrors(membersAttempt).slice(0, 120) : 'IT SUCCEEDED, which is an escalation',
  );

  return { results, recordId };
}

async function main() {
  const adminToken = await loginAsAdmin();
  const role = await ensureTeamRole(adminToken);
  console.log(`[INFO] role "${role.label}" (${role.id})`);
  for (const [key, expected] of Object.entries(TEAM_ROLE_PERMISSIONS)) {
    if (key in role) {
      console.log(`${role[key] === expected ? '[PASS]' : '[FAIL]'} ${key} = ${role[key]} (expected ${expected})`);
    }
  }

  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { apiKeyId, token } = await mintApiKeyForRole(adminToken, {
    roleId: role.id,
    name: `CRM-007 team probe ${new Date().toISOString()}`,
    expiresAt,
  });
  console.log(`[INFO] minted API key ${apiKeyId} bound to that role (token length ${token.length}, expires ${expiresAt})`);

  const companyName = `AOS-CRM CRM-007 team-role probe ${Date.now()}`;
  const { results, recordId } = await probeTeamKeyPrivileges(token, { companyName });
  for (const r of results) console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.name} -- ${r.detail}`);

  if (recordId) {
    const deleted = await mcpCall(
      'tools/call',
      { name: 'execute_tool', arguments: { toolName: 'delete_one_company', arguments: { id: recordId } } },
      { token },
    );
    console.log(`[INFO] the probe's own company record deleted by the team key (status ${deleted.status})`);
  }

  if (!process.argv.includes('--keep')) {
    await revokeApiKey(adminToken, apiKeyId);
    console.log('[INFO] the probe API key was revoked');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '[PASS]' : '[FAIL]'} team role: ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// pathToFileURL, not a hand-built file:/// string: this checkout's path holds a
// non-ASCII character, which import.meta.url percent-encodes and a naive
// comparison then misses, silently skipping main() with exit 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[FAIL] ${error.stack || error.message}`);
    process.exit(1);
  });
}
