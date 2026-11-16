/**
 * The five remaining items, pinned.
 *
 * Each of these was reported as "outstanding" and is now implemented; this gate is what stops them
 * silently regressing. Where a piece is pure it is exercised directly; where it is wiring, the source
 * is asserted with comments stripped (a fix's own explanation must not satisfy its own test).
 *
 *   npx esbuild scripts/verify-pending-items.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-pending.mjs && node .tmp-pending.mjs
 */
import fs from 'node:fs';
import { TRIAL_CREDIT_SPLIT } from '../lib/automation/billing';
import { RAZORPAY_CREDIT_PACKAGES, isCallingCreditPackage } from '../utils/razorpay';
import { pickRotatedDid } from '../utils/vobiz-helper';
import { VOBIZ_NUMBER_CATALOG } from '../utils/vobiz-catalog';
import { CEO_WINDOW_DAYS, CEO_MAX_ROWS, buildDayRollup, rollupDay, windowStartDay } from '../lib/automation/ceo-rollup';

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

const read = (p: string) => fs.readFileSync(p, 'utf8');
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ─────────────────────────────────────────────────────────────────────────────
console.log('▸ 1. TRIAL SPLIT: 600 AI / 400 calling');
check('the split is 600 AI', TRIAL_CREDIT_SPLIT.ai === 600, String(TRIAL_CREDIT_SPLIT.ai));
check('the split is 400 calling', TRIAL_CREDIT_SPLIT.calling === 400, String(TRIAL_CREDIT_SPLIT.calling));
check(
  'it totals the 1,000 the trial grants',
  TRIAL_CREDIT_SPLIT.ai + TRIAL_CREDIT_SPLIT.calling === 1000,
  '600 + 400',
);
const verify = codeOf(read('app/api/payment/razorpay/verify/route.ts'));
check('the verify route uses the split grant for trials', /grantTrialCreditsOnce\(/.test(verify));
check(
  'the split grant writes two idempotent refs',
  /:ai`/.test(read('lib/automation/billing.ts')) && /:calling`/.test(read('lib/automation/billing.ts')),
  'a half-applied trial must not look finished',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ 2. AI credits vs Calling credits, buyable separately');
const aiPacks = Object.keys(RAZORPAY_CREDIT_PACKAGES).filter((k) => /^p\d/.test(k));
const callPacks = Object.keys(RAZORPAY_CREDIT_PACKAGES).filter((k) => isCallingCreditPackage(k));
check('AI credit packs exist', aiPacks.length >= 3, aiPacks.join(', '));
check('calling credit packs exist', callPacks.length >= 3, callPacks.join(', '));
check(
  'AI packs are named "AI Credits", not a bare "Pack"',
  aiPacks.every((k) => /AI Credits/.test(RAZORPAY_CREDIT_PACKAGES[k].name)),
  RAZORPAY_CREDIT_PACKAGES[aiPacks[0]].name,
);
check(
  'calling packs are named "Calling Credits"',
  callPacks.every((k) => /Calling Credits/.test(RAZORPAY_CREDIT_PACKAGES[k].name)),
  RAZORPAY_CREDIT_PACKAGES[callPacks[0]].name,
);
check(
  'the calling description states the minutes it buys',
  /minutes of AI calling/.test(RAZORPAY_CREDIT_PACKAGES[callPacks[0]].description),
  RAZORPAY_CREDIT_PACKAGES[callPacks[0]].description,
);
check('AI packs are not misclassified as calling', !isCallingCreditPackage('p1000'));
check('an empty id is not mistaken for a calling pack', !isCallingCreditPackage(''));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ 3. DID ROTATION across the shared pool');
const pool = VOBIZ_NUMBER_CATALOG.map((n) => n.phoneNumber).filter(Boolean);
check('the catalog has a pool to rotate over', pool.length >= 2, `${pool.length} numbers`);
check('the same seed always picks the same DID', pickRotatedDid(pool, 'lead-123') === pickRotatedDid(pool, 'lead-123'));
const picks = new Set<string>();
for (let i = 0; i < 400; i++) picks.add(String(pickRotatedDid(pool, `lead-${i}`)));
check(
  'different leads spread across the whole pool',
  picks.size === pool.length,
  `${picks.size} of ${pool.length} numbers used over 400 leads`,
);
check('an empty pool returns null rather than an empty string', pickRotatedDid([], 'seed') === null);
check('a pool of blanks returns null', pickRotatedDid(['', '  '], 'seed') === null);
const vobiz = codeOf(read('utils/vobiz-helper.ts'));
check('rotation happens before any per-tenant number', /pickRotatedDid\(sharedPool/.test(vobiz));
check(
  'the shared pool is built from the catalog',
  /VOBIZ_NUMBER_CATALOG\.map/.test(vobiz),
  'no DID belongs to one tenant',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ 4. VIDEO JOB uses the full Creation-tab pipeline');
const vid = codeOf(read('app/api/cron/auto-generate-video/route.ts'));
check('it writes a SCRIPT first (not prompt-only)', /video-script/.test(vid), 'concepts -> script');
check('it generates a VOICE track (TTS)', /createGeminiTTS/.test(vid), 'the Creation tab always does');
check('it generates the video', /createGrokVideoTask|video\/generate/.test(vid));
check('it resolves the finished film via the callback', /video\/callback/.test(vid));
check(
  'it keeps one brand voice via the shared script module',
  /buildScriptFacts|brandStyleGuard|fitDialogue/.test(vid),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ 5. CEO ROLLUPS: bounded by construction');
check('the window is 30 days', CEO_WINDOW_DAYS === 30, String(CEO_WINDOW_DAYS));
check('a render is capped', CEO_MAX_ROWS > 0 && CEO_MAX_ROWS <= 200, `${CEO_MAX_ROWS} rows`);
const now = new Date('2026-11-17T12:00:00Z');
check('rollupDay is a YYYY-MM-DD key', /^\d{4}-\d{2}-\d{2}$/.test(rollupDay(now)), rollupDay(now));
check(
  'the window start is 30 days earlier',
  windowStartDay(now) === '2026-10-18',
  windowStartDay(now),
);
const day = buildDayRollup('2026-11-16', {
  agentEvents: 40,
  routineRuns: 3,
  failedRuns: 1,
  artifacts: 5,
  creditsSpent: 120,
});
check('a busy day summarises into one line', /3 routine runs/.test(day.headline), day.headline);
check('the summary carries the cost', day.creditsSpent === 120);
const quiet = buildDayRollup('2026-11-15', {
  agentEvents: 0, routineRuns: 0, failedRuns: 0, artifacts: 0, creditsSpent: 0,
});
check('an empty day says so plainly', quiet.headline === 'Nothing ran.', quiet.headline);
check(
  'negative or nonsense counts cannot corrupt a rollup',
  buildDayRollup('2026-11-14', { agentEvents: -5, routineRuns: NaN as any, failedRuns: -1, artifacts: 0, creditsSpent: -3 }).agentEvents === 0,
);
check('failed runs never exceed total runs', buildDayRollup('x', { agentEvents: 0, routineRuns: 2, failedRuns: 9, artifacts: 0, creditsSpent: 0 }).failedRuns <= 2);
const crons = read('vercel.json');
check('the nightly rollup is scheduled', /\/api\/cron\/ceo-rollups/.test(crons));
check('the rollup table exists in a migration', fs.existsSync('supabase/migrations/20261117000300_ceo_daily_rollups.sql'));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
