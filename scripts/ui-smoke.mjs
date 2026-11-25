/**
 * A real user's walk through the dashboard, in a real browser.
 *
 * What this exists for: every bug found so far by reading code (a preview that played nothing, invented
 * call stats, a property developer's campaigns shipped to every account) would have been visible in ten
 * seconds to someone loading the page. This loads the page.
 *
 * For each tab it records what a user would notice:
 *   - did it render, and how long did it take
 *   - console errors and uncaught exceptions
 *   - requests that failed (4xx/5xx), because a silent failed fetch is an empty panel
 *   - a screenshot, so the layout can be looked at rather than imagined
 *
 * Credentials come from the environment and are never written to disk:
 *   NOBO_EMAIL=... NOBO_PASS=... node scripts/ui-smoke.mjs [--headed] [--only=crm,whatsapp]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const EMAIL = process.env.NOBO_EMAIL;
const PASSWORD = process.env.NOBO_PASS;
const HEADED = process.argv.includes('--headed');
const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').replace('--only=', '');

if (!EMAIL || !PASSWORD) {
  console.error('Set NOBO_EMAIL and NOBO_PASS in the environment. They are deliberately not stored here.');
  process.exit(1);
}

const PAGES = [
  { name: 'crm', path: '/dashboard/crm' },
  { name: 'analytics', path: '/dashboard/analytics' },
  { name: 'creation', path: '/dashboard/creation' },
  { name: 'whatsapp', path: '/dashboard/whatsapp' },
  { name: 'profile', path: '/dashboard/profile' },
  { name: 'flows', path: '/dashboard/flows' },
  { name: 'ads', path: '/dashboard/ads' },
  { name: 'agent', path: '/dashboard/agent' },
  { name: 'ceo', path: '/dashboard/ceo' },
].filter((page) => !ONLY || ONLY.split(',').includes(page.name));

const OUT_DIR = path.join(process.cwd(), '.ui-screens');
mkdirSync(OUT_DIR, { recursive: true });

/** Noise that is not a defect: aborted navigations, favicon, analytics beacons. */
const IGNORED_REQUEST = /favicon|\.map$|_next\/static|vercel\/insights|sentry|hot-update/i;

const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const report = [];

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30_000 });
  // Type rather than fill: `fill()` sets the DOM value before React has hydrated, so the component's
  // state stays empty and the submit button never enables. A real user's keystrokes cannot outrun it.
  await page.locator('input[name="email"]').click();
  await page.locator('input[name="email"]').pressSequentially(EMAIL, { delay: 12 });
  await page.locator('input[name="password"]').click();
  await page.locator('input[name="password"]').pressSequentially(PASSWORD, { delay: 12 });
  // The submit button is disabled until the form is valid, and a fast fill can outrun that: wait for it
  // to become enabled instead of clicking into a disabled control.
  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await submit.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }).catch(() => null),
    submit.click(),
  ]);
  const url = page.url();
  if (!/\/dashboard/.test(url)) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(`login did not reach the dashboard (at ${url})\n${body.slice(0, 400)}`);
  }
  console.log(`logged in → ${url}`);
}

async function visit(target) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const onConsole = (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon|Download the React DevTools/i.test(text)) return;
    consoleErrors.push(text.slice(0, 300));
  };
  const onPageError = (error) => pageErrors.push(String(error?.message || error).slice(0, 300));
  const onResponse = (response) => {
    const url = response.url();
    if (IGNORED_REQUEST.test(url)) return;
    const status = response.status();
    if (status >= 400) failedRequests.push(`${status} ${url.replace(BASE, '').slice(0, 140)}`);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  const started = Date.now();
  let status = 'ok';
  try {
    await page.goto(`${BASE}${target.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Time to a usable page, not to "everything has ever loaded": networkidle can wait for ever on a
    // page with a polling loop, which is exactly how a slow tab gets excused.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);
  } catch (error) {
    status = `navigation failed: ${error?.message || error}`;
  }
  const ms = Date.now() - started;

  await page.waitForTimeout(1200); // let client-side fetches land before the screenshot
  const shot = path.join(OUT_DIR, `${target.name}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => null);

  const text = await page.locator('body').innerText().catch(() => '');
  const finalUrl = page.url();

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('response', onResponse);

  const entry = {
    name: target.name,
    path: target.path,
    finalUrl: finalUrl.replace(BASE, ''),
    status,
    ms,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
    pageErrors: [...new Set(pageErrors)].slice(0, 5),
    failedRequests: [...new Set(failedRequests)].slice(0, 10),
    textLength: text.length,
    bodyStart: text.replace(/\s+/g, ' ').slice(0, 220),
    screenshot: shot,
  };
  report.push(entry);
  return entry;
}

try {
  await login();
  for (const target of PAGES) {
    const entry = await visit(target);
    const flag = entry.status === 'ok' && entry.pageErrors.length === 0 && entry.consoleErrors.length === 0 && entry.failedRequests.length === 0 ? 'PASS' : 'LOOK';
    console.log(
      `${flag}  ${entry.name.padEnd(10)} ${String(entry.ms).padStart(6)}ms  ` +
        `text ${String(entry.textLength).padStart(6)}  console ${entry.consoleErrors.length}  ` +
        `pageErrors ${entry.pageErrors.length}  failedReqs ${entry.failedRequests.length}  → ${entry.finalUrl}`
    );
  }
} finally {
  const outFile = path.join(OUT_DIR, 'report.json');
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${outFile}`);
  console.log(`screenshots: ${OUT_DIR}`);
  await browser.close();
}
