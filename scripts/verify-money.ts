/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test harness: the fake client and the rows it returns are intentionally
 * untyped, mirroring how Supabase returns data to the real code.
 */
/**
 * Verification suite for money: holds, atomic spend, and payment idempotency.
 *
 *   npm run verify:money
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 * The SQL functions (`reserve_credits`, `charge_hold`, `grant_credits_once`, …)
 * are exercised live, inside a rolled-back transaction, by
 * `scratch/credit-primitives-test.sql`. That is where the race, the charge cap and
 * the unique-reference claim are actually proven.
 *
 * This file proves the TypeScript half: that `lib/automation/billing.ts` and
 * `utils/credits.ts` call those functions with the right arguments, read the
 * results correctly, refuse to start unfunded work, degrade safely when the
 * migration is absent, and never double-credit a payment. It runs against an
 * in-memory fake that implements the same contract, so it needs no database and
 * no network — which also means it can run in CI.
 */

import {
  quoteJob,
  QUOTE_APPROVAL_THRESHOLD,
  reserveCredits,
  chargeHold,
  closeHold,
  releaseHold,
  grantCreditsOnce,
  availableCredits,
  spendCreditsAtomic,
  addCreditsAtomic,
  creditBalance,
} from '../lib/automation/billing';
import { planOnboarding, onboardingJobId, vendorVideoSeconds, videoCredits, imageCredits } from '../lib/automation/onboarding-plan';
import { hasEnoughCredits, hasBalance, welcomeGrantActive, deductCredits } from '../utils/credits';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`
  );
}

/* ====================================================================== */
/* A fake Supabase client that implements the credit contract             */
/* ====================================================================== */

interface FakeProfile {
  id: string;
  parent_id?: string | null;
  agency_id?: string | null;
  credits: number;
  business_name?: string;
  role?: string;
  subscription_status?: string | null;
  email?: string;
  client_features?: Record<string, any>;
}

interface FakeHold {
  id: string;
  user_id: string;
  job_id: string;
  amount: number;
  spent: number;
  state: 'open' | 'settled' | 'released';
  expires_at: number | null;
}

/**
 * `withFunctions: false` simulates a database where the migration has not been
 * applied — the degrade path, which must never block a customer's marketing.
 */
class FakeDb {
  profiles = new Map<string, FakeProfile>();
  holds: FakeHold[] = [];
  ledger: Array<{ user_id: string; amount: number; category: string; ref?: string | null }> = [];
  refs = new Set<string>();
  rpcCalls: string[] = [];
  private seq = 0;

  constructor(public withFunctions = true) {}

  seed(id: string, credits: number, extra: Partial<FakeProfile> = {}) {
    this.profiles.set(id, { id, credits, ...extra });
    return this;
  }

  private missing() {
    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } };
  }

  /** The `from()` builder: only the shapes this code actually uses. */
  from(table: string) {
    const db = this;
    const state: any = { table, filters: [] as Array<[string, any]>, patch: null, insertRows: null, selected: '*' };

    const exec = (mode: 'single' | 'maybeSingle' | 'many') => {
      if (state.table !== 'profiles') return { data: null, error: null };

      const rows = [...db.profiles.values()].filter((p) =>
        state.filters.every(([col, val]: [string, any]) => (p as any)[col] === val)
      );

      if (state.patch) {
        if (rows.length === 0) return { data: null, error: null };
        for (const row of rows) {
          // Mirror the compare-and-swap guard used by the fallback path.
          const swaps = state.filters.filter(([col]: [string, any]) => col === 'credits');
          if (swaps.length > 0 && row.credits !== swaps[0][1]) continue;
          Object.assign(row, state.patch);
        }
        const updated = rows.filter((row) => state.filters.every(([col, val]: [string, any]) => (row as any)[col] === val));
        if (state.selected === 'credits') {
          return { data: mode === 'many' ? updated.map((r) => ({ credits: r.credits })) : { credits: updated[0]?.credits }, error: null };
        }
        return { data: mode === 'many' ? updated : updated[0] || null, error: null };
      }

      if (mode === 'many') return { data: rows, error: null };
      if (mode === 'maybeSingle') return { data: rows[0] || null, error: null };
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } };
    };

    const builder: any = {
      select(cols: string) {
        state.selected = cols;
        return builder;
      },
      eq(col: string, val: any) {
        state.filters.push([col, val]);
        return builder;
      },
      update(patch: any) {
        state.patch = patch;
        return builder;
      },
      insert(rows: any) {
        state.insertRows = Array.isArray(rows) ? rows : [rows];
        const list = state.insertRows as any[];
        if (state.table === 'credit_transactions') {
          for (const row of list) {
            if (row.ref) {
              if (db.refs.has(row.ref)) {
                return {
                  then: (res: any) => res({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }),
                };
              }
              db.refs.add(row.ref);
            }
            db.ledger.push({ ...row });
          }
        }
        return { data: null, error: null };
      },
      single() {
        return exec('single');
      },
      maybeSingle() {
        return exec('maybeSingle');
      },
      then(res: any) {
        res(exec('many'));
      },
    };
    return builder;
  }

  async rpc(name: string, args: any): Promise<{ data: any; error: any }> {
    this.rpcCalls.push(name);
    if (!this.withFunctions) return this.missing();

    const profile = this.profiles.get(args.p_user_id);
    const now = Date.now();

    const openHeld = () =>
      this.holds
        .filter((h) => h.user_id === args.p_user_id && h.state === 'open' && (h.expires_at === null || h.expires_at > now))
        .reduce((sum, h) => sum + (h.amount - h.spent), 0);

    switch (name) {
      case 'available_credits': {
        if (!profile) return { data: null, error: null };
        return { data: profile.credits - openHeld(), error: null };
      }

      case 'reserve_credits': {
        if (!profile) return { data: null, error: null };
        const existing = this.holds.find(
          (h) => h.user_id === args.p_user_id && h.job_id === args.p_job_id && h.state === 'open'
        );
        if (existing) return { data: existing.id, error: null };
        if (profile.credits - openHeld() < args.p_amount) return { data: null, error: null };
        const id = `hold-${++this.seq}`;
        this.holds.push({
          id,
          user_id: args.p_user_id,
          job_id: args.p_job_id,
          amount: args.p_amount,
          spent: 0,
          state: 'open',
          expires_at: args.p_ttl_minutes == null ? null : now + args.p_ttl_minutes * 60_000,
        });
        return { data: id, error: null };
      }

      case 'charge_hold': {
        const hold = this.holds.find((h) => h.id === args.p_hold_id);
        if (!hold) return { data: { ok: false, error: 'hold_not_found' }, error: null };
        if (hold.state !== 'open') return { data: { ok: false, error: `hold_${hold.state}` }, error: null };
        // charge_hold is addressed by hold id, so the wallet comes from the hold.
        const holder = this.profiles.get(hold.user_id);
        if (!holder) return { data: { ok: true, error: 'no_profile' }, error: null };
        if (args.p_ref && this.refs.has(args.p_ref)) {
          return { data: { ok: true, duplicate: true, charged: 0, remaining: hold.amount - hold.spent }, error: null };
        }
        const remaining = Math.max(hold.amount - hold.spent, 0);
        const charge = Math.min(Math.max(args.p_amount || 0, 0), remaining);
        if (charge <= 0) {
          return { data: { ok: true, charged: 0, capped: (args.p_amount || 0) > 0, remaining }, error: null };
        }
        if (holder.credits < charge) {
          return { data: { ok: false, error: 'insufficient_at_settle' }, error: null };
        }
        holder.credits -= charge;
        hold.spent += charge;
        if (args.p_ref) this.refs.add(args.p_ref);
        this.ledger.push({ user_id: hold.user_id, amount: -charge, category: args.p_category || 'ai_generation', ref: args.p_ref });
        return {
          data: { ok: true, charged: charge, balance: holder.credits, remaining: remaining - charge, capped: (args.p_amount || 0) > charge },
          error: null,
        };
      }

      case 'close_hold':
      case 'release_hold': {
        const hold = this.holds.find((h) => h.id === args.p_hold_id);
        if (!hold) return { data: { ok: false, error: 'hold_not_found' }, error: null };
        if (hold.state !== 'open') return { data: { ok: true, already: hold.state, spent: hold.spent }, error: null };
        hold.state = hold.spent > 0 ? 'settled' : 'released';
        return {
          data: { ok: true, state: hold.state, spent: hold.spent, released: hold.amount - hold.spent },
          error: null,
        };
      }

      case 'spend_credits': {
        if (!profile) return { data: null, error: null };
        if (profile.credits < args.p_amount) return { data: null, error: null };
        profile.credits -= args.p_amount;
        return { data: profile.credits, error: null };
      }

      case 'add_credits_atomic': {
        if (!profile) return { data: null, error: null };
        profile.credits += args.p_amount;
        return { data: profile.credits, error: null };
      }

      case 'grant_credits_once': {
        if (!profile) return { data: null, error: null };
        if (this.refs.has(args.p_ref)) return { data: null, error: null };
        this.refs.add(args.p_ref);
        this.ledger.push({ user_id: args.p_user_id, amount: args.p_amount, category: args.p_category, ref: args.p_ref });
        profile.credits += args.p_amount;
        return { data: profile.credits, error: null };
      }

      default:
        return { data: null, error: { code: 'PGRST202', message: `no such function ${name}` } };
    }
  }
}

const U = '11111111-1111-1111-1111-111111111111';

/* ====================================================================== */
/* 1. QUOTES — price the job before doing it                              */
/* ====================================================================== */
function testQuotes() {
  console.log('\n— quotes —');

  const quote = quoteJob('job-1', [
    { id: 'img-1', kind: 'image', units: 2 },
    { id: 'vid-1', kind: 'video', units: 30 },
  ]);
  eq('2 images + 30s video prices at 120 credits', quote.costInCredits, 120);
  eq('a 120-credit job needs no approval', quote.needsApproval, false);

  const big = quoteJob('job-2', [{ id: 'vid', kind: 'video', units: 300 }]);
  eq('300s of video prices at 1000 credits', big.costInCredits, 1000);
  eq('a 1000-credit job needs approval', big.needsApproval, true);
  check('the approval threshold is 200 credits', QUOTE_APPROVAL_THRESHOLD === 200, String(QUOTE_APPROVAL_THRESHOLD));

  eq('a 45s video is billed as the 30s the vendor renders', vendorVideoSeconds(45), 30);
  eq('a 30s video costs 100 credits', videoCredits(30), 100);
  eq('an image costs 10 credits', imageCredits(), 10);

  const single = quoteJob('job-3', [{ id: 'copy', label: 'Ad copy', kind: 'copy', units: 1 }]);
  eq('one copy step is quoted as a line, not a guess', single.lines.length, 1);
}

/* ====================================================================== */
/* 2. ONBOARDING PLAN — trim, never overrun the run ceiling               */
/* ====================================================================== */
function testOnboardingPlan() {
  console.log('\n— onboarding plan —');

  const basic = planOnboarding([{ creativesCount: 3, videos: [{ duration: 15 }] }]);
  eq('3 creatives + 1 video plan costs 80 credits', basic.costInCredits, 80);
  eq('the plan counts its images', basic.imageCount, 3);
  eq('the plan counts its videos', basic.videoCount, 1);

  // The 300s video budget per run.
  const manyVideos = planOnboarding([
    { creativesCount: 1, videos: Array.from({ length: 11 }, () => ({ duration: 30 })) },
  ]);
  eq('the 300s video budget allows 10 videos of 30s', manyVideos.videoCount, 10);
  check('dropping a video is reported, not silent', manyVideos.trimmed.length > 0, JSON.stringify(manyVideos.trimmed));

  // The per-run credit ceiling: video goes first, images are kept.
  const trimmed = planOnboarding([{ creativesCount: 4, videos: [{ duration: 30 }] }], { maxCredits: 50 });
  eq('a 50-credit ceiling drops the video', trimmed.videoCount, 0);
  eq('a 50-credit ceiling keeps every image', trimmed.imageCount, 4);
  check('a 50-credit ceiling fits the budget', trimmed.costInCredits <= 50, String(trimmed.costInCredits));

  const starved = planOnboarding([{ creativesCount: 10, videos: [{ duration: 30 }] }], { maxCredits: 30 });
  eq('a 30-credit ceiling keeps three images', starved.imageCount, 3);
  check('a starved plan still explains itself', starved.trimmed.length > 0);

  const twoProjects = planOnboarding(
    [
      { creativesCount: 4, videos: [] },
      { creativesCount: 4, videos: [] },
    ],
    { maxCredits: 40 }
  );
  eq('trimming keeps one image for each project', twoProjects.imageCount, 4);
  eq('and does not leave a project with nothing', new Set(twoProjects.items.map((i) => i.projectIndex)).size, 2);

  // Retrying the same request must re-attach to the same reservation.
  eq('the job id is stable for the same plan', onboardingJobId(U, basic), onboardingJobId(U, basic));
  check('a different plan gets a different job id', onboardingJobId(U, basic) !== onboardingJobId(U, manyVideos));
}

/* ====================================================================== */
/* 3. THE RACE — two jobs cannot both take the last 60 credits            */
/* ====================================================================== */
async function testReservationRace() {
  console.log('\n— reservation race —');

  const db = new FakeDb();
  db.seed(U, 100);

  const first = await reserveCredits(db as any, { userId: U, jobId: 'video-a', amount: 60 });
  check('the first 60-credit reservation on a 100-credit wallet succeeds', first.ok && Boolean(first.holdId), JSON.stringify(first));
  eq('a hold does not move money', await creditBalance(db as any, U), 100);
  eq('available credits drop by the reservation', await availableCredits(db as any, U), 40);

  const second = await reserveCredits(db as any, { userId: U, jobId: 'video-b', amount: 60 });
  check('the second 60-credit reservation is refused (this was the bug)', second.ok === false, JSON.stringify(second));
  eq('the refusal reports why', second.reason, 'insufficient');
  eq('the refusal reports the real availability', second.available, 40);

  const retry = await reserveCredits(db as any, { userId: U, jobId: 'video-a', amount: 60 });
  eq('re-entering the same job re-attaches to its hold', retry.holdId, first.holdId);

  // Settlement.
  const charged = await chargeHold(db as any, { holdId: first.holdId, credits: 60, ref: 'video-a:1' });
  eq('the hold settles for the real amount', charged.charged, 60);
  eq('the wallet drops to 40', charged.balance, 40);
  eq('nothing is left on the hold', charged.remaining, 0);

  const closed = await closeHold(db as any, first.holdId, 'job done');
  eq('a settled hold closes as settled', closed.state, 'settled');
  eq('unused reservation is released', closed.released, 0);
}

/* ====================================================================== */
/* 4. CHARGE CAPPING AND STEP IDEMPOTENCY                                 */
/* ====================================================================== */
async function testChargeRules() {
  console.log('\n— charge rules —');

  const db = new FakeDb();
  db.seed(U, 500);

  const hold = await reserveCredits(db as any, { userId: U, jobId: 'job-x', amount: 100 });

  const step1 = await chargeHold(db as any, { holdId: hold.holdId, credits: 40, ref: 'job-x:step-1' });
  eq('a step charges its own amount', step1.charged, 40);
  eq('the hold reports what is left', step1.remaining, 60);

  const retry = await chargeHold(db as any, { holdId: hold.holdId, credits: 40, ref: 'job-x:step-1' });
  eq('a retried step is recognised as a duplicate', retry.duplicate, true);
  eq('a retried step charges nothing', retry.charged, 0);
  eq('a retried step does not touch the wallet', await creditBalance(db as any, U), 460);

  const oversized = await chargeHold(db as any, { holdId: hold.holdId, credits: 999, ref: 'job-x:step-2' });
  eq('an over-large step is capped at the reservation', oversized.charged, 60);
  eq('the cap is reported so the caller can pause', oversized.capped, true);
  eq('the wallet is never overdrawn by a runaway job', await creditBalance(db as any, U), 400);

  const afterClose = await closeHold(db as any, hold.holdId);
  eq('closing a fully spent hold settles it', afterClose.state, 'settled');

  // A cancelled job returns everything it did not spend.
  db.seed('22222222-2222-2222-2222-222222222222', 300);
  const other = await reserveCredits(db as any, {
    userId: '22222222-2222-2222-2222-222222222222',
    jobId: 'job-cancel',
    amount: 200,
  });
  eq('a 200-credit reservation reduces availability', await availableCredits(db as any, '22222222-2222-2222-2222-222222222222'), 100);
  const released = await releaseHold(db as any, other.holdId, 'owner cancelled');
  eq('a cancelled job releases the whole reservation', released.state, 'released');
  eq('a cancelled job charges nothing', released.spent, 0);
  eq(
    'the money is available again',
    await availableCredits(db as any, '22222222-2222-2222-2222-222222222222'),
    300
  );
}

/* ====================================================================== */
/* 5. PAYMENT IDEMPOTENCY                                                 */
/* ====================================================================== */
async function testPaymentIdempotency() {
  console.log('\n— payment idempotency —');

  const db = new FakeDb();
  db.seed(U, 0);

  const first = await grantCreditsOnce(db as any, {
    userId: U,
    amount: 1000,
    category: 'topup',
    description: 'Razorpay pack',
    ref: 'razorpay:pay_TEST123',
  });
  eq('the first delivery of a payment is granted', first.granted, true);
  eq('the balance reflects it', first.balance, 1000);

  const retry = await grantCreditsOnce(db as any, {
    userId: U,
    amount: 1000,
    category: 'topup',
    description: 'Razorpay pack',
    ref: 'razorpay:pay_TEST123',
  });
  eq('a retried payment is recognised as a duplicate', retry.duplicate, true);
  eq('a retried payment is not granted', retry.granted, false);
  eq('the balance is not credited twice (this was free money)', await creditBalance(db as any, U), 1000);

  const different = await grantCreditsOnce(db as any, {
    userId: U,
    amount: 500,
    category: 'topup',
    description: 'Second pack',
    ref: 'razorpay:pay_TEST456',
  });
  eq('a genuinely different payment still lands', different.granted, true);
  eq('and stacks on the balance', await creditBalance(db as any, U), 1500);

  eq('two ledger rows, one per payment', db.ledger.filter((l) => l.ref?.startsWith('razorpay:')).length, 2);
}

/* ====================================================================== */
/* 6. FUNDING — the welcome grant must be spendable                       */
/* ====================================================================== */
async function testFunding() {
  console.log('\n— funding —');

  const db = new FakeDb();
  db.seed(U, 5000, {
    subscription_status: 'free',
    client_features: { welcome_credits_granted: true },
  });

  eq(
    'the welcome grant funds paid work despite subscription_status="free" (this blocked ~75 tenants)',
    await hasEnoughCredits(db as any, U, 500),
    true
  );

  const poor = new FakeDb();
  poor.seed(U, 0, { subscription_status: 'active' });
  eq('an active subscription with no credits is not funding', await hasEnoughCredits(poor as any, U, 10), false);

  // Held credits are already promised: they must not authorise new work.
  const held = new FakeDb();
  held.seed(U, 100, { subscription_status: 'active' });
  await reserveCredits(held as any, { userId: U, jobId: 'nightly', amount: 60 });
  eq('60 reserved leaves 40 spendable', await hasEnoughCredits(held as any, U, 40), true);
  eq('and 50 is therefore not affordable', await hasEnoughCredits(held as any, U, 50), false);

  check('hasBalance is about money only', hasBalance(10, 10) === true && hasBalance(9, 10) === false);
  check('welcomeGrantActive reads the flag', welcomeGrantActive({ client_features: { welcome_credits_granted: true } }) === true);
  check('welcomeGrantActive is false without it', welcomeGrantActive({ client_features: {} }) === false);
}

/* ====================================================================== */
/* 7. ATOMIC SPEND — no overdraft, no lost update                         */
/* ====================================================================== */
async function testAtomicSpend() {
  console.log('\n— atomic spend —');

  const db = new FakeDb();
  db.seed(U, 100, { email: 'someone@example.com' });

  eq('spending more than the balance is refused', await spendCreditsAtomic(db as any, U, 200), null);
  eq('a refused spend leaves the balance alone', await creditBalance(db as any, U), 100);

  eq('spending within the balance succeeds', await spendCreditsAtomic(db as any, U, 100), 0);

  eq('adding credits is an increment', await addCreditsAtomic(db as any, U, 250), 250);

  // deductCredits must not write a negative balance.
  const db2 = new FakeDb();
  db2.seed(U, 100, { email: 'someone@example.com' });
  eq('deductCredits refuses to overdraw', await deductCredits(db2 as any, U, 500, 'ai_generation', 'too big'), false);
  eq('and the balance is untouched', await creditBalance(db2 as any, U), 100);
  eq('deductCredits charges a payable amount', await deductCredits(db2 as any, U, 100, 'ai_generation', 'exact'), true);
  eq('leaving zero, not negative', await creditBalance(db2 as any, U), 0);
}

/* ====================================================================== */
/* 8. DEGRADED MODE — a missing migration must not stop the business      */
/* ====================================================================== */
async function testDegradedMode() {
  console.log('\n— degraded mode (migration not applied) —');

  const db = new FakeDb(false);
  db.seed(U, 1000);

  const reserved = await reserveCredits(db as any, { userId: U, jobId: 'job-degraded', amount: 100 });
  check('the job is allowed to proceed when holds are unavailable', reserved.ok === true, JSON.stringify(reserved));
  eq('but it is flagged as degraded', reserved.reason, 'degraded');
  eq('with no hold id', reserved.holdId, null);

  const charged = await chargeHold(db as any, { holdId: reserved.holdId, credits: 50 });
  eq('charging a job with no hold charges nothing', charged.charged, 0);
  check('and reports success rather than failing the job', charged.ok === true, JSON.stringify(charged));

  const closed = await closeHold(db as any, reserved.holdId);
  eq('closing a null hold is a no-op', closed.spent, 0);

  eq('availability falls back to the raw balance', await availableCredits(db as any, U), 1000);

  const granted = await grantCreditsOnce(db as any, {
    userId: U,
    amount: 100,
    category: 'topup',
    description: 'fallback grant',
    ref: 'razorpay:pay_FALLBACK',
  });
  eq('a grant still lands without the RPC', granted.granted, true);
  eq('via the ledger-claim fallback', granted.degraded, true);
  eq('and credits the wallet', await creditBalance(db as any, U), 1100);
}

/* ====================================================================== */

async function main() {
  testQuotes();
  testOnboardingPlan();
  await testReservationRace();
  await testChargeRules();
  await testPaymentIdempotency();
  await testFunding();
  await testAtomicSpend();
  await testDegradedMode();

  console.log('\n' + '='.repeat(60));
  console.log(`passed ${passed}   failed ${failed}`);
  if (failed > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  • ' + f);
    process.exit(1);
  }
  console.log('ALL MONEY CHECKS PASSED');
}

main().catch((e) => {
  console.error('verify-money crashed:', e);
  process.exit(1);
});
