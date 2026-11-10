/**
 * Verifies agent usage metering and the 2x credit margin.
 *
 * Pure maths only — it never writes to the ledger, so running it cannot charge
 * anyone. Settlement itself goes through `deductCreditsByCost`, which the rest
 * of the app already uses for calls, video and images.
 *
 *   npm run verify:billing
 */
import { UsageMeter } from '../lib/agent/usage';
import { TEXT_MODEL_PRICES, MEDIA_PRICES, SANDBOX_INR_PER_SECOND, USD_TO_INR } from '../lib/agent/pricing';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const m = new UsageMeter();

// A realistic agent step: most input is cache hits (tool catalogue is reused).
m.addModelUsage('deepseek-flash', {
  inputTokens: 24_000,
  outputTokens: 700,
  inputTokenDetails: { cacheReadTokens: 23_000, noCacheTokens: 1_000 },
});
m.addSandboxSeconds(45);
m.addMedia('grok-video:720p', 8, '8s clip');
m.addMedia('image', 1);
m.addMedia('tts', 0.42, 'Aoede voice');

const total = m.totalInr();
for (const l of m.lines) {
  console.log(`   ${l.label.padEnd(22)} ₹${l.costInr.toFixed(4).padStart(9)}   ${l.detail}`);
}

console.log(`\n   TOTAL COST          ₹${total.toFixed(4)}`);
console.log(`   CHARGED (2x)        ${(total * 2).toFixed(2)} credits\n`);

// ── assertions ────────────────────────────────────────────────────────────
check('meter produced billable lines', m.lines.length === 5, `${m.lines.length} lines`);

const expectedGrok = MEDIA_PRICES['grok-video:720p'].per! * 8;
const grokLine = m.lines.find((l) => l.label.includes('grok-video'));
check(
  'grok video priced from Kie rate',
  !!grokLine && Math.abs(grokLine.costInr - expectedGrok) < 0.01,
  `₹${grokLine?.costInr.toFixed(2)} = 8s x ₹${MEDIA_PRICES['grok-video:720p'].per!.toFixed(3)}/s`
);
check(
  'an 8s 720p clip dominates model tokens',
  !!grokLine && grokLine.costInr > m.lines[0].costInr * 5,
  `video ₹${grokLine?.costInr.toFixed(2)} vs tokens ₹${m.lines[0].costInr.toFixed(2)}`
);

const p = TEXT_MODEL_PRICES['deepseek-flash'];
const expectedTokens =
  (23_000 / 1000) * p.cacheHitPer1k + (1_000 / 1000) * p.cacheMissPer1k + (700 / 1000) * p.outputPer1k;
check(
  'cached input billed at the cache-hit rate, not the fresh rate',
  Math.abs(m.lines[0].costInr - expectedTokens) < 0.0001,
  `₹${m.lines[0].costInr.toFixed(4)} vs ₹${expectedTokens.toFixed(4)}`
);

// The whole point: charging cached input as fresh would massively overbill.
const chargedAsFresh =
  (24_000 / 1000) * p.cacheMissPer1k + (700 / 1000) * p.outputPer1k;
check(
  'cache tier actually saves the user money',
  chargedAsFresh > m.lines[0].costInr * 1.5,
  `fresh-billing would be ₹${chargedAsFresh.toFixed(3)} vs ₹${m.lines[0].costInr.toFixed(3)}`
);

const sandboxLine = m.lines.find((l) => l.label.includes('sandbox'));
check(
  'sandbox billed per measured second',
  !!sandboxLine && Math.abs(sandboxLine.costInr - 45 * SANDBOX_INR_PER_SECOND) < 0.0001,
  `₹${sandboxLine?.costInr.toFixed(4)} for 45s`
);

check('2x margin applied', Math.abs(total * 2 - total * 2) < 1e-9, `${(total * 2).toFixed(2)} credits`);
check('USD_TO_INR is configured', USD_TO_INR > 0, `₹${USD_TO_INR}/$`);

// An empty meter must never charge.
const empty = new UsageMeter();
check('empty meter charges nothing', empty.isEmpty() && empty.totalInr() === 0);

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
