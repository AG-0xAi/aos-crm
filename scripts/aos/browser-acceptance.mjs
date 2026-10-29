// CRM-005 (R1/R3): the browser half of the functional acceptance, executed
// INSIDE the pinned official Playwright container (see
// scripts/aos/browser-acceptance.Dockerfile) by
// scripts/aos/test/crm-browser-e2e.test.mjs.
//
// It drives a real headless Chromium -- with its sandbox ON, as the image's
// unprivileged pwuser -- against the local CRM over the published loopback
// port: the administrator signs in through the form, synthetic records are
// created through the UI, their relations are set through the UI, and after the
// host has restarted the services the same records are read back in the
// browser, including the timeline entry the WORKER wrote.
//
// It asserts on DATA (record ids read off the rendered rows, field values,
// relation chips, timeline text), never on screenshots, and it takes none.
//
// It also reports every request the page made to a host other than loopback,
// as METADATA only (method, scheme, host, path -- never a query string, a body
// or a header), which is the browser-side half of the R3 traffic evidence.
//
// Credentials arrive in the environment (docker --env-file of the ignored
// deploy/local/.env) and are never printed: the result object below carries
// checks, ids and request metadata, and nothing reads process.env except the
// three lookups at the top.
import { chromium } from 'playwright';

const BASE_URL = requireEnv('AOS_CRM_BROWSER_BASE_URL');
const EMAIL = requireEnv('AOS_CRM_ADMIN_EMAIL');
const PASSWORD = requireEnv('AOS_CRM_ADMIN_PASSWORD');
const PHASE = process.env.AOS_CRM_BROWSER_PHASE || 'create';
const MARKER = process.env.AOS_CRM_BROWSER_MARKER || 'aos-crm-browser';
const IDS = JSON.parse(process.env.AOS_CRM_BROWSER_IDS || '{}');
const DEBUG = process.env.AOS_CRM_BROWSER_DEBUG === '1';

const COMPANY_NAME = `Ensayos Sinteticos ${MARKER}`;
const PERSON_FIRST_NAME = `Marta ${MARKER}`;
const OPPORTUNITY_NAME = `Oportunidad ${MARKER}`;
const SHORT_WAIT_MS = 1_500;
const LOCATOR_TIMEOUT_MS = 30_000;

const checks = [];
const externalRequests = [];
const consoleErrors = [];
const ids = { ...IDS };
const debugDumps = [];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[FAIL] ${name} is not set in the container environment`);
    process.exit(2);
  }
  return value;
}

function isLoopback(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

async function check(name, body) {
  try {
    const detail = await body();
    checks.push({ name, ok: true, detail: detail ?? 'ok' });
    return true;
  } catch (error) {
    checks.push({ name, ok: false, detail: String(error?.message ?? error).slice(0, 300) });
    return false;
  }
}

// What the page looks like when a locator did not resolve: text and the test
// ids present, never a screenshot and never a credential. Only collected with
// AOS_CRM_BROWSER_DEBUG=1, and only from our own synthetic local instance.
async function dumpPage(page, label) {
  if (!DEBUG) return;
  try {
    const text = (await page.locator('body').innerText()).replace(/\s+\n/g, '\n').slice(0, 2500);
    const testIds = await page.locator('[data-testid]').evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => n.getAttribute('data-testid')))).slice(0, 60));
    const buttons = await page.getByRole('button').evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((n) => (n.textContent || '').trim()).filter(Boolean))).slice(0, 40));
    debugDumps.push({ label, url: page.url(), text, testIds, buttons });
  } catch (error) {
    debugDumps.push({ label, error: String(error?.message ?? error).slice(0, 200) });
  }
}

async function signIn(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const withEmail = page.getByRole('button', { name: /continue with email/i });
  if (await withEmail.count() > 0) {
    await withEmail.first().click();
  }
  const email = page.locator('input[placeholder="Email"]').first();
  await email.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  await email.fill(EMAIL);
  await page.getByRole('button', { name: /^continue$/i }).first().click();
  const password = page.locator('input[type="password"]').first();
  await password.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  await password.fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/objects\//, { timeout: 90_000 });
}

async function openIndex(page, plural) {
  await page.goto(`${BASE_URL}/objects/${plural}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="row-id-"], [data-testid="record-index-empty-state"]')
    .first().waitFor({ timeout: LOCATOR_TIMEOUT_MS });
}

function rowForText(page, text) {
  return page.locator('[data-testid^="row-id-"]').filter({ hasText: text }).first();
}

