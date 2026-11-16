/**
 * Can the owner (and the agent) actually find out what 5,000 credits buy?
 *
 * §3.7 asks for a "what 5,000 credits buys" breakdown. The arithmetic already existed and was correct
 * — `describeTier` renders "₹9,999 — 5,000 credits: 500 images, or 375s of video, or 1000 call minutes"
 * — but nothing customer-facing ever called it; only the admin ledger route did. So the breakdown
 * existed in code and nowhere a person could see it, and the agent had no way to answer the question
 * except by doing the division itself.
 *
 * This calls the real tool through the real orchestrator and checks the numbers are the real ones,
 * derived from CREDIT_COSTS and the plan table rather than restated here.
 *
 *   npx esbuild scripts/verify-credits-explainer.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-credits-explainer.mjs && node .tmp-credits-explainer.mjs
 *
 * Read-only. Spends nothing.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { CREDIT_TIERS, RECOMMENDED_TIER_ID, tierCapacity } from '../lib/automation/credit-tiers';
import { CREDIT_COSTS } from '../utils/credits';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor, 5,000 credits

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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

// A billing question, so the turn looks like the one that prompts this.
const ctx = await createAgentContext(sb as any, ORG, {
  intentText: 'what do my 5000 credits buy, and what does a video cost?',
});
const tool = (ctx.tools as any).nobogent_credits_explainer;

check('the explainer is available on a plain billing question', Boolean(tool?.execute));
check(
  'the prompt tells the agent to use it instead of doing the arithmetic',
  /nobogent_credits_explainer/.test(String(ctx.systemPrompt)) &&
    /never work that arithmetic out yourself/i.test(String(ctx.systemPrompt)),
);

if (!tool?.execute) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

const result = await tool.execute({}, {} as any);
console.log(`\nbalance: ${result?.balance} (known: ${result?.balanceKnown})`);
console.log('unit prices:', JSON.stringify(result?.unitPrices));
console.log('this balance buys:', JSON.stringify(result?.thisBalanceBuys));
for (const plan of result?.plans ?? []) {
  console.log(`  ${plan.summary}`);
}

check('the tool succeeds', result?.success === true, String(result?.error ?? ''));

// The prices must be the SAME source of truth as the ledger, not a restatement.
check(
  'unit prices come from CREDIT_COSTS',
  result?.unitPrices?.image === CREDIT_COSTS.AI_IMAGE_GENERATION &&
    result?.unitPrices?.video15s === CREDIT_COSTS.AI_VIDEO_15SEC_CHUNK &&
    result?.unitPrices?.callMinute === CREDIT_COSTS.VOICE_CALL_MINUTE &&
    result?.unitPrices?.copy === CREDIT_COSTS.AI_COPY_GENERATION,
  JSON.stringify(result?.unitPrices),
);

check(
  'it reports every plan in the table',
  (result?.plans ?? []).length === CREDIT_TIERS.length,
  `${(result?.plans ?? []).length} of ${CREDIT_TIERS.length}`,
);
check(
  'exactly one plan is marked recommended',
  (result?.plans ?? []).filter((p: any) => p.recommended).length === 1,
);
check(
  'the recommended plan is the one the code names',
  (result?.plans ?? []).some((p: any) => p.recommended && p.id === RECOMMENDED_TIER_ID),
  RECOMMENDED_TIER_ID,
);

// The headline case from §3.7: 5,000 credits must state what it buys, and match the table.
const growth = (result?.plans ?? []).find((p: any) => p.credits === 5000);
if (growth) {
  const expected = tierCapacity(CREDIT_TIERS.find((t) => t.monthlyCredits === 5000)!);
  check(
    'the 5,000-credit plan states what it buys',
    growth.includes?.images === expected.images && growth.includes?.videoSeconds === expected.videoSeconds,
    `${growth.includes?.images} images, ${growth.includes?.videoSeconds}s video, ${growth.includes?.callMinutes} call minutes`,
  );
  check(
    'its summary sentence names images and video in one line',
    /images/.test(String(growth.summary)) && /video/.test(String(growth.summary)),
    String(growth.summary).slice(0, 120),
  );
  check(
    'video is quoted in minutes, not raw seconds',
    /min of video/.test(String(growth.summary)),
    String(growth.summary).slice(0, 120),
  );
  check(
    'the summary is priced in rupees, not paise',
    /^₹/.test(String(growth.summary)),
    String(growth.summary).slice(0, 30),
  );
} else {
  check('a 5,000-credit plan exists to describe', false, 'no tier with 5,000 credits');
}

// An unreadable balance must never be presented as zero.
if (result?.balance === null) {
  check('an unreadable balance is labelled unknown, not zero', result?.balanceKnown === false);
} else {
  check(
    'the balance is a real number and what it buys is consistent',
    typeof result?.balance === 'number' &&
      result.thisBalanceBuys.images === Math.floor(result.balance / CREDIT_COSTS.AI_IMAGE_GENERATION),
    `balance ${result?.balance} -> ${result?.thisBalanceBuys?.images} images`,
  );
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
