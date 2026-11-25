/**
 * Verify the two things from this round, against production.
 *
 *  1. The CRM filters sheet must NOT reopen on a reload, and Escape must close it.
 *  2. The agent must actually answer a question when sent from the composer (the previous run only
 *     typed into it — Enter does not submit; the send button does).
 */
import { chromium } from 'playwright';
import { login } from './lib/ui-login.mjs';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text().slice(0, 160));
});

const panelOpen = async () =>
  page.evaluate(() => {
    const listButton = [...document.querySelectorAll('button')].find((b) => /List Table/i.test(b.textContent || ''));
    if (!listButton) return { listButtonFound: false };
    const box = listButton.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { listButtonFound: true, covered: Boolean(top) && !listButton.contains(top) };
  });

try {
  await login(page, { baseUrl: BASE, email: process.env.NOBO_EMAIL, password: process.env.NOBO_PASS });

  // ── 1. filters sheet
  await page.goto(`${BASE}/dashboard/crm`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  console.log('fresh load, list covered?   ', JSON.stringify(await panelOpen()));

  await page.locator('button').filter({ hasText: /^Filters$/ }).first().click();
  await page.waitForTimeout(1500);
  console.log('after opening, covered?     ', JSON.stringify(await panelOpen()));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  console.log('after Escape, covered?      ', JSON.stringify(await panelOpen()));

  await page.locator('button').filter({ hasText: /^Filters$/ }).first().click();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  console.log('after reload, covered?      ', JSON.stringify(await panelOpen()));

  const listClick = await page
    .locator('button')
    .filter({ hasText: /List Table/i })
    .first()
    .click({ timeout: 10_000 })
    .then(() => 'clicked')
    .catch((error) => String(error.message).split('\n')[0]);
  await page.waitForTimeout(2500);
  console.log('list-table click            ', listClick, '→ tables:', await page.locator('table').count());

  // ── 2. the agent, actually sent
  await page.goto(`${BASE}/dashboard/agent`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const composer = page.locator('textarea').first();
  await composer.click();
  await composer.pressSequentially('How many leads do I have right now?', { delay: 8 });

  const before = (await page.locator('body').innerText()).length;
  // Send via the button in the composer's row (Enter does not submit this composer).
  const sendButton = page.locator('button').filter({ has: page.locator('svg') }).last();
  await sendButton.click({ timeout: 15_000 }).catch(async () => {
    await composer.press('Control+Enter');
  });

  const started = Date.now();
  let firstGrowth = 0;
  let stableSince = 0;
  let lastLength = before;
  for (let attempt = 0; attempt < 300; attempt++) {
    const length = (await page.locator('body').innerText()).length;
    if (length > lastLength + 10) {
      if (!firstGrowth) firstGrowth = Date.now() - started;
      lastLength = length;
      stableSince = Date.now();
    }
    if (stableSince && Date.now() - stableSince > 6000) break;
    await page.waitForTimeout(500);
  }

  const body = await page.locator('body').innerText();
  const grew = body.length - before;
  const numericAnswer = body
    .split(/\n+/)
    .filter((line) => /\b\d[\d,]{2,}\b/.test(line) && line.length > 12 && line.length < 300)
    .slice(-4)
    .join(' / ')
    .slice(0, 300);

  console.log('\nagent:');
  console.log(`  composer cleared        ${!(await composer.inputValue().catch(() => '')).trim()}`);
  console.log(`  first output            ${firstGrowth ? `${(firstGrowth / 1000).toFixed(1)}s` : 'none seen'}`);
  console.log(`  page text grew          ${grew > 0 ? `${grew} chars` : 'nothing'}`);
  console.log(`  answer with figures     ${numericAnswer || '(none found)'}`);
  console.log(`  console errors          ${errors.length ? [...new Set(errors)].join(' | ') : 'none'}`);
  await page.screenshot({ path: '.ui-screens/verify-agent.png' });
} finally {
  await browser.close();
}
