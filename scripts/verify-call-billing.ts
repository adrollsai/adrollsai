/**
 * Does the call-billing model charge exactly what the owner specified, to the hundredth?
 *
 * The owner gave six worked examples as the specification. This gate asserts every one of them, plus
 * the boundaries either side of each minute, because the whole model turns on minute BLOCKS:
 * a call that ends at 60s pays one block, and a call that runs one second longer pays two.
 *
 * It also pins the arithmetic that makes the ledger reconcilable: 500 minutes must come to exactly
 * 2,000 credits, or the locked calling pot and the per-second rate disagree with each other.
 *
 *   npx esbuild scripts/verify-call-billing.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-call-billing.mjs && node .tmp-call-billing.mjs
 */
import {
  CALLING_POT_CREDITS,
  CALLING_POT_MINUTES,
  callChargeCredits,
  callChargeHundredths,
  failedCallHundredths,
  minutesCoveredByCredits,
} from '../lib/automation/call-billing';

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

// ── The owner's own six examples, verbatim. These are the specification.
console.log('▸ the six worked examples given as the specification');
const SPEC: Array<[seconds: number, credits: number]> = [
  [1, 1.05],
  [30, 2.5],
  [60, 4],
  [61, 5.05],
  [90, 6.5],
  [120, 8],
];
for (const [seconds, expected] of SPEC) {
  const hundredths = callChargeHundredths(seconds);
  check(
    `${seconds}s costs ${expected.toFixed(2)} credits`,
    hundredths === Math.round(expected * 100),
    `${hundredths} hundredths (${(hundredths / 100).toFixed(2)})`,
  );
}

// ── The minute boundaries, both sides, because that is where the model bites.
console.log('\n▸ minute boundaries');
const at = (s: number) => callChargeCredits(s);
check('59s is still one block', at(59) === 3.95, `${at(59).toFixed(2)}`);
check('60s is exactly one block, NOT two', at(60) === 4.0, `${at(60).toFixed(2)} — the prose said 5.00`);
check('61s is two blocks', at(61) === 5.05, `${at(61).toFixed(2)}`);
check('119s is two blocks', at(119) === 7.95, `${at(119).toFixed(2)}`);
check('120s is exactly two blocks, NOT three', at(120) === 8.0, `${at(120).toFixed(2)} — the prose said 9.00`);
check('121s is three blocks', at(121) === 9.05, `${at(121).toFixed(2)}`);
check('600s is ten blocks', at(600) === 40.0, `${at(600).toFixed(2)}`);

// ── Nothing is ever fractional below a hundredth, and nothing drifts.
console.log('\n▸ the arithmetic is integer-exact (no float drift)');
check('every charge is a whole number of hundredths', SPEC.every(([s]) => Number.isInteger(callChargeHundredths(s))));
check(
  '61s is exactly 505 hundredths, not 505.0000000000001',
  callChargeHundredths(61) === 505,
  String(callChargeHundredths(61)),
);
const longCall = callChargeHundredths(3600);
check('a one-hour call is exact', longCall === 3600 * 5 + 60 * 100, `${longCall} hundredths = ₹${(longCall / 100).toFixed(2)}-equivalent`);

// ── A call that never connected is a different charge entirely.
console.log('\n▸ dials that never connected');
check('a failed dial costs 0.02 credits', failedCallHundredths() === 2, String(failedCallHundredths()));
check('a failed dial consumes no minute block', failedCallHundredths() < 100);
check('zero measured seconds charges nothing from the call tariff', callChargeHundredths(0) === 0);

// ── The pot and the rate must agree, or "500 minutes" is a lie.
console.log('\n▸ the locked calling pot agrees with the per-second rate');
const potHundredths = CALLING_POT_MINUTES * 60;
const potCost = callChargeHundredths(potHundredths);
check(
  `${CALLING_POT_MINUTES} minutes costs exactly ${CALLING_POT_CREDITS} credits`,
  potCost === CALLING_POT_CREDITS * 100,
  `${(potCost / 100).toFixed(2)} credits`,
);
check(
  'and the advertised rate is 4.00 credits for the first minute',
  callChargeCredits(60) === 4,
  '1 credit block + 60 x 0.05',
);
check(
  `${CALLING_POT_CREDITS} credits are quoted as covering ${CALLING_POT_MINUTES} minutes`,
  minutesCoveredByCredits(CALLING_POT_CREDITS) === CALLING_POT_MINUTES,
  `${minutesCoveredByCredits(CALLING_POT_CREDITS)} minutes`,
);
check('a part-used pot rounds down, never up', minutesCoveredByCredits(1999) === 499, String(minutesCoveredByCredits(1999)));

