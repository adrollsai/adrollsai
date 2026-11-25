/**
 * Ask the agent one cheap question and wait for the turn to actually finish.
 *
 * The completion signal is the "Working / Stop" indicator going away — watching the page text for
 * stability reports "done" while the model is still thinking, which is exactly what a user would
 * misread as a hang.
 */
import { chromium } from 'playwright';
import { login } from './lib/ui-login.mjs';

const BASE = process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const QUESTION = process.argv[2] || 'How many leads do I have right now?';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e?.message || e).slice(0, 200)}`));

const working = () =>
  page.evaluate(() =>
    Boolean(
      [...document.querySelectorAll('button')].find((b) => /^stop$/i.test((b.textContent || '').trim())) ||
        /Working\s*⋯/i.test(document.body.innerText.slice(0, 4000))
    )
  );

try {
  await login(page, { baseUrl: BASE, email: process.env.NOBO_EMAIL, password: process.env.NOBO_PASS });
  await page.goto(`${BASE}/dashboard/agent`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const composer = page.locator('textarea').first();
  await composer.click();
  await composer.pressSequentially(QUESTION, { delay: 8 });
  await page.locator('button').filter({ has: page.locator('svg') }).last().click();

  const started = Date.now();
  let sawWorking = false;
  let finishedAt = 0;
  for (let attempt = 0; attempt < 360; attempt++) {
    const busy = await working().catch(() => false);
    if (busy) sawWorking = true;
    if (sawWorking && !busy) {
      finishedAt = Date.now() - started;
      break;
    }
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(1500);
  const lines = (await page.locator('body').innerText())
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 8 && !/^(Chat|Dark|New session|Stop|Working)/.test(line));

  // The assistant's reply sits after the question; take what follows it.
  const questionIndex = lines.findIndex((line) => line.includes(QUESTION.slice(0, 20)));
  const answer = lines.slice(questionIndex + 1, questionIndex + 8).join('\n');

  console.log(`question      : ${QUESTION}`);
  console.log(`turn started  : ${sawWorking ? 'yes' : 'no indicator seen'}`);
  console.log(`turn finished : ${finishedAt ? `${(finishedAt / 1000).toFixed(1)}s` : 'still working after 180s'}`);
  console.log(`answer        :\n${answer || '(nothing captured)'}`);
  console.log(`console errors: ${errors.length ? [...new Set(errors)].join(' | ') : 'none'}`);
  await page.screenshot({ path: '.ui-screens/agent-answer.png', fullPage: true });
} finally {
  await browser.close();
}
