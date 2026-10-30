// CRM-005 (R2): the REST and GraphQL authorization boundary of the local
// AOS-CRM stack, measured against the real containers over the real published
// loopback port.
//
// @e2e: REST and both GraphQL schemas refused without a credential and with a
// malformed one -> the CRM-007 least-privilege team role's API key doing real
// REST CRUD (create, read, update, soft delete) with every effect confirmed by
// psql inside this project's own PostgreSQL container -> the same key refused
// when it tries to destroy a record permanently, to mint an API key, to create
// a privileged role or to read the role list, each refusal checked against an
// Admin credential running the same call so it is the permission and not the
// request that was refused -> a real pending invitation for a synthetic address
// whose acceptance token (read straight out of core."appToken" and never
// printed) reaches neither an anonymous caller, nor the team key, nor a signup
// attempt made with the invited address -> the single-workspace boundary of
// this deployment, with the isolation this therefore cannot measure named out
// loud.
// @e2e-falla-si: stop the `server` container, widen the team role's switches,
// drop the settings guard on the invitation resolver, or let REST/GraphQL
// answer an unauthenticated call. Every assertion reads the published loopback
// port over a real HTTP connection and psql inside the db container; there is
// no double to pass instead.
//
// Requires the stack to be up (scripts/aos/local.ps1 -Action Start). It does
// not build the image and does not create the stack: if the services are not
// running, this fails closed and says so.
//
// Secrets: the administrator's credentials come from the ignored
// deploy/local/.env, this run's API keys are minted and revoked here, and the
// invitation token is read into memory to prove its absence from responses.
// None of them is ever printed, logged or asserted on by value -- failure
// messages carry booleans and fixed text, never a credential (CRM-005
// auth-preflight: assert.equal on a payload prints the ACTUAL value, and the
// only way these assertions fail is the case where that value is the secret).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, COMPOSE_PROJECT, DISTRO, PG_DB, PG_USER,
  REPO_ROOT, SERVER_URL, graphql, http,
} from '../mcp/lib.mjs';
import {
  findAdminRoleId, gqlErrors, loginAsAdmin, mintApiKeyForRole,
  probeEscalationRefusals, refusalKind, revokeApiKey, ensureTeamRole,
} from '../mcp/team-role.mjs';

const CORE = '/graphql';
const METADATA = '/metadata';
const HEALTH_TIMEOUT_MS = 180_000;
const RUN_MARKER = `aos-crm-api-authz-${randomUUID()}`;
// A synthetic address at a reserved TLD (RFC 2606): no real mailbox can exist
// for it. EMAIL_DRIVER defaults to LOGGER on this profile, so the invitation
// link is written to the server's own container log -- which is why nothing in
// this suite reads that log, and why the address can never be delivered to.
const INVITED_EMAIL = `marta.invitada.${randomUUID().slice(0, 8)}@aos-crm.invalid`;

let linuxRoot = null;
let adminToken = null;
let adminKeyToken = null;
let teamKeyToken = null;
let workspaceSchema = null;
let createdPersonId = null;
let invitationId = null;
const mintedApiKeyIds = [];
// Every response body this suite collected while probing for the invitation
// token. The leak assertion is made over all of them at once, so a token that
// escapes through any one of these answers fails the suite.
const collectedBodies = [];

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

