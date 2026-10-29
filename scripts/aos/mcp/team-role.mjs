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
// Every key it mints is printed as a length, never as a value. The team key is
// revoked before the script exits unless --keep is passed; the Admin reference
// key, which exists only to prove the refusals are about permission, is always
// revoked.
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

// Derived from TEAM_ROLE_PERMISSIONS and not written out by hand: the check
// below can only compare switches the server actually returned, so a switch
// missing from this selection is a switch nobody checks. Spelling the list
// twice is how three of the ten went unverified.
const ROLE_FIELDS = `id label description ${Object.keys(TEAM_ROLE_PERMISSIONS).join(' ')}`;

// What the principal guard answers when it declines a whole class of caller,
// as opposed to the permission guard answering that this caller's role is not
// enough. Both arrive as FORBIDDEN; only the message tells them apart.
const PRINCIPAL_REFUSED_MESSAGE = 'This endpoint is not available to this caller';

export function gqlErrors(body) {
  return (body.errors || []).map((e) => e.message).join(' | ');
}

// Why a call was refused, read off what the server answered. `permission` and
// `principal` are the deployment enforcing something; `invalid-input` is the
// server rejecting the request before any of that, which is the failure mode
// that made the first version of this probe pass without proving anything.
export function refusalKind(body) {
  const error = (body.errors || [])[0];
  if (!error) return 'allowed';
  const code = error.extensions?.code;
  if (code === 'FORBIDDEN' && error.extensions?.subCode === 'PERMISSION_DENIED') return 'permission';
  if (code === 'FORBIDDEN' && error.message === PRINCIPAL_REFUSED_MESSAGE) return 'principal';
  if (['NOT_FOUND', 'BAD_USER_INPUT', 'GRAPHQL_VALIDATION_FAILED'].includes(code)) return 'invalid-input';
  return `other(${code}/${error.extensions?.subCode})`;
}

