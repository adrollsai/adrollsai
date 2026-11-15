/**
 * Proves the credit model's arithmetic and its bookkeeping, WITHOUT a database.
 *
 * What is at stake here is somebody's money, so the gate is about the sentences a
 * customer would say out loud:
 *
 *   - "₹9,999 is supposed to be 5,000 credits."        -> the tier table, and the
 *                                                         guard that refuses a
 *                                                         table where a bigger plan
 *                                                         is a worse rate
 *   - "I paid once; I must be credited once."          -> the idempotency key, built
 *                                                         from the payment and not
 *                                                         from the clock
 *   - "the run failed; I should be exactly where I was" -> reconciliation, net 0
 *   - "you charged me but the hold says otherwise"      -> the mismatch verdict
 *   - "5,000 credits is 500 images"                     -> the capacity view, read
 *                                                         from the one unit-cost
 *                                                         table rather than copied
 *
 * Everything below runs over injected fakes; there is no Supabase client in this
 * script and no network call in it.
 *
 *   npm run verify:credits
 */
import {
  CREDIT_TIERS,
  MAX_CREDITS_PER_100_RUPEES,
  MIN_CREDITS_PER_100_RUPEES,
  PAISE_PER_RUPEE,
  RECOMMENDED_TIER_ID,
  TIER_UNIT_COSTS,
  creditsPer100Rupees,
  describeTier,
  formatInr,
  paisePerCredit,
  paisePerThousandCredits,
  rupeesFromPaise,
  tierById,
  tierCapacity,
  tierIds,
  tierTableProblems,
  topUpCredits,
  topUpRatePaisePerCredit,
} from '../lib/automation/credit-tiers';
import {
  CreditGrantError,
  grantTierOnce,
  grantTopUpOnce,
  grantTrialOnce,
  paymentRef,
  topUpRef,
  trialRef,
} from '../lib/automation/credit-grants';
import {
  RUN_REF_PREFIX,
  DEFAULT_LEDGER_LIMIT,
  reconcileRun,
  readLedger,
  runIdFromRef,
  stepFromRef,
  summariseLedger,
  type HoldRow,
  type LedgerRow,
  type LedgerReader,
} from '../lib/automation/credit-reconcile';
import * as creditReconcile from '../lib/automation/credit-reconcile';
import { CREDIT_COSTS } from '../utils/credits';

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

function throws(fn: () => unknown): { threw: boolean; message: string; name: string } {
  try {
    fn();
    return { threw: false, message: '', name: '' };
  } catch (error: any) {
    return { threw: true, message: String(error?.message ?? error), name: String(error?.name ?? '') };
  }
}

async function rejects(fn: () => Promise<unknown>): Promise<{ threw: boolean; message: string; reason?: string }> {
  try {
    await fn();
    return { threw: false, message: '' };
  } catch (error: any) {
    return { threw: true, message: String(error?.message ?? error), reason: String(error?.reason ?? '') };
  }
}

const near = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
const section = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);

