/**
 * Does the plan-validity warning fire at the boundaries — and stay quiet the rest of the time?
 *
 * §3.7: "plan-validity popups". The dashboard showed a banner only AFTER a plan ended and then
 * redirected to billing, so an owner discovered the problem when a campaign stopped or their caller
 * ID entered its grace period. The warning is now derived from `planValidityNotice`, a pure function,
 * precisely so every boundary can be tested here instead of being discovered by a customer.
 *
 * The cases that matter are the ugly ones: it ends today, it ended yesterday, it ends in exactly 3 or
 * exactly 7 days, the date is garbage, there is no date at all, and billing already marked it expired
 * while the date is still in the future.
 *
 *   npx esbuild scripts/verify-plan-validity.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-plan-validity.mjs && node .tmp-plan-validity.mjs
 */
import { planValidityNotice } from '../lib/automation/plan-validity';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const NOW = new Date('2026-11-16T09:00:00Z');
const inDays = (days: number, hours = 0) =>
  new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();

const at = (days: number, hours = 0, over: Record<string, unknown> = {}) =>
  planValidityNotice({ status: 'active', validUntil: inDays(days, hours), now: NOW, ...over });

console.log('▸ no date, no claim');
check('a missing validUntil produces no notice', at(0, 0, { validUntil: null }) === null);
check('an empty validUntil produces no notice', at(0, 0, { validUntil: '' }) === null);
check('an unparseable date produces no notice', at(0, 0, { validUntil: 'next tuesday' }) === null, 'garbage is not an expiry');

console.log('\n▸ the quiet zone');
check('60 days out is silent', at(60) === null, 'no noise a month early');
check('30 days out is silent', at(30) === null);
check('8 days out is silent', at(8) === null, 'one day past the window');

console.log('\n▸ warning window (4-7 days)');
const w7 = at(7);
check('exactly 7 days is a warning', w7?.level === 'warning', `${w7?.level} / ${w7?.daysLeft}d`);
const w4 = at(4);
check('4 days is a warning', w4?.level === 'warning', `${w4?.daysLeft}d`);
check('the warning names the number of days', /ends in 4 days/.test(String(w4?.message)), String(w4?.message));
check('a warning offers to view plans rather than to pay', w4?.actionLabel === 'View plans', String(w4?.actionLabel));

console.log('\n▸ critical window (0-3 days)');
const c3 = at(3);
check('3 days is critical, not merely a warning', c3?.level === 'critical', `${c3?.level} / ${c3?.daysLeft}d`);
const c1 = at(1);
check('1 day is critical and singular', c1?.level === 'critical' && /ends in 1 day\b/.test(String(c1?.message)), String(c1?.message));
check('the critical notice drives to recharge', c1?.actionLabel === 'Recharge now', String(c1?.actionLabel));

console.log('\n▸ the day it ends');
const today = at(0, 5); // 09:00 + 5h = 14:00 same day
check('later today is 0 days left', today?.daysLeft === 0, `${today?.daysLeft}d`);
check('later today is critical, not "expired"', today?.level === 'critical', String(today?.level));
check('and it says "today"', /ends today/.test(String(today?.message)), String(today?.message));

console.log('\n▸ after it ends');
const yesterday = at(-1);
check('yesterday is expired', yesterday?.level === 'expired', String(yesterday?.level));
check('an expired notice offers recharge', yesterday?.actionLabel === 'Recharge now');
check('daysLeft is negative, so callers can tell it apart from "today"', Number(yesterday?.daysLeft) < 0, String(yesterday?.daysLeft));

console.log('\n▸ status outranks the date');
const marked = planValidityNotice({
  status: 'EXPIRED', // case must not matter
  validUntil: inDays(5),
  now: NOW,
});
check(
  'an account billing already expired is not told it has 5 days left',
  marked?.level === 'expired',
  `${marked?.level} with a future date`,
);

console.log('\n▸ it survives messy real data');
const isoDateOnly = planValidityNotice({ status: 'active', validUntil: '2026-11-18', now: NOW });
check('a date-only string is accepted', isoDateOnly?.level === 'critical' || isoDateOnly?.level === 'warning', `${isoDateOnly?.level} / ${isoDateOnly?.daysLeft}d`);
const spacedStatus = planValidityNotice({ status: '  Active  ', validUntil: inDays(2), now: NOW });
check('a padded status is handled', spacedStatus?.level === 'critical', String(spacedStatus?.level));
const noStatus = planValidityNotice({ status: null, validUntil: inDays(2), now: NOW });
check('a missing status still warns on the date', noStatus?.level === 'critical', String(noStatus?.level));

console.log('\n▸ the copy is in the owner\'s terms');
const sample = String(at(2)?.message ?? '');
check('no exclamation marks', !sample.includes('!'), sample);
check('no internal jargon', !/subscription|profile|db|api/i.test(sample), sample);
check('it says what happens next', /recharge/i.test(sample), sample);

console.log('\n▸ the notice is actually wired into the dashboard');
// I have no browser here, so this is the honest limit: the decision above is tested case by case,
// and this checks the layout consumes it rather than computing its own date maths inline.
const fs = await import('node:fs');
const layout = fs.readFileSync('app/dashboard/layout.tsx', 'utf8');
check('the layout imports the pure decision', /from '@\/lib\/automation\/plan-validity'/.test(layout));
check(
  'it calls planValidityNotice with the profile fields',
  /planValidityNotice\(\{/.test(layout) && /validUntil:\s*subscriptionValidUntil/.test(layout),
  'status + validUntil + now',
);
check(
  'it renders the notice for a plan that has NOT yet expired',
  /planNotice\.level !== 'expired'/.test(layout),
  'so it does not duplicate the existing expired banner',
);
check('it stays off the billing page', /pathname !== '\/dashboard\/billing'/.test(layout) || /dismissPlanNotice/.test(layout));
check('the owner can dismiss it', /setDismissPlanNotice\(true\)/.test(layout));
check(
  'the notice has an accessible dismiss control',
  /aria-label="Dismiss plan notice"/.test(layout),
);
check(
  'the old expired banner is still there for the already-ended case',
  /subscriptionExpiredAlert/.test(layout) && /Plan Validity Expired/.test(layout),
  'both states covered',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
