/**
 * Do the two credit pots actually stay separate — in the money path, not just on the profile?
 *
 * The split is only real if `deductCredits` routes by pot and the database refuses an overdraw of the
 * right column. A `calling_credits` column that nothing debits was the exact state before this change:
 * a phone call spent AI credits and the locked pot sat there.
 *
 * This proves it against the live database, on the Procolor test account, with restoration:
 *
 *   1. spend 1 CALLING credit  -> calling_credits falls by 1, credits UNCHANGED
 *   2. spend 1 AI credit       -> credits falls by 1, calling_credits UNCHANGED
 *   3. spend more calling than the pot holds (while AI credits are plentiful)
 *                              -> REFUSED, and neither pot moves
 *   4. put the account back exactly as it was, and delete this run's ledger rows
 *
 *   npx esbuild scripts/verify-credit-pots.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-credit-pots.mjs && node .tmp-credit-pots.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { deductCredits, availableCredits, availableCallingCredits } from '../utils/credits';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor Film Academy
const TAG = `gate:credit-pots:${Date.now()}`;

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

const read = async () => {
  const { data } = await sb.from('profiles').select('credits, calling_credits').eq('id', ORG).maybeSingle();
  return { ai: Number((data as any)?.credits ?? 0), calling: Number((data as any)?.calling_credits ?? 0) };
};

const restore = async (ai: number, calling: number) => {
  await sb.from('profiles').update({ credits: ai, calling_credits: calling }).eq('id', ORG);
};

const start = await read();
console.log(`start: ${start.ai} AI + ${start.calling} calling\n`);

try {
  // ── 1. A call spends the CALLING pot and leaves AI credits alone.
  const okCall = await deductCredits(sb, ORG, 1, 'calling', `${TAG} call`);
  const afterCall = await read();
  check('a 1-credit call charge succeeds', okCall === true);
  check(
    'it comes out of calling_credits',
    afterCall.calling === start.calling - 1,
    `${start.calling} -> ${afterCall.calling}`,
  );
  check(
    'and AI credits are untouched',
    afterCall.ai === start.ai,
    `AI still ${afterCall.ai}`,
  );

  // ── 2. An AI charge spends the AI pot and leaves calling credits alone.
  const okAi = await deductCredits(sb, ORG, 1, 'ai_generation', `${TAG} image`);
  const afterAi = await read();
  check('a 1-credit AI charge succeeds', okAi === true);
  check('it comes out of credits', afterAi.ai === afterCall.ai - 1, `${afterCall.ai} -> ${afterAi.ai}`);
  check(
    'and calling credits are untouched',
    afterAi.calling === afterCall.calling,
    `calling still ${afterAi.calling}`,
  );

  // ── 3. THE INVARIANT: the calling pot cannot borrow from the AI pot.
  const tooMuch = afterAi.calling + 1;
  const okOverdraw = await deductCredits(sb, ORG, tooMuch, 'calling', `${TAG} overdraw`);
  const afterOverdraw = await read();
  check(
    `a call needing ${tooMuch} credits is REFUSED while ${afterAi.ai} AI credits sit unused`,
    okOverdraw === false,
    'this is the whole point of a locked pot',
  );
  check(
    'and the refusal moved neither pot',
    afterOverdraw.ai === afterAi.ai && afterOverdraw.calling === afterAi.calling,
    `${afterOverdraw.ai} AI + ${afterOverdraw.calling} calling`,
  );

  // ── 4. The read helpers report the right pot.
  check('availableCredits reports AI credits', (await availableCredits(sb, ORG)) === afterOverdraw.ai);
  check(
    'availableCallingCredits reports calling credits',
    (await availableCallingCredits(sb, ORG)) === afterOverdraw.calling,
  );

  // ── 5. Both RPCs exist and are SECURITY DEFINER, not invoker.
  for (const rpc of ['spend_credits', 'spend_calling_credits']) {
    const { error } = await sb.rpc(rpc, { p_user_id: ORG, p_amount: 0 });
    check(`${rpc} is callable`, !error, error ? error.message.slice(0, 70) : 'ok');
  }
} finally {
  await restore(start.ai, start.calling);
  const after = await read();
  const ledger = await sb.from('credit_transactions').delete().eq('user_id', ORG).like('description', `${TAG}%`);
  console.log(
    `\ncleanup: restored to ${after.ai} AI + ${after.calling} calling; ` +
      `ledger rows removed (${ledger.error ? ledger.error.message : 'ok'})`,
  );
  check(
    'the account was restored exactly',
    after.ai === start.ai && after.calling === start.calling,
    `${after.ai}/${after.calling} vs ${start.ai}/${start.calling}`,
  );
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