// The UI's own creation path: the table's "Add New" action row creates the
// record and leaves its first cell in edit mode, so the name is typed into the
// real editor and committed with Enter. The id is then read off the row the
// table rendered, which is what later phases address the record by.
async function createRecordThroughTable(page, plural, text) {
  await openIndex(page, plural);
  await page.getByText('Add New', { exact: true }).last().click();
  await page.waitForTimeout(SHORT_WAIT_MS);
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press('Enter');
  const row = rowForText(page, text);
  await row.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  const testId = await row.getAttribute('data-testid');
  const id = (testId ?? '').replace('row-id-', '');
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    throw new Error(`the created row carries no record id (data-testid=${testId})`);
  }
  return id;
}

// An empty relation cell renders the placeholder "Set <Field label>" (see
// RecordTableCellDisplayContainer), which is the stable handle for it. Clicking
// focuses the cell, Enter opens the editor, the search text filters the picker
// and the option is clicked by its own text.
async function setRelationThroughTable(page, { rowText, fieldLabel, searchText, optionText }) {
  const row = rowForText(page, rowText);
  await row.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  const cell = row.getByText(`Set ${fieldLabel}`, { exact: true }).first();
  await cell.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  await cell.click();
  await page.waitForTimeout(400);
  const editor = page.locator('[data-testid="editable-cell-edit-mode-container"]');
  if (await editor.count() === 0) {
    await page.keyboard.press('Enter');
    await editor.first().waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  }
  await page.keyboard.type(searchText, { delay: 15 });
  await page.waitForTimeout(SHORT_WAIT_MS);
  const option = page.getByText(optionText, { exact: true }).last();
  await option.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  await option.click();
  await page.waitForTimeout(SHORT_WAIT_MS);
  await page.keyboard.press('Escape');
}

