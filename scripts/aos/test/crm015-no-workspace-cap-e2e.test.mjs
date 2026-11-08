// CRM-015: the founder removed the AGPL five-workspace cap
// (MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY) for this fork, measured against the
// real containers over the real published loopback port, on the beta profile
// (deploy/local/compose.yaml sets MAX_WORKSPACES=0, meaning no limit).
//
// @e2e: the operator (the only server admin) opens SIX synthetic workspaces,
// one past the old hard-coded limit of five -> each is confirmed to exist in
// core.workspace with its own provisioned data schema -> the deployment's
// total workspace count is confirmed to be more than five -> the founder's own
// workspace and its company/person counts are confirmed unchanged while the
// six exist -> all six are destroyed for real (deleteCurrentWorkspace, then
// the operator's hard delete workspace:clean --only-operation destroy, waited
// for in the database) -> the deployment returns to exactly the workspace
// count it had before this run, and the founder's workspace and its records
// are confirmed unchanged again.
// @e2e-falla-si: set MAX_WORKSPACES back to a positive value below 6 on this
// profile (the sixth workspace is refused and this suite fails at creation),
// or restore the old hard-coded
// MAX_WORKSPACES_WITHOUT_ENTERPRISE_KEY = 5 behaviour (same failure). Every
// count asserted here comes from psql inside this project's db container; the
// founder's workspace is read from the database, never assumed, and is the
// one record this run must never touch.
//
// Requires the stack to be up on the beta profile (scripts/aos/local.ps1
// -Action Start). It does not build the image and does not create the stack:
// if the services are not running, this fails closed and says so.
//
// Secrets: the operator's credentials come from the ignored deploy/local/.env.
// Every synthetic workspace this run creates is destroyed in `after`, even if
// a test fails first; nothing of the founder's workspace is ever deleted or
// modified.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  ADMIN_EMAIL, ADMIN_PASSWORD, PG_DB,
  compose, exchangeLoginToken, founderWorkspaceOrigin, graphql, http,
  loginWithOrigin, psql,
} from '../mcp/lib.mjs';
import { gqlErrors } from '../mcp/team-role.mjs';

const METADATA = '/metadata';
const HEALTH_TIMEOUT_MS = 180_000;
const NUM_WORKSPACES = 6;
// Opening a workspace and activating it provision a data schema with every
// standard object in it, and the socket stays idle while the server does that
// work: ~50 s per workspace measured in CRM-014 with the host to itself.
// Creating all six sequentially is budgeted for the worst case.
const PROVISIONING_TIMEOUT_MS = 300_000;
const SETUP_TIMEOUT_MS = PROVISIONING_TIMEOUT_MS * NUM_WORKSPACES;
const DESTRUCTION_TIMEOUT_MS = 300_000;

// Unique per run: the subdomain of a workspace is unique per deployment, so a
// fixed one would collide with a leftover from an interrupted run.
const RUN = randomUUID().slice(0, 8);

let operatorFounderToken = null;
let founderWorkspaceId = null;
let founderSchema = null;
let founderBaseline = null;
let workspaceCountBefore = null;
const workspaces = [];

function nameOf(index) {
  return `AOS-CRM015 sin-tope ${index} ${RUN}`;
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
  throw new Error(`/healthz never became healthy within ${timeoutMs}ms (last: ${last})`);
}

function workspaceRowExists(workspaceId) {
  return psql(`select count(*) from core.workspace where id = '${workspaceId}'`) !== '0';
}

function schemaExists(schemaName) {
  return psql(`select count(*) from pg_namespace where nspname = '${schemaName}'`) !== '0';
}

// Same derivation the server uses (workspace-datasource/utils/get-workspace-
// schema-name.util.ts over twenty-shared's uuidToBase36), confirmed against
// pg_namespace so a drifted derivation cannot read as "nothing leaked/created".
function schemaOf(workspaceId) {
  const name = `workspace_${BigInt(`0x${workspaceId.replace(/-/g, '')}`).toString(36)}`;
  assert.ok(schemaExists(name),
    `the schema derived for workspace ${workspaceId} (${name}) does not exist in ${PG_DB}`);
  return name;
}

async function createSyntheticWorkspace(index) {
  const subdomain = `aos-crm015-${index}-${RUN}`;
  const created = await graphql(
    METADATA,
    'mutation($input: SignUpInNewWorkspaceInput) {' +
      ' signUpInNewWorkspace(input: $input) { loginToken { token } workspace { id workspaceUrls { subdomainUrl } } } }',
    { input: { displayName: nameOf(index), subdomain } },
    operatorFounderToken,
    { timeoutMs: PROVISIONING_TIMEOUT_MS },
  );
  assert.equal(created.errors, undefined,
    `the operator could not open synthetic workspace ${index}: ${gqlErrors(created)}`);
  const workspace = created.data.signUpInNewWorkspace.workspace;
  const origin = new URL(workspace.workspaceUrls.subdomainUrl).origin;

  // PENDING_CREATION until activated: activation is what provisions the data
  // schema this workspace is confirmed by below.
  const pendingToken = await exchangeLoginToken(created.data.signUpInNewWorkspace.loginToken.token, origin);
  const activated = await graphql(
    METADATA, 'mutation { activateWorkspace(data: {}) { id activationStatus } }', {}, pendingToken,
    { timeoutMs: PROVISIONING_TIMEOUT_MS },
  );
  assert.equal(activated.errors, undefined, `activating synthetic workspace ${index} failed: ${gqlErrors(activated)}`);
  assert.equal(activated.data.activateWorkspace.activationStatus, 'ACTIVE');

  const operatorToken = await loginWithOrigin(ADMIN_EMAIL, ADMIN_PASSWORD, origin);

  return { index, id: workspace.id, subdomain, origin, operatorToken, schema: schemaOf(workspace.id) };
}

