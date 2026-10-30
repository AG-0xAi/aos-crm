// CRM-019 (R4): the browser half of the brand acceptance, executed INSIDE the
// pinned official Playwright container (scripts/aos/browser-acceptance.Dockerfile)
// by scripts/aos/test/crm-brand-e2e.test.mjs.
//
// What it measures, in a real headless Chromium with its sandbox ON:
//  - public   : the unauthenticated sign-in/sign-up page. Betty's name and
//               wordmark, the document title, the legal links pointing at
//               betty.management, the AGPL notice, and no "Twenty" in any text
//               a visitor can read.
//  - settings : Settings > AI > MCP. The "Connect your assistant" card at the
//               top, Claude's prefilled link (or its stated absence), the
//               ChatGPT steps, the workspace's own MCP URL, and the absence of
//               the card for Twenty's hosted ChatGPT app.
//  - navigation: the settings navigation. Community gone, Documentation hidden
//               while HELP_CENTER_URL is unset, and no "Twenty" in the drawer.
//
// It asserts on RENDERED TEXT and on hrefs read off the DOM, never on
// screenshots, and takes none. It also reports every request the page made to a
// host other than loopback as metadata only (method, scheme, host, path), which
// is how "no Twenty-hosted service" is measured rather than asserted.
//
// WHAT IT DOES NOT COVER: the onboarding step itself. Seeing it needs a user
// who is mid-onboarding, which needs a synthetic workspace created and then
// destroyed inside the run (the shape crm-isolation-e2e.test.mjs uses). The
// step's own component is covered by the unit suite
// twenty-front/src/modules/settings/mcp/components/__tests__/McpConnectAssistant.test.tsx,
// which renders it for real; the browser gap is declared in .aos/reports/CRM-019.md.
//
// Credentials arrive in the environment (docker --env-file of the ignored
// deploy/local/.env) and are never printed.
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const BASE_URL = requireEnv('AOS_CRM_BROWSER_BASE_URL');
const EMAIL = requireEnv('AOS_CRM_ADMIN_EMAIL');
const PASSWORD = requireEnv('AOS_CRM_ADMIN_PASSWORD');
const PHASE = process.env.AOS_CRM_BROWSER_PHASE || 'public';
const MARKER = process.env.AOS_CRM_BROWSER_MARKER || 'aos-crm-brand';

const LOCATOR_TIMEOUT_MS = 30_000;
// Same reasoning as crm-browser-e2e: a deadline on WORK, not on an answer.
// Measured in this image on 2026-10-30, the app's own page reaches
// domcontentloaded in 11-13 s.
const NAVIGATION_TIMEOUT_MS = Number(
  process.env.AOS_CRM_BROWSER_NAV_TIMEOUT_MS || 90_000,
);

const checks = [];
const externalRequests = [];
let sandbox = null;

function requireEnv(name) {
  const value = process.env[name];

  if (!value) throw new Error(`${name} is not set in the container environment`);

  return value;
}

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail: String(detail).slice(0, 400) });
}

function isLoopback(hostname) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

// The product name as a word, exactly as the static guard reads it, so a
// rendered string and a source string are judged by the same rule.
const TWENTY_WORD = /(^|[^A-Za-z0-9_-])Twenty([^A-Za-z0-9_-]|$)/;

async function visibleText(page) {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

function recordNoTwenty(name, text) {
  const match = TWENTY_WORD.exec(text);

  record(
    name,
    match === null,
    match === null
      ? ''
      : `found "${text.slice(Math.max(0, match.index - 60), match.index + 60)}"`,
  );
}

async function signIn(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const withEmail = page.getByRole('button', { name: /continue with email/i });

  if ((await withEmail.count()) > 0) await withEmail.first().click();

  const email = page.locator('input[placeholder="Email"]').first();

  await email.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  await email.fill(EMAIL);
  await page.getByRole('button', { name: /^continue$/i }).first().click();

  const password = page.locator('input[type="password"]').first();

  await password.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  await password.fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/objects\//, { timeout: NAVIGATION_TIMEOUT_MS });
}

async function runPublicPhase(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const title = await page.title();

  record(
    'the document title is Betty',
    title.trim() === 'Betty' || /\bBetty\b/.test(title),
    `title was ${JSON.stringify(title)}`,
  );

  const favicon = await page
    .locator('link[rel="icon"]')
    .first()
    .getAttribute('href');

  record(
    "the favicon is served from this deployment's own brand assets",
    typeof favicon === 'string' && favicon.includes('/brand/logo/'),
    `href was ${JSON.stringify(favicon)}`,
  );

  const withEmail = page.getByRole('button', { name: /continue with email/i });

  if ((await withEmail.count()) > 0) await withEmail.first().click();

  const text = await visibleText(page);

  record(
    'the sign-in page names Betty',
    /\bBetty\b/.test(text),
    text.slice(0, 200),
  );
  recordNoTwenty('no "Twenty" anywhere a visitor can read', text);

  const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute('href')),
  );

  record(
    'the Terms link points at betty.management/terminos',
    hrefs.includes('https://betty.management/terminos'),
    hrefs.join(' | ').slice(0, 300),
  );
  record(
    'the Privacy link points at betty.management/privacidad',
    hrefs.includes('https://betty.management/privacidad'),
    hrefs.join(' | ').slice(0, 300),
  );
  record(
    'the AGPL notice is shown, with the source of the deployed version or a stated absence',
    /AGPL-3\.0/.test(text) &&
      (/Source code \(/.test(text) ||
        /source code link not configured/.test(text)),
    text.slice(-300),
  );
  record(
    'no link leaves for a Twenty-owned host',
    !hrefs.some((href) => /\btwenty(hq|-[a-z]+)?\b[a-z0-9.-]*\.[a-z]{2,}/i.test(href ?? '')),
    hrefs.filter((href) => /twenty/i.test(href ?? '')).join(' | '),
  );
}

