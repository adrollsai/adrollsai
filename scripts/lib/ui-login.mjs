/**
 * Log in, reliably.
 *
 * The sign-in button is disabled until React has both field values in state, and every way of setting
 * them can lose that race: `fill()` writes the DOM value before hydration, and fast keystrokes can be
 * overwritten by a re-render. Three attempts, each closer to what a person does, and the last one
 * dispatches the input event React listens for.
 */
export async function login(page, { baseUrl, email, password }) {
  if (!email || !password) throw new Error('NOBO_EMAIL and NOBO_PASS must be set');

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30_000 });

  const submit = page.locator('button[type="submit"]').first();
  const enabled = async () => submit.isEnabled().catch(() => false);

  /** Attempt 1: type like a person. */
  await page.locator('input[name="email"]').click();
  await page.locator('input[name="email"]').pressSequentially(email, { delay: 15 });
  await page.locator('input[name="password"]').click();
  await page.locator('input[name="password"]').pressSequentially(password, { delay: 15 });

  /** Attempt 2: set the values through React's own input event. */
  if (!(await enabled())) {
    await page.waitForTimeout(1000);
  }
  if (!(await enabled())) {
    await page.evaluate(
      ([emailValue, passwordValue]) => {
        const setValue = (selector, value) => {
          const element = document.querySelector(selector);
          if (!element) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        };
        setValue('input[name="email"]', emailValue);
        setValue('input[name="password"]', passwordValue);
      },
      [email, password]
    );
    await page.waitForTimeout(600);
  }

  /** Attempt 3: give hydration a moment, then press Enter in the form. */
  for (let attempt = 0; attempt < 40 && !(await enabled()); attempt++) await page.waitForTimeout(250);

  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }).catch(() => null),
    (async () => {
      if (await enabled()) await submit.click();
      else await page.locator('input[name="password"]').press('Enter');
    })(),
  ]);

  if (!/\/dashboard/.test(page.url())) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(`login did not reach the dashboard (at ${page.url()})\n${body.slice(0, 300)}`);
  }
  return page.url();
}