// deleteCurrentWorkspace only SOFT deletes (workspace.service.ts
// deleteWorkspace with softDelete=true): the row, schema and records stay
// until destruction runs. The hard delete below ENQUEUES the job the worker
// performs, so the effect is waited for in the database instead of trusted
// from an exit code.
async function destroySyntheticWorkspace(workspace) {
  const deleted = await graphql(METADATA, 'mutation { deleteCurrentWorkspace { id deletedAt } }', {}, workspace.operatorToken);
  if (deleted.errors && !/not found|suspended|deleted/i.test(gqlErrors(deleted))) {
    throw new Error(`deleteCurrentWorkspace(${workspace.index}) failed: ${gqlErrors(deleted)}`);
  }
  const destroyed = compose([
    'exec', '-T', 'server', 'yarn', 'command:prod', 'workspace:clean',
    '--workspace-id', workspace.id, '--only-operation', 'destroy', '--ignore-destroy-grace-period',
  ]);
  if (destroyed.status !== 0) {
    throw new Error(`workspace:clean(${workspace.index}) exited ${destroyed.status}: ${(destroyed.stderr || '').slice(-400)}`);
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
  founderSchema = schemaOf(founderWorkspaceId);
  founderBaseline = {
    companies: psql(`select count(*) from ${founderSchema}.company`),
    people: psql(`select count(*) from ${founderSchema}.person`),
  };
  workspaceCountBefore = Number(psql('select count(*) from core.workspace'));
}, { timeout: HEALTH_TIMEOUT_MS + PROVISIONING_TIMEOUT_MS });

// The net under the teardown test below: a run that fails earlier must still
// not leave a synthetic workspace behind. Entries are nulled as they are
// destroyed, so nothing is destroyed twice.
after(async () => {
  for (let i = 0; i < workspaces.length; i++) {
    const workspace = workspaces[i];
    if (workspace === null) continue;
    try {
      const gone = await destroySyntheticWorkspace(workspace);
      if (!gone) console.error(`[CLEANUP] synthetic workspace ${workspace.index} (${workspace.id}) was still in the database when this run ended`);
    } catch (error) {
      console.error(`[CLEANUP] ${workspace.index}: ${error.message}`);
    }
    workspaces[i] = null;
  }
});

test('the operator opens six synthetic workspaces, past the old five-workspace cap', async () => {
  for (let index = 1; index <= NUM_WORKSPACES; index++) {
    workspaces.push(await createSyntheticWorkspace(index));
  }
  assert.equal(workspaces.length, NUM_WORKSPACES);

  for (const workspace of workspaces) {
    assert.ok(workspaceRowExists(workspace.id), `synthetic workspace ${workspace.index} (${workspace.id}) does not exist`);
    assert.ok(schemaExists(workspace.schema), `synthetic workspace ${workspace.index} has no data schema`);
  }

  const total = Number(psql('select count(*) from core.workspace'));
  assert.ok(total > 5, `expected more than five workspaces to exist on this deployment, got ${total}`);
  assert.equal(total, workspaceCountBefore + NUM_WORKSPACES,
    `expected exactly ${NUM_WORKSPACES} new workspaces on top of the ${workspaceCountBefore} that existed before this run`);
}, { timeout: SETUP_TIMEOUT_MS });

test("the founder's own workspace and its records are unchanged while all six synthetic workspaces exist", () => {
  assert.equal(psql(`select count(*) from core.workspace where id = '${founderWorkspaceId}' and "deletedAt" is null`), '1',
    "the founder's workspace is gone or soft deleted");
  assert.equal(psql(`select count(*) from ${founderSchema}.company`), founderBaseline.companies,
    "the founder's company count changed while the synthetic workspaces existed");
  assert.equal(psql(`select count(*) from ${founderSchema}.person`), founderBaseline.people,
    "the founder's person count changed while the synthetic workspaces existed");
});

test('all six synthetic workspaces are destroyed, and the deployment and the founder workspace return to their prior state', async () => {
  for (let i = 0; i < workspaces.length; i++) {
    const workspace = workspaces[i];
    const gone = await destroySyntheticWorkspace(workspace);
    assert.equal(gone, true,
      `synthetic workspace ${workspace.index} (${workspace.id}) or its data schema ${workspace.schema} was still in the database ${DESTRUCTION_TIMEOUT_MS}ms after its destruction was enqueued`);
    workspaces[i] = null;
  }

  assert.equal(psql('select count(*) from core.workspace'), String(workspaceCountBefore),
    'this deployment does not hold exactly as many workspaces as it did before this run');
  assert.equal(psql(`select count(*) from core.workspace where id = '${founderWorkspaceId}' and "deletedAt" is null`), '1',
    "the founder's workspace is gone or soft deleted after cleanup");
  assert.equal(psql(`select count(*) from ${founderSchema}.company`), founderBaseline.companies,
    "the founder's company count changed by the end of this run");
  assert.equal(psql(`select count(*) from ${founderSchema}.person`), founderBaseline.people,
    "the founder's person count changed by the end of this run");
}, { timeout: DESTRUCTION_TIMEOUT_MS * NUM_WORKSPACES });
