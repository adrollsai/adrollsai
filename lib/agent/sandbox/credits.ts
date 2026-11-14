/* eslint-disable @typescript-eslint/no-explicit-any --
 * See lib/agent/sandbox/store.ts: the generated database types are stale, so the
 * Supabase handle is intentionally loose.
 */
/**
 * Credits adapter for the durable sandbox runner, and the idempotency that makes
 * "charge once per completed step" actually true.
 *
 * NO NEW MONEY CODE. Everything that moves money is `lib/automation/billing.ts`
 * (which in turn calls the SECURITY DEFINER functions from
 * 20261213000100_atomic_credit_functions.sql):
 *
 *   hold()   -> reserveCredits()  reserve_credits   one reservation per run
 *   charge() -> chargeHold()      charge_hold       min(requested, remaining)
 *   refund() -> closeHold()       close_hold        releases the unspent part
 *   settle() -> closeHold()       close_hold        releases whatever a finished
 *                                                   run never spent
 *
 * WHERE EXACTLY-ONCE COMES FROM
 *
 *   Every charge carries `ref = agent_run:<run_id>:<step>`, and
 *   `credit_transactions.ref` has a UNIQUE index
 *   (credit_transactions_ref_uniq). `charge_hold` claims that ref BEFORE it
 *   touches a balance, so of two concurrent or repeated charges for the same
 *   (run_id, step) exactly one moves money and the other comes back
 *   `{ duplicate: true, charged: 0 }`. The adapter treats that as success, not as
 *   an error — the step was paid for, once.
 *
 *   A refund is a `close_hold`: it does not move money, it takes the hold out of
 *   the open set so the unspent remainder becomes available again. `close_hold`
 *   only acts on a hold in state 'open', so a second refund returns
 *   `already: released` and releases nothing twice.
 *
 *   No reservation exists when the RPCs are not deployed (billing degrades to
 *   `holdId: null` and lets work proceed). In that case the same ref is claimed
 *   directly in `credit_transactions` before `spendCreditsAtomic`, and the claim
 *   is rolled back if the spend fails, so the fallback path is idempotent too.
 */

import * as billing from '@/lib/automation/billing';
import type { RunnerDeps } from './runner';
import type { AgentLogger } from './log';
import { silentLogger } from './log';

/** The runner's credit contract, taken straight from its own dependency type. */
export type RunnerCredits = RunnerDeps['credits'];

/** The billing helpers, injectable so a test can drive a fake wallet. */
export interface MoneyOps {
  resolveOwner(admin: any, userId: string): Promise<string>;
  reserveCredits(admin: any, options: billing.ReserveOptions): Promise<billing.ReserveResult>;
  chargeHold(admin: any, options: billing.ChargeOptions): Promise<billing.ChargeResult>;
  closeHold(admin: any, holdId: string | null, reason?: string): Promise<billing.CloseResult>;
  spendCreditsAtomic(admin: any, userId: string, amount: number): Promise<number | null>;
}

/** The real thing: lib/automation/billing.ts, unmodified. */
export const BILLING_HELPERS: MoneyOps = {
  resolveOwner: (admin, userId) => billing.resolveBillingOwner(admin, userId),
  reserveCredits: (admin, options) => billing.reserveCredits(admin, options),
  chargeHold: (admin, options) => billing.chargeHold(admin, options),
  closeHold: (admin, holdId, reason) => billing.closeHold(admin, holdId, reason),
  spendCreditsAtomic: (admin, userId, amount) => billing.spendCreditsAtomic(admin, userId, amount),
};

export class CreditsError extends Error {
  readonly op: 'hold' | 'charge' | 'refund' | 'settle';

  constructor(op: CreditsError['op'], message: string) {
    super(message);
    this.name = 'CreditsError';
    this.op = op;
    Object.setPrototypeOf(this, CreditsError.prototype);
  }
}

/** Raised before any work starts, so a run can never outspend its wallet. */
export class InsufficientCreditsError extends CreditsError {
  readonly available: number | null;

  constructor(runId: string, requested: number, available: number | null) {
    super(
      'hold',
      `insufficient credits for run ${runId}: ${requested} requested, ` +
        `${available === null ? 'balance unknown' : `${available} available`}. No work was started.`,
    );
    this.name = 'InsufficientCreditsError';
    this.available = available;
    Object.setPrototypeOf(this, InsufficientCreditsError.prototype);
  }
}

