// CRM-019 (R4): the brand acceptance in a real browser, against the real
// containers over the published loopback port.
//
// @e2e: the official Playwright image, pinned by DIGEST, with the Chromium
// SANDBOX ON (as the image's unprivileged pwuser, under Playwright's own
// published seccomp profile -- never --no-sandbox) -> the unauthenticated
// sign-in page read for Betty's name, its own favicon, the legal links to
// betty.management, the AGPL notice and the absence of "Twenty" in anything a
// visitor can read -> the administrator signs in through the form and opens
// Settings > AI > MCP, where the "Connect your assistant" card is asserted
// together with Claude's prefilled link (or its stated absence over plain
// http), the ChatGPT steps and the workspace's own MCP URL -> the settings
// navigation read for the removal of Community and the hiding of Documentation
// -> a connector registered through dynamic client registration and its OAuth
// consent screen read for Betty's app icon and ornament, with every image the
// page PAINTED (img sources plus computed background-image) asserted to name no
// Twenty asset
// -> every request the page made to a host other than loopback reported as
// metadata and asserted to name no Twenty-owned host.
// @e2e-falla-si: put "Twenty" back in any of those screens, point the legal
// links back at twenty.com, restore the hosted-ChatGPT card, restore the
// Community navigation entry, or let any page fetch a Twenty-hosted asset
// again. Everything asserted here comes from a real browser; there is no
// double to pass instead.
//
// WHAT THIS DOES NOT COVER: the onboarding step. Seeing it needs a user who is
// mid-onboarding, which needs a synthetic workspace created and destroyed
// inside the run. The step's component is covered for real by the unit suite
// McpConnectAssistant.test.tsx; the browser gap is declared in
// .aos/reports/CRM-019.md.
//
// Requires the stack to be UP (scripts/aos/local.ps1 -Action Start) and the
// running image to be built from this commit: it does not build the
// application image. If the services are not running it fails closed.
//
// Secrets: the administrator's credentials reach the browser container through
// `docker --env-file` of the ignored deploy/local/.env (never through argv) and
// are never printed. The container prints checks and request metadata only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  BASE_URL,
  BROWSER_ACCEPTANCE_DOCKERFILE,
  browserAcceptanceContextFiles,
  compose,
  founderWorkspaceOrigin,
  http,
  linuxRepoRoot,
  wsl,
} from '../mcp/lib.mjs';

// Pinned by digest for the same reason crm-browser-e2e pins it: v1.60.0-noble
// is a mutable tag, and a moving browser is not a measurement.
const BROWSER_IMAGE =
  'mcr.microsoft.com/playwright:v1.60.0-noble@sha256:9bd26ad900bb5e0f4dee75839e957a89ae89c2b7ab1e76050e559790e946b948';
const PLAYWRIGHT_VERSION = '1.60.0';
const SECCOMP_PROFILE = 'scripts/aos/playwright-seccomp-profile.json';
const RUN_MARKER = `crm019-${randomUUID().slice(0, 8)}`;
const IMAGE_TAG = `aos-crm-local/brand-acceptance:gate-${process.pid}-${randomUUID().slice(0, 8)}`;
const CONTAINER_NAME = `aos-crm-brand-gate-${process.pid}`;
const HEALTH_TIMEOUT_MS = 240_000;
const PHASE_TIMEOUT_MS = 420_000;
// Registered but never dialled: the consent screen is only read, never
// submitted, so nothing ever redirects here.
const AUTHORIZE_REDIRECT_URI = 'http://127.0.0.1:43999/aos-crm-brand-callback';

let linuxRoot = null;
let workspaceBaseUrl = null;
const results = {};

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

  throw new Error(
    `${BASE_URL}/healthz never became healthy within ${timeoutMs}ms (last: ${last})`,
  );
}

