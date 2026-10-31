// CRM-016 (R1/R2/R3): the self-service sign-up the operator hands out by
// e-mail, measured against the real containers over the real published
// loopback port, on the same beta profile the AWS beta runs.
//
// @e2e: the operator (the only server admin) creates a sign-up invitation from
// the admin-panel API -> the link is read out of the WORKER's log, where the
// LOGGER e-mail driver puts it, and its token is PROVEN to be the one stored by
// matching its sha256 against core."appToken".value -> a synthetic friend signs
// up with that link and opens exactly one workspace, choosing its name and
// subdomain, and lands in it as its admin -> the operator is not a member of it
// and the founder's workspace is untouched -> the same link is then refused a
// second time, refused for a different address, refused once aged past its
// expiry and refused once revoked -> and a sign-up by an address that merely
// HAS a pending JOIN invitation, without its link, is handed no invitation
// token (CRM-014 §4.1) -> everything synthetic is removed: the friend, their
// workspace with its data schema, and every appToken row this run created.
// @e2e-falla-si: drop the token from the sign-up path (the friend is refused at
// the first step), stop consuming it inside the workspace transaction (the
// reuse assertion fails), stop hashing it (the log/stored-hash assertion
// fails), or hand personalInviteToken back to an unverified address (the §4.1
// assertion fails). Everything asserted here comes from a real HTTP connection
// to the published loopback port, from the worker's own log and from psql
// inside this project's db container; there is no double to pass instead.
//
// Requires the stack to be up on the beta profile (scripts/aos/local.ps1
// -Action Start). It does not build the image and does not create the stack: if
// the services are not running, this fails closed and says so.
//
// Secrets: the operator's credentials come from the ignored deploy/local/.env;
// the synthetic friend's password is generated in process with crypto
// randomness and never printed; the invitation token is read out of the worker
// log into memory and only ever reported as a length or a boolean.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, WEB_PORT,
  compose, exchangeLoginToken, founderWorkspaceOrigin, graphql, http,
  loginWithOrigin, psql,
} from '../mcp/lib.mjs';
import { findAdminRoleId, gqlErrors, mintApiKeyForRole, revokeApiKey } from '../mcp/team-role.mjs';

const ADMIN_PANEL = '/admin-panel';
const METADATA = '/metadata';
const CORE = '/graphql';
const HEALTH_TIMEOUT_MS = 180_000;
const SETUP_TIMEOUT_MS = 300_000;
// Opening a workspace and activating it provision a data schema with every
// standard object in it, and the socket is idle while the server does that
// work. Measured in CRM-014 on this host: ~50 s per workspace, which blows
// past lib.mjs's 60 s inactivity deadline when the host is busy.
const PROVISIONING_TIMEOUT_MS = 300_000;
const DESTRUCTION_TIMEOUT_MS = 300_000;
const LOG_TIMEOUT_MS = 90_000;

// Unique per run: a subdomain is unique per deployment and an address must not
// collide with a leftover identity from an interrupted run.
const RUN = randomUUID().slice(0, 8);
// A reserved TLD (RFC 2606): no mailbox can exist for these, and this profile's
// EMAIL_DRIVER is LOGGER, so nothing leaves the host either.
const FRIEND_EMAIL = `amiga.alta.${RUN}@aos-crm.invalid`;
const OTHER_EMAIL = `otra.alta.${RUN}@aos-crm.invalid`;
const EXPIRED_EMAIL = `caducada.${RUN}@aos-crm.invalid`;
const REVOKED_EMAIL = `anulada.${RUN}@aos-crm.invalid`;
const JOIN_PROBE_EMAIL = `reclamo.alta.${RUN}@aos-crm.invalid`;
const SUBDOMAIN = `aos-alta-${RUN}`;

const INVITATION_FIELDS = 'id email status createdAt expiresAt consumedAt revokedAt';

let operatorToken = null;
let founderWorkspaceId = null;
let founderBaseline = null;
// Every appToken id this run brings into existence, so the teardown can remove
// exactly those rows and nothing else.
const createdInvitationIds = new Set();
const mintedKeys = [];
let friend = null;
let workspace = null;
// Read BEFORE the revocation: the case that matters is a link already sitting
// in somebody's inbox when the operator revokes it.
let revokedLink = null;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
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