/** The idempotency key of one step of one run. Stable across processes. */
export function chargeRef(runId: string, step: string): string {
  return `agent_run:${runId}:${step}`;
}

export interface CreditsAdapter extends RunnerCredits {
  /** The reservation backing this run, or null when none exists. */
  holdIdFor(runId: string): Promise<string | null>;
  /** Release whatever a finished run never spent. Safe to call twice. */
  settle(runId: string, reason?: string): Promise<void>;
}

export interface SupabaseCreditsOptions {
  supabase: any;
  /** Who pays. `resolveBillingOwner` maps a team member to the owner's wallet. */
  userId: string;
  money?: MoneyOps;
  /** How long the reservation survives without progress. */
  ttlMinutes?: number;
  /** Ledger category for every charge this adapter makes. */
  category?: billing.CreditCategory;
  log?: AgentLogger;
}

const DEFAULT_TTL_MINUTES = 120;

export function createSupabaseCredits(options: SupabaseCreditsOptions): CreditsAdapter {
  const log = options.log ?? silentLogger;
  const supabase = options.supabase;
  const money = options.money ?? BILLING_HELPERS;
  const category = options.category ?? 'ai_generation';
  const ttlMinutes = options.ttlMinutes ?? DEFAULT_TTL_MINUTES;

  if (!supabase || typeof supabase.from !== 'function' || typeof supabase.rpc !== 'function') {
    throw new CreditsError(
      'hold',
      'agent credits adapter needs a service-role Supabase client (options.supabase)',
    );
  }
  if (!options.userId) {
    throw new CreditsError('hold', 'agent credits adapter needs options.userId to bill');
  }

  /** runId -> hold id (null = the database could not record a reservation). */
  const holds = new Map<string, string | null>();
  let ownerId: string | null = null;

  const owner = async (): Promise<string> => {
    if (ownerId) return ownerId;
    const resolved = await money.resolveOwner(supabase, options.userId);
    ownerId = resolved || options.userId;
    return ownerId;
  };

  /**
   * Find the reservation for this run.
   *
   * In-process first. After a restart, or on a different worker resuming the run,
   * the hold is looked up by (user_id, job_id, state = 'open') — which is exactly
   * the partial unique index `credit_holds_open_job_uniq`, so `maybeSingle()` is
   * safe and there can never be two.
   */
  const holdIdFor = async (runId: string): Promise<string | null> => {
    if (holds.has(runId)) return holds.get(runId) ?? null;

    const { data, error } = await supabase
      .from('credit_holds')
      .select('id')
      .eq('user_id', await owner())
      .eq('job_id', runId)
      .eq('state', 'open')
      .maybeSingle();

    if (error) {
      // Not fatal on its own: the caller's charge() will fall through to the
      // ledger claim, which is still exactly-once. Log loudly, keep going.
      log('credits.hold_lookup_failed', { runId, error: String(error.message || error) });
      return null;
    }

    const found = data && data.id != null ? String(data.id) : null;
    if (found) {
      holds.set(runId, found);
      log('credits.hold_recovered', { runId, holdId: found });
    }
    return found;
  };

  /**
   * No reservation exists (the credit RPCs are not deployed, or the reserve call
   * was degraded). Claim the ledger ref first — `credit_transactions.ref` is
   * uniquely indexed — and only then move money, so a repeat charges nothing.
   */
  const chargeWithoutHold = async (
    runId: string,
    step: string,
    credits: number,
    ref: string,
  ): Promise<void> => {
    const payer = await owner();

    const { error: claimError } = await supabase.from('credit_transactions').insert({
      user_id: payer,
      amount: -credits,
      category,
      description: `agent run ${runId} / ${step}`.slice(0, 480),
      ref,
    });

    if (claimError) {
      if (String((claimError as any).code || '') === '23505') {
        log('credits.charge_duplicate', { runId, step, ref, via: 'ledger_ref' });
        return;
      }
      throw new CreditsError(
        'charge',
        `could not claim the ledger ref ${ref} for step "${step}" of run ${runId}: ` +
          String((claimError as any).message || claimError),
      );
    }

    const balance = await money.spendCreditsAtomic(supabase, options.userId, credits);

    if (balance === null) {
      // Give the claim back so a funded retry can still pay for this step.
      await supabase.from('credit_transactions').delete().eq('ref', ref);
      throw new CreditsError(
        'charge',
        `the wallet could not cover ${credits} credits for step "${step}" of run ${runId}; ` +
          'the ledger claim was rolled back.',
      );
    }

    log('credits.charged', { runId, step, ref, credits, balance, via: 'ledger_ref' });
  };

  return {
    holdIdFor,

    async hold(runId: string, amount: number): Promise<void> {
      const requested = Number(amount) || 0;
      if (requested <= 0) {
        // Nothing to reserve, but remember that so charge() does not go looking
        // for a hold that was deliberately never created.
        holds.set(runId, null);
        return;
      }

      const result = await money.reserveCredits(supabase, {
        userId: options.userId,
        jobId: runId,
        amount: requested,
        ttlMinutes,
        reason: `agent_run:${runId}`,
      });

      if (!result.ok) {
        // The paywall signal. Thrown before a sandbox exists, so no work is done
        // and nothing needs refunding.
        throw new InsufficientCreditsError(runId, requested, result.available);
      }

      holds.set(runId, result.holdId);

      if (!result.holdId) {
        log('credits.hold_degraded', {
          runId,
          requested,
          note: 'no reservation recorded (credit RPCs missing?); charges fall back to the ledger ref',
        });
        return;
      }

      log('credits.hold', { runId, holdId: result.holdId, amount: requested });
    },

    async charge(runId: string, step: string, amount: number): Promise<void> {
      const credits = Math.max(0, Number(amount) || 0);
      if (credits === 0) return;

      const ref = chargeRef(runId, step);
      const holdId = await holdIdFor(runId);

      if (!holdId) {
        await chargeWithoutHold(runId, step, credits, ref);
        return;
      }

      const result = await money.chargeHold(supabase, {
        holdId,
        credits,
        category,
        description: `agent run ${runId} / ${step}`.slice(0, 480),
        ref,
      });

      if (result.duplicate) {
        // Already paid for by an earlier attempt. Success, not an error.
        log('credits.charge_duplicate', { runId, step, ref });
        return;
      }

      if (!result.ok) {
        throw new CreditsError(
          'charge',
          `could not charge step "${step}" of run ${runId} (${result.error || 'unknown error'}). ` +
            'The step finished but the wallet did not move.',
        );
      }

      if (result.capped) {
        // The reservation was smaller than the step asked for. Should be
        // impossible (the runner holds exactly the remaining steps), so say so.
        log('credits.charge_capped', {
          runId,
          step,
          requested: credits,
          charged: result.charged,
          remaining: result.remaining,
        });
      }

      log('credits.charged', {
        runId,
        step,
        ref,
        credits: result.charged,
        balance: result.balance,
        remaining: result.remaining,
      });
    },

    async refund(runId: string, amount: number, reason: string): Promise<void> {
      const holdId = await holdIdFor(runId);
      if (!holdId) {
        log('credits.refund_no_hold', { runId, amount: Number(amount) || 0, reason });
        return;
      }

      const result = await money.closeHold(supabase, holdId, reason);
      holds.delete(runId);

      if (!result.ok) {
        throw new CreditsError(
          'refund',
          `could not release the reserve for run ${runId} (hold ${holdId}): ${reason}`,
        );
      }

      log('credits.refunded', {
        runId,
        holdId,
        requested: Number(amount) || 0,
        spent: result.spent,
        released: result.released,
        state: result.state,
        reason,
      });
    },

    async settle(runId: string, reason = 'run_complete'): Promise<void> {
      const holdId = await holdIdFor(runId);
      if (!holdId) return;

      const result = await money.closeHold(supabase, holdId, reason);
      holds.delete(runId);

      if (!result.ok) {
        throw new CreditsError(
          'settle',
          `could not settle the reserve for run ${runId} (hold ${holdId}): ${reason}`,
        );
      }

      log('credits.settled', {
        runId,
        holdId,
        spent: result.spent,
        released: result.released,
        state: result.state,
      });
    },
  };
}
