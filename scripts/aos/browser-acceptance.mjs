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
// createRequire, not a bare import: the playwright package is installed
// globally in the image (/usr/lib/node_modules, on NODE_PATH), and NODE_PATH is
// a CommonJS resolution mechanism that ESM import does not consult.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

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
// Navigation gets its own deadline because Playwright's default 30 s is a
// deadline on WORK here, not on an answer. Measured inside this very image on
// 2026-10-30 with the host otherwise idle: `/healthz` answers in 176 ms, and
// reaching `domcontentloaded` on the app's own page takes 11-13 s -- under 3x
// headroom, which two runs that afternoon spent (every `page.goto` of the
// create phase timed out at 30 s while the server was answering `/` in 0.2 s
// and another session had the 4-core distro at load 6). A page that never
// loads still fails, inside the phase budget the host test enforces.
const NAVIGATION_TIMEOUT_MS = Number(process.env.AOS_CRM_BROWSER_NAV_TIMEOUT_MS || 90_000);

const checks = [];
let sandbox = null;
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

// Measured, not asserted from the absence of a flag we did not pass: every
// chromium process this container is running, read off /proc, so the host suite
// can check that none of them carries --no-sandbox and that the sandboxed
// zygote is there. Only the switches are collected, never a full command line
// (it would carry the user-data dir).
function sandboxEvidence() {
  const switches = new Set();
  let chromiumProcesses = 0;
  let zygotes = 0;
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let cmdline;
    try { cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8'); } catch { continue; }
    const argv = cmdline.split('\0').filter(Boolean);
    if (argv.length === 0 || !/chrom/i.test(argv[0])) continue;
    chromiumProcesses += 1;
    for (const arg of argv.slice(1)) {
      if (!arg.startsWith('--')) continue;
      const name = arg.split('=')[0];
      switches.add(name);
      if (name === '--type' && arg.includes('zygote')) zygotes += 1;
    }
    if (argv.some((a) => a === '--type=zygote')) zygotes += 1;
  }
  return { chromiumProcesses, zygotes, switches: [...switches].sort(), uid: process.getuid?.() ?? null };
}

// The whole `.localhost` TLD is loopback by RFC 6761, and the browser now
// drives a WORKSPACE SUBDOMAIN of it (CRM-014: with multi-workspace on, the
// workspace is resolved from the subdomain, so the app's own origin is
// <subdomain>.localhost). Without the suffix every request the app makes to
// itself would be recorded as an external destination, which is both false and
// would bury the one thing this recorder exists to catch.
function isLoopback(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
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
    const text = (await page.locator('body').innerText()).replace(/\s+\n/g, '\n').slice(0, 6000);
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
  // A loaded index is one of three things: rows, the table's own add-new action
  // row, or the empty state a filtered view shows. Waiting for rows alone hangs
  // on a view whose filter matches nothing, which is how this suite first met
  // the Opportunities default view.
  await page.getByText('Add New', { exact: true })
    .or(page.locator('[data-testid^="row-id-"]'))
    .or(page.getByText(/No .* found/))
    .first()
    .waitFor({ timeout: LOCATOR_TIMEOUT_MS });
}

function rowForText(page, text) {
  return page.locator('[data-testid^="row-id-"]').filter({ hasText: text }).first();
}

// The id of the record the UI just created, read off the side panel the UI
// itself opens for it (/objects/people?panel=%2Fobject%2Fperson%2F<id>). The
// panel is the reliable half: a filtered view does not render a row for the new
// record at all, and then there is nothing to scrape.
async function idFromPanel(page, singular) {
  const pattern = new RegExp(`panel=%2Fobject%2F${singular}%2F([0-9a-f-]{36})`);
  await page.waitForURL(pattern, { timeout: LOCATOR_TIMEOUT_MS });
  return pattern.exec(page.url())?.[1] ?? null;
}

