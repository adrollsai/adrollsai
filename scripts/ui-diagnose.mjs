/**
 * Diagnose the four steps that failed, so each is either a harness problem or a product defect.
 */
import { chromium } from 'playwright';
import { login } from './lib/ui-login.mjs';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

const describe = async (selector) =>
  page.$$eval(selector, (nodes) =>
    nodes.slice(0, 40).map((node) => {
      const box = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        text: String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        tag: node.tagName,
        visible: box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
        disabled: Boolean(node.disabled),
      };
    })
  );

try {
  await login(page, { baseUrl: BASE, email: process.env.NOBO_EMAIL, password: process.env.NOBO_PASS });

  // ── 1. CRM view switch
  await page.goto(`${BASE}/dashboard/crm`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const crmCandidates = (await describe('button')).filter((entry) => /list table|grid cards/i.test(entry.text));
  console.log('CRM view buttons:', JSON.stringify(crmCandidates));
  const tableButton = page.locator('button', { hasText: /List Table/i }).first();
  console.log('  count of buttons matching List Table:', await page.locator('button').filter({ hasText: /List Table/i }).count());
  if (await tableButton.count()) {
    await tableButton.scrollIntoViewIfNeeded().catch(() => null);
    await tableButton.click({ timeout: 8000 }).catch((error) => console.log('  click error:', String(error.message).split('\n')[0]));
    await page.waitForTimeout(2500);
    console.log('  tables after click:', await page.locator('table').count());
    const body = await page.locator('body').innerText();
    console.log('  has table headers:', /Lead|Phone|Status|Source/.test(body.slice(0, 3000)));
  }

  // ── 2. WhatsApp conversation
  await page.goto(`${BASE}/dashboard/whatsapp`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const rows = (await describe('div')).filter((entry) => /Today, \d{2}:\d{2}/.test(entry.text));
  console.log('\nWhatsApp rows found:', rows.length, JSON.stringify(rows.slice(0, 3)));
  const clickable = await page.$$eval('[class*="cursor-pointer"], button, a, li', (nodes) =>
    nodes
      .filter((node) => /Today, \d{2}:\d{2}/.test(node.textContent || ''))
      .slice(0, 5)
      .map((node) => ({ tag: node.tagName, cls: String(node.className).slice(0, 60), text: String(node.textContent || '').replace(/\s+/g, ' ').slice(0, 40) }))
  );
  console.log('  clickable candidates:', JSON.stringify(clickable));
  const row = page.locator('[class*="cursor-pointer"]').filter({ hasText: /Today, \d{2}:\d{2}/ }).first();
  console.log('  cursor-pointer rows:', await page.locator('[class*="cursor-pointer"]').filter({ hasText: /Today, \d{2}:\d{2}/ }).count());
  if (await row.count()) {
    await row.click({ timeout: 8000 }).catch((error) => console.log('  click error:', String(error.message).split('\n')[0]));
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText();
    console.log('  pane still says select:', /SELECT A CONVERSATION/i.test(body));
    await page.screenshot({ path: '.ui-screens/diag-whatsapp.png' });
  }

  // ── 3. Profile voice preview
  await page.goto(`${BASE}/dashboard/profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const voiceish = (await describe('button')).filter((entry) => /voice|preview|listen|sample|call/i.test(entry.text));
  console.log('\nProfile voice-ish buttons:', JSON.stringify(voiceish.slice(0, 8)));
  console.log('  audio elements on load:', await page.locator('audio').count());
  const tabs = (await describe('button')).filter((entry) => entry.visible).map((entry) => entry.text).slice(0, 25);
  console.log('  visible buttons:', JSON.stringify(tabs));

  // ── 4. Creation chat
  await page.goto(`${BASE}/dashboard/creation`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const openChat = (await describe('button')).filter((entry) => /open active chat/i.test(entry.text));
  console.log('\nCreation "Open Active Chat":', JSON.stringify(openChat));
  const anchorOrButton = await page.$$eval('button, a', (nodes) =>
    nodes.filter((node) => /Open Active Chat/i.test(node.textContent || '')).map((node) => ({ tag: node.tagName, disabled: Boolean(node.disabled) }))
  );
  console.log('  elements:', JSON.stringify(anchorOrButton));
  if (anchorOrButton.length) {
    await page.locator('button, a').filter({ hasText: /Open Active Chat/i }).first().click({ timeout: 8000 }).catch((error) => console.log('  click error:', String(error.message).split('\n')[0]));
    await page.waitForTimeout(3000);
    console.log('  textareas after click:', await page.locator('textarea').count());
    await page.screenshot({ path: '.ui-screens/diag-creation.png' });
  }
} finally {
  await browser.close();
}