// One browser phase: the container runs, prints its result between two markers
// and exits 0 whether or not a check failed. A run with no result block at all
// is a browser that could not start, which is a different failure and is
// reported as one.
function runBrowserPhase(phase, extraEnv = {}) {
  const res = wsl(
    [
      'docker',
      'run',
      '--rm',
      '--name',
      `${CONTAINER_NAME}-${phase}`,
      '--network',
      'host',
      '--ipc=host',
      '--security-opt',
      `seccomp=${linuxRoot}/${SECCOMP_PROFILE}`,
      '--env-file',
      `${linuxRoot}/deploy/local/.env`,
      '-e',
      `AOS_CRM_BROWSER_BASE_URL=${workspaceBaseUrl}`,
      '-e',
      `AOS_CRM_BROWSER_PHASE=${phase}`,
      '-e',
      `AOS_CRM_BROWSER_MARKER=${RUN_MARKER}`,
      ...Object.entries(extraEnv).flatMap(([name, value]) => [
        '-e',
        `${name}=${value}`,
      ]),
      IMAGE_TAG,
      'node',
      '/aos/brand-acceptance.mjs',
    ],
    { timeout: PHASE_TIMEOUT_MS },
  );
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  const block =
    /AOS_BROWSER_RESULT_BEGIN\n([\s\S]*?)\nAOS_BROWSER_RESULT_END/.exec(output);

  assert.ok(
    block,
    `the browser container printed no result for phase '${phase}' (exit ${res.status}): ${output.slice(-500)}`,
  );

  return JSON.parse(block[1]);
}

function hostOf(metadata) {
  return (/^\S+\s+\w+:\/\/([^/]+)/.exec(metadata) ?? [])[1] ?? metadata;
}

// Every Twenty-owned host family CRM-019 removed a caller for: the icon
// provider, the placeholder images, the documentation, the hosted app and the
// telemetry endpoint.
const FORBIDDEN_HOST_PATTERN = /\btwenty(hq|-[a-z]+)?\b[a-z0-9.-]*\.[a-z]{2,}$/i;

function assertNoTwentyHost(result, phase) {
  const hosts = [...new Set(result.externalRequests.map(hostOf))];
  const forbidden = hosts.filter((host) => FORBIDDEN_HOST_PATTERN.test(host));

  assert.deepEqual(
    forbidden,
    [],
    `in phase '${phase}' the browser reached Twenty-owned host(s) ${forbidden.join(', ')}: ` +
      result.externalRequests
        .filter((request) => forbidden.includes(hostOf(request)))
        .join(' | '),
  );
}

function assertPhasePassed(result, phase) {
  const failed = result.checks.filter((check) => !check.ok);

  assert.deepEqual(
    failed.map((check) => `${check.name} -- ${check.detail}`),
    [],
    `${failed.length} of ${result.checks.length} brand checks failed in phase '${phase}'`,
  );
  assert.ok(result.checks.length > 0, `phase '${phase}' ran no checks at all`);
}

before(async () => {
  linuxRoot = linuxRepoRoot();

  const ps = compose(['ps', '--format', 'json', '--status', 'running']);

  assert.equal(
    ps.status,
    0,
    `docker compose ps exited ${ps.status}: ${(ps.stderr || '').slice(-300)}`,
  );
  const services = ps.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line).Service);

  for (const expected of ['server', 'worker', 'db', 'redis']) {
    assert.ok(
      services.includes(expected),
      `service '${expected}' is not running (running: ${services.join(', ') || 'none'}). Run scripts/aos/local.ps1 -Action Start first.`,
    );
  }

  assert.ok(
    ADMIN_EMAIL && ADMIN_PASSWORD,
    'deploy/local/.env carries no AOS_CRM_ADMIN_EMAIL/AOS_CRM_ADMIN_PASSWORD: run scripts/aos/test/crm-runtime-e2e.test.mjs once to create the first administrator',
  );

  await waitForHealthy(HEALTH_TIMEOUT_MS);
  workspaceBaseUrl = founderWorkspaceOrigin();

  // The same context crm-browser-e2e builds, derived from the shared
  // Dockerfile's own COPY lines, so nothing else from this checkout reaches the
  // daemon and the layer cache is shared with that suite's build.
  const build = wsl(
    [
      'sh',
      '-c',
      `set -e; cd ${JSON.stringify(linuxRoot)}; ` +
        `tar -C scripts/aos -cf - ${browserAcceptanceContextFiles().join(' ')} | ` +
        `docker build --provenance=false --build-arg BROWSER_IMAGE=${BROWSER_IMAGE} ` +
        `--build-arg PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION} -f ${BROWSER_ACCEPTANCE_DOCKERFILE} -t ${IMAGE_TAG} -`,
    ],
    { timeout: 600_000 },
  );

  assert.equal(
    build.status,
    0,
    `the browser image build exited ${build.status}: ${(build.stderr || '').slice(-400)}`,
  );
});