// REST, not GraphQL: the same credential over the other public surface.
async function rest(path, { method = 'GET', token, body } = {}) {
  const res = await http(`/rest${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  collectedBodies.push(res.body);
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { /* a non-JSON refusal is still a refusal */ }
  return { status: res.status, body: parsed, raw: res.body };
}

async function gql(path, query, variables, token) {
  const answer = await graphql(path, query, variables, token);
  collectedBodies.push(JSON.stringify(answer));
  return answer;
}

before(async () => {
  const translated = wsl(['wslpath', '-a', resolve(REPO_ROOT)]);
  assert.equal(translated.status, 0, `could not reach WSL distro '${DISTRO}' to translate the repo path`);
  linuxRoot = translated.stdout.trim();
  assert.ok(linuxRoot.startsWith('/'), `wslpath returned something that is not a Linux path: ${linuxRoot}`);

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
  adminToken = await loginAsAdmin();
  assert.ok(adminToken, 'the administrator sign-in produced no token');

  const schemas = psql("select nspname from pg_namespace where nspname like 'workspace_%' order by nspname;")
    .split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(schemas.length, 1, `expected exactly one workspace schema in ${PG_DB}, found ${schemas.length}`);
  workspaceSchema = schemas[0];

  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const teamRole = await ensureTeamRole(adminToken);
  const teamKey = await mintApiKeyForRole(adminToken, {
    roleId: teamRole.id,
    name: `CRM-005 API authz team probe ${new Date().toISOString()}`,
    expiresAt,
  });
  mintedApiKeyIds.push(teamKey.apiKeyId);
  teamKeyToken = teamKey.token;

  // The Admin reference credential: without it, a refusal cannot be told apart
  // from an operation that fails for everyone. Revoked in after().
  const adminKey = await mintApiKeyForRole(adminToken, {
    roleId: await findAdminRoleId(adminToken),
    name: `CRM-005 API authz Admin reference ${new Date().toISOString()}`,
    expiresAt,
  });
  mintedApiKeyIds.push(adminKey.apiKeyId);
  adminKeyToken = adminKey.token;
});

after(async () => {
  // Permanent removal of this run's own record, with the administrator's
  // session: the team key deliberately cannot destroy, so a soft-deleted probe
  // record would otherwise stay in the workspace.
  if (createdPersonId !== null && adminToken !== null) {
    try {
      await graphql(CORE, 'mutation($id: UUID!) { destroyPerson(id: $id) { id } }', { id: createdPersonId }, adminToken);
    } catch { /* reported by the assertions above */ }
  }
  if (invitationId !== null && adminToken !== null) {
    try {
      await graphql(METADATA, 'mutation($appTokenId: String!) { deleteWorkspaceInvitation(appTokenId: $appTokenId) }',
        { appTokenId: invitationId }, adminToken);
    } catch { /* reported by the assertions above */ }
  }
  for (const apiKeyId of mintedApiKeyIds) {
    try { await revokeApiKey(adminToken, apiKeyId); } catch { /* best effort */ }
  }
});

test('REST refuses an anonymous call, and a malformed credential, on read AND on write', async () => {
  // Measured on this deployment, 2026-10-29: no credential at all is 401, a
  // malformed bearer is 403. Both are refusals by the deployment, which is what
  // this asserts -- pinning one code would make the suite fail on a change that
  // is not a weakening, and pinning "any 4xx" would accept a 404 that hid a
  // route rather than refusing it.
  const REFUSALS = [401, 403];
  for (const [name, call] of [
    ['GET /rest/companies', () => rest('/companies')],
    ['POST /rest/people', () => rest('/people', { method: 'POST', body: { name: { firstName: RUN_MARKER, lastName: 'Anonima' } } })],
    ['GET /rest/companies with a malformed bearer', () => rest('/companies', { token: randomBytes(24).toString('base64url') })],
  ]) {
    const res = await call();
    assert.ok(REFUSALS.includes(res.status), `${name} answered ${res.status} without a valid credential`);
    // A refusal that still carried records would be a leak.
    assert.equal(res.body?.data ?? null, null, `${name} returned a data payload with its ${res.status}`);
  }
  // And nothing was written by the refused POST.
  const written = Number(psql(`select count(*) from "${workspaceSchema}".person where "nameFirstName" = '${RUN_MARKER}'`));
  assert.equal(written, 0, 'the anonymous REST write was refused but a row was created anyway');
});

test('both GraphQL schemas refuse an anonymous call without leaking records', async () => {
  const core = await gql(CORE, '{ companies { edges { node { id name } } } }', {});
  assert.ok(core.errors, 'the core GraphQL schema answered an anonymous records query without an error');
  assert.equal(core.data?.companies ?? null, null, 'the anonymous core query came back with companies');
  assert.match(gqlErrors(core), /Unauthenticated|Authentication|Unauthorized|token/i,
    `expected an authentication refusal, got: ${gqlErrors(core).slice(0, 200)}`);

  const metadata = await gql(METADATA, '{ currentUser { id email } }', {});
  assert.ok(metadata.errors, 'the metadata GraphQL schema answered an anonymous currentUser query without an error');
  assert.equal(metadata.data?.currentUser ?? null, null, 'the anonymous metadata query came back with a user');
});

test('the least-privilege team key does real REST CRUD, and every effect is visible in this project own PostgreSQL', async () => {
  const created = await rest('/people', {
    method: 'POST',
    token: teamKeyToken,
    body: { name: { firstName: RUN_MARKER, lastName: 'Ensayo' }, jobTitle: 'Ensayo de API' },
  });
  assert.equal(created.status, 201, `REST create answered ${created.status}: ${created.raw.slice(0, 200)}`);
  createdPersonId = created.body?.data?.createPerson?.id ?? null;
  assert.ok(createdPersonId, `REST create returned no record id: ${created.raw.slice(0, 200)}`);

  const rows = Number(psql(`select count(*) from "${workspaceSchema}".person where id = '${createdPersonId}'`));
  assert.equal(rows, 1, 'the REST create answered 201 but no row exists in the workspace schema');

  const read = await rest(`/people/${createdPersonId}`, { token: teamKeyToken });
  assert.equal(read.status, 200, `REST read answered ${read.status}`);
  assert.ok(read.raw.includes(createdPersonId), 'the REST read did not return the record it was asked for');

  const updated = await rest(`/people/${createdPersonId}`, {
    method: 'PATCH',
    token: teamKeyToken,
    body: { jobTitle: 'Ensayo de API actualizado' },
  });
  assert.equal(updated.status, 200, `REST update answered ${updated.status}: ${updated.raw.slice(0, 200)}`);
  assert.equal(psql(`select "jobTitle" from "${workspaceSchema}".person where id = '${createdPersonId}'`), 'Ensayo de API actualizado',
    'the REST update answered 200 but the row still carries the old value');

  // MEASURED, and not what the role's switches suggest: DELETE /rest/people/<id>
  // is refused for this role with PERMISSION_DENIED even though it carries
  // canSoftDeleteAllObjectRecords: true. The ORM maps the 'delete' operation to
  // canDestroyObjectRecords (is-object-operation-permitted.util.ts), which this
  // role deliberately does not have, so the REST route needs the permanent-purge
  // privilege. The soft delete this role CAN do is the record API's own
  // deleteOne, asserted right after -- see docs/aos/bootstrap/SECURITY_AUDIT.md.
  const restDelete = await rest(`/people/${createdPersonId}`, { method: 'DELETE', token: teamKeyToken });
  assert.equal(refusalKind({ errors: [{ message: restDelete.body?.messages?.[0], extensions: { code: 'FORBIDDEN', subCode: restDelete.body?.code } }] }), 'permission',
    `REST delete answered ${restDelete.status} (${restDelete.raw.slice(0, 160)}): expected the permission refusal this role's switches imply for a permanent delete`);
  assert.equal(psql(`select "deletedAt" is null from "${workspaceSchema}".person where id = '${createdPersonId}'`), 't',
    'the refused REST delete still touched the row');

  const softDeleted = await gql(CORE, 'mutation($id: UUID!) { deletePerson(id: $id) { id deletedAt } }', { id: createdPersonId }, teamKeyToken);
  assert.equal(refusalKind(softDeleted), 'allowed',
    `the team key could not soft delete through the record API: ${gqlErrors(softDeleted).slice(0, 160)}`);
  assert.equal(psql(`select "deletedAt" is not null from "${workspaceSchema}".person where id = '${createdPersonId}'`), 't',
    'the soft delete answered without an error but the row is not soft deleted');
});

