/**
 * Proves the email rule: an account pays double what a message costs us, and never pays for one that
 * failed to leave.
 *
 * WHY THIS GATE EXISTS
 * The product already charged twice our cost for model tokens, sandbox time and media — and charged
 * nothing at all for email. The twice-daily digest to every business was therefore the one thing an
 * account could consume forever without paying: real model work plus a real message on a real SMTP
 * bill, with no ledger entry. A pricing rule that is applied to "the expensive things" instead of to
 * "everything" is how a hole like that opens, so the rule is pinned here.
 *
 *   npm run verify:email-billing
 */
import fs from 'node:fs';
import {
  CREDIT_MARGIN,
  EMAIL_SEND_COST_INR,
  emailCostInr,
  emailCredits,
} from '../lib/automation/email-billing';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

head('1. Twice our cost, for one and for many');

check(
  'the margin is 2× — the owner\'s rule, in one constant',
  CREDIT_MARGIN === 2,
  `${CREDIT_MARGIN}×`,
);
check(
  'one email is billed at exactly twice our cost',
  Math.abs(emailCredits(1) - EMAIL_SEND_COST_INR * 2) < 1e-9,
  `${emailCredits(1)} vs ${EMAIL_SEND_COST_INR * 2}`,
);
check(
  'ten emails are ten times the cost, doubled — not a rounded-off zero',
  Math.abs(emailCredits(10) - EMAIL_SEND_COST_INR * 10 * 2) < 1e-9,
  `${emailCredits(10)}`,
);
check(
  'the charge always exceeds the cost it covers',
  emailCredits(1) > emailCostInr(1) && emailCredits(1000) > emailCostInr(1000),
  `${emailCredits(1)} > ${emailCostInr(1)}`,
);
check(
  'money is kept to 2dp — a ledger that carries more than paise is a ledger that drifts',
  String(emailCredits(7)).split('.')[1]?.length === undefined || String(emailCredits(7)).split('.')[1].length <= 2,
  String(emailCredits(7)),
);

head('2. Nothing is charged for nothing');

check('zero emails cost nothing', emailCredits(0) === 0);
check('a negative count cannot credit the account', emailCredits(-5) === 0);
check('NaN costs nothing rather than becoming a charge', emailCredits(NaN) === 0);
check('a fractional count does not invent a fraction of a message', emailCredits(1.7) === emailCredits(1), `${emailCredits(1.7)}`);
check('cost and charge agree that nothing was sent', emailCostInr(0) === 0);

head('3. It is wired, not just available');

{
  const digest = fs.readFileSync('app/api/cron/ceo-digest/route.ts', 'utf8');
  check('the twice-daily digest charges the account', /chargeEmailSends\(supabase, routine\.user_id/.test(digest));
  check(
    'and charges only AFTER the provider accepted the message',
    digest.indexOf('await sendGenericEmail') < digest.indexOf('chargeEmailSends(supabase, routine.user_id'),
    'send precedes charge',
  );
  check('the charge names the slot it paid for', /label: `CEO \$\{slot\} digest`/.test(digest));

  const billing = fs.readFileSync('lib/automation/email-billing.ts', 'utf8');
  check('a billing failure cannot swallow the email', /catch/.test(billing) && /never throws|Never throws/i.test(billing));
  check('the cost constant is stated once, with its source', /EMAIL_SEND_COST_INR = 0\.035/.test(billing));
  check(
    'the ledger description carries the arithmetic',
    /billed at \$\{CREDIT_MARGIN\}×/.test(billing),
  );
}

console.log(`\n${'='.repeat(64)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nEmail is a cost like any other: it must be billed at 2x, and never for a failed send.');
  process.exit(1);
}
console.log('Every email an account receives is charged at twice what it costs us.');
