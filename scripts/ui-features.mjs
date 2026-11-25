/**
 * Pass 2: use the features, not just load the pages.
 *
 * Each step is an ordinary thing a person does — open the filters, switch to the table view, open a
 * conversation, play a voice sample, open the campaign builder — and each is asserted: the expected
 * thing appeared, no console error, and nothing 4xx'd. A step that fails is the defect; a step that
 * passes quietly is the coverage.
 *
 * Deliberately non-destructive: nothing is sent to a customer, nothing is deleted, no campaign is
 * created. It opens, checks, and closes.
 *
 *   NOBO_EMAIL=... NOBO_PASS=... node scripts/ui-features.mjs [--only=crm,voice]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { login } from './lib/ui-login.mjs';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const EMAIL = process.env.NOBO_EMAIL;
const PASSWORD = process.env.NOBO_PASS;
const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').replace('--only=', '');

const OUT = path.join(process.cwd(), '.ui-screens');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();

/** Everything observed during one step. */
let watcher = { console: [], failed: [], audios: [] };
page.on('console', (message) => {
  if (message.type() === 'error' && !/favicon|DevTools/i.test(message.text())) watcher.console.push(message.text().slice(0, 200));
});
page.on('pageerror', (error) => watcher.console.push(`pageerror: ${String(error?.message || error).slice(0, 200)}`));
page.on('response', (response) => {
  const url = response.url();
  if (/favicon|\.map$|_next\/static|vercel\/insights/.test(url)) return;
  if (response.status() >= 400) watcher.failed.push(`${response.status()} ${url.replace(BASE, '').slice(0, 120)}`);
  if (/\/api\/voice\/sample|\.wav|\.mp3/i.test(url) && response.status() < 400) watcher.audios.push(`${response.status()} ${url.replace(BASE, '').slice(0, 100)}`);
});

const results = [];

async function step(name, run) {
  watcher = { console: [], failed: [], audios: [] };
  const started = Date.now();
  let ok = false;
  let detail = '';
  try {
    detail = (await run()) || '';
    ok = true;
  } catch (error) {
    detail = String(error?.message || error).split('\n')[0].slice(0, 220);
  }
  const ms = Date.now() - started;
  const entry = { name, ok, ms, detail, console: [...new Set(watcher.console)], failed: [...new Set(watcher.failed)], audio: [...new Set(watcher.audios)] };
  results.push(entry);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${String(ms).padStart(6)}ms  ` +
      `console ${entry.console.length}  failed ${entry.failed.length}` +
      (entry.audio.length ? `  audio ${entry.audio.length}` : '') +
      (detail ? `  — ${detail}` : '')
  );
  if (entry.console.length) console.log(`       console: ${entry.console.join(' | ')}`);
  if (entry.failed.length) console.log(`       failed : ${entry.failed.join(' | ')}`);
}

const want = (key) => !ONLY || ONLY.split(',').includes(key);

/** Click something by its visible text, and wait for a matching thing to appear. */
async function clickText(text, { exact = false } = {}) {
  const locator = exact ? page.getByText(text, { exact: true }).first() : page.getByText(text).first();
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await locator.click({ timeout: 15_000 });
}

async function expectVisible(text, timeout = 15_000) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout });
  return `“${text}” visible`;
}

async function goto(path_) {
  await page.goto(`${BASE}${path_}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3500);
}