test('the team key cannot destroy a record permanently, and an Admin key can: the refusal is about permission', async () => {
  assert.ok(createdPersonId, 'no record to destroy: the CRUD step did not complete');
  const refused = await gql(CORE, 'mutation($id: UUID!) { destroyPerson(id: $id) { id } }', { id: createdPersonId }, teamKeyToken);
  const kind = refusalKind(refused);
  assert.equal(kind, 'permission',
    `expected canDestroyAllObjectRecords:false to refuse the permanent destroy, got ${kind}: ${gqlErrors(refused).slice(0, 160)}`);
  assert.equal(psql(`select count(*) from "${workspaceSchema}".person where id = '${createdPersonId}'`), '1',
    'the destroy was refused but the row is gone');

  const allowed = await gql(CORE, 'mutation($id: UUID!) { destroyPerson(id: $id) { id } }', { id: createdPersonId }, adminKeyToken);
  assert.equal(refusalKind(allowed), 'allowed',
    `an Admin key could not destroy the same record either, so the refusal above proves nothing: ${gqlErrors(allowed).slice(0, 160)}`);
  assert.equal(psql(`select count(*) from "${workspaceSchema}".person where id = '${createdPersonId}'`), '0',
    'the Admin destroy answered without an error but the row is still there');
  createdPersonId = null;
});

