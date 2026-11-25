/**
 * The CRM as a big workspace actually experiences it.
 *
 * Loads /dashboard/crm?impersonate=<account> in a real browser and reports what a person sitting in
 * front of it gets: when the first lead appears, when the list stops changing, whether the bounded-load
 * notice is shown, and any errors.
 *
 *   NOBO_EMAIL=... NOBO_PASS=... node scripts/ui-crm-big.mjs <accountId>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const EMAIL = process.env.NOBO_EMAIL;
const PASSWORD = process.env.NOBO_PASS;
const ACCOUNT = process.argv[2] || '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

if (!EMAIL || !PASSWORD) {
  console.error('Set NOBO_EMAIL and NOBO_PASS.');
  process.exit(1);
}

const OUT = path.join(process.cwd(), '.ui-screens');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text().slice(0, 200));
});
page.on('pageerror', (error) => errors.push(`pageerror: ${String(error?.message || error).slice(0, 200)}`));

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 60_000 }).catch(() => null), page.click('button[type="submit"]')]);

  const target = `${BASE}/dashboard/crm?impersonate=${ACCOUNT}`;
  const started = Date.now();
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // When does the first lead appear? That is the number the owner feels.
  await page
    .locator('text=/\\b(Lead|leads)\\b/')
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => null);
  const firstContent = Date.now() - started;

  // Let the list settle: wait for the FIRST non-zero lead count (0 means "still loading" on this page),
  // then stop when the count stops changing for two seconds.
  let previous = '';
  let settledAt = 0;
  let firstNonZeroAt = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    const text = await page.locator('body').innerText().catch(() => '');
    const match = text.match(/All Leads\s+(\d+)/);
    const current = match ? match[1] : '';
    if (current && current !== '0' && !firstNonZeroAt) firstNonZeroAt = Date.now() - started;
    if (current && current !== '0' && current === previous) {
      settledAt = Date.now() - started;
      break;
    }
    previous = current;
    await page.waitForTimeout(1000);
  }

  const body = await page.locator('body').innerText().catch(() => '');
  const allLeads = body.match(/All Leads\s+(\d+)/)?.[1] ?? 'unknown';
  const notice = body.match(/Showing the [\d,]+ most recently active of [\d,]+ leads/i)?.[0] ?? null;
  const loadButton = body.match(/Load the other [\d,]+ of [\d,]+ leads/i)?.[0] ?? null;
  const pager = body.match(/Page \d+ of \d+/)?.[0] ?? null;

  await page.screenshot({ path: path.join(OUT, 'crm-bluesquare.png'), fullPage: false });

  console.log(`account           : ${ACCOUNT}`);
  console.log(`first content     : ${firstContent}ms`);
  console.log(`list settled      : ${settledAt || 'did not settle'}ms`);
  console.log(`All Leads counter : ${allLeads}`);
  console.log(`pager             : ${pager}`);
  console.log(`bounded notice    : ${notice ?? 'not shown (everything fits the eager window)'}`);
  console.log(`load-more button  : ${loadButton ?? 'not shown'}`);
  console.log(`errors            : ${errors.length ? [...new Set(errors)].slice(0, 5).join(' | ') : 'none'}`);

  // And the deliberate action: fetch the rest, and time it properly.
  //
  // The assertion is the END STATE (the notice is gone and the list holds every lead), not the absence
  // of a button label — that label becomes "Loading…" the moment it is clicked, so watching the label
  // reported success after 100ms while nothing had arrived.
  if (loadButton) {
    const button = page.locator('button:has-text("Load the other")').first();
    await button.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null);
    await page
      .waitForFunction(() => {
        const element = [...document.querySelectorAll('button')].find((b) => /Load the other/i.test(b.textContent || ''));
        return Boolean(element) && !element.disabled;
      }, { timeout: 20_000 })
      .catch(() => null);

    const restStarted = Date.now();
    await button.click().catch(() => null);

    let allLoadedAt = 0;
    for (let attempt = 0; attempt < 240; attempt++) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (!/Showing the [\d,]+ most recently active of/i.test(text)) {
        allLoadedAt = Date.now() - restStarted;
        break;
      }
      await page.waitForTimeout(500);
    }
    const after = await page.locator('body').innerText().catch(() => '');
    const counter = after.match(/All Leads\s+(\d+)/)?.[1] ?? 'unknown';
    console.log(
      `loaded the rest   : ${allLoadedAt ? `in ${(allLoadedAt / 1000).toFixed(1)}s` : 'did not finish in 120s'}` +
        ` · All Leads now ${counter}`
    );
    await page.screenshot({ path: path.join(OUT, 'crm-bluesquare-all.png'), fullPage: false });
  }
} finally {
  await browser.close();
}
