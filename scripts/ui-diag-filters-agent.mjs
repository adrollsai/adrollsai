/**
 * Two open questions, answered by running them.
 *
 *  1. Why can the CRM list not be clicked after the filters panel has been opened once? Is the panel's
 *     open state persisted, and is it still covering the page after a reload?
 *  2. Does the agent actually answer from the UI, and how long does a cheap question take?
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { login } from './lib/ui-login.mjs';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
mkdirSync('.ui-screens', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) consoleErrors.push(m.text().slice(0, 160));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e?.message || e).slice(0, 160)}`));

try {
  await login(page, { baseUrl: BASE, email: process.env.NOBO_EMAIL, password: process.env.NOBO_PASS });

  // ── 1. Filters panel persistence
  await page.goto(`${BASE}/dashboard/crm`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);

  const openPanel = async () => {
    await page.locator('button').filter({ hasText: /^Filters$/ }).first().click({ timeout: 15_000 });
    await page.waitForTimeout(1500);
  };
  const panelState = async () =>
    page.evaluate(() => {
      const overlay = [...document.querySelectorAll('div')].find((node) => {
        const style = window.getComputedStyle(node);
        return (style.position === 'fixed' || style.position === 'absolute') && Number(style.zIndex || 0) >= 30 && node.getBoundingClientRect().height > 300;
      });
      const listButton = [...document.querySelectorAll('button')].find((b) => /List Table/i.test(b.textContent || ''));
      let coveredBy = null;
      if (listButton) {
        const box = listButton.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        coveredBy = top && listButton.contains(top) ? null : `${top?.tagName}.${String(top?.className || '').slice(0, 40)}`;
      }
      return {
        overlayVisible: Boolean(overlay),
        listButtonCoveredBy: coveredBy,
        storageKeys: Object.keys(localStorage).filter((key) => /filter|modal|panel/i.test(key)),
      };
    });

  console.log('before opening filters :', JSON.stringify(await panelState()));
  await openPanel();
  console.log('after opening filters  :', JSON.stringify(await panelState()));

  // Escape, then reload — does the panel come back?
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  console.log('after Escape           :', JSON.stringify(await panelState()));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
  const afterReload = await panelState();
  console.log('after reload           :', JSON.stringify(afterReload));

  // Can the list view be switched now?
  const tableButton = page.locator('button').filter({ hasText: /List Table/i }).first();
  const clicked = await tableButton.click({ timeout: 8000 }).then(() => true).catch((error) => String(error.message).split('\n')[0]);
  await page.waitForTimeout(2500);
  console.log('list-table click       :', clicked === true ? 'clicked' : clicked);
  console.log('tables rendered        :', await page.locator('table').count());
  await page.screenshot({ path: '.ui-screens/diag-crm-filters.png' });

  // ── 2. The agent, asked something cheap and factual
  await page.goto(`${BASE}/dashboard/agent`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const composer = page.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 20_000 });

  const started = Date.now();
  await composer.click();
  await composer.pressSequentially('How many leads do I have right now?', { delay: 8 });
  await page.keyboard.press('Enter');

  let firstTokenAt = 0;
  let doneAt = 0;
  let lastText = '';
  for (let attempt = 0; attempt < 240; attempt++) {
    const text = await page.locator('body').innerText().catch(() => '');
    if (text !== lastText) {
      if (!firstTokenAt && text.length > lastText.length + 20) firstTokenAt = Date.now() - started;
      lastText = text;
    }
    // The composer re-enabling is the signal the turn finished.
    const busy = await page.evaluate(() => {
      const element = document.querySelector('textarea');
      const buttons = [...document.querySelectorAll('button')];
      return Boolean(buttons.find((b) => /stop|thinking|cancel/i.test(b.textContent || ''))) || (element ? element.disabled : false);
    });
    if (!busy && Date.now() - started > 6000) {
      doneAt = Date.now() - started;
      break;
    }
    await page.waitForTimeout(500);
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const answer = bodyText.split(/\n+/).filter((line) => /\d/.test(line) && line.length > 15).slice(-6).join(' / ').slice(0, 400);
  console.log('\nagent turn:');
  console.log(`  first output  : ${firstTokenAt ? `${(firstTokenAt / 1000).toFixed(1)}s` : 'not seen'}`);
  console.log(`  finished      : ${doneAt ? `${(doneAt / 1000).toFixed(1)}s` : 'still running after 120s'}`);
  console.log(`  answer lines  : ${answer || '(nothing found)'}`);
  await page.screenshot({ path: '.ui-screens/diag-agent.png' });

  console.log(`\nconsole errors: ${consoleErrors.length ? [...new Set(consoleErrors)].join(' | ') : 'none'}`);
} finally {
  await browser.close();
}