test('the team key is refused on every administration operation, each against an Admin credential running the same call', async () => {
  const teamRole = await ensureTeamRole(adminToken);
  const results = await probeEscalationRefusals({
    teamToken: teamKeyToken,
    adminToken,
    adminKeyToken,
    assignableRoleId: teamRole.id,
  });
  assert.ok(results.length >= 6, `expected both halves of every escalation probe, got ${results.length} checks`);
  const failed = results.filter((r) => !r.ok);
  assert.deepEqual(failed.map((r) => `${r.name} -- ${r.detail}`), [],
    `${failed.length} of ${results.length} escalation checks failed`);
});

test('a pending invitation acceptance token reaches no unauthorized caller', async () => {
  const sent = await gql(
    METADATA,
    'mutation($emails: [String!]!) { sendInvitations(emails: $emails) { success result { id email } errors } }',
    { emails: [INVITED_EMAIL] },
    adminToken,
  );
  assert.equal(sent.errors, undefined, `the administrator could not create the invitation: ${gqlErrors(sent)}`);
  assert.equal(sent.data.sendInvitations.success, true, 'sendInvitations reported no success');
  invitationId = sent.data.sendInvitations.result?.[0]?.id ?? null;
  assert.ok(invitationId, 'sendInvitations returned no invitation id');

  // The acceptance credential itself, read straight out of the table that
  // stores it (plaintext, 32 random bytes hex -- see
  // workspace-invitation.service.ts). Held in memory only: it is never printed
  // and never compared with assert.equal, because a failing assert prints the
  // actual value.
  const invitationToken = psql(
    `select value from core."appToken" where type = 'INVITATION_TOKEN' and context->>'email' = '${INVITED_EMAIL}' and "deletedAt" is null`,
  );
  assert.equal(invitationToken.length, 64, 'the invitation token was not stored as expected, so the leak check below would prove nothing');

  // 1. Anonymous: the invitation list is behind authentication.
  const anonymous = await gql(METADATA, '{ findWorkspaceInvitations { id email } }', {});
  assert.ok(anonymous.errors, 'the invitation list answered an anonymous caller');
  assert.equal(anonymous.data?.findWorkspaceInvitations ?? null, null, 'the anonymous caller received invitations');

  // 2. The team key: authenticated, but without the workspace-members setting.
  const withTeamKey = await gql(METADATA, '{ findWorkspaceInvitations { id email } }', {}, teamKeyToken);
  const listKind = refusalKind(withTeamKey);
  assert.ok(['permission', 'principal'].includes(listKind),
    `the team key was not refused the invitation list by this deployment (${listKind}): ${gqlErrors(withTeamKey).slice(0, 160)}`);

  // 3. The team key cannot create invitations either.
  const teamKeySend = await gql(
    METADATA,
    'mutation($emails: [String!]!) { sendInvitations(emails: $emails) { success } }',
    { emails: [`intruso.${randomUUID().slice(0, 8)}@aos-crm.invalid`] },
    teamKeyToken,
  );
  const sendKind = refusalKind(teamKeySend);
  assert.ok(['permission', 'principal'].includes(sendKind),
    `the team key was not refused invitation sending by this deployment (${sendKind}): ${gqlErrors(teamKeySend).slice(0, 160)}`);

  // 4. The exposure the CRM-005 auth preflight pointed at -- the sign-up answer
  // handing personalInviteToken to an identity that merely CLAIMS the invited
  // address -- is NOT probed here any more, and that is a deliberate move, not
  // an omission. CRM-005 could assert it was refused because public
  // registration was closed; on the beta profile that same sign-up SUCCEEDS
  // (sign-in-up.service.ts allows an address with a pending invitation), so the
  // probe now has to create a real claimer identity, which has no business
  // existing in the founder's own deployment. It lives in
  // scripts/aos/test/crm-isolation-e2e.test.mjs, which runs it against a
  // synthetic workspace, prints the measured limit and deletes the identity it
  // created. The MEASURED outcome (2026-10-30): the token IS handed over and
  // redeeming it joins the workspace -- see .aos/reports/CRM-014.md and the
  // mitigation in docs/aos/product/BETA_RUNBOOK.md.
  //
  // What this suite keeps is the half that is about unauthorized CALLERS rather
  // than about the invited address itself.

  // The leak assertion, over every body this suite collected: presence as a
  // boolean with a fixed message, so a failure cannot print the token.
  const bodiesCarryingTheToken = collectedBodies.filter((body) => body.includes(invitationToken)).length;
  assert.equal(bodiesCarryingTheToken, 0,
    'the pending invitation acceptance token appeared in a response to an unauthorized caller (not printed)');
});

