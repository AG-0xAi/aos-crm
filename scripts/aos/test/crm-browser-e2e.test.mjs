// CRM-005 (R1/R3): the browser path of the local AOS-CRM stack, driven by a
// real headless Chromium against the real containers over the published
// loopback port.
//
// @e2e: the official Playwright image, pinned by DIGEST, with the Chromium
// SANDBOX ON (as the image's unprivileged pwuser, under Playwright's own
// published seccomp profile -- never --no-sandbox) -> the administrator signs
// in through the sign-in form -> a synthetic company, person and opportunity
// created through the UI, and the person/opportunity relations set through the
// UI -> those rows and their foreign keys read with psql inside this project's
// own PostgreSQL container -> the timeline rows the WORKER wrote for them,
// polled in that same database -> server and worker restarted -> the same
// records, with their relations and the worker's timeline entry, read back IN
// THE BROWSER -> every request the page made to a host other than loopback
// reported as metadata, and asserted empty while the privacy profile pins
// ALLOW_REQUESTS_TO_TWENTY_ICONS=false.
// @e2e-falla-si: stop the `server` container, set ALLOW_REQUESTS_TO_TWENTY_ICONS
// back to true (the browser then asks twenty-icons.com for the synthetic
// company's domain and this fails), revert the three icon-flag guards, or break
// the UI paths this drives. Everything asserted here comes from a real browser
// and from psql inside the db container; there is no double to pass instead.
//
// Requires the stack to be up (scripts/aos/local.ps1 -Action Start) and the
// running image to be the one built from this commit: it does not build the
// application image. If the services are not running, this fails closed.
//
// Secrets: the administrator's credentials reach the browser container through
// `docker --env-file` of the ignored deploy/local/.env (never through argv,
// where another user on this host could read them off the process list) and are
// never printed. The container prints checks, record ids and request metadata
// only: no screenshot, no HAR, no page HTML, no token.
//
// The two files that make up the browser container (its Dockerfile and the
// in-container script) are tarred from the WORKING TREE, so this suite measures
// the browser script as it is on disk right now, not as it is committed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, COMPOSE_PROJECT, DISTRO, PG_DB, PG_USER,
  REPO_ROOT, founderWorkspaceOrigin, graphql, http,
} from '../mcp/lib.mjs';
import { loginAsAdmin } from '../mcp/team-role.mjs';

// The official image, by digest and not by tag: `v1.60.0-noble` is mutable, and
// a moving browser is not a measurement. The npm package installed on top is
// pinned to the same version the repo's own lockfile resolves (playwright
// 1.60.0), because the browsers inside the image are built for that version.
const BROWSER_IMAGE =
  'mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948';
const PLAYWRIGHT_VERSION = '1.60.0';
// Playwright's own published seccomp profile for running Chromium's sandbox in
// a container, vendored at scripts/aos/playwright-seccomp-profile.json from
// https://raw.githubusercontent.com/microsoft/playwright/v1.60.0/utils/docker/seccomp_profile.json
// (sha256 cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849).
// Measured on this host: with Docker's default profile, chromium.launch({
// chromiumSandbox: true }) dies with "Chromium sandboxing failed!"; with this
// one it starts, and the process tree carries no --no-sandbox. No added
// capability and no privileged container.
const SECCOMP_PROFILE = 'scripts/aos/playwright-seccomp-profile.json';
const RUN_MARKER = `crm005-${randomUUID().slice(0, 8)}`;
const IMAGE_TAG = `aos-crm-local/browser-acceptance:gate-${process.pid}-${randomUUID().slice(0, 8)}`;
const CONTAINER_NAME = `aos-crm-browser-gate-${process.pid}`;
const HEALTH_TIMEOUT_MS = 240_000;
const PHASE_TIMEOUT_MS = 420_000;
const WORKER_TIMELINE_TIMEOUT_MS = 120_000;

let linuxRoot = null;
let adminToken = null;
let workspaceSchema = null;
let workspaceBaseUrl = null;
let createPhase = null;
let ids = {};