// Every switch TEAM_ROLE_PERMISSIONS declares, compared against what the role
// came back with. A switch the server did not return is a FAILED check and not
// a skipped one: an absent field means the selection above does not ask for it,
// and silently passing over it is indistinguishable from the role being right.
export function checkRolePermissions(role) {
  return Object.entries(TEAM_ROLE_PERMISSIONS).map(([key, expected]) => ({
    name: `${key} is ${expected}`,
    ok: key in role && role[key] === expected,
    detail: key in role
      ? `${role[key]} (expected ${expected})`
      : 'the role came back WITHOUT this field, so nothing was compared',
  }));
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

// The built-in Admin role, looked up and not hardcoded: its id differs per
// workspace. Only used to mint the Admin credential the falsifiability half
// needs, which the caller revokes.
export async function findAdminRoleId(adminToken) {
  const roles = await graphql(METADATA, '{ getApiKeyRoles { id label } }', {}, adminToken);
  if (roles.errors) throw new Error(`getApiKeyRoles failed: ${gqlErrors(roles)}`);
  const admin = roles.data.getApiKeyRoles.find((role) => role.label === 'Admin');
  if (!admin) {
    throw new Error(
      `no API-key-assignable Admin role in this workspace: ${roles.data.getApiKeyRoles.map((r) => r.label).join(', ')}`,
    );
  }
  return admin.id;
}

// The administrative operations the team role must not be able to perform, one
// definition each, used for BOTH halves of the proof: refused with the team
// key, allowed with an Admin credential. Sharing the query AND the variables is
// the whole point -- the Admin half is what makes the refusal evidence about
// permission instead of evidence that the request was malformed.
//
// `roleId` has to be a real, API-key-assignable role: measured, the all-zero id
// this probe used to send is refused as NOT_FOUND even for the administrator,
// so the refusal said nothing about permission. Same for the role input, which
// needs a target switch or the server rejects it as having no assignable target.
function escalationOperations(roleId) {
  const stamp = new Date().toISOString();
  return [
    {
      name: 'mint an API key',
      query: 'mutation($input: CreateApiKeyInput!) { createApiKey(input: $input) { id } }',
      variables: {
        input: {
          name: `CRM-007 escalation attempt ${stamp}`,
          roleId,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      // createApiKey carries its own principal guard with apiKey:false, so NO
      // API key mints a key, Admin included. That is asserted below as its own
      // check, and the allowed half runs with the administrator's session.
      adminKeyRefusedAs: 'principal',
      allowedWith: 'session',
      cleanup: (adminToken, body) => revokeApiKey(adminToken, body.data.createApiKey.id),
    },
    {
      name: 'create a role with full settings access',
      query: 'mutation($input: CreateRoleInput!) { createOneRole(createRoleInput: $input) { id } }',
      variables: {
        input: {
          label: `CRM-007 escalation attempt ${stamp}`,
          canUpdateAllSettings: true,
          canBeAssignedToApiKeys: true,
        },
      },
      allowedWith: 'key',
      cleanup: async (adminToken, body) => {
        const deleted = await graphql(METADATA, 'mutation($roleId: UUID!) { deleteOneRole(roleId: $roleId) }', { roleId: body.data.createOneRole.id }, adminToken);
        if (deleted.errors) throw new Error(`deleteOneRole failed: ${gqlErrors(deleted)}`);
      },
    },
    {
      // Named for what it measures. Members administration
      // (updateWorkspaceMemberRole) is out of reach of every API key by its own
      // guard, and exercising the allowed half would rewrite the role of this
      // workspace's only member, so it is not probed here.
      name: 'read the workspace role list',
      query: '{ getRoles { id label canUpdateAllSettings } }',
      variables: {},
      allowedWith: 'key',
      cleanup: null,
    },
  ];
}

// Each refusal above, measured twice so it is falsifiable: with the team key it
// must be refused for permission, and with an Admin credential the same call
// with the same arguments must go through. Whatever the Admin half creates is
// removed again before returning.
export async function probeEscalationRefusals({ teamToken, adminToken, adminKeyToken, assignableRoleId }) {
  if (!assignableRoleId) {
    throw new Error('probeEscalationRefusals needs a real API-key-assignable roleId; a nonexistent one is refused as invalid input and proves nothing');
  }
  const results = [];
  const add = (name, ok, detail) => results.push({ name, ok, detail });

  for (const op of escalationOperations(assignableRoleId)) {
    const refused = await graphql(METADATA, op.query, op.variables, teamToken);
    const kind = refusalKind(refused);
    add(
      `the team key cannot ${op.name}`,
      kind === 'permission',
      kind === 'allowed'
        ? 'IT SUCCEEDED, which is an escalation'
        : `refused as ${kind}: ${gqlErrors(refused).slice(0, 120)}`,
    );
    if (kind === 'allowed' && op.cleanup) await op.cleanup(adminToken, refused);

    if (op.adminKeyRefusedAs) {
      const adminKeyAttempt = await graphql(METADATA, op.query, op.variables, adminKeyToken);
      const adminKeyKind = refusalKind(adminKeyAttempt);
      add(
        `no API key can ${op.name}, not even an Admin one: the caller type is refused, not the role`,
        adminKeyKind === op.adminKeyRefusedAs,
        `refused as ${adminKeyKind}: ${gqlErrors(adminKeyAttempt).slice(0, 120)}`,
      );
      if (adminKeyKind === 'allowed' && op.cleanup) await op.cleanup(adminToken, adminKeyAttempt);
    }

    const credential = op.allowedWith === 'session' ? adminToken : adminKeyToken;
    const allowed = await graphql(METADATA, op.query, op.variables, credential);
    const allowedKind = refusalKind(allowed);
    add(
      `an Admin ${op.allowedWith === 'session' ? 'session' : 'API key'} CAN ${op.name}, so the refusal above is about permission`,
      allowedKind === 'allowed',
      allowedKind === 'allowed'
        ? 'the same call with the same arguments went through'
        : `refused as ${allowedKind}: ${gqlErrors(allowed).slice(0, 120)} -- the refusal above proves nothing`,
    );
    if (allowedKind === 'allowed' && op.cleanup) {
      // Reported and not assumed: the Admin half creates real privilege, and a
      // cleanup that quietly failed leaves it behind in the workspace.
      try {
        await op.cleanup(adminToken, allowed);
        add(`what the Admin half created to ${op.name} was removed again`, true, 'removed');
      } catch (error) {
        add(`what the Admin half created to ${op.name} was removed again`, false, String(error.message).slice(0, 160));
      }
    }
  }

  return results;
}

// What the team key must be able to do, measured through the same MCP surface a
// connected assistant uses. What it must not be able to do is
// probeEscalationRefusals, which only exists on GraphQL: an API key cannot
// reach those operations through MCP at all, which is itself part of the answer.
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

  return { results, recordId };
}

async function main() {
  const adminToken = await loginAsAdmin();
  const role = await ensureTeamRole(adminToken);
  console.log(`[INFO] role "${role.label}" (${role.id})`);
  const permissionChecks = checkRolePermissions(role);
  for (const check of permissionChecks) console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.name} -- ${check.detail}`);

  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { apiKeyId, token } = await mintApiKeyForRole(adminToken, {
    roleId: role.id,
    name: `CRM-007 team probe ${new Date().toISOString()}`,
    expiresAt,
  });
  console.log(`[INFO] minted API key ${apiKeyId} bound to that role (token length ${token.length}, expires ${expiresAt})`);

  // The Admin credential the falsifiability half needs. Minted here, revoked
  // below, never printed: without it a refusal cannot be told apart from an
  // operation that fails for everyone.
  const adminKey = await mintApiKeyForRole(adminToken, {
    roleId: await findAdminRoleId(adminToken),
    name: `CRM-007 Admin reference probe ${new Date().toISOString()}`,
    expiresAt,
  });
  console.log(`[INFO] minted the Admin reference API key ${adminKey.apiKeyId} (token length ${adminKey.token.length})`);

  const companyName = `AOS-CRM CRM-007 team-role probe ${Date.now()}`;
  const { results, recordId } = await probeTeamKeyPrivileges(token, { companyName });
  const refusals = await probeEscalationRefusals({
    teamToken: token,
    adminToken,
    adminKeyToken: adminKey.token,
    assignableRoleId: role.id,
  });
  const checks = [...permissionChecks, ...results, ...refusals];
  for (const r of [...results, ...refusals]) console.log(`${r.ok ? '[PASS]' : '[FAIL]'} ${r.name} -- ${r.detail}`);

  if (recordId) {
    const deleted = await mcpCall(
      'tools/call',
      { name: 'execute_tool', arguments: { toolName: 'delete_one_company', arguments: { id: recordId } } },
      { token },
    );
    console.log(`[INFO] the probe's own company record deleted by the team key (status ${deleted.status})`);
  }

  await revokeApiKey(adminToken, adminKey.apiKeyId);
  console.log('[INFO] the Admin reference API key was revoked');
  if (!process.argv.includes('--keep')) {
    await revokeApiKey(adminToken, apiKeyId);
    console.log('[INFO] the probe API key was revoked');
  }

  const failed = checks.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '[PASS]' : '[FAIL]'} team role: ${checks.length - failed.length}/${checks.length} checks passed`);
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
