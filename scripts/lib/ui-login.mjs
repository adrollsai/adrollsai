/**
 * Log in, reliably — ONE login per browser context.
 *
 * WHY THIS WAS REWRITTEN
 * The previous version escalated through three strategies (type, synthetic React events, press Enter) and, on a real
 * account, ended by reporting "login did not reach the dashboard" while the page sat on /login. A plain type-then-click
 * submitted fine. The clever fallbacks were the problem, not the account.
 *
 * Two rules now:
 *   1. type into both fields like a person, press submit, then WAIT FOR A DASHBOARD ROUTE — the assertion is the
 *      destination, not the click;
 *   2. reuse the context. Supabase rate-limits rapid repeated sign-ins, so a caller that needs several pages logs in once
 *      and navigates afterwards. `login` returns early when already signed in.
 */

const DASHBOARD = /\/dashboard(\/|\?|$)/;

const pathOf = (page) => {
  try {
    const url = new URL(page.url());
    return url.pathname + url.search;
  } catch {
    return '';
  }
};

async function alreadyIn(page) {
  const where = pathOf(page);
  return DASHBOARD.test(where) || /^\/shared\//.test(where);
}

export async function login(page, { baseUrl, email, password, timeoutMs = 90_000 } = {}) {
  if (!email || !password) throw new Error('NOBO_EMAIL and NOBO_PASS must be set');
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('baseUrl is required');

  if (await alreadyIn(page)) return page.url();

  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30_000 });

  // Type, like a person: React needs the real input events, and `fill()` writes before hydration.
  await page.locator('input[name="email"]').click();
  await page.locator('input[name="email"]').pressSequentially(email, { delay: 20 });
  await page.locator('input[name="password"]').click();
  await page.locator('input[name="password"]').pressSequentially(password, { delay: 20 });
  await page.waitForTimeout(700);

  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: 'visible', timeout: 20_000 });

  let refusal = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    // The controller enables submit only once both values are in state; clicking early is a silent no-op.
    if (!(await submit.isEnabled().catch(() => false))) {
      await page.waitForTimeout(900);
      continue;
    }

    await submit.click({ timeout: 15_000 }).catch(() => {});

    try {
      await page.waitForURL(DASHBOARD, { timeout: Math.max(10_000, Math.floor(timeoutMs / 3)) });
      return page.url();
    } catch {
      // Still on /login. Read what the form says, so a wrong password is distinguishable from a slow one.
      refusal = await page
        .evaluate(() => {
          const nodes = Array.from(document.querySelectorAll('[role="alert"], p, span, div'));
          const hit = nodes.find((node) =>
            /invalid|incorrect|wrong|failed|error|not found|too many|rate/i.test(node.textContent || '')
          );
          return (hit?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        })
        .catch(() => '');
      if (refusal) throw new Error(`Login refused: ${refusal}`);
    }
  }

  throw new Error(`login did not reach the dashboard (at ${page.url()})`);
}

/**
 * Navigate to a route on an existing session, recovering ONCE if the navigation bounced to /login.
 *
 * One retry only: a second sign-in in quick succession is what triggers the rate limit.
 */
export async function gotoDashboard(page, baseUrl, path, { email, password, settleMs = 8000 } = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const target = path.startsWith('/') ? path : `/${path}`;

  await page.goto(`${base}${target}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(settleMs);

  if (!(await alreadyIn(page))) {
    await login(page, { baseUrl: base, email, password });
    await page.goto(`${base}${target}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(settleMs);
  }

  return page.url();
}