after(() => {
  // Only this run's own image tag, by name. Nothing by pattern, by age or by
  // image: this daemon also holds the running stack and other gates' images.
  if (linuxRoot) {
    const removed = wsl(['docker', 'image', 'rm', IMAGE_TAG], {
      timeout: 60_000,
    });

    if (removed.status !== 0) {
      console.error(
        `[CLEANUP] this run's own image tag ${IMAGE_TAG} survived (exit ${removed.status})`,
      );
    }
  }
});

test('the browser runs with its sandbox on, in the pinned official image', () => {
  results.public = runBrowserPhase('public');
  assert.ok(
    results.public.sandbox,
    'the browser reported no user-agent at all, so it never rendered a page',
  );
});

test('the unauthenticated sign-in page is Betty, with its own favicon, legal links and licence notice', () => {
  assert.ok(results.public, 'the public phase did not run');
  assertPhasePassed(results.public, 'public');
  assertNoTwentyHost(results.public, 'public');
});

test('Settings > AI > MCP is headed by "Connect your assistant", with Claude and the ChatGPT steps', () => {
  results.settings = runBrowserPhase('settings');
  assertPhasePassed(results.settings, 'settings');
  assertNoTwentyHost(results.settings, 'settings');
});

test('the settings navigation has no Community entry and no Documentation while none is configured', () => {
  results.navigation = runBrowserPhase('navigation');
  assertPhasePassed(results.navigation, 'navigation');
  assertNoTwentyHost(results.navigation, 'navigation');
});

test("the OAuth consent screen shows Betty's icon and ornament, not Twenty's logo and blue band", async () => {
  // A connector registered the way ChatGPT and Claude register theirs: dynamic
  // client registration. The flow is never completed -- the browser only READS
  // the consent screen -- so no grant is minted and nothing listens on the
  // redirect URI.
  const registration = await http('/oauth/register', {
    method: 'POST',
    // The same host the browser opens the consent screen on, so the connector
    // is registered against the workspace the screen will resolve.
    headers: {
      'content-type': 'application/json',
      host: new URL(workspaceBaseUrl).host,
    },
    body: JSON.stringify({
      client_name: `AOS-CRM brand acceptance ${RUN_MARKER}`,
      redirect_uris: [AUTHORIZE_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  assert.equal(
    registration.status,
    201,
    `dynamic registration answered ${registration.status}: ${registration.body.slice(0, 200)}`,
  );

  const clientId = JSON.parse(registration.body).client_id;

  assert.ok(clientId, 'dynamic registration returned no client id');

  results.authorize = runBrowserPhase('authorize', {
    AOS_CRM_AUTHORIZE_CLIENT_ID: clientId,
    AOS_CRM_AUTHORIZE_REDIRECT_URI: AUTHORIZE_REDIRECT_URI,
  });
  assertPhasePassed(results.authorize, 'authorize');
  assertNoTwentyHost(results.authorize, 'authorize');
});

test('no phase reached a Twenty-owned host at all', () => {
  const phases = Object.entries(results);

  assert.equal(
    phases.length,
    4,
    `expected four measured phases, got ${phases.map(([name]) => name).join(', ') || 'none'}`,
  );

  for (const [phase, result] of phases) assertNoTwentyHost(result, phase);
});