// ────────────────────────────────────────────────────────────────────────────
// A fake wallet: enough Supabase to satisfy billing.grantCreditsOnce.
//
// The real grant path calls `rpc('grant_credits_once', …)` and treats a NULL return
// as "this ref was already applied". Reproducing exactly that is what makes the
// idempotency assertions mean something: a duplicate is a NULL, not an exception.
// ────────────────────────────────────────────────────────────────────────────
function fakeWallet(options: { missingRpc?: boolean } = {}) {
  const state = {
    balance: 0,
    refs: new Set<string>(),
    rows: [] as { user_id: string; amount: number; category: string; description: string; ref: string }[],
    rpcCalls: 0,
  };

  const client = {
    async rpc(name: string, args: Record<string, any>) {
      if (options.missingRpc) {
        return { data: null, error: { message: `function public.${name} does not exist`, code: '42883' } };
      }
      if (name !== 'grant_credits_once') {
        return { data: null, error: { message: `unexpected rpc ${name}` } };
      }
      state.rpcCalls++;
      if (state.refs.has(String(args.p_ref))) {
        // Already applied: the real function returns NULL and credits nothing.
        return { data: null, error: null };
      }
      state.refs.add(String(args.p_ref));
      state.balance += Number(args.p_amount);
      state.rows.push({
        user_id: args.p_user_id,
        amount: Number(args.p_amount),
        category: String(args.p_category),
        description: String(args.p_description),
        ref: String(args.p_ref),
      });
      return { data: state.balance, error: null };
    },
    from(table: string) {
      if (table !== 'credit_transactions') throw new Error(`unexpected table ${table}`);
      return {
        insert(row: Record<string, any>) {
          const ref = String(row.ref ?? '');
          if (ref && (state.refs.has(ref) || state.rows.some((existing) => existing.ref === ref))) {
            return Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
          }
          if (ref) state.refs.add(ref);
          state.balance += Number(row.amount);
          state.rows.push({
            user_id: String(row.user_id),
            amount: Number(row.amount),
            category: String(row.category ?? ''),
            description: String(row.description ?? ''),
            ref,
          });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client, state };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. The plan table
// ════════════════════════════════════════════════════════════════════════════

function checkTiers() {
  section('1. The plan table');

  const growth = tierById('growth');
  check(
    '₹9,999 buys 5,000 credits — the decision, pinned',
    Boolean(growth) && growth!.pricePaise === 999_900 && growth!.monthlyCredits === 5_000,
    growth ? `${formatInr(growth.pricePaise)} -> ${growth.monthlyCredits} credits` : 'no growth tier',
  );
  check(
    '₹9,999 is rupees 9,999 exactly, and the table is rupees-only',
    growth !== null && rupeesFromPaise(growth.pricePaise) === 9999 && formatInr(growth.pricePaise) === '₹9,999',
    `${rupeesFromPaise(growth!.pricePaise)} / ${formatInr(growth!.pricePaise)}`,
  );
  check(
    'the table has no problems: ids unique, prices and credits whole, one recommended',
    tierTableProblems().length === 0,
    tierTableProblems().join('; ') || `${CREDIT_TIERS.length} tiers, all clean`,
  );
  check(
    'a larger plan is always a BETTER rate (paise per credit strictly falls)',
    (() => {
      const ordered = [...CREDIT_TIERS].sort((a, b) => a.pricePaise - b.pricePaise);
      return ordered.every(
        (tier, index) => index === 0 || paisePerCredit(tier) < paisePerCredit(ordered[index - 1]),
      );
    })(),
    [...CREDIT_TIERS]
      .sort((a, b) => a.pricePaise - b.pricePaise)
      .map((tier) => `${tier.id}:${paisePerCredit(tier)}p`)
      .join(' '),
  );
  check(
    'a misplaced zero in the PRICE is refused (₹9,999 written as ₹999)',
    (() => {
      // One recommended tier, so the only thing that can fail is the money check.
      const typo = [{ ...CREDIT_TIERS[1], id: 'growth', pricePaise: 99_900 }];
      const problems = tierTableProblems(typo);
      return problems.length > 0 && problems.some((problem) => /above the ceiling/.test(problem));
    })(),
    `ceiling ${MAX_CREDITS_PER_100_RUPEES} credits per ₹100`,
  );
  check(
    'a misplaced zero in the CREDITS is refused (5,000 written as 50,000)',
    (() => {
      const typo = [{ ...CREDIT_TIERS[1], id: 'growth', pricePaise: 999_900, monthlyCredits: 50_000 }];
      return tierTableProblems(typo).some((problem) => /above the ceiling/.test(problem));
    })(),
    'the same guard catches both directions',
  );
  check(
    'a plan that gives almost nothing for the money is refused',
    (() => {
      const stingy = [{ ...CREDIT_TIERS[0], id: 'stingy', pricePaise: 999_900, monthlyCredits: 10 }];
      return tierTableProblems(stingy).some((problem) => /below the floor/.test(problem));
    })(),
    `floor ${MIN_CREDITS_PER_100_RUPEES} credits per ₹100`,
  );
  check(
    'the real table sits comfortably between the floor and the ceiling',
    CREDIT_TIERS.every(
      (tier) =>
        creditsPer100Rupees(tier) > MIN_CREDITS_PER_100_RUPEES &&
        creditsPer100Rupees(tier) < MAX_CREDITS_PER_100_RUPEES,
    ),
    CREDIT_TIERS.map((tier) => `${tier.id}:${creditsPer100Rupees(tier).toFixed(0)}`).join(' '),
  );
  check(
    'an upside-down table (a bigger plan at a worse rate) is refused',
    (() => {
      const upsideDown = [
        { id: 'small', label: 'Small', pricePaise: 100_000, monthlyCredits: 1_000, recommended: true, blurb: '' },
        { id: 'big', label: 'Big', pricePaise: 500_000, monthlyCredits: 1_000, recommended: false, blurb: '' },
      ];
      const problems = tierTableProblems(upsideDown);
      return (
        problems.some((problem) => /better rate|no more credits/.test(problem)) &&
        problems.some((problem) => /recommended/.test(problem))
      );
    })(),
    'both the rate and the credit count are checked',
  );
  check(
    'the recommended tier is the one the constant names',
    tierTableProblems().every((problem) => !/recommended/.test(problem)) &&
      RECOMMENDED_TIER_ID === 'growth' &&
      tierById(RECOMMENDED_TIER_ID)?.recommended === true,
    RECOMMENDED_TIER_ID,
  );
  check(
    'an unknown tier is null, never a default',
    tierById('enterprise-unlimited') === null && tierById('') === null && tierIds().length === CREDIT_TIERS.length,
    tierIds().join(', '),
  );

  const capacity = tierCapacity(tierById('growth')!);
  check(
    '5,000 credits is 500 images, 100 video chunks (1,500 s) and 1,000 call minutes',
    capacity.images === 500 && capacity.videoChunks === 100 && capacity.videoSeconds === 1500 && capacity.callMinutes === 1000,
    `${capacity.images} images / ${capacity.videoSeconds}s video / ${capacity.callMinutes} min`,
  );
  check(
    'the capacity view reads the SAME unit costs the charger uses, so it cannot drift',
    TIER_UNIT_COSTS.image === CREDIT_COSTS.AI_IMAGE_GENERATION &&
      TIER_UNIT_COSTS.video15s === CREDIT_COSTS.AI_VIDEO_15SEC_CHUNK &&
      TIER_UNIT_COSTS.callMinute === CREDIT_COSTS.VOICE_CALL_MINUTE &&
      TIER_UNIT_COSTS.copy === CREDIT_COSTS.AI_COPY_GENERATION,
    `${TIER_UNIT_COSTS.image}/${TIER_UNIT_COSTS.video15s}/${TIER_UNIT_COSTS.callMinute}/${TIER_UNIT_COSTS.copy}`,
  );
  check(
    'capacity is floored, never rounded up into a promise',
    (() => {
      const stretched = tierCapacity({ ...tierById('growth')!, monthlyCredits: 1_099 });
      // 1,099 credits at 10 an image is 109.9 images: the plan covers 109.
      return stretched.images === 109;
    })(),
    '1,099 credits -> 109 images',
  );
  check(
    'the pricing-card line states credits AND what they buy',
    /₹9,999.*5,000 credits.*500 images/.test(describeTier(tierById('growth')!)),
    describeTier(tierById('growth')!),
  );
  check(
    'the per-thousand-credit figure is the one an owner compares',
    paisePerThousandCredits(tierById('growth')!) === 200_000,
    `${formatInr(paisePerThousandCredits(tierById('growth')!))} per 1,000 credits`,
  );

  check(
    'a top-up never beats the plan rate',
    topUpRatePaisePerCredit() === paisePerCredit(tierById(RECOMMENDED_TIER_ID)!),
    `${topUpRatePaisePerCredit()} paise per credit`,
  );
  check(
    'a ₹100 top-up is 50 credits, and a part credit is not sold',
    topUpCredits(10_000) === 50 && topUpCredits(10_099) === 50 && topUpCredits(0) === 0 && topUpCredits(-5) === 0,
    `₹100 -> ${topUpCredits(10_000)}, ₹100.99 -> ${topUpCredits(10_099)}`,
  );
  check(
    'formatInr groups in Indian style and only shows paise when there are any',
    formatInr(999_900) === '₹9,999' &&
      formatInr(2_499_900) === '₹24,999' &&
      formatInr(10_000_000) === '₹1,00,000' &&
      formatInr(2_499_950) === '₹24,999.50',
    `${formatInr(2_499_900)} / ${formatInr(10_000_000)} / ${formatInr(2_499_950)}`,
  );
  check(
    'PAISE_PER_RUPEE is 100 and the growth price is a whole number of rupees',
    PAISE_PER_RUPEE === 100 && CREDIT_TIERS.every((tier) => tier.pricePaise % PAISE_PER_RUPEE === 0),
    'no paise fractions in plan prices',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. The one grant path
// ════════════════════════════════════════════════════════════════════════════

async function checkGrants() {
  section('2. The one idempotent grant path');

  check(
    'a payment ref names the event, never the moment',
    paymentRef('pay_ABC123', 'growth') === paymentRef('pay_ABC123', 'growth') &&
      /^razorpay:pay_ABC123:growth$/.test(paymentRef('pay_ABC123', 'growth')),
    paymentRef('pay_ABC123', 'growth'),
  );
  check(
    'two different payments for the same plan are two grants; one retry is one',
    paymentRef('pay_A', 'growth') !== paymentRef('pay_B', 'growth') &&
      paymentRef('pay_A', 'growth') !== topUpRef('pay_A') &&
      paymentRef('pay_A', 'growth') !== paymentRef('pay_A', 'scale'),
    'payment, tier and kind are all in the key',
  );
  check(
    'the trial ref is per OWNER, so a second signup cannot claim a second trial',
    trialRef('owner-1') === 'trial:owner-1' && trialRef('owner-1') !== trialRef('owner-2'),
    trialRef('owner-1'),
  );
  check(
    'a ref with no id is refused rather than built from an empty string',
    (() => {
      const blank = throws(() => paymentRef('', 'growth'));
      const spaces = throws(() => paymentRef('   ', 'growth'));
      return blank.threw && spaces.threw && /idempotency key/.test(blank.message);
    })(),
    'an empty payment id would make every retry collide',
  );
  check(
    'whitespace in a payment id cannot fork one payment into two keys',
    paymentRef(' pay_A ', 'growth') === paymentRef('pay_A', 'growth'),
    paymentRef(' pay_A ', 'growth'),
  );

  const wallet = fakeWallet();
  const first = await grantTierOnce(wallet.client, {
    userId: 'user-1',
    tierId: 'growth',
    paymentId: 'pay_ONE',
    paidPaise: 999_900,
  });
  check(
    'a plan purchase credits exactly the tier amount',
    first.granted && first.credits === 5_000 && wallet.state.balance === 5_000 && first.tier?.id === 'growth',
    `balance ${wallet.state.balance}, ref ${first.ref}`,
  );
  const again = await grantTierOnce(wallet.client, {
    userId: 'user-1',
    tierId: 'growth',
    paymentId: 'pay_ONE',
    paidPaise: 999_900,
  });
  check(
    'the SAME payment retried credits nothing and says duplicate, not error',
    again.duplicate && again.credits === 0 && wallet.state.balance === 5_000,
    `balance still ${wallet.state.balance}, duplicate ${again.duplicate}`,
  );
  const otherPayment = await grantTierOnce(wallet.client, {
    userId: 'user-1',
    tierId: 'growth',
    paymentId: 'pay_TWO',
  });
  check(
    'a second, genuine payment for the same plan is a second grant',
    otherPayment.granted && wallet.state.balance === 10_000,
    `balance ${wallet.state.balance}`,
  );
  check(
    'the grant is recorded with the subscription category and the ref',
    wallet.state.rows.length === 2 &&
      wallet.state.rows.every((row) => row.category === 'subscription') &&
      wallet.state.rows.every((row) => /^razorpay:pay_(ONE|TWO):growth$/.test(row.ref)),
    wallet.state.rows.map((row) => `${row.amount}:${row.category}`).join(' '),
  );

  const mismatch = await rejects(() =>
    grantTierOnce(fakeWallet().client, { userId: 'u', tierId: 'growth', paymentId: 'pay_X', paidPaise: 499_900 }),
  );
  check(
    'a payment that does not match the plan is refused, and nothing is credited',
    mismatch.threw && mismatch.reason === 'amount_mismatch' && /reconcile the payment/.test(mismatch.message),
    mismatch.message.slice(0, 96),
  );
  const unknown = await rejects(() =>
    grantTierOnce(fakeWallet().client, { userId: 'u', tierId: 'platinum', paymentId: 'pay_Y' }),
  );
  check(
    'an unknown plan is refused rather than credited a guess',
    unknown.threw && unknown.reason === 'unknown_tier',
    unknown.message.slice(0, 96),
  );

  const degraded = fakeWallet({ missingRpc: true });
  const fallback = await grantTierOnce(degraded.client, { userId: 'user-1', tierId: 'growth', paymentId: 'pay_D' });
  const fallbackAgain = await grantTierOnce(degraded.client, { userId: 'user-1', tierId: 'growth', paymentId: 'pay_D' });
  check(
    'with the atomic RPC missing, the fallback is still single-grant',
    fallback.granted && fallback.degraded === true && fallbackAgain.duplicate && degraded.state.balance === 5_000,
    `degraded ${fallback.degraded}, balance ${degraded.state.balance} after two calls`,
  );

  const topUp = await grantTopUpOnce(fakeWallet().client, { userId: 'u', paymentId: 'pay_T', paidPaise: 100_000 });
  check(
    'a top-up credits at the plan rate and is not a plan',
    topUp.granted && topUp.credits === 500 && topUp.tier === null && /:topup$/.test(topUp.ref),
    `${topUp.credits} credits for ₹1,000, ref ${topUp.ref}`,
  );
  const tinyTopUp = await rejects(() =>
    grantTopUpOnce(fakeWallet().client, { userId: 'u', paymentId: 'pay_T2', paidPaise: 100 }),
  );
  check(
    'a payment that buys no whole credit is refused',
    tinyTopUp.threw && tinyTopUp.reason === 'no_credits',
    tinyTopUp.message.slice(0, 90),
  );

  const trialWallet = fakeWallet();
  const trial = await grantTrialOnce(trialWallet.client, { userId: 'u', ownerId: 'owner-1', trialCredits: 300 });
  const trialAgain = await grantTrialOnce(trialWallet.client, { userId: 'u', ownerId: 'owner-1', trialCredits: 300 });
  check(
    'the trial is granted once per owner, forever',
    trial.granted && trialAgain.duplicate && trialWallet.state.balance === 300 && trialWallet.state.rows[0].category === 'trial',
    `balance ${trialWallet.state.balance} after two attempts`,
  );
  check(
    'a plan grant and a trial grant are different refs, so a customer can have both',
    paymentRef('pay_ONE', 'growth') !== trialRef('owner-1'),
    `${paymentRef('pay_ONE', 'growth')} vs ${trialRef('owner-1')}`,
  );
  check(
    'a grant error names its reason, so a caller can decide what to show',
    (() => {
      const error = new CreditGrantError('amount_mismatch', 'x');
      return error.name === 'CreditGrantError' && error.reason === 'amount_mismatch';
    })(),
    'CreditGrantError.reason',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Reconciliation — the failed run nets zero
// ════════════════════════════════════════════════════════════════════════════

const RUN = 'run-abc';

function charge(step: string, credits: number, runId = RUN): LedgerRow {
  return { amount: -credits, category: 'ai_generation', description: `agent run ${runId} / ${step}`, ref: `${RUN_REF_PREFIX}${runId}:${step}` };
}

function checkReconcile() {
  section('3. Reconciliation: a failed run nets zero');

  check(
    'a run ref is parsed back to its run and its step',
    runIdFromRef(`${RUN_REF_PREFIX}${RUN}:s3`) === RUN &&
      stepFromRef(`${RUN_REF_PREFIX}${RUN}:s3`) === 's3' &&
      runIdFromRef('razorpay:pay_A:growth') === null &&
      runIdFromRef(null) === null,
    `${runIdFromRef(`${RUN_REF_PREFIX}${RUN}:s3`)} / ${stepFromRef(`${RUN_REF_PREFIX}${RUN}:s3`)}`,
  );
  check(
    'a run id containing a colon still parses (the step is the LAST segment)',
    runIdFromRef(`${RUN_REF_PREFIX}tenant:run:9:s2`) === 'tenant:run:9' &&
      stepFromRef(`${RUN_REF_PREFIX}tenant:run:9:s2`) === 's2',
    runIdFromRef(`${RUN_REF_PREFIX}tenant:run:9:s2`) ?? 'null',
  );

  // THE CASE THAT MATTERS: reserved 300, nothing finished, remainder released.
  const failed = reconcileRun(
    RUN,
    [],
    { id: 'hold-1', job_id: RUN, amount: 300, spent: 0, state: 'released' },
  );
  check(
    'a FAILED run nets exactly 0 credits and releases the whole reservation',
    failed.netCredits === 0 &&
      failed.verdict === 'no-movement' &&
      failed.chargedCredits === 0 &&
      failed.hold?.released === 300 &&
      failed.stillReservedCredits === 0 &&
      failed.problems.length === 0,
    failed.verdictText,
  );
  check(
    'a failed run never leaves money unavailable',
    failed.stillReservedCredits === 0 && failed.hold?.state === 'released',
    `state ${failed.hold?.state}, reserved ${failed.stillReservedCredits}`,
  );

  // A run that did some work and then failed.
  const partial = reconcileRun(
    RUN,
    [charge('s1', 50), charge('s2', 80)],
    { id: 'hold-2', job_id: RUN, amount: 300, spent: 130, state: 'settled' },
  );
  check(
    'a run that failed after two steps nets only what those steps cost',
    partial.netCredits === -130 && partial.chargedCredits === 130 && partial.verdict === 'charged' && partial.agrees,
    partial.verdictText,
  );
  check(
    'the two records of the same events agree: hold.spent equals the ledger',
    partial.agrees && partial.hold?.spent === partial.chargedCredits,
    `hold spent ${partial.hold?.spent}, ledger ${partial.chargedCredits}`,
  );
  check(
    'the unspent part of a settled hold is reported as released',
    partial.hold?.released === 170,
    `${partial.hold?.released} released of ${partial.hold?.amount}`,
  );

  const mismatch = reconcileRun(
    RUN,
    [charge('s1', 50)],
    { id: 'hold-3', job_id: RUN, amount: 300, spent: 200, state: 'settled' },
  );
  check(
    'a hold whose spent counter disagrees with the ledger is a MISMATCH, with the gap named',
    mismatch.verdict === 'mismatch' &&
      !mismatch.agrees &&
      mismatch.problems.some((problem) => /150 credits apart/.test(problem)),
    mismatch.verdict,
  );

  const duplicateRows = reconcileRun(
    RUN,
    [charge('s1', 50), charge('s1', 50)],
    { id: 'hold-4', job_id: RUN, amount: 300, spent: 100, state: 'settled' },
  );
  check(
    'two ledger rows for one step are reported, not silently summed',
    duplicateRows.problems.some((problem) => /step "s1" appears in 2 ledger rows/.test(problem)),
    duplicateRows.problems[0]?.slice(0, 96) ?? 'no problem reported',
  );

  const open = reconcileRun(
    RUN,
    [charge('s1', 50)],
    { id: 'hold-5', job_id: RUN, amount: 300, spent: 50, state: 'open' },
  );
  check(
    'an unfinished run reports the money it is still holding',
    open.stillReservedCredits === 250 && open.verdict === 'charged' && open.agrees,
    `still reserved ${open.stillReservedCredits}`,
  );

  const noHold = reconcileRun(RUN, [charge('s1', 40)], null);
  check(
    'a charge with no reservation is reported as such, not as an error',
    noHold.verdict === 'charged-without-hold' && noHold.netCredits === -40,
    noHold.verdictText,
  );

  const overCharged = reconcileRun(
    RUN,
    [charge('s1', 400)],
    { id: 'hold-6', job_id: RUN, amount: 300, spent: 400, state: 'settled' },
  );
  check(
    'charging more than the reservation is flagged: a hold must never be exceeded',
    overCharged.problems.some((problem) => /must never be exceeded/.test(problem)),
    overCharged.problems[0]?.slice(0, 96) ?? 'no problem reported',
  );

  const positive = reconcileRun(RUN, [{ amount: 100, ref: `${RUN_REF_PREFIX}${RUN}:s1` }], null);
  check(
    'a run whose ledger is net POSITIVE is flagged',
    positive.problems.some((problem) => /net POSITIVE/.test(problem)),
    positive.problems[0]?.slice(0, 96) ?? 'no problem reported',
  );

  check(
    'rows belonging to another run are ignored, not counted',
    (() => {
      const mixed = reconcileRun(RUN, [charge('s1', 50), charge('s1', 999, 'other-run')], null);
      return mixed.netCredits === -50 && mixed.steps.length === 1;
    })(),
    'one run per call',
  );

  // ── the whole wallet
  const summary = summariseLedger(
    [
      { amount: 5_000, category: 'subscription', ref: 'razorpay:pay_A:growth' },
      charge('s1', 50),
      charge('s2', 80),
      charge('s1', 30, 'run-ok'),
      { amount: -0.4, category: 'whatsapp', ref: null },
    ],
    [
      { id: 'hold-2', job_id: RUN, amount: 300, spent: 130, state: 'settled' },
      { id: 'hold-9', job_id: 'run-ok', amount: 100, spent: 30, state: 'settled' },
    ],
  );
  check(
    'the wallet total is granted minus spent, and it adds up',
    summary.grantedCredits === 5_000 &&
      summary.spentCredits === 160.4 &&
      summary.netCredits === 4_839.6 &&
      summary.problems.length === 0,
    `granted ${summary.grantedCredits}, spent ${summary.spentCredits}, net ${summary.netCredits}`,
  );
  check(
    'runs and non-run rows are separated, and together they equal the total',
    near(summary.runNetCredits + summary.otherNetCredits, summary.netCredits) &&
      summary.runNetCredits === -160 &&
      summary.otherNetCredits === 5_000 - 0.4,
    `runs ${summary.runNetCredits} + other ${summary.otherNetCredits} = ${summary.netCredits}`,
  );
  check(
    'a row with no ref is counted (and counted separately), never dropped',
    summary.rowsWithoutRef === 1,
    `${summary.rowsWithoutRef} row(s) without a ref`,
  );
  check(
    'every run in the window gets a verdict, in a stable order',
    summary.runs.length === 2 &&
      summary.runs.map((run) => run.runId).join(',') === 'run-abc,run-ok' &&
      summary.runs.every((run) => run.verdict === 'charged'),
    summary.runs.map((run) => `${run.runId}:${run.netCredits}`).join(' '),
  );

  const orphanHold = summariseLedger([], [{ id: 'h', job_id: 'run-dead', amount: 90, spent: 0, state: 'open' }]);
  check(
    'a hold on a run with no ledger rows still shows up as money held',
    orphanHold.runs.length === 1 &&
      orphanHold.runs[0].verdict === 'open' &&
      orphanHold.runs[0].stillReservedCredits === 90,
    orphanHold.runs[0]?.verdictText ?? 'missing',
  );

  const doubled = summariseLedger([], [
    { id: 'a', job_id: 'job-1', amount: 10, spent: 0, state: 'open' },
    { id: 'b', job_id: 'job-1', amount: 10, spent: 0, state: 'open' },
  ]);
  check(
    'two open holds on one job is a reported inconsistency, not a silent pick',
    doubled.problems.some((problem) => /more than one hold/.test(problem)),
    doubled.problems[0]?.slice(0, 100) ?? 'no problem reported',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. The admin view is a reader
// ════════════════════════════════════════════════════════════════════════════

async function checkAdminView() {
  section('4. The admin ledger view');

  const seen: { transactions: number; holds: number } = { transactions: 0, holds: 0 };
  const reader: LedgerReader = {
    async transactions() {
      seen.transactions++;
      return [{ amount: 5_000, category: 'subscription', ref: 'razorpay:pay_A:growth' }, charge('s1', 50)];
    },
    async holds() {
      seen.holds++;
      return [{ id: 'h1', job_id: RUN, amount: 300, spent: 50, state: 'settled' }];
    },
  };

  const view = await readLedger(reader, { userId: 'user-1' });
  check(
    'the view reads both tables once and reports the net movement',
    seen.transactions === 1 && seen.holds === 1 && view.netCredits === 4_950 && view.userId === 'user-1',
    `net ${view.netCredits} over ${view.runs.length} run(s)`,
  );
  check(
    'the view defaults its window rather than reading an unbounded table',
    view.limit === DEFAULT_LEDGER_LIMIT && DEFAULT_LEDGER_LIMIT > 0,
    `${view.limit} rows`,
  );
  check(
    'an explicit limit is clamped, so a query cannot ask for the whole table',
    (await readLedger(reader, { userId: 'u', limit: 999_999 })).limit === 5_000 &&
      (await readLedger(reader, { userId: 'u', limit: 0 })).limit === DEFAULT_LEDGER_LIMIT,
    'max 5000',
  );
  check(
    'a view with no user is refused',
    (await rejects(() => readLedger(reader, { userId: '  ' }))).threw,
    'readLedger needs a userId',
  );
  check(
    'the view is read-only: the module exposes no writer',
    // A guard on the API SURFACE, not on behaviour: if a write helper is ever added
    // to the ledger module, this fails and the reviewer sees it. The ledger is the
    // audit trail, so the only ways credits may move are a payment or a run's own
    // charge/refund path.
    !Object.keys(creditReconcile).some((key) => /^(write|set|adjust|update|delete|grant|insert|charge|refund)/i.test(key)),
    Object.keys(creditReconcile).length + ' exports, none of them a writer',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. The end-to-end story: pay, run, fail, refund
// ════════════════════════════════════════════════════════════════════════════

async function checkStory() {
  section('5. Pay -> run -> fail -> refund, as one ledger');

  const wallet = fakeWallet();
  const grant = await grantTierOnce(wallet.client, { userId: 'u', tierId: 'growth', paymentId: 'pay_LIFE' });

  // The run reserves 300 of those credits, charges one step, then fails, so the
  // remainder goes back.
  const rows: LedgerRow[] = [
    ...wallet.state.rows.map((row) => ({ amount: row.amount, category: row.category, ref: row.ref })),
    charge('s1', 50),
  ];
  const hold: HoldRow = { id: 'h', job_id: RUN, amount: 300, spent: 50, state: 'released' };
  const run = reconcileRun(RUN, rows, hold);
  const summary = summariseLedger(rows, [hold]);

  check(
    'the customer bought a plan, one step ran, the rest came back',
    grant.granted &&
      grant.credits === 5_000 &&
      run.netCredits === -50 &&
      run.hold?.released === 250 &&
      run.stillReservedCredits === 0,
    `${run.verdictText}; ${run.hold?.released} released`,
  );
  check(
    'the wallet nets the plan minus the one step that finished',
    summary.netCredits === 4_950 && summary.grantedCredits === 5_000 && summary.spentCredits === 50,
    `net ${summary.netCredits}`,
  );
  check(
    'nothing is left unavailable after the run ended',
    summary.runs.every((entry) => entry.stillReservedCredits === 0) && summary.problems.length === 0,
    'no open reservations, no problems',
  );
  await grantTierOnce(wallet.client, { userId: 'u', tierId: 'growth', paymentId: 'pay_LIFE' });
  check(
    'a retried payment in the middle of that story leaves the wallet where it was',
    wallet.state.balance === 5_000 && wallet.state.rows.length === 1 && summary.netCredits === 4_950,
    `${wallet.state.rows.length} ledger row(s), balance ${wallet.state.balance}`,
  );

  check(
    'RUN_REF_PREFIX is the same prefix the runner charges with',
    RUN_REF_PREFIX === 'agent_run:' && `${RUN_REF_PREFIX}${RUN}:s1` === `agent_run:${RUN}:s1`,
    RUN_REF_PREFIX,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────────

(async () => {
  checkTiers();
  await checkGrants();
  checkReconcile();
  await checkAdminView();
  await checkStory();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