function wsl(args, opts = {}) {
  return spawnSync('wsl.exe', ['-d', DISTRO, '--exec', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

function compose(args, opts = {}) {
  assert.ok(linuxRoot, 'the repo path was never translated into the distro');
  return wsl(['docker', 'compose', '-f', `${linuxRoot}/deploy/local/compose.yaml`, '-p', COMPOSE_PROJECT, ...args], opts);
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

// One browser phase: the container runs, prints its result between two markers
// and exits 0 whether or not a check failed. A run with no result block at all
// is a browser that could not start, which is a different failure and is
// reported as one.
function runBrowserPhase(phase, { ids: handedIds = {} } = {}) {
  const res = wsl(['docker', 'run', '--rm',
    '--name', `${CONTAINER_NAME}-${phase}`,
    '--network', 'host',
    '--ipc=host',
    '--security-opt', `seccomp=${linuxRoot}/${SECCOMP_PROFILE}`,
    '--env-file', `${linuxRoot}/deploy/local/.env`,
    // The WORKSPACE's own URL, not the bare loopback address: on the beta
    // profile (CRM-014) the app resolves the workspace from the subdomain, and
    // the bare host is the sign-in/picker page, which serves no workspace. This
    // is also the URL a beta user actually opens. Chromium resolves
    // *.localhost to loopback itself (RFC 6761), so no DNS, no hosts file and
    // no extra container flag is involved; the connection still lands on the
    // published 127.0.0.1 port through --network host.
    '-e', `AOS_CRM_BROWSER_BASE_URL=${workspaceBaseUrl}`,
    '-e', `AOS_CRM_BROWSER_PHASE=${phase}`,
    '-e', `AOS_CRM_BROWSER_MARKER=${RUN_MARKER}`,
    '-e', `AOS_CRM_BROWSER_IDS=${JSON.stringify(handedIds)}`,
    IMAGE_TAG, 'node', '/aos/browser-acceptance.mjs',
  ], { timeout: PHASE_TIMEOUT_MS });
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const block = /AOS_BROWSER_RESULT_BEGIN\n([\s\S]*?)\nAOS_BROWSER_RESULT_END/.exec(output);
  assert.ok(block, `the browser container printed no result for phase '${phase}' (exit ${res.status}): ${output.slice(-500)}`);
  return JSON.parse(block[1]);
}

// The host CRM-005 exists to get rid of: company and link icons fetched from
// twenty-icons.com with the workspace's own domain names in the path.
const FORBIDDEN_HOSTS = ['twenty-icons.com'];
// Hosts that are MEASURED, NAMED and still reached. Not an excuse list: a host
// that is not here fails this suite, which is what makes a new destination
// visible instead of silent.
//  - twentyhq.github.io: the DEFAULT workspace logo, a hardcoded upstream
//    constant (twenty-front .../navigation-drawer/constants/DefaultWorkspaceLogo.ts)
//    that the navigation drawer loads on every page view while this workspace
//    has no logo of its own. Outside CRM-005's registered Scope (four frontend
//    files), so it is reported in docs/aos/bootstrap/TELEMETRY_AUDIT.md and not
//    silently patched here.
const INVENTORIED_HOSTS = ['twentyhq.github.io'];

function hostOf(metadata) {
  return (/^\S+\s+\w+:\/\/([^/]+)/.exec(metadata) ?? [])[1] ?? metadata;
}

function assertExternalRequests(result, phase) {
  const hosts = [...new Set(result.externalRequests.map(hostOf))];
  const forbidden = hosts.filter((h) => FORBIDDEN_HOSTS.some((f) => h === f || h.endsWith(`.${f}`)));
  assert.deepEqual(forbidden, [],
    `in phase '${phase}' the browser asked ${forbidden.join(', ')} for icons while ALLOW_REQUESTS_TO_TWENTY_ICONS is false: ` +
    `${result.externalRequests.filter((r) => forbidden.includes(hostOf(r))).join(' | ')}`);
  const unknown = hosts.filter((h) => !INVENTORIED_HOSTS.includes(h));
  assert.deepEqual(unknown, [],
    `in phase '${phase}' the browser reached host(s) that are not in this suite's inventory: ${unknown.join(', ')}. ` +
    'Classify them in docs/aos/bootstrap/TELEMETRY_AUDIT.md before adding them here.');
}

function assertPhasePassed(result, phase) {
  const failed = result.checks.filter((c) => !c.ok);
  assert.deepEqual(failed.map((c) => `${c.name} -- ${c.detail}`), [],
    `${failed.length} of ${result.checks.length} browser checks failed in phase '${phase}'`);
  assert.ok(result.checks.length > 0, `phase '${phase}' ran no checks at all`);
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
  workspaceBaseUrl = founderWorkspaceOrigin();

  const schemas = psql("select nspname from pg_namespace where nspname like 'workspace_%' order by nspname;")
    .split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(schemas.length, 1, `expected exactly one workspace schema in ${PG_DB}, found ${schemas.length}`);
  workspaceSchema = schemas[0];

  // The browser image: the pinned official base plus the version-matched
  // playwright package. Built from a tar of the two files in scripts/aos, so
  // nothing else from this checkout reaches the daemon.
  const build = wsl(['sh', '-c',
    `set -e; cd ${JSON.stringify(linuxRoot)}; ` +
    'tar -C scripts/aos -cf - browser-acceptance.Dockerfile browser-acceptance.mjs | ' +
    `docker build --provenance=false --build-arg BROWSER_IMAGE=${BROWSER_IMAGE} ` +
    `--build-arg PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION} -f browser-acceptance.Dockerfile -t ${IMAGE_TAG} -`,
  ], { timeout: 600_000 });
  assert.equal(build.status, 0, `the browser image build exited ${build.status}: ${(build.stderr || '').slice(-400)}`);
});

after(async () => {
  // This run's own synthetic records, removed permanently with the
  // administrator's session: a soft delete would leave them in the workspace.
  for (const [singular, id] of [['company', ids.companyId], ['person', ids.personId], ['opportunity', ids.opportunityId]]) {
    if (!id || !adminToken) continue;
    const mutation = `destroy${singular[0].toUpperCase()}${singular.slice(1)}`;
    try {
      await graphql('/graphql', `mutation($id: UUID!) { ${mutation}(id: $id) { id } }`, { id }, adminToken);
    } catch {
      // Reported by the assertions above; a cleanup error must not hide them.
    }
  }
  if (linuxRoot) wsl(['docker', 'image', 'rm', IMAGE_TAG], { timeout: 60_000 });
});

test('the browser runs with its sandbox on, as an unprivileged user, in the pinned official image', () => {
  createPhase = runBrowserPhase('create');
  ids = createPhase.ids ?? {};
  const sandbox = createPhase.sandbox;
  assert.ok(sandbox, 'the browser reported no sandbox evidence at all');
  assert.ok(sandbox.chromiumProcesses > 0, 'no chromium process was running when the evidence was read');
  assert.ok(!sandbox.switches.includes('--no-sandbox'),
    'the browser was launched with --no-sandbox: that is not the browser this acceptance is about');
  assert.notEqual(sandbox.uid, 0, 'the browser ran as root, where Chromium refuses its own sandbox');
});

test('the administrator signs in and creates a related company, person and opportunity through the UI', () => {
  assert.ok(createPhase, 'the create phase did not run');
  assertPhasePassed(createPhase, 'create');
  for (const key of ['companyId', 'personId', 'opportunityId']) {
    assert.match(ids[key] ?? '', /^[0-9a-f-]{36}$/, `the create phase produced no ${key}`);
  }
});

test('what the browser created is in this project own PostgreSQL, with the names it typed and the relations it set', () => {
  assert.ok(ids.companyId, 'no record ids: the create phase did not complete');
  // The NAME and not only the row: the UI's editor dropped the first keystrokes
  // of a name typed too early (measured 2026-10-29), and a row whose name is a
  // truncation of what the browser typed is not the record this created.
  assert.equal(psql(`select name from "${workspaceSchema}".company where id = '${ids.companyId}'`), createPhase.names.company,
    'the company row carries a different name than the browser typed');
  assert.equal(psql(`select "nameFirstName" from "${workspaceSchema}".person where id = '${ids.personId}'`), createPhase.names.person,
    'the person row carries a different name than the browser typed');
  assert.equal(psql(`select name from "${workspaceSchema}".opportunity where id = '${ids.opportunityId}'`), createPhase.names.opportunity,
    'the opportunity row carries a different name than the browser typed');
  assert.equal(psql(`select "companyId" from "${workspaceSchema}".person where id = '${ids.personId}'`), ids.companyId,
    'the person row does not carry the company the browser related it to');
  assert.equal(psql(`select "companyId" from "${workspaceSchema}".opportunity where id = '${ids.opportunityId}'`), ids.companyId,
    'the opportunity row does not carry the company the browser related it to');
  assert.equal(psql(`select "pointOfContactId" from "${workspaceSchema}".opportunity where id = '${ids.opportunityId}'`), ids.personId,
    'the opportunity row does not carry the point of contact the browser related it to');
});

test('the worker processed the records the browser created (its timeline rows, polled in the same database)', async () => {
  assert.ok(ids.companyId, 'no record ids: the create phase did not complete');
  const deadline = Date.now() + WORKER_TIMELINE_TIMEOUT_MS;
  const columns = { company: 'targetCompanyId', person: 'targetPersonId', opportunity: 'targetOpportunityId' };
  const pending = new Map(Object.entries(columns).map(([object, column]) => [object, column]));
  let last = '';
  while (pending.size > 0 && Date.now() < deadline) {
    for (const [object, column] of [...pending]) {
      const id = ids[`${object}Id`];
      const rows = Number(psql(`select count(*) from "${workspaceSchema}"."timelineActivity" where "${column}" = '${id}'`));
      if (rows > 0) pending.delete(object);
      else last = `${object} still has 0 timeline rows`;
    }
    if (pending.size > 0) await new Promise((r) => setTimeout(r, 3000));
  }
  assert.equal(pending.size, 0,
    `the worker never wrote a timeline activity for: ${[...pending.keys()].join(', ')} (${last}). ` +
    'This is the worker job upsert-timeline-activity-from-internal-event, not the request that created the record.');
});

test('the records and relations survive restarting server and worker, read back IN THE BROWSER', async () => {
  assert.ok(ids.companyId, 'no record ids: the create phase did not complete');
  // Bounded on purpose: server and worker only. The founder may be using this
  // stack, and the database and Redis containers do not need to go down for
  // this to be a restart of the application processes.
  const before = psql(`select count(*) from "${workspaceSchema}".company where id = '${ids.companyId}'`);
  assert.equal(before, '1', 'the company is gone before the restart even started');
  const restart = compose(['restart', 'server', 'worker'], { timeout: 300_000 });
  assert.equal(restart.status, 0, `docker compose restart server worker exited ${restart.status}: ${(restart.stderr || '').slice(-300)}`);
  await waitForHealthy(HEALTH_TIMEOUT_MS);

  const verifyPhase = runBrowserPhase('verify', { ids });
  assertPhasePassed(verifyPhase, 'verify');
  assertExternalRequests(verifyPhase, 'verify');
});

test('the browser asked the icon provider for nothing, and reached no uninventoried host', () => {
  assert.ok(createPhase, 'the create phase did not run');
  // The measurement this names: with ALLOW_REQUESTS_TO_TWENTY_ICONS=false and
  // the three consumers honouring it, a full sign-in plus CRUD session makes no
  // request to twenty-icons.com. Before the CRM-005 fix the same session asked
  // it for every company domain on screen, including the synthetic one this
  // suite creates and five real ones from the demo data (measured 2026-10-29,
  // docs/aos/bootstrap/TELEMETRY_AUDIT.md).
  assertExternalRequests(createPhase, 'create');
});