async function adminPanel(query, variables) {
  return graphql(ADMIN_PANEL, query, variables, operatorToken);
}

async function createInvitation(email) {
  const created = await adminPanel(
    `mutation($email: String!, $locale: String) { createSignUpInvitation(email: $email, locale: $locale) { ${INVITATION_FIELDS} } }`,
    { email, locale: 'es-ES' },
  );
  assert.equal(created.errors, undefined, `the operator could not invite ${email}: ${gqlErrors(created)}`);
  const invitation = created.data.createSignUpInvitation;
  createdInvitationIds.add(invitation.id);

  return invitation;
}

function dataSchemaOf(workspaceId) {
  const name = `workspace_${BigInt(`0x${workspaceId.replace(/-/g, '')}`).toString(36)}`;
  assert.equal(psql(`select count(*) from pg_namespace where nspname = '${name}'`) !== '0', true,
    `the schema name derived for workspace ${workspaceId} (${name}) does not exist: the derivation no longer matches the server's`);

  return name;
}

// The plaintext token exists ONLY in the worker's log line: the database keeps a
// sha256 of it and the API never returns it. It is the WORKER's log and not the
// server's -- EmailService.send enqueues a job and the worker runs the LOGGER
// driver -- which is the single most important detail of this step for whoever
// follows the runbook. Read with --tail and not --since: on this host
// `docker compose logs --since <duration>` came back empty for lines seconds
// old (CRM-014), which would read as "the mail never went out".
async function readInvitationLinkFromWorkerLog(invitationId) {
  const expectedHash = psql(
    `select value from core."appToken" where id = '${invitationId}'`,
  );
  assert.equal(expectedHash.length, 64,
    'the invitation is not stored as a 64-character digest, so the link below would prove nothing');

  const deadline = Date.now() + LOG_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const logs = compose(['logs', '--no-log-prefix', '--tail', '6000', 'worker']);
    assert.equal(logs.status, 0, `docker compose logs worker exited ${logs.status}`);
    // Every candidate in the log, then the ONE whose hash is this invitation's:
    // older runs leave their own links behind, and guessing by recency would
    // make this assertion about ordering instead of about identity.
    const links = [...(logs.stdout || '').matchAll(
      /https?:\/\/[^\s"'<>]*\/welcome\?signUpInvitationToken=([0-9a-f]{64})(?:&amp;|&)email=([^\s"'<>&]+)/g,
    )];
    const match = links.find(([, token]) => sha256Hex(token) === expectedHash);

    if (match) {
      return { link: match[0], token: match[1], email: decodeURIComponent(match[2]), matchCount: links.length };
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error(`no link whose token hashes to this invitation's stored digest appeared in the worker log within ${LOG_TIMEOUT_MS}ms`);
}

async function signUpWithInvitation(email, password, signUpInvitationToken) {
  return graphql(
    METADATA,
    'mutation($email: String!, $password: String!, $token: String) {' +
      ' signUp(email: $email, password: $password, signUpInvitationToken: $token) {' +
      ' tokens { accessOrWorkspaceAgnosticToken { token } }' +
      ' availableWorkspaces { availableWorkspacesForSignUp { id personalInviteToken inviteHash } } } }',
    { email, password, token: signUpInvitationToken },
  );
}

async function destroySyntheticWorkspace() {
  if (friend !== null) {
    // The synthetic USER first, while it still has a session: a user row is
    // server-level, so destroying the workspace would leave it behind forever
    // and nobody could delete it afterwards (user.resolver.ts deleteUser is
    // self-only, and this password exists only in this process's memory).
    const removed = await graphql(METADATA, 'mutation { deleteUser { id } }', {}, friend.token);
    if (removed.errors) console.error(`[CLEANUP] the synthetic friend survived: ${gqlErrors(removed)}`);
    friend = null;
  }

  if (workspace === null) return true;

  // With its own API KEY and not a user session: by this point the friend is
  // gone and an API key belongs to the workspace itself.
  const deleted = await graphql(METADATA, 'mutation { deleteCurrentWorkspace { id deletedAt } }', {}, workspace.apiKeyToken);
  if (deleted.errors && !/not found|suspended|deleted/i.test(gqlErrors(deleted))) {
    throw new Error(`deleteCurrentWorkspace failed: ${gqlErrors(deleted)}`);
  }

  // deleteCurrentWorkspace SOFT deletes: the row, the schema and every record
  // stay until the destruction job runs, so the effect is waited for in the
  // database instead of trusted from an exit code.
  const destroyed = compose([
    'exec', '-T', 'server', 'yarn', 'command:prod', 'workspace:clean',
    '--workspace-id', workspace.id, '--only-operation', 'destroy', '--ignore-destroy-grace-period',
  ]);
  if (destroyed.status !== 0) {
    throw new Error(`workspace:clean exited ${destroyed.status}: ${(destroyed.stderr || '').slice(-400)}`);
  }

  const deadline = Date.now() + DESTRUCTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rowGone = psql(`select count(*) from core.workspace where id = '${workspace.id}'`) === '0';
    const schemaGone = psql(`select count(*) from pg_namespace where nspname = '${workspace.schema}'`) === '0';
    if (rowGone && schemaGone) {
      workspace = null;
      return true;
    }
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

  operatorToken = await loginWithOrigin(ADMIN_EMAIL, ADMIN_PASSWORD, founderWorkspaceOrigin());
  founderWorkspaceId = psql('select id from core.workspace order by "createdAt" asc limit 1');
  const schema = dataSchemaOf(founderWorkspaceId);
  founderBaseline = {
    schema,
    companies: psql(`select count(*) from ${schema}.company`),
    people: psql(`select count(*) from ${schema}.person`),
    members: psql(`select count(*) from core."userWorkspace" where "workspaceId" = '${founderWorkspaceId}'`),
  };

  assert.equal(psql(`select "canAccessFullAdminPanel" from core."user" where email = '${ADMIN_EMAIL}'`), 't',
    'the operator is not a server admin on this deployment, so no invitation can be issued here');
}, { timeout: SETUP_TIMEOUT_MS });

after(async () => {
  for (const key of mintedKeys) {
    try { await revokeApiKey(key.operatorToken, key.apiKeyId); } catch { /* the workspace is about to be destroyed anyway */ }
  }

  try {
    const gone = await destroySyntheticWorkspace();
    if (!gone) console.error('[CLEANUP] the synthetic workspace was still in the database when this run ended');
  } catch (error) {
    console.error(`[CLEANUP] ${error.message}`);
  }

  // The invitation rows belong to no workspace, so destroying the workspace
  // does not take them with it. Only the ids THIS run created, never by type or
  // by age: the founder's own invitations must survive a test run.
  for (const id of createdInvitationIds) {
    try {
      psql(`delete from core."appToken" where id = '${id}' and type = 'SIGN_UP_INVITATION_TOKEN'`);
    } catch (error) {
      console.error(`[CLEANUP] invitation ${id} survived: ${error.message}`);
    }
  }

  const leftovers = psql(
    `select count(*) from core."appToken" where type = 'SIGN_UP_INVITATION_TOKEN' and context->>'email' like '%${RUN}@aos-crm.invalid'`,
  );
  if (leftovers !== '0') console.error(`[CLEANUP] ${leftovers} synthetic invitation row(s) survived`);

  const orphans = psql(
    `select count(*) from core."user" where email like '%${RUN}@aos-crm.invalid' and "deletedAt" is null`,
  );
  if (orphans !== '0') console.error(`[CLEANUP] ${orphans} synthetic identity(ies) survived`);
});

test('R1: the operator creates, lists and revokes a sign-up invitation, and the token is stored only as a hash', async () => {
  const invitation = await createInvitation(FRIEND_EMAIL);

  assert.equal(invitation.email, FRIEND_EMAIL);
  assert.equal(invitation.status, 'Pending');
  assert.equal(invitation.consumedAt, null);
  assert.equal(invitation.revokedAt, null);

  // Seven days by default, not "some expiry": that is the contract R1 states.
  const days = (new Date(invitation.expiresAt) - new Date(invitation.createdAt)) / 86_400_000;
  assert.ok(Math.abs(days - 7) < 0.01, `the invitation expires in ${days} days instead of 7`);

  const listed = await adminPanel(`query { getSignUpInvitations { ${INVITATION_FIELDS} } }`, {});
  assert.equal(listed.errors, undefined, `listing the invitations failed: ${gqlErrors(listed)}`);
  const mine = listed.data.getSignUpInvitations.filter((row) => row.email === FRIEND_EMAIL);
  assert.equal(mine.length, 1, `the list carries ${mine.length} rows for this address instead of one`);
  assert.equal(mine[0].status, 'Pending');

  // The API never returns the token, under any name: a field that leaked it
  // would make the e-mail's single-use link readable by anyone who can list.
  const serialized = JSON.stringify(listed.data.getSignUpInvitations);
  assert.equal(/[0-9a-f]{64}/.test(serialized), false, 'the invitation listing carries a 64-character digest');

  const stored = psql(`select value from core."appToken" where id = '${invitation.id}'`);
  assert.equal(stored.length, 64, 'the stored invitation value is not a sha256 digest');
  assert.equal(psql(`select "workspaceId" is null and "userId" is null from core."appToken" where id = '${invitation.id}'`), 't',
    'the sign-up invitation is bound to a workspace or a user, which it must not be before it is redeemed');

  // A second live invitation for the same address is refused, so the operator
  // cannot accidentally leave two valid links out in the world.
  const duplicate = await adminPanel(
    `mutation($email: String!) { createSignUpInvitation(email: $email) { id } }`,
    { email: FRIEND_EMAIL },
  );
  assert.ok(duplicate.errors, 'a second live invitation for the same address was created');

  // Revocation measured on its own invitation, so the one under test stays live.
  const toRevoke = await createInvitation(REVOKED_EMAIL);
  revokedLink = await readInvitationLinkFromWorkerLog(toRevoke.id);
  const revoked = await adminPanel(
    `mutation($id: UUID!) { revokeSignUpInvitation(id: $id) { ${INVITATION_FIELDS} } }`,
    { id: toRevoke.id },
  );
  assert.equal(revoked.errors, undefined, `revoking failed: ${gqlErrors(revoked)}`);
  assert.equal(revoked.data.revokeSignUpInvitation.status, 'Revoked');
  assert.notEqual(revoked.data.revokeSignUpInvitation.revokedAt, null);
});

test('R2: the invitation e-mail reaches the worker log with exactly one link for that address, whose token matches the stored hash', async () => {
  const invitation = (await adminPanel(
    `query { getSignUpInvitations { ${INVITATION_FIELDS} } }`, {},
  )).data.getSignUpInvitations.find((row) => row.email === FRIEND_EMAIL);
  assert.ok(invitation, 'the invitation under test is gone');

  const found = await readInvitationLinkFromWorkerLog(invitation.id);

  assert.equal(found.email, FRIEND_EMAIL,
    'the link in the log carries a different address than the invitation it hashes to');
  assert.equal(found.token.length, 64, 'the token in the link is not the shape this flow mints');

  // The default subdomain, on the published port: the invited person has no
  // workspace yet, so any workspace host in that link would be a dead end.
  const url = new URL(found.link);
  assert.equal(url.pathname, '/welcome', `the link points at ${url.pathname} instead of the sign-up screen`);
  assert.equal(url.port, String(WEB_PORT), `the link points at port ${url.port} instead of the published ${WEB_PORT}`);
  assert.equal(url.hostname.split('.')[0], 'app',
    `the link points at the host ${url.hostname}, which is not the default subdomain`);

  // Resending rotates the token: after it, the link above is dead and exactly
  // one link for this address is live.
  const resent = await adminPanel(
    `mutation($id: UUID!, $locale: String) { resendSignUpInvitation(id: $id, locale: $locale) { ${INVITATION_FIELDS} } }`,
    { id: invitation.id, locale: 'en' },
  );
  assert.equal(resent.errors, undefined, `resending failed: ${gqlErrors(resent)}`);
  assert.equal(resent.data.resendSignUpInvitation.id, invitation.id,
    'the resend created a second invitation instead of rotating this one');
  assert.notEqual(psql(`select value from core."appToken" where id = '${invitation.id}'`), sha256Hex(found.token),
    'the resend left the first token live');

  const rotated = await readInvitationLinkFromWorkerLog(invitation.id);
  assert.notEqual(rotated.token, found.token, 'the resent link carries the same token as the first one');

  friend = { email: FRIEND_EMAIL, password: randomBytes(36).toString('base64url'), token: null, invitationToken: rotated.token, invitationId: invitation.id };
});

test('R3: with the link, the invited address signs up, opens one workspace of its own and becomes its admin; the operator is not a member', async () => {
  assert.ok(friend?.invitationToken, 'the invitation link was never read, so there is nothing to redeem');

  const signedUp = await signUpWithInvitation(friend.email, friend.password, friend.invitationToken);
  assert.equal(signedUp.errors, undefined, `the invited address could not sign up: ${gqlErrors(signedUp)}`);
  const agnosticToken = signedUp.data.signUp.tokens.accessOrWorkspaceAgnosticToken.token;
  assert.ok(agnosticToken.length > 0, 'the sign-up returned no workspace-agnostic token');

  // The invitation is not spent yet: it is spent by the workspace it opens.
  assert.equal(psql(`select "revokedAt" is null from core."appToken" where id = '${friend.invitationId}'`), 't',
    'the invitation was consumed by the sign-up alone, before any workspace existed');
  assert.equal(psql(`select "canAccessFullAdminPanel" from core."user" where email = '${friend.email}'`), 'f',
    'the invited address was granted server-admin access, which an invitation must never do');

  const created = await graphql(
    METADATA,
    'mutation($input: SignUpInNewWorkspaceInput) {' +
      ' signUpInNewWorkspace(input: $input) { loginToken { token } workspace { id workspaceUrls { subdomainUrl } } } }',
    { input: { displayName: `AOS-CRM alta ${RUN}`, subdomain: SUBDOMAIN, signUpInvitationToken: friend.invitationToken } },
    agnosticToken,
    { timeoutMs: PROVISIONING_TIMEOUT_MS },
  );
  assert.equal(created.errors, undefined, `the invited address could not open its workspace: ${gqlErrors(created)}`);

  const opened = created.data.signUpInNewWorkspace.workspace;
  const url = new URL(opened.workspaceUrls.subdomainUrl);
  assert.equal(url.hostname.split('.')[0], SUBDOMAIN,
    `the server put the workspace on ${url.hostname}, which is not the subdomain the person asked for`);

  workspace = { id: opened.id, origin: url.origin, subdomain: SUBDOMAIN };

  const pendingToken = await exchangeLoginToken(created.data.signUpInNewWorkspace.loginToken.token, workspace.origin);
  const activated = await graphql(METADATA, 'mutation { activateWorkspace(data: {}) { id activationStatus } }', {}, pendingToken,
    { timeoutMs: PROVISIONING_TIMEOUT_MS });
  assert.equal(activated.errors, undefined, `activating the new workspace failed: ${gqlErrors(activated)}`);
  assert.equal(activated.data.activateWorkspace.activationStatus, 'ACTIVE');

  workspace.schema = dataSchemaOf(workspace.id);
  friend.token = await loginWithOrigin(friend.email, friend.password, workspace.origin);

  // The invitation is spent, and the row says BY WHOM.
  assert.equal(psql(`select context->>'consumedAt' is not null from core."appToken" where id = '${friend.invitationId}'`), 't',
    'the invitation was not consumed by the workspace it opened');
  assert.equal(
    psql(`select context->>'consumedByUserId' = (select id::text from core."user" where email = '${friend.email}') from core."appToken" where id = '${friend.invitationId}'`),
    't',
    'the invitation records a different redeemer than the person who used it');

  const listedAfter = await adminPanel(`query { getSignUpInvitations { ${INVITATION_FIELDS} } }`, {});
  const row = listedAfter.data.getSignUpInvitations.find((entry) => entry.id === friend.invitationId);
  assert.equal(row.status, 'Used', `the operator's list shows the redeemed invitation as ${row.status}`);
  assert.notEqual(row.consumedAt, null, 'the redeemed invitation carries no consumption date');

  // Exactly one member, and it is not the operator.
  assert.equal(psql(`select count(*) from core."userWorkspace" where "workspaceId" = '${workspace.id}'`), '1',
    'the new workspace has a number of members other than one');
  assert.equal(
    psql(`select count(*) from core."userWorkspace" uw join core."user" u on u.id = uw."userId" where uw."workspaceId" = '${workspace.id}' and lower(u.email) = lower('${ADMIN_EMAIL}')`),
    '0',
    'the operator is a member of the workspace the invited person opened');

  // Admin of their own workspace, measured by doing something only an admin
  // can: minting an ADMIN-role API key for it. That key is also what the
  // teardown uses to destroy the workspace after the friend is gone.
  const adminRoleId = await findAdminRoleId(friend.token);
  const key = await mintApiKeyForRole(friend.token, {
    roleId: adminRoleId,
    name: `CRM-016 alta ${RUN}`,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  mintedKeys.push({ operatorToken: friend.token, apiKeyId: key.apiKeyId });
  workspace.apiKeyToken = key.token;

  // Their own data lands in their own schema, and nowhere near the founder's.
  const company = await graphql(
    CORE,
    'mutation($name: String!) { createCompany(data: { name: $name }) { id name } }',
    { name: `AOS-CRM alta ${RUN} empresa` },
    friend.token,
  );
  assert.equal(company.errors, undefined, `the new admin could not create a record: ${gqlErrors(company)}`);
  assert.equal(psql(`select count(*) from ${workspace.schema}.company where id = '${company.data.createCompany.id}'`), '1',
    "the record the new admin created is not in their own workspace's data schema");
  assert.equal(psql(`select count(*) from ${founderBaseline.schema}.company where name like '%${RUN}%'`), '0',
    "this run's synthetic marker reached the founder's workspace");
});

test('R3: the same link is refused a second time, for another address, once expired and once revoked', async () => {
  assert.ok(friend?.invitationToken, 'there is no redeemed link to replay');

  // 1. Replayed by the same person who already spent it.
  const workspacesBefore = psql('select count(*) from core.workspace');
  const replayed = await graphql(
    METADATA,
    'mutation($input: SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input: $input) { workspace { id } } }',
    { input: { displayName: `AOS-CRM segunda ${RUN}`, subdomain: `${SUBDOMAIN}-dos`, signUpInvitationToken: friend.invitationToken } },
    friend.token,
  );
  assert.ok(replayed.errors, 'a spent invitation opened a second workspace');
  assert.equal(psql('select count(*) from core.workspace'), workspacesBefore,
    'the refused replay still created a workspace');

  // 2. Presented by a different address.
  const otherInvitation = await createInvitation(OTHER_EMAIL);
  const otherLink = await readInvitationLinkFromWorkerLog(otherInvitation.id);
  const usersBefore = psql('select count(*) from core."user"');
  const wrongAddress = await signUpWithInvitation(
    `impostora.${RUN}@aos-crm.invalid`,
    randomBytes(36).toString('base64url'),
    otherLink.token,
  );
  assert.ok(wrongAddress.errors, "an invitation addressed to one mailbox let a different address sign up");
  assert.equal((wrongAddress.data?.signUp ?? null) !== null, false,
    'the refused sign-up still returned a payload (not printed: it would carry tokens)');
  assert.equal(psql('select count(*) from core."user"'), usersBefore,
    'the refused sign-up still created an identity');

  // 3. Aged past its expiry. The clock is the only thing moved, in the
  //    database, because waiting seven days is not a test.
  const expiredInvitation = await createInvitation(EXPIRED_EMAIL);
  const expiredLink = await readInvitationLinkFromWorkerLog(expiredInvitation.id);
  psql(`update core."appToken" set "expiresAt" = now() - interval '1 minute' where id = '${expiredInvitation.id}'`);
  const expired = await signUpWithInvitation(EXPIRED_EMAIL, randomBytes(36).toString('base64url'), expiredLink.token);
  assert.ok(expired.errors, 'an expired invitation let its address sign up');

  const listedExpired = await adminPanel(`query { getSignUpInvitations { ${INVITATION_FIELDS} } }`, {});
  assert.equal(
    listedExpired.data.getSignUpInvitations.find((row) => row.id === expiredInvitation.id).status,
    'Expired',
    "the operator's list does not show the aged invitation as expired");

  // 4. Revoked by the operator. Its link was e-mailed before the revocation,
  //    which is the case that matters: the link exists and must stop working.
  const revokedInvitation = (await adminPanel(`query { getSignUpInvitations { ${INVITATION_FIELDS} } }`, {}))
    .data.getSignUpInvitations.find((row) => row.email === REVOKED_EMAIL);
  assert.ok(revokedInvitation, 'the revoked invitation is gone');
  assert.equal(revokedInvitation.status, 'Revoked');

  assert.ok(revokedLink, 'the revoked invitation link was never read, so there is nothing to replay');
  const revokedUsersBefore = psql('select count(*) from core."user"');
  const afterRevocation = await signUpWithInvitation(REVOKED_EMAIL, randomBytes(36).toString('base64url'), revokedLink.token);
  assert.ok(afterRevocation.errors, 'a revoked invitation link still let its address sign up');
  assert.equal(psql('select count(*) from core."user"'), revokedUsersBefore,
    'the refused sign-up with a revoked link still created an identity');

  const resendRevoked = await adminPanel(
    `mutation($id: UUID!) { resendSignUpInvitation(id: $id) { id } }`,
    { id: revokedInvitation.id },
  );
  assert.ok(resendRevoked.errors, 'a revoked invitation was resent');

  // And a sign-up with no token at all is still closed to non-admins.
  const noToken = await signUpWithInvitation(`sin-token.${RUN}@aos-crm.invalid`, randomBytes(36).toString('base64url'), undefined);
  assert.ok(noToken.errors, 'a sign-up without an invitation succeeded on the beta profile');
});

test('CRM-014 §4.1: an address with a pending JOIN invitation, signing up without its link, is handed no invitation token', async () => {
  assert.ok(friend?.token, 'the synthetic workspace has no admin to invite from');

  const adminRoleId = await findAdminRoleId(friend.token);
  const invited = await graphql(
    METADATA,
    'mutation($emails: [String!]!, $roleId: UUID) { sendInvitations(emails: $emails, roleId: $roleId) { success errors } }',
    { emails: [JOIN_PROBE_EMAIL], roleId: adminRoleId },
    friend.token,
  );
  assert.equal(invited.errors, undefined, `the join invitation for the probe failed: ${gqlErrors(invited)}`);
  assert.equal(invited.data.sendInvitations.success, true,
    `sendInvitations reported no success: ${JSON.stringify(invited.data.sendInvitations.errors)}`);

  const joinToken = psql(
    `select value from core."appToken" where type = 'INVITATION_TOKEN' and "workspaceId" = '${workspace.id}' and context->>'email' = '${JOIN_PROBE_EMAIL}' and "deletedAt" is null`,
  );
  assert.equal(joinToken.length, 64, 'the join invitation is not in the shape this flow stores it in');

  // The whole payload the claimer receives. availableWorkspaces is not a root
  // query on this deployment: it travels inside the sign-up answer, which is
  // why it is read from there (CRM-014 §4.1).
  const probePassword = randomBytes(36).toString('base64url');
  const claimed = await signUpWithInvitation(JOIN_PROBE_EMAIL, probePassword, undefined);
  assert.equal(claimed.errors, undefined,
    `the claim probe could not sign up, so this assertion would measure nothing: ${gqlErrors(claimed)}`);

  const claimerToken = claimed.data.signUp.tokens.accessOrWorkspaceAgnosticToken.token;
  try {
    const offered = claimed.data.signUp.availableWorkspaces.availableWorkspacesForSignUp;
    const forWorkspace = offered.find((entry) => entry.id === workspace.id);
    assert.ok(forWorkspace, 'the probe was not offered the workspace it was invited to, so the leak path is not even exercised');
    // THE finding CRM-014 §4.1 reported, now closed: this field used to carry
    // the join invitation's token to anyone who merely claimed the address.
    assert.equal(forWorkspace.personalInviteToken, null,
      'the sign-up answer handed the pending join invitation token to an address nobody proved');

    const serialized = JSON.stringify(claimed.data.signUp.availableWorkspaces);
    assert.equal(serialized.includes(joinToken), false,
      'the sign-up answer carries the join invitation token under some other field');

    // The link still works, which is the path the runbook tells people to use.
    const accepted = await graphql(
      METADATA,
      'mutation($email: String!, $password: String!, $workspaceId: UUID, $hash: String, $token: String) {' +
        ' signUpInWorkspace(email: $email, password: $password, workspaceId: $workspaceId,' +
        ' workspaceInviteHash: $hash, workspacePersonalInviteToken: $token) { workspace { id } } }',
      {
        email: JOIN_PROBE_EMAIL,
        password: probePassword,
        workspaceId: workspace.id,
        hash: psql(`select "inviteHash" from core.workspace where id = '${workspace.id}'`),
        token: joinToken,
      },
    );
    assert.equal(accepted.errors, undefined, `accepting a join invitation by its link stopped working: ${gqlErrors(accepted)}`);
    assert.equal(accepted.data.signUpInWorkspace.workspace.id, workspace.id);
  } finally {
    // The probe deletes its own account (deleteUser is self-only), so nothing
    // is left behind in the founder's deployment.
    const removed = await graphql(METADATA, 'mutation { deleteUser { id } }', {}, claimerToken);
    if (removed.errors) console.error(`[CLEANUP] the claim probe user survived: ${gqlErrors(removed)}`);
  }
});

test("the founder's own workspace, its members and its records were never touched by this run", () => {
  assert.equal(psql(`select count(*) from core.workspace where id = '${founderWorkspaceId}' and "deletedAt" is null`), '1',
    "the founder's workspace is gone or soft deleted");
  assert.equal(psql(`select count(*) from ${founderBaseline.schema}.company`), founderBaseline.companies,
    "the founder's company count changed during this run");
  assert.equal(psql(`select count(*) from ${founderBaseline.schema}.person`), founderBaseline.people,
    "the founder's person count changed during this run");
  assert.equal(psql(`select count(*) from core."userWorkspace" where "workspaceId" = '${founderWorkspaceId}'`), founderBaseline.members,
    "the founder's workspace gained or lost a member during this run");
});

test('the synthetic workspace, identity and invitations are gone, leaving exactly the founder workspace', async () => {
  const gone = await destroySyntheticWorkspace();
  assert.equal(gone, true,
    `the synthetic workspace or its data schema was still in the database ${DESTRUCTION_TIMEOUT_MS}ms after its destruction was enqueued`);

  for (const id of createdInvitationIds) {
    psql(`delete from core."appToken" where id = '${id}' and type = 'SIGN_UP_INVITATION_TOKEN'`);
  }
  createdInvitationIds.clear();

  assert.equal(
    psql(`select count(*) from core."appToken" where type = 'SIGN_UP_INVITATION_TOKEN' and context->>'email' like '%${RUN}@aos-crm.invalid'`),
    '0',
    'a synthetic sign-up invitation survived cleanup');
  assert.equal(
    psql(`select count(*) from core."user" where email like '%${RUN}@aos-crm.invalid' and "deletedAt" is null`),
    '0',
    'a synthetic identity survived cleanup');
  assert.equal(psql('select count(*) from core.workspace'), '1',
    'this deployment does not hold exactly the founder workspace after cleanup');
  assert.equal(psql("select count(*) from pg_namespace where nspname like 'workspace_%'"), '1',
    'a synthetic workspace data schema survived cleanup');
});