// ── Messy input must not produce a negative or wild charge.
console.log('\n▸ it survives bad input');
check('negative seconds charge nothing', callChargeHundredths(-5) === 0, String(callChargeHundredths(-5)));
check('NaN charges nothing', callChargeHundredths(Number.NaN) === 0, String(callChargeHundredths(Number.NaN)));
check('fractional seconds floor to whole seconds', callChargeHundredths(60.9) === callChargeHundredths(60), `${callChargeHundredths(60.9)} vs ${callChargeHundredths(60)}`);

// ── The route must actually use this, and must not still carry the old flat rate.
console.log('\n▸ the billing route uses this model');
import fs from 'node:fs';
const routeRaw = fs.readFileSync('app/api/voice/bill-call/route.ts', 'utf8');
// Comments stripped first: the fix explains the old tariff in prose, and a naive substring test would
// fail on the explanation rather than on a regression.
const route = routeRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('bill-call imports the shared model', /from '@\/lib\/automation\/call-billing'/.test(route));
check(
  'the old flat 5-credits-per-minute charge is gone',
  !/durationMinutes \* 5/.test(route) && !/creditsToDeduct\s*=\s*durationMinutes/.test(route),
  'it charged 5/min, a different model to the owner specification',
);
check(
  'the charge is computed from the shared model',
  /callChargeCredits\(/.test(route),
  'one formula, not a second copy inside the route',
);
check(
  'an unmeasured duration is not silently billed as a connected call',
  /DURATION UNKNOWN/.test(route) && /failedCallHundredths/.test(route),
  'three distinct cases, not one fallback',
);
// The AI cost is INSIDE the 4 credits/min. Any second per-minute AI overhead in this route is a
// double charge waiting to happen.
check(
  'no separate AI/token charge sits alongside the credit charge',
  !/aiCostPerMinute|aiCostInr|AI Voice Overhead/.test(route),
  'Gemini is baked into the price, not billed on top',
);
check(
  'no rupee-cost figure is computed and left undeducted',
  !/finalCostInr/.test(route),
  'dead arithmetic invites a second charge later',
);

// THE REAL TELEPHONY PATH. Credit for this check: the Vobiz status-callback is where genuine calls are
// billed, and it kept the old flat 5-credits-per-minute after bill-call was fixed — so the fix did not
// reach production until this was caught. Both paths must use the one model.
console.log('\n▸ the VOBiz status callback (real calls) uses the same model');
const vobizRaw = fs.readFileSync('app/api/voice/vobiz/status-callback/route.ts', 'utf8');
const vobiz = vobizRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('vobiz callback imports the shared model', /from '@\/lib\/automation\/call-billing'/.test(vobiz));
check(
  'it charges from callChargeCredits, not its own arithmetic',
  /callChargeCredits\(/.test(vobiz),
);
check(
  'the old flat per-minute multiplication is gone from it',
  !/billableMinutes\s*\*\s*CREDIT_COSTS\.VOICE_CALL_MINUTE/.test(vobiz),
  'this was the path real calls took',
);
check(
  'it still routes to the calling pot',
  /deductCredits\([\s\S]{0,200}'calling'/.test(vobiz),
  'a call spends calling credits, never AI credits',
);

console.log('\n▸ nobody else charges a connected call by the minute either');
const fsMod = fs;
const suspectFiles = [
  'app/api/voice/bill-call/route.ts',
  'app/api/voice/vobiz/status-callback/route.ts',
];
for (const f of suspectFiles) {
  const src = fsMod.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check(`  ${f} has no flat per-minute call charge`, !/ceil\([^)]*\/\s*60\)\s*\*\s*CREDIT_COSTS/.test(src));
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