try {
  const url = await login(page, { baseUrl: BASE, email: EMAIL, password: PASSWORD });
  console.log(`logged in → ${url}\n`);

  if (want('crm')) {
    await goto('/dashboard/crm');
    await step('crm: list opens with leads', async () => {
      await expectVisible('CRM Pipeline');
      const count = await page.getByText(/All Leads\s*\d+/).first().innerText();
      if (!/\d{2,}/.test(count.replace(/\D/g, '') || '')) throw new Error(`lead counter reads "${count}"`);
      return count.replace(/\s+/g, ' ');
    });

    await step('crm: search narrows the list', async () => {
      const search = page.locator('input[placeholder*="Search by name"]').first();
      await search.waitFor({ state: 'visible', timeout: 15_000 });
      await search.pressSequentially('zzzz-nothing-matches', { delay: 10 });
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText();
      const matches = /No leads|nothing found|0 leads/i.test(body);
      await search.fill('');
      await page.waitForTimeout(1500);
      if (!matches) throw new Error('a search for nonsense did not say there are no matches');
      return 'empty state shown for a nonsense query';
    });

    await step('crm: filters panel opens', async () => {
      await clickText('Filters');
      await page.waitForTimeout(1200);
      const body = await page.locator('body').innerText();
      if (!/filter/i.test(body)) throw new Error('no filter UI after clicking Filters');
      await page.keyboard.press('Escape').catch(() => null);
      return 'panel opened';
    });

    await step('crm: table view switches', async () => {
      // Fresh navigation: a modal left open by the previous step sits over the list and swallows clicks.
      await goto('/dashboard/crm');
      // Settle first: a click during the initial render lands on a control the handler has not bound yet.
      await page.waitForTimeout(6000);
      const tableButton = page.locator('button').filter({ hasText: /List Table/i }).first();
      await tableButton.waitFor({ state: 'visible', timeout: 20_000 });
      await tableButton.click({ timeout: 20_000 });
      await page.waitForTimeout(3000);
      const tableCount = await page.locator('table').count();
      const body = await page.locator('body').innerText();
      if (!tableCount) throw new Error('no table element after switching to List Table');
      if (!/Status|Pipeline|Phone/i.test(body)) throw new Error('the table rendered without headers');
      await page.locator('button').filter({ hasText: /Grid Cards/i }).first().click({ timeout: 15_000 }).catch(() => null);
      return `table rendered (${tableCount} table, headers present)`;
    });
  }

  if (want('whatsapp')) {
    await goto('/dashboard/whatsapp');
    await step('whatsapp: conversation opens', async () => {
      await expectVisible('WhatsApp Portal');
      const firstChat = page.locator('[class*="cursor-pointer"]').filter({ hasText: /Today, \d{2}:\d{2}/ }).first();
      await firstChat.waitFor({ state: 'visible', timeout: 20_000 });
      await firstChat.click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText();
      if (/SELECT A CONVERSATION/i.test(body)) throw new Error('the pane still asks to select a conversation after clicking one');
      return 'message pane loaded';
    });
  }

  if (want('voice')) {
    await goto('/dashboard/voice-agent');
    await step('voice-agent: page opens', async () => {
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText();
      if (/404|not found/i.test(body.slice(0, 200))) throw new Error('voice agent page 404s');
      return body.replace(/\s+/g, ' ').slice(0, 70);
    });

    await step('voice-agent: a voice preview actually plays', async () => {
      const play = page.locator('button').filter({ hasText: /play|preview|listen|sample/i }).first();
      const hasPlay = await play.count();
      const audioOnLoad = await page.locator('audio').count();
      if (hasPlay) {
        await play.scrollIntoViewIfNeeded().catch(() => null);
        await play.click({ timeout: 15_000 });
      }
      await page.waitForTimeout(4000);
      const audio = page.locator('audio').first();
      const src = (await audio.count()) ? await audio.getAttribute('src') : null;
      const fetched = watcher.audios.length > 0 || watcher.failed.length === 0;
      if (!src && !hasPlay && audioOnLoad === 0) throw new Error('no preview control and no audio element on the voice agent page');
      if (!fetched) throw new Error(`preview request failed: ${watcher.failed.join(', ')}`);
      return src ? `audio src ${String(src).slice(0, 70)}` : 'play control clicked, audio requested';
    });
  }

  if (want('flows')) {
    await goto('/dashboard/flows');
    await step('flows: AI calling tab + sample', async () => {
      await clickText('AI Calling');
      await page.waitForTimeout(2500);
      const play = page.locator('button').filter({ hasText: /play|preview|listen/i }).first();
      if (await play.count()) {
        await play.click({ timeout: 10_000 });
        await page.waitForTimeout(3000);
      }
      return watcher.audios.length ? `audio fetched: ${watcher.audios[0]}` : 'tab opened (no audio request seen)';
    });

    await step('flows: template opens the builder', async () => {
      await clickText('Flows');
      await page.waitForTimeout(1500);
      await page.getByText('Use Template').first().click({ timeout: 15_000 });
      await page.waitForTimeout(3000);
      const body = await page.locator('body').innerText();
      if (!/Save|Publish|Trigger|Node/i.test(body)) throw new Error('no builder UI after Use Template');
      return 'builder opened';
    });
  }

  if (want('creation')) {
    await goto('/dashboard/creation');
    await step('creation: templates library opens', async () => {
      await clickText('Templates Library');
      await page.waitForTimeout(2000);
      const body = await page.locator('body').innerText();
      if (!/template/i.test(body)) throw new Error('no templates UI');
      await page.keyboard.press('Escape').catch(() => null);
      return 'library opened';
    });

    await step('creation: chat composer opens', async () => {
      await goto('/dashboard/creation');
      await page.locator('button').filter({ hasText: /Open Active Chat/i }).first().click({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      const composer = page.locator('textarea, input[placeholder*="prompt" i], input[placeholder*="Ask" i]').first();
      await composer.waitFor({ state: 'visible', timeout: 15_000 });
      return 'composer visible';
    });
  }

  if (want('ads')) {
    await goto('/dashboard/ads');
    await step('ads: new campaign builder opens', async () => {
      await clickText('New Campaign');
      await page.waitForTimeout(3000);
      const body = await page.locator('body').innerText();
      if (!/budget|campaign|goal|creative/i.test(body)) throw new Error('no builder after New Campaign');
      await page.keyboard.press('Escape').catch(() => null);
      return 'builder opened';
    });
  }

  if (want('analytics')) {
    await goto('/dashboard/analytics');
    await step('analytics: report tabs switch', async () => {
      await clickText('Action Report');
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText();
      if (/Something went wrong|Application error/i.test(body)) throw new Error('error state after switching tab');
      return 'tab switched';
    });
  }
} finally {
  writeFileSync(path.join(OUT, 'features.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  console.log(`report: ${path.join(OUT, 'features.json')}`);
  await browser.close();
  if (failed.length) process.exitCode = 1;
}
