/**
 * Pass 1: what can a user actually click on each tab?
 *
 * Dumps the buttons, tabs and links with their labels, so the interaction tests that follow use the
 * real labels instead of guesses. Also records console errors and failed requests per tab.
 *
 *   NOBO_EMAIL=... NOBO_PASS=... node scripts/ui-inventory.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const EMAIL = process.env.NOBO_EMAIL;
const PASSWORD = process.env.NOBO_PASS;
if (!EMAIL || !PASSWORD) {
  console.error('Set NOBO_EMAIL and NOBO_PASS.');
  process.exit(1);
}

const TABS = [
  { name: 'crm', path: '/dashboard/crm' },
  { name: 'whatsapp', path: '/dashboard/whatsapp' },
  { name: 'creation', path: '/dashboard/creation' },
  { name: 'profile', path: '/dashboard/profile' },
  { name: 'flows', path: '/dashboard/flows' },
  { name: 'ads', path: '/dashboard/ads' },
  { name: 'analytics', path: '/dashboard/analytics' },
  { name: 'catalog', path: '/dashboard/catalog' },
  { name: 'assets', path: '/dashboard/assets' },
];

const OUT = path.join(process.cwd(), '.ui-screens');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();

const results = [];

async function login() {
  const { login: doLogin } = await import('./lib/ui-login.mjs');
  const url = await doLogin(page, { baseUrl: BASE, email: EMAIL, password: PASSWORD });
  console.log(`logged in → ${url}`);
}
try {
  await login();

  for (const tab of TABS) {
    const consoleErrors = [];
    const failed = [];
    const onConsole = (message) => {
      if (message.type() === 'error' && !/favicon|DevTools/i.test(message.text())) consoleErrors.push(message.text().slice(0, 200));
    };
    const onResponse = (response) => {
      const url = response.url();
      if (/favicon|\.map$|_next\/static|vercel\/insights/.test(url)) return;
      if (response.status() >= 400) failed.push(`${response.status()} ${url.replace(BASE, '').slice(0, 110)}`);
    };
    page.on('console', onConsole);
    page.on('response', onResponse);

    const started = Date.now();
    await page.goto(`${BASE}${tab.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
    await page.waitForTimeout(6000);
    const controls = await page.evaluate(() => {
      const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      const buttons = [...document.querySelectorAll('button')].map((b) => clean(b.textContent)).filter(Boolean);
      const links = [...document.querySelectorAll('a')].map((a) => clean(a.textContent)).filter(Boolean);
      const selects = [...document.querySelectorAll('select')].map((s) => clean(s.getAttribute('aria-label') || s.name || 'select'));
      const inputs = [...document.querySelectorAll('input')].map((i) => clean(i.getAttribute('placeholder') || i.name || i.type));
      const audios = [...document.querySelectorAll('audio')].map((a) => a.getAttribute('src') || '');
      return {
        buttons: [...new Set(buttons)].slice(0, 40),
        links: [...new Set(links)].slice(0, 20),
        selects: [...new Set(selects)].slice(0, 10),
        inputs: [...new Set(inputs)].slice(0, 10),
        audios,
        bodyText: clean(document.body.innerText).slice(0, 160),
      };
    });
    await page.screenshot({ path: path.join(OUT, `inv-${tab.name}.png`) });
    page.off('console', onConsole);
    page.off('response', onResponse);

    results.push({ ...tab, ms: Date.now() - started, consoleErrors: [...new Set(consoleErrors)], failed: [...new Set(failed)], ...controls });
    console.log(`\n=== ${tab.name} (${Date.now() - started}ms) ===`);
    console.log(`  buttons : ${controls.buttons.slice(0, 18).join(' | ')}`);
    console.log(`  inputs  : ${controls.inputs.join(' | ')}`);
    console.log(`  selects : ${controls.selects.join(' | ')}`);
    if (controls.audios.length) console.log(`  audio   : ${controls.audios.join(' | ')}`);
    if (consoleErrors.length) console.log(`  CONSOLE : ${[...new Set(consoleErrors)].join(' | ')}`);
    if (failed.length) console.log(`  FAILED  : ${[...new Set(failed)].join(' | ')}`);
  }
} finally {
  writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