// The UI's own creation path: the table's "Add New" action row (or, on a view
// whose filter matches nothing, the empty state's own create button) creates
// the record and leaves its first cell in edit mode, so the name is typed into
// the real editor and committed with Enter.
async function createRecordThroughUi(page, { plural, singular, text }) {
  await openIndex(page, plural);
  // The action row lives at the BOTTOM of a virtualized table, so it is not
  // rendered until the table is scrolled there: looking for it the moment the
  // first row appears is how this step first failed on the People index.
  await page.mouse.wheel(0, 20_000);
  const addNew = page.getByText('Add New', { exact: true }).last();
  try {
    await addNew.waitFor({ timeout: 15_000 });
    await addNew.click();
  } catch {
    // A view whose filter matches nothing renders no table at all, only its
    // empty state and that state's own create button.
    await page.getByRole('button', { name: /^Add a /i }).first().click();
  }
  // Wait for the cell editor the UI opens for the new row, then type INTO ITS
  // INPUT and read the value back before committing. Measured: typing on the
  // page after a fixed pause lost the first characters ("Marta probe4" was
  // saved as "a probe4"), because the editor had not mounted yet -- and a
  // record created under a truncated name would then fail the relation step for
  // a reason that has nothing to do with relations.
  await page.waitForFunction(() => {
    const active = document.activeElement;
    return Boolean(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
  }, { timeout: LOCATOR_TIMEOUT_MS });
  const input = page.locator('input:focus, textarea:focus, [contenteditable="true"]:focus').first();
  await input.pressSequentially(text, { delay: 25 });
  const readBack = async () => input.evaluate((el) => ('value' in el ? el.value : el.textContent) ?? '');
  if (await readBack() !== text) {
    await input.fill(text);
    const refilled = await readBack();
    if (refilled !== text) throw new Error(`the editor holds "${refilled}" instead of the name this run meant to type`);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(SHORT_WAIT_MS);
  const id = await idFromPanel(page, singular);
  if (!id) throw new Error('the UI opened no side panel for the record it created');
  return id;
}

// A relation set through the record page's own field cell. An empty field
// renders its label as the placeholder of its value cell, so inside the fields
// widget the LAST exact match for the label is the value and the first is the
// label itself. Clicking it opens the relation picker, the search text filters
// it and the option is clicked by the record's own name.
async function setRelationOnRecordPage(page, { singular, id, fieldLabel, searchText, optionText }) {
  await openRecord(page, singular, id);
  const widget = page.getByTestId('record-fields-widget');
  await widget.waitFor({ timeout: LOCATOR_TIMEOUT_MS });

  // Which of the label's occurrences is the value cell is a rendering detail,
  // so this tries them and keeps the one that actually opened an editor instead
  // of assuming. The editor's own container is the evidence that it opened.
  const editor = page.locator('[data-testid="inline-cell-edit-mode-container"]');
  const candidates = widget.getByText(fieldLabel, { exact: true });
  const total = await candidates.count();
  // Measured: the value cell resolves but a plain click times out on
  // actionability (it sits under the field row's own hover layer), so each
  // candidate is tried normally and then forced, and the editor's own container
  // is the evidence of which attempt actually opened it.
  const attempts = [];
  for (const index of [total - 1, 1, 0].filter((i, p, all) => i >= 0 && i < total && all.indexOf(i) === p)) {
    for (const force of [false, true]) {
      attempts.push({ index, force });
    }
  }
  let opened = null;
  for (const attempt of attempts) {
    try {
      await candidates.nth(attempt.index).click({ force: attempt.force, timeout: 8_000 });
    } catch {
      continue;
    }
    await page.waitForTimeout(700);
    if (await editor.count() > 0) { opened = attempt; break; }
    await page.keyboard.press('Escape');
  }
  if (opened === null) {
    throw new Error(`clicking the ${fieldLabel} field opened no editor in ${attempts.length} attempt(s) over ${total} matching node(s)`);
  }

  // The picker's search box, clicked and then typed into KEY BY KEY: measured,
  // locator.fill() sets the value without the picker's query ever changing (the
  // list came back unfiltered, missing the record this was looking for), and
  // keystrokes sent to the page with no focus went nowhere.
  const input = page.locator('input:visible');
  const inputs = await input.count();
  if (inputs === 0) throw new Error(`the ${fieldLabel} picker opened with no search box`);
  await input.last().click();
  await input.last().pressSequentially(searchText, { delay: 25 });
  await page.waitForTimeout(2_500);

  // Not exact: an option renders its record name inside a chip whose element
  // text carries more than the name.
  const option = page.getByText(optionText, { exact: false }).last();
  if (await option.count() === 0) {
    const offered = (await page.locator('body').innerText())
      .split('\n').map((l) => l.trim()).filter(Boolean).slice(-12).join(' | ');
    throw new Error(`the ${fieldLabel} picker (opened by ${JSON.stringify(opened)}, ${inputs} visible input(s)) offered no option matching the record; last lines on screen: ${offered}`);
  }
  await option.click({ timeout: LOCATOR_TIMEOUT_MS });
  await page.waitForTimeout(SHORT_WAIT_MS);
  await page.keyboard.press('Escape');
  // Read back from a FRESH load, not from the DOM that was just mutated: what
  // matters is that the relation was persisted, not that a chip appeared.
  await openRecord(page, singular, id);
  const body = await page.locator('body').innerText();
  if (!body.includes(optionText)) {
    throw new Error(`after reloading, the ${singular} page does not show "${optionText}" in its ${fieldLabel} field`);
  }
}

async function openRecord(page, singular, id) {
  await page.goto(`${BASE_URL}/object/${singular}/${id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="top-bar-title"]').first().waitFor({ timeout: LOCATOR_TIMEOUT_MS });
  await page.getByTestId('record-fields-widget').waitFor({ timeout: LOCATOR_TIMEOUT_MS });
}

// The record page renders its frame -- title bar and fields widget -- BEFORE
// the record itself arrives, and shows "Untitled (0/0)" in the meantime.
// Measured right after a server restart: the first load came back with that
// placeholder and an assertion on the body text failed on a record that was
// perfectly fine. So the wait is for the record's own text, with reloads.
async function openRecordAndWaitFor(page, singular, id, text) {
  let last = 'never loaded';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await openRecord(page, singular, id);
    try {
      await page.getByText(text, { exact: false }).first().waitFor({ timeout: 20_000 });
      return;
    } catch {
      last = (await page.locator('[data-testid="top-bar-title"]').first().innerText()).slice(0, 60);
      await page.waitForTimeout(2_000);
    }
  }
  throw new Error(`the ${singular} page never showed "${text}" in 3 loads (last title: "${last}")`);
}

// The three relation steps, shared by the create phase and by the 'relate'
// phase the relation work was iterated with (ids handed in, nothing created).
//
// The picker is searched by this run's own MARKER and not by the full record
// name: measured, the dropdown returns a BOUNDED list, so searching
// "Ensayos Sinteticos" while four companies shared that prefix pushed the one
// this run had just created off the end of the list and the step failed with
// the picker showing four other records.
async function runRelationSteps(page) {
  await check('the person is related to the company through the UI, and the relation survives a reload', async () => {
    await setRelationOnRecordPage(page, {
      singular: 'person',
      id: ids.personId,
      fieldLabel: 'Company',
      searchText: MARKER,
      optionText: COMPANY_NAME,
    });
    return 'the person page shows the company after a fresh load';
  }) || await dumpPage(page, 'relate-person');

  await check('the opportunity is related to the company through the UI, and the relation survives a reload', async () => {
    await setRelationOnRecordPage(page, {
      singular: 'opportunity',
      id: ids.opportunityId,
      fieldLabel: 'Company',
      searchText: MARKER,
      optionText: COMPANY_NAME,
    });
    return 'the opportunity page shows the company after a fresh load';
  }) || await dumpPage(page, 'relate-opportunity');

  await check('the opportunity point of contact is the synthetic person, set through the UI', async () => {
    await setRelationOnRecordPage(page, {
      singular: 'opportunity',
      id: ids.opportunityId,
      fieldLabel: 'Point of Contact',
      searchText: MARKER,
      optionText: PERSON_FIRST_NAME,
    });
    return 'the opportunity page shows the point of contact after a fresh load';
  }) || await dumpPage(page, 'relate-point-of-contact');
}

async function runCreatePhase(page) {
  await check('the administrator signs in through the browser form', async () => {
    await signIn(page);
    return `landed on ${new URL(page.url()).pathname}`;
  }) || await dumpPage(page, 'sign-in');

  await check('a synthetic company is created through the UI', async () => {
    ids.companyId = await createRecordThroughUi(page, { plural: 'companies', singular: 'company', text: COMPANY_NAME });
    return `company ${ids.companyId}`;
  }) || await dumpPage(page, 'create-company');

  await check('a synthetic person is created through the UI', async () => {
    ids.personId = await createRecordThroughUi(page, { plural: 'people', singular: 'person', text: PERSON_FIRST_NAME });
    return `person ${ids.personId}`;
  }) || await dumpPage(page, 'create-person');

  await check('a synthetic opportunity is created through the UI', async () => {
    ids.opportunityId = await createRecordThroughUi(page, { plural: 'opportunities', singular: 'opportunity', text: OPPORTUNITY_NAME });
    return `opportunity ${ids.opportunityId}`;
  }) || await dumpPage(page, 'create-opportunity');

  await runRelationSteps(page);
}

// CRM-005 point 5: the document viewer, if it is reachable at all from a
// record's Files tab. Two things are measured here and nowhere else:
//
//  - a synthetic MS Office attachment must NOT make the page load
//    view.officeapps.live.com (upstream's DocumentViewer offers a download
//    instead when the file URL is private -- see .aos/reports/
//    DOCUMENT-VIEWER-triage.md). The externalRequests recorder is what proves
//    it: every request to a non-loopback host is reported.
//  - a TXT attachment whose content LOOKS like HTML must be displayed escaped.
//    GHSA-fvhg-p4hf-79x3 / CVE-2026-30691 claims the TXTRenderer casts text to
//    a ReactNode; the triage found JSX interpolation and a non-reproducibility
//    objection, and said to settle it with a real browser and synthetic text
//    that looks like markup. The file below carries an onerror payload that
//    would set a flag on window if the markup were ever parsed as HTML, and the
//    check reads that flag.
const XSS_FLAG = '__aosCrm005ViewerMarkupExecuted';
const VIEWER_TXT_MARKER = 'AOS-CRM-005 texto sintetico con markup';
const VIEWER_TXT_PAYLOAD =
  `${VIEWER_TXT_MARKER}\n<img src=x onerror="window.${XSS_FLAG}=true">\n<script>window.${XSS_FLAG}=true</script>\n`;

async function runViewerPhase(page) {
  await check('the administrator signs in through the browser form', async () => {
    await signIn(page);
    return `landed on ${new URL(page.url()).pathname}`;
  }) || await dumpPage(page, 'viewer-sign-in');

  await check('a synthetic company is created to hold the attachments', async () => {
    ids.companyId = ids.companyId || await createRecordThroughUi(page, { plural: 'companies', singular: 'company', text: COMPANY_NAME });
    return `company ${ids.companyId}`;
  }) || await dumpPage(page, 'viewer-company');

  const txtPath = `/tmp/aos-crm-005-${MARKER}.txt`;
  const officePath = `/tmp/aos-crm-005-${MARKER}.docx`;
  writeFileSync(txtPath, VIEWER_TXT_PAYLOAD, 'utf8');
  // Not a real document: the viewer picks its renderer from the EXTENSION (see
  // the triage), so these bytes are enough to exercise the MS Office branch
  // without shipping a binary fixture.
  writeFileSync(officePath, `${VIEWER_TXT_MARKER} (office sintetico)\n`, 'utf8');

  await check('both synthetic attachments are uploaded through the record Files tab', async () => {
    await openRecord(page, 'company', ids.companyId);
    const filesTab = page.getByText('Files', { exact: true }).first();
    await filesTab.waitFor({ timeout: LOCATOR_TIMEOUT_MS });
    await filesTab.click();
    await page.waitForTimeout(SHORT_WAIT_MS);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: LOCATOR_TIMEOUT_MS });
    await fileInput.setInputFiles([txtPath, officePath]);
    await page.waitForTimeout(4_000);
    const body = await page.locator('body').innerText();
    if (!body.includes(`aos-crm-005-${MARKER}`)) {
      throw new Error('neither attachment appears in the Files tab after the upload');
    }
    return 'both attachments are listed';
  }) || await dumpPage(page, 'viewer-upload');

  await check('a TXT attachment that looks like HTML is displayed escaped, and its markup never executes', async () => {
    await page.getByText(`aos-crm-005-${MARKER}.txt`, { exact: false }).first().click();
    await page.waitForTimeout(4_000);
    const body = await page.locator('body').innerText();
    if (!body.includes(VIEWER_TXT_MARKER)) {
      throw new Error('the TXT preview does not show the file content at all');
    }
    if (!body.includes('<img src=x onerror=')) {
      throw new Error('the TXT preview shows the content but not the markup as text: it may have been parsed as HTML');
    }
    const executed = await page.evaluate((flag) => Boolean(window[flag]), XSS_FLAG);
    if (executed) throw new Error('the markup in the TXT file EXECUTED in the browser');
    return 'the markup is rendered as text and nothing executed';
  }) || await dumpPage(page, 'viewer-txt');

  await check('a synthetic MS Office attachment is not sent to view.officeapps.live.com', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1_000);
    await openRecord(page, 'company', ids.companyId);
    await page.getByText('Files', { exact: true }).first().click();
    await page.waitForTimeout(SHORT_WAIT_MS);
    await page.getByText(`aos-crm-005-${MARKER}.docx`, { exact: false }).first().click();
    await page.waitForTimeout(5_000);
    const microsoft = externalRequests.filter((r) => r.includes('officeapps.live.com') || r.includes('office.com'));
    if (microsoft.length > 0) {
      throw new Error(`the office preview reached Microsoft: ${microsoft.join(' | ')}`);
    }
    const body = await page.locator('body').innerText();
    // Upstream's own fallback for a private URL: a download affordance instead
    // of the external iframe.
    const offersDownload = /download|descargar/i.test(body);
    return offersDownload
      ? 'no request to Microsoft, and the viewer offers a download instead'
      : 'no request to Microsoft (no download affordance was found on screen)';
  }) || await dumpPage(page, 'viewer-office');
}

async function runVerifyPhase(page) {
  await check('the administrator signs in again after the restart', async () => {
    await signIn(page);
    return `landed on ${new URL(page.url()).pathname}`;
  }) || await dumpPage(page, 'sign-in-after-restart');

  await check('the company created before the restart is still there, with its people and opportunity', async () => {
    if (!ids.companyId) throw new Error('no company id was handed to this phase');
    await openRecordAndWaitFor(page, 'company', ids.companyId, COMPANY_NAME);
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
    await openRecordAndWaitFor(page, 'person', ids.personId, PERSON_FIRST_NAME);
    const body = await page.locator('body').innerText();
    if (!body.includes(PERSON_FIRST_NAME)) throw new Error('the person page does not show the person');
    if (!body.includes(COMPANY_NAME)) throw new Error('the person page does not show the company relation');
    return 'the person page shows the company relation';
  }) || await dumpPage(page, 'verify-person');

  await check('the opportunity created before the restart is still there, with both relations', async () => {
    if (!ids.opportunityId) throw new Error('no opportunity id was handed to this phase');
    await openRecordAndWaitFor(page, 'opportunity', ids.opportunityId, OPPORTUNITY_NAME);
    const body = await page.locator('body').innerText();
    for (const expected of [OPPORTUNITY_NAME, COMPANY_NAME, PERSON_FIRST_NAME]) {
      if (!body.includes(expected)) throw new Error(`the opportunity page does not show "${expected}"`);
    }
    return 'the opportunity page shows the company and the point of contact';
  }) || await dumpPage(page, 'verify-opportunity');

  // The worker's own output, read in the browser: the timeline entries for
  // these records are written by upsert-timeline-activity-from-internal-event
  // in the worker process, not by the request that created the record.
  await check('the timeline entry the WORKER wrote for the company is rendered in the browser', async () => {
    // The record page's own Timeline section, not a tab: the entries come from
    // the workspace's timelineActivity table, which the worker fills through
    // upsert-timeline-activity-from-internal-event -- the request that created
    // the record does not write them.
    await openRecordAndWaitFor(page, 'company', ids.companyId, COMPANY_NAME);
    await page.waitForTimeout(SHORT_WAIT_MS);
    const body = await page.locator('body').innerText();
    if (!body.includes('was created by')) {
      throw new Error('the record page shows no timeline creation entry');
    }
    return 'the record page shows the creation entry the worker wrote';
  }) || await dumpPage(page, 'verify-timeline');
}

async function main() {
  // chromiumSandbox: true EXPLICITLY. Playwright's own default for
  // chromium.launch() is FALSE -- measured on 2026-10-29, the process tree came
  // back carrying --no-sandbox without anyone asking for it -- and a browser
  // with its sandbox off is not the browser this acceptance is about.
  const browser = await chromium.launch({ chromiumSandbox: true });
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
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  sandbox = sandboxEvidence();
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
    } else if (PHASE === 'explore') {
      // Not part of the gate: a one-off structural dump (text, test ids,
      // buttons -- never a screenshot) used while writing the UI steps below.
      await check('explore', async () => {
        await signIn(page);
        for (const [singular, id] of Object.entries({ company: IDS.companyId, person: IDS.personId })) {
          if (!id) continue;
          await openRecord(page, singular, id);
          await page.waitForTimeout(SHORT_WAIT_MS);
          await dumpPage(page, `record-${singular}`);
        }
        return 'dumped';
      });
    } else if (PHASE === 'create') {
      await runCreatePhase(page);
    } else if (PHASE === 'relate') {
      // The relation steps alone, over records handed in: how the UI relation
      // path was iterated without creating a new record for every attempt.
      await check('the administrator signs in through the browser form', async () => {
        await signIn(page);
        return `landed on ${new URL(page.url()).pathname}`;
      });
      await runRelationSteps(page);
    } else if (PHASE === 'viewer') {
      await runViewerPhase(page);
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
    sandbox,
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
    names: { company: COMPANY_NAME, person: PERSON_FIRST_NAME, opportunity: OPPORTUNITY_NAME },
    ids,
    sandbox,
    checks: [...checks, { name: 'the browser run completed', ok: false, detail: String(error?.message ?? error).slice(0, 300) }],
    externalRequests,
    consoleErrors,
    ...(DEBUG ? { debugDumps } : {}),
  }));
  console.log('AOS_BROWSER_RESULT_END');
});