async function runSettingsPhase(page) {
  await signIn(page);
  await page.goto(`${BASE_URL}/settings/ai`, { waitUntil: 'domcontentloaded' });

  const mcpTab = page.getByRole('tab', { name: /^MCP$/i });

  if ((await mcpTab.count()) > 0) {
    await mcpTab.first().click();
  }

  const heading = page.getByText(/Connect your assistant/i).first();

  await heading.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  record('Settings > AI > MCP is headed by "Connect your assistant"', true);

  const text = await visibleText(page);

  record(
    'the card offers Claude and ChatGPT',
    /\bClaude\b/.test(text) && /\bChatGPT\b/.test(text),
    text.slice(0, 300),
  );
  record(
    'the ChatGPT steps name the Plugins page and the Server URL field',
    /chatgpt\.com\/plugins/i.test(text) && /Server URL/i.test(text),
    text.slice(0, 400),
  );
  record(
    "the workspace's own MCP URL is shown, or its absence is stated",
    /\/mcp\b/.test(text) || /no MCP URL|not available|did not report a server address/i.test(text),
    text.slice(0, 400),
  );
  recordNoTwenty('no "Twenty" on Settings > AI > MCP', text);

  const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute('href')),
  );

  record(
    "the card for Twenty's hosted ChatGPT app is gone",
    !hrefs.some((href) => (href ?? '').includes('chatgpt.com/apps/twenty')),
    hrefs.filter((href) => /chatgpt/i.test(href ?? '')).join(' | '),
  );

  const claudeLink = hrefs.find((href) =>
    (href ?? '').startsWith('https://claude.ai/customize/connectors'),
  );

  if (typeof claudeLink === 'string') {
    const params = new URL(claudeLink).searchParams;

    record(
      'the Claude link prefills the connector name Betty and this workspace MCP URL',
      params.get('connectorName') === 'Betty' &&
        (params.get('connectorUrl') ?? '').endsWith('/mcp'),
      claudeLink,
    );
  } else {
    // Over plain http (the local profile) the link is withheld on purpose, and
    // the card has to say why instead of offering a link that would fail.
    record(
      'with no public HTTPS URL the Claude link is withheld AND the reason is shown',
      /public HTTPS address|served over HTTPS/i.test(text),
      text.slice(0, 400),
    );
  }
}

async function runNavigationPhase(page) {
  await signIn(page);
  await page.goto(`${BASE_URL}/settings/profile`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByText(/^Logout$/i)
    .first()
    .waitFor({ timeout: LOCATOR_TIMEOUT_MS });

  const drawer = (await page.locator('nav, aside').first().innerText()).replace(
    /\s+/g,
    ' ',
  );

  record('the settings navigation has no Community entry', !/Community/i.test(drawer), drawer.slice(0, 400));
  record(
    'Documentation is hidden while no help centre is configured',
    !/Documentation/i.test(drawer),
    drawer.slice(0, 400),
  );
  recordNoTwenty('no "Twenty" in the settings navigation', drawer);

  const community = await page.goto(`${BASE_URL}/settings/community`, {
    waitUntil: 'domcontentloaded',
  });

  record(
    'the Community page itself is unreachable',
    !/Join our Discord|Browse partners/i.test(await visibleText(page)),
    `status ${community?.status()}`,
  );
}

async function main() {
  // chromiumSandbox: true EXPLICITLY. Playwright's own default is false, and a
  // browser with its sandbox off is not the browser this acceptance is about.
  const browser = await chromium.launch({ chromiumSandbox: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });

  context.on('request', (request) => {
    let url;

    try {
      url = new URL(request.url());
    } catch {
      return;
    }

    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return;
    if (isLoopback(url.hostname)) return;

    const metadata = `${request.method()} ${url.protocol}//${url.host}${url.pathname}`;

    if (!externalRequests.includes(metadata)) externalRequests.push(metadata);
  });

  const page = await context.newPage();

  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

  sandbox = await page.evaluate(() => navigator.userAgent).catch(() => null);

  try {
    if (PHASE === 'public') await runPublicPhase(page);
    else if (PHASE === 'settings') await runSettingsPhase(page);
    else if (PHASE === 'navigation') await runNavigationPhase(page);
    else throw new Error(`unknown phase '${PHASE}'`);
  } finally {
    await context.close();
    await browser.close();
  }

  print();
}

function print() {
  console.log('AOS_BROWSER_RESULT_BEGIN');
  console.log(
    JSON.stringify({ phase: PHASE, marker: MARKER, sandbox, checks, externalRequests }),
  );
  console.log('AOS_BROWSER_RESULT_END');
}

// Always exit 0 once a result was printed: the verdict belongs to the host
// suite, which can tell "the browser could not start" (no result at all) from
// "a check failed" (a result with ok:false).
main().catch((error) => {
  record('the browser run completed', false, error?.message ?? error);
  print();
});