test('opening a workspace is closed to everything except an operator session (and cross-workspace isolation is measured elsewhere)', async () => {
  // CRM-014 put this deployment on the beta profile, so a second workspace CAN
  // exist -- what stays closed is who may open one. This suite keeps the half
  // it can measure with the credentials it already holds and leaves the
  // boundary between two workspaces to scripts/aos/test/crm-isolation-e2e.test.mjs,
  // which opens, probes and destroys its own synthetic pair.
  const before = psql('select count(*) from core.workspace');
  assert.equal(before, '1',
    `this local deployment holds ${before} workspaces instead of the founder's one: a synthetic workspace from an interrupted isolation run was left behind`);

  // An API key is not a person: signUpInNewWorkspace only accepts a user
  // session (auth.resolver.ts AuthPrincipalGuard apiKey:false), so even an
  // Admin-role key cannot open one.
  for (const [name, token] of [['the Admin API key', adminKeyToken], ['the team API key', teamKeyToken]]) {
    const refused = await gql(
      METADATA,
      'mutation($input: SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input: $input) { workspace { id } } }',
      { input: { displayName: `AOS-CRM ${RUN_MARKER}` } },
      token,
    );
    assert.ok(refused.errors, `${name} opened a workspace`);
    assert.equal((refused.data?.signUpInNewWorkspace ?? null) !== null, false,
      `${name} received a workspace payload from a refused call`);
  }

  // And registration itself stays closed: a brand-new address with no pending
  // invitation cannot sign itself up
  // (IS_WORKSPACE_CREATION_LIMITED_TO_SERVER_ADMINS, sign-in-up.service.ts
  // assertSignUpWithoutWorkspaceAllowed).
  const stranger = await gql(
    METADATA,
    'mutation($email: String!, $password: String!) { signUp(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    { email: `extrano.${randomUUID().slice(0, 8)}@aos-crm.invalid`, password: randomBytes(24).toString('base64url') },
  );
  assert.ok(stranger.errors, 'a public sign-up without an invitation succeeded');
  assert.equal((stranger.data?.signUp ?? null) !== null, false,
    'the refused sign-up still returned a payload (not printed: it would carry tokens)');

  assert.equal(psql('select count(*) from core.workspace'), before, 'a refused call still created a workspace');
});