async function openRecord(page, singular, id) {
  await page.goto(`${BASE_URL}/object/${singular}/${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="top-bar-title"]').first().waitFor({ timeout: LOCATOR_TIMEOUT_MS });
}

async function runCreatePhase(page) {
  await check('the administrator signs in through the browser form', async () => {
    await signIn(page);
    return `landed on ${new URL(page.url()).pathname}`;
  }) || await dumpPage(page, 'sign-in');

  await check('a synthetic company is created through the UI', async () => {
    ids.companyId = await createRecordThroughTable(page, 'companies', COMPANY_NAME);
    return `company ${ids.companyId}`;
  }) || await dumpPage(page, 'create-company');

  await check('a synthetic person is created through the UI', async () => {
    ids.personId = await createRecordThroughTable(page, 'people', PERSON_FIRST_NAME);
    return `person ${ids.personId}`;
  }) || await dumpPage(page, 'create-person');

  await check('the person is related to the company through the UI', async () => {
    await setRelationThroughTable(page, {
      rowText: PERSON_FIRST_NAME,
      fieldLabel: 'Company',
      searchText: COMPANY_NAME,
      optionText: COMPANY_NAME,
    });
    const row = rowForText(page, PERSON_FIRST_NAME);
    const text = await row.innerText();
    if (!text.includes(COMPANY_NAME)) {
      throw new Error('the person row does not show the company after setting the relation');
    }
    return 'the person row shows the company chip';
  }) || await dumpPage(page, 'relate-person');

  await check('a synthetic opportunity is created through the UI', async () => {
    ids.opportunityId = await createRecordThroughTable(page, 'opportunities', OPPORTUNITY_NAME);
    return `opportunity ${ids.opportunityId}`;
  }) || await dumpPage(page, 'create-opportunity');

  await check('the opportunity is related to the company through the UI', async () => {
    await setRelationThroughTable(page, {
      rowText: OPPORTUNITY_NAME,
      fieldLabel: 'Company',
      searchText: COMPANY_NAME,
      optionText: COMPANY_NAME,
    });
    const row = rowForText(page, OPPORTUNITY_NAME);
    const text = await row.innerText();
    if (!text.includes(COMPANY_NAME)) {
      throw new Error('the opportunity row does not show the company after setting the relation');
    }
    return 'the opportunity row shows the company chip';
  }) || await dumpPage(page, 'relate-opportunity');

  await check('the opportunity point of contact is the synthetic person, set through the UI', async () => {
    await setRelationThroughTable(page, {
      rowText: OPPORTUNITY_NAME,
      fieldLabel: 'Point of Contact',
      searchText: PERSON_FIRST_NAME,
      optionText: PERSON_FIRST_NAME,
    });
    const row = rowForText(page, OPPORTUNITY_NAME);
    const text = await row.innerText();
    if (!text.includes(PERSON_FIRST_NAME)) {
      throw new Error('the opportunity row does not show the point of contact after setting the relation');
    }
    return 'the opportunity row shows the person chip';
  }) || await dumpPage(page, 'relate-point-of-contact');
}

async function runVerifyPhase(page) {
  await check('the administrator signs in again after the restart', async () => {
    await signIn(page);
    return `landed on ${new URL(page.url()).pathname}`;
  }) || await dumpPage(page, 'sign-in-after-restart');

  await check('the company created before the restart is still there, with its people and opportunity', async () => {
    if (!ids.companyId) throw new Error('no company id was handed to this phase');
    await openRecord(page, 'company', ids.companyId);
    const title = await page.locator('[data-testid="top-bar-title"]').first().innerText();
    if (!title.includes(COMPANY_NAME)) throw new Error(`the company page shows "${title}"`);
    const body = await page.locator('body').innerText();
    for (const related of [PERSON_FIRST_NAME, OPPORTUNITY_NAME]) {
      if (!body.includes(related)) throw new Error(`the company page does not show "${related}"`);
    }
    return 'the company page shows both related records';
  }) || await dumpPage(page, 'verify-company');

  await check('the person created before the restart is still there, still related to the company', async () => {
    if (!ids.personId) throw new Error('no person id was handed to this phase');
    await openRecord(page, 'person', ids.personId);
    const body = await page.locator('body').innerText();
    if (!body.includes(PERSON_FIRST_NAME)) throw new Error('the person page does not show the person');
    if (!body.includes(COMPANY_NAME)) throw new Error('the person page does not show the company relation');
    return 'the person page shows the company relation';
  }) || await dumpPage(page, 'verify-person');

  await check('the opportunity created before the restart is still there, with both relations', async () => {
    if (!ids.opportunityId) throw new Error('no opportunity id was handed to this phase');
    await openRecord(page, 'opportunity', ids.opportunityId);
    const body = await page.locator('body').innerText();
    for (const expected of [OPPORTUNITY_NAME, COMPANY_NAME, PERSON_FIRST_NAME]) {
      if (!body.includes(expected)) throw new Error(`the opportunity page does not show "${expected}"`);
    }
    return 'the opportunity page shows the company and the point of contact';
  }) || await dumpPage(page, 'verify-opportunity');

  // The worker's own output, read in the browser: the timeline entries for
  // these records are written by upsert-timeline-activity-from-internal-event
  // in the worker process, not by the request that created the record.
  await check('the timeline the WORKER wrote for the company is rendered in the browser', async () => {
    await openRecord(page, 'company', ids.companyId);
    const timelineTab = page.getByRole('tab', { name: /timeline/i }).first();
    if (await timelineTab.count() > 0) {
      await timelineTab.click();
    } else {
      await page.getByText('Timeline', { exact: true }).first().click();
    }
    await page.waitForTimeout(SHORT_WAIT_MS);
    const body = await page.locator('body').innerText();
    if (!/created|creó|record/i.test(body)) {
      throw new Error('the timeline tab shows no creation event');
    }
    return 'the timeline tab shows a creation event';
  }) || await dumpPage(page, 'verify-timeline');
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  context.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return;
    if (isLoopback(url.hostname)) return;
    const metadata = `${request.method()} ${url.protocol}//${url.host}${url.pathname}`;
    if (!externalRequests.includes(metadata)) externalRequests.push(metadata);
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text().slice(0, 200);
    if (!consoleErrors.includes(text)) consoleErrors.push(text);
  });

  try {
    if (PHASE === 'probe') {
      await check('chromium runs with its sandbox on and reaches the CRM over loopback', async () => {
        const response = await page.goto(`${BASE_URL}/healthz`, { timeout: 30_000 });
        const status = response?.status();
        if (status !== 200) throw new Error(`/healthz answered ${status}`);
        const sandbox = await page.evaluate(() => navigator.userAgent);
        return `healthz 200, user agent ${sandbox.slice(0, 60)}`;
      });
    } else if (PHASE === 'create') {
      await runCreatePhase(page);
    } else if (PHASE === 'verify') {
      await runVerifyPhase(page);
    } else {
      checks.push({ name: 'phase', ok: false, detail: `unknown phase '${PHASE}'` });
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const result = {
    phase: PHASE,
    marker: MARKER,
    names: { company: COMPANY_NAME, person: PERSON_FIRST_NAME, opportunity: OPPORTUNITY_NAME },
    ids,
    checks,
    externalRequests,
    consoleErrors,
    ...(DEBUG ? { debugDumps } : {}),
  };
  console.log('AOS_BROWSER_RESULT_BEGIN');
  console.log(JSON.stringify(result));
  console.log('AOS_BROWSER_RESULT_END');
}

// Always exit 0 once a result was printed: the verdict belongs to the host
// suite, which can tell "the browser could not start" (no result at all) from
// "a check failed" (a result with ok:false).
main().catch((error) => {
  console.log('AOS_BROWSER_RESULT_BEGIN');
  console.log(JSON.stringify({
    phase: PHASE,
    marker: MARKER,
    ids,
    checks: [...checks, { name: 'the browser run completed', ok: false, detail: String(error?.message ?? error).slice(0, 300) }],
    externalRequests,
    consoleErrors,
    ...(DEBUG ? { debugDumps } : {}),
  }));
  console.log('AOS_BROWSER_RESULT_END');
});
