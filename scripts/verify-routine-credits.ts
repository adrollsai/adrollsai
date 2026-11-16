/**
 * Does a routine refuse to start on an empty balance — and still start on a funded one?
 *
 * §3.7's "routines must not start without credits" was only ever a sentence in a prompt: `run_routine`
 * and `run_one_off` claimed a period and queued a harness run with no idea whether the account could
 * pay for the first image. The guard is now real; this checks both directions, because a guard that
 * blocks a funded account is worse than no guard at all.
 *
 * It calls the SAME decision function the tools call, and it starts NOTHING: no period is claimed,
 * no run is queued, no credit is spent.
 *
 *   npx esbuild scripts/verify-routine-credits.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-routine-credits.mjs && node .tmp-routine-credits.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { creditsRefusal } from '../lib/agent/tools/routine';
import { availableCredits, CREDIT_COSTS } from '../utils/credits';

dotenv.config({ path: '.env.local', quiet: true });

const FUNDED_ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor, 5,000 credits
const UNKNOWN_ORG = '00000000-0000-4000-8000-000000000000'; // no profile row at all

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

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

console.log(`floor: ${CREDIT_COSTS.AI_IMAGE_GENERATION} credits (one generated image)\n`);

console.log('▸ a funded account must NOT be blocked');
const balance = await availableCredits(db as any, FUNDED_ORG);
console.log(`  available credits: ${balance}`);
const funded = await creditsRefusal(db as any, FUNDED_ORG);
check('a funded account is allowed to start', funded === null, funded ? JSON.stringify(funded).slice(0, 160) : '');

console.log('\n▸ an unknown balance must NOT be treated as zero');
const unknown = await creditsRefusal(db as any, UNKNOWN_ORG);
check(
  'an unreadable balance does not block the routine',
  unknown === null,
  unknown ? JSON.stringify(unknown).slice(0, 160) : 'allowed (balance unreadable, so not assumed to be zero)',
);

console.log('\n▸ the refusal, when it fires, must be honest and spend nothing');
// Exercise the decision with a stubbed reader, so the refusal sentence is checked without touching
// a real account. The stub returns the same shape availableCredits does.
const stubDb = (credits: number | null) =>
  ({
    rpc: async () => ({ data: credits, error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'x', credits }, error: null }), maybeSingle: async () => ({ data: { credits }, error: null }) }) }),
    }),
  }) as any;

const broke = await creditsRefusal(stubDb(0), 'x');
check('zero credits is refused', broke !== null && broke.ok === false);
check('the refusal says how many credits there are', /\b0 credits\b/.test(String(broke?.error ?? '')), String(broke?.error ?? '').slice(0, 120));
check('the refusal says nothing was started or spent', /Nothing was\s+started/i.test(String(broke?.error ?? '')));
check('the refusal carries the numbers a UI can render', broke?.credits === 0 && broke?.required === CREDIT_COSTS.AI_IMAGE_GENERATION);

const justUnder = await creditsRefusal(stubDb(CREDIT_COSTS.AI_IMAGE_GENERATION - 1), 'x');
check('one credit short is refused', justUnder !== null);

const exactly = await creditsRefusal(stubDb(CREDIT_COSTS.AI_IMAGE_GENERATION), 'x');
check('exactly the floor is allowed', exactly === null);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
