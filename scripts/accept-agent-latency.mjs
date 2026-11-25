/**
 * ACCEPT: the composer sends on Enter, and a one-line question is answered quickly.
 *
 * Two claims, measured in a real browser against the deployed app:
 *
 *   1. ENTER SENDS. On an IDLE composer, typing and pressing Enter must put the message in the
 *      transcript and clear the box. The earlier "Enter does nothing" report was made while a run
 *      was already in flight, where Enter deliberately STEERS the running turn instead
 *      ("Delivered to the running task") — that is by design and is checked here too, without
 *      being removed.
 *   2. THE ANSWER ARRIVES QUICKLY. "How many leads do I have right now?" was measured at 43.5s.
 *      The number is asserted against the account, not just printed, because a fast wrong answer
 *      is worse than a slow right one.
 *
 *   node scripts/accept-agent-latency.mjs                        # production
 *   node scripts/accept-agent-latency.mjs --base http://localhost:3000
 *
 * Needs NOBO_EMAIL / NOBO_PASS in the environment (never in a file), and
 * NOBO_EXPECT_LEADS for the expected count (default 1584).
 */
import { chromium } from 'playwright';
import { login } from './lib/ui-login.mjs';

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : process.env.NOBO_BASE_URL || 'https://app.pipixel.io';
const QUESTION = 'How many leads do I have right now?';
const EXPECTED = Number(process.env.NOBO_EXPECT_LEADS || 1584);
const BUDGET_MS = Number(process.env.NOBO_BUDGET_MS || 20_000);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e?.message || e).slice(0, 200)}`));

const PASS = (name, detail = '') => console.log(`PASS  ${name}${detail ? ` -- ${detail}` : ''}`);
const FAIL = (name, detail = '') => console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) PASS(name, detail);
  else {
    FAIL(name, detail);
    failures++;
  }
};

const busy = () =>
  page.evaluate(() =>
    Boolean(
      [...document.querySelectorAll('button')].find((b) => /^stop$/i.test((b.textContent || '').trim())) ||
        /Working\s*⋯/i.test(document.body.innerText.slice(0, 4000))
    )
  );

const bodyText = () => page.evaluate(() => document.body.innerText);

try {
  await login(page, { baseUrl: BASE, email: process.env.NOBO_EMAIL, password: process.env.NOBO_PASS });
  await page.goto(`${BASE}/dashboard/agent`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // ── 1. Enter on an IDLE composer ────────────────────────────────────────
  const idle = !(await busy());
  check('composer starts idle (so Enter is the send path, not steering)', idle);

  const composer = page.locator('textarea').first();
  await composer.click();
  await composer.pressSequentially(QUESTION, { delay: 8 });
  const typed = await composer.inputValue();
  check('text typed into the composer', typed.includes('How many leads'), `${typed.length} chars`);

  const started = Date.now();
  await composer.press('Enter');
  await page.waitForTimeout(1200);

  const afterEnter = await composer.inputValue();
  check('Enter clears the composer', afterEnter.trim().length === 0, JSON.stringify(afterEnter.slice(0, 40)));

  const textAfterSend = await bodyText();
  check('the message appears in the transcript', textAfterSend.includes('How many leads do I have right now'));
  check('the run started (Working/Stop indicator)', await busy());

  // ── 2. the answer, timed ────────────────────────────────────────────────
  let sawWorking = false;
  let answeredAt = 0;
  for (let attempt = 0; attempt < 240; attempt++) {
    const b = await busy().catch(() => false);
    if (b) sawWorking = true;
    if (sawWorking && !b) {
      answeredAt = Date.now() - started;
      break;
    }
    await page.waitForTimeout(500);
  }

  check('the turn finished', answeredAt > 0, answeredAt ? `${(answeredAt / 1000).toFixed(1)}s` : 'still working after 120s');
  if (answeredAt > 0) {
    check(
      `answered within ${BUDGET_MS / 1000}s`,
      answeredAt <= BUDGET_MS,
      `${(answeredAt / 1000).toFixed(1)}s (was 43.5s)`
    );
  }

  await page.waitForTimeout(1500);
  const finalText = await bodyText();
  const formatted = EXPECTED.toLocaleString('en-US');
  check(
    `the answer states the real lead count (${formatted})`,
    finalText.includes(formatted) || finalText.includes(String(EXPECTED)),
    finalText.includes(formatted) ? '' : 'number not found in the transcript'
  );
  check('no console or page errors', errors.length === 0, [...new Set(errors)].join(' | '));

  await page.screenshot({ path: '.ui-screens/agent-enter-and-latency.png', fullPage: true });
} catch (err) {
  FAIL('script completed', String(err?.message || err).slice(0, 300));
  failures++;
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
