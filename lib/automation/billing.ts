/* eslint-disable @typescript-eslint/no-explicit-any --
 * The generated supabase/database.types.ts is stale (it is missing tables and
 * columns this code legitimately uses), so typing these Supabase calls against
 * it would produce false errors. `any` is the same choice utils/credits.ts and
 * utils/voice-helper.ts make for the same reason.
 */
/**
 * Credit gating for automated (unattended) generation, and the money primitives
 * the rest of the app should be using.
 *
 * WHY NOT `hasEnoughCredits()` FROM utils/credits.ts
 * That helper answers a different question: "may this user make a request right
 * now?" It returns false unless `subscription_status` is one of
 * active/trialing/pro/growth/enterprise, OR the account appears in a hardcoded
 * 8-email whitelist. In production only 17 of 92 owners have an active status
 * (39 inactive, 29 null, 7 suspended), so gating unattended generation on it
 * would silently stop the daily creative for almost every tenant — turning a
 * metering concern into a feature outage.
 *
 * Automation needs the narrower question: "is there balance to pay for this?"
 * That is what `canAffordAutomation` answers.
 *
 * ---------------------------------------------------------------------------
 * THE HOLD MODEL (added with 20261213000000_credit_holds_and_atomic_spend.sql)
 *
 * Payment only puts credits in the wallet. Work spends a RESERVED amount against
 * a SPECIFIC job:
 *
 *   const hold = await reserveCredits(admin, { userId, jobId, amount: 120 });
 *   if (!hold.ok) return paywall(hold.available);      // not funded, do no work
 *   await chargeHold(admin, { holdId: hold.holdId, credits: 50, ref: 'img-1' });
 *   await chargeHold(admin, { holdId: hold.holdId, credits: 50, ref: 'img-2' });
 *   await closeHold(admin, hold.holdId);               // remainder released
 *
 * A hold never moves money; `chargeHold` does, atomically, and can never charge
 * more than the reservation — so a runaway job stops instead of silently
 * overdrawing a wallet. `closeHold`/`releaseHold` make the unspent remainder
 * available again by taking the hold out of the open set.
 *
 * SAFETY RULE, unchanged: every failure path of the *read* helpers returns
 * permissive. An accounting read must never be the reason a customer's marketing
 * silently stops. If we cannot read the balance or the RPCs are not deployed, we
 * deliver and log — but we never invent a charge either (`charged: 0`).
 */

import { CREDIT_COSTS } from '@/utils/credits';

/** Resolve who actually pays: team members spend the owner's balance. */
export async function resolveBillingOwner(supabaseAdmin: any, userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, parent_id, agency_id')
      .eq('id', userId)
      .maybeSingle();

    if (!data) return userId;
    return data.parent_id || data.agency_id || data.id || userId;
  } catch {
    return userId;
  }
}

/** Raw wallet balance, holds ignored. `null` when it cannot be read. */
export async function creditBalance(supabaseAdmin: any, userId: string): Promise<number | null> {
  try {
    const ownerId = await resolveBillingOwner(supabaseAdmin, userId);
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('id', ownerId)
      .maybeSingle();
    if (!data) return null;
    return Number(data.credits ?? 0);
  } catch {
    return null;
  }
}

/**
 * True when the tenant can pay for this run. Defaults to true whenever the
 * balance cannot be determined.
 */
export async function canAffordAutomation(
  supabaseAdmin: any,
  userId: string,
  amount: number
): Promise<{ ok: boolean; balance: number | null }> {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: true, balance: null };
  const balance = await creditBalance(supabaseAdmin, userId);
  if (balance === null) return { ok: true, balance: null };
  return { ok: balance >= amount, balance };
}

// ---------------------------------------------------------------- primitives

/** Postgres raises 42883 for a missing function; PostgREST uses PGRST202. */
function isMissingFunction(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /could not find the function|does not exist|schema cache/i.test(message)
  );
}

function warnUnavailable(what: string, error: any) {
  console.warn(
    `[billing] ${what} unavailable (${error?.message || error}). ` +
      'Run supabase/migrations/20261213000000_credit_holds_and_atomic_spend.sql and ' +
      '20261213000100_atomic_credit_functions.sql. Continuing without a hold.'
  );
}

/**
 * Credits that are actually spendable: balance minus everything reserved by an
 * open, unexpired hold. `null` when unknown.
 */
export async function availableCredits(supabaseAdmin: any, userId: string): Promise<number | null> {
  try {
    const ownerId = await resolveBillingOwner(supabaseAdmin, userId);
    const { data, error } = await supabaseAdmin.rpc('available_credits', { p_user_id: ownerId });
    if (error) {
      if (isMissingFunction(error)) {
        // Degrade to the raw balance: no holds exist to subtract anyway.
        return creditBalance(supabaseAdmin, userId);
      }
      return creditBalance(supabaseAdmin, userId);
    }
    if (data === null || data === undefined) return null;
    return Number(data);
  } catch {
    return null;
  }
}

export interface ReserveOptions {
  userId: string;
  /** Stable id for the unit of work. Re-entry with the same id re-attaches. */
  jobId: string;
  amount: number;
  ttlMinutes?: number;
  reason?: string;
}

export interface ReserveResult {
  /** true when the job is funded (or when funding cannot be determined). */
  ok: boolean;
  holdId: string | null;
  available: number | null;
  /** 'funded' | 'insufficient' | 'degraded' | 'no_profile' */
  reason: 'funded' | 'insufficient' | 'degraded' | 'no_profile';
  requested: number;
}

/**
 * Reserve `amount` credits for `jobId`.
 *
 * `ok: false` is the paywall signal — do not start work. `holdId: null` with
 * `ok: true` means the reservation could not be recorded at all (migration not
 * applied); work proceeds unmetered rather than stopping a customer's business,
 * which is the same trade-off `canAffordAutomation` already makes.
 */
export async function reserveCredits(supabaseAdmin: any, opts: ReserveOptions): Promise<ReserveResult> {
  const requested = Math.max(0, Number(opts.amount) || 0);
  const base: ReserveResult = {
    ok: true,
    holdId: null,
    available: null,
    reason: 'funded',
    requested,
  };

  if (requested === 0) return base;

  try {
    const ownerId = await resolveBillingOwner(supabaseAdmin, opts.userId);
    const { data, error } = await supabaseAdmin.rpc('reserve_credits', {
      p_user_id: ownerId,
      p_job_id: opts.jobId,
      p_amount: requested,
      p_ttl_minutes: opts.ttlMinutes ?? 120,
      p_reason: opts.reason ?? null,
    });

    if (error) {
      if (isMissingFunction(error)) {
        warnUnavailable('reserve_credits', error);
        const balance = await creditBalance(supabaseAdmin, opts.userId);
        return { ...base, available: balance, reason: 'degraded', ok: true };
      }
      console.warn(`[billing] reserve_credits failed: ${error.message}`);
      const balance = await creditBalance(supabaseAdmin, opts.userId);
      return { ...base, available: balance, reason: 'degraded', ok: true };
    }

    if (!data) {
      // NULL from the function: the wallet cannot cover it. That is the paywall.
      const available = await availableCredits(supabaseAdmin, opts.userId);
      return {
        ok: false,
        holdId: null,
        available,
        reason: available === null ? 'no_profile' : 'insufficient',
        requested,
      };
    }

    return { ok: true, holdId: String(data), available: null, reason: 'funded', requested };
  } catch (e: any) {
    console.warn(`[billing] reserve_credits threw: ${e?.message || e}`);
    const balance = await creditBalance(supabaseAdmin, opts.userId);
    return { ...base, available: balance, reason: 'degraded', ok: true };
  }
}

export interface ChargeOptions {
  holdId: string | null;
  credits: number;
  category?: 'calling' | 'whatsapp' | 'ai_generation' | 'campaign_launch' | 'topup' | 'subscription';
  description?: string;
  /** Idempotency key for this step. A retry with the same ref charges nothing. */
  ref?: string;
}

export interface ChargeResult {
  ok: boolean;
  charged: number;
  balance: number | null;
  remaining: number | null;
  /** true when the request exceeded what the hold had left. */
  capped: boolean;
  duplicate?: boolean;
  error?: string;
}

/**
 * Charge one step of a job against its hold.
 *
 * Never charges more than the reservation, and never charges twice for the same
 * `ref`. A `capped` result means the job wants more than it was funded for: stop
 * and ask, do not keep going.
 */
export async function chargeHold(supabaseAdmin: any, opts: ChargeOptions): Promise<ChargeResult> {
  const requested = Math.max(0, Number(opts.credits) || 0);
  const empty: ChargeResult = { ok: true, charged: 0, balance: null, remaining: null, capped: false };

  if (!opts.holdId) return { ...empty, ok: true };
  if (requested === 0) return empty;

  try {
    const { data, error } = await supabaseAdmin.rpc('charge_hold', {
      p_hold_id: opts.holdId,
      p_amount: requested,
      p_category: opts.category || 'ai_generation',
      p_description: opts.description || null,
      p_ref: opts.ref || null,
    });

    if (error) {
      if (isMissingFunction(error)) warnUnavailable('charge_hold', error);
      else console.warn(`[billing] charge_hold failed: ${error.message}`);
      return { ...empty, ok: false, error: error.message };
    }

    const row: any = data || {};
    return {
      ok: row.ok !== false,
      charged: Number(row.charged ?? 0),
      balance: row.balance == null ? null : Number(row.balance),
      remaining: row.remaining == null ? null : Number(row.remaining),
      capped: Boolean(row.capped),
      duplicate: Boolean(row.duplicate),
      error: row.error,
    };
  } catch (e: any) {
    console.warn(`[billing] charge_hold threw: ${e?.message || e}`);
    return { ...empty, ok: false, error: String(e?.message || e) };
  }
}

export interface CloseResult {
  ok: boolean;
  state: 'settled' | 'released' | 'unknown';
  spent: number;
  released: number;
}

/** Finish a job: whatever the hold did not spend becomes available again. */
export async function closeHold(
  supabaseAdmin: any,
  holdId: string | null,
  reason?: string
): Promise<CloseResult> {
  if (!holdId) return { ok: true, state: 'unknown', spent: 0, released: 0 };
  try {
    const { data, error } = await supabaseAdmin.rpc('close_hold', {
      p_hold_id: holdId,
      p_reason: reason ?? null,
    });
    if (error) {
      if (!isMissingFunction(error)) console.warn(`[billing] close_hold failed: ${error.message}`);
      return { ok: false, state: 'unknown', spent: 0, released: 0 };
    }
    const row: any = data || {};
    return {
      ok: row.ok !== false,
      state: (row.state as CloseResult['state']) || 'unknown',
      spent: Number(row.spent ?? 0),
      released: Number(row.released ?? 0),
    };
  } catch (e: any) {
    console.warn(`[billing] close_hold threw: ${e?.message || e}`);
    return { ok: false, state: 'unknown', spent: 0, released: 0 };
  }
}

/** Abandon a job. Identical to `closeHold` except the reason says cancelled. */
export async function releaseHold(
  supabaseAdmin: any,
  holdId: string | null,
  reason = 'cancelled'
): Promise<CloseResult> {
  return closeHold(supabaseAdmin, holdId, reason);
}

/** Charge an amount step that has no hold (small, one-off, non-agent paths). */
export async function chargeHoldJob(
  supabaseAdmin: any,
  holdId: string | null,
  credits: number,
  description: string,
  ref?: string
): Promise<ChargeResult> {
  return chargeHold(supabaseAdmin, {
    holdId,
    credits,
    category: 'ai_generation',
    description,
    ref,
  });
}

/**
 * Atomically spend credits that are not reserved.
 *
 * Returns the new balance, or `null` when the wallet could not cover it. The
 * old read-then-write in `deductCredits` let two concurrent 60-credit jobs both
 * pass a 100-credit check; this cannot.
 */
export async function spendCreditsAtomic(
  supabaseAdmin: any,
  userId: string,
  amount: number
): Promise<number | null> {
  const requested = Number(amount) || 0;
  if (requested <= 0) return creditBalance(supabaseAdmin, userId);

  try {
    const ownerId = await resolveBillingOwner(supabaseAdmin, userId);
    const { data, error } = await supabaseAdmin.rpc('spend_credits', {
      p_user_id: ownerId,
      p_amount: requested,
    });
    if (!error) return data === null || data === undefined ? null : Number(data);

    if (!isMissingFunction(error)) {
      console.warn(`[billing] spend_credits failed: ${error.message}`);
      return null;
    }
    warnUnavailable('spend_credits', error);
    return compareAndSwapSpend(supabaseAdmin, ownerId, requested);
  } catch (e: any) {
    console.warn(`[billing] spend_credits threw: ${e?.message || e}`);
    return null;
  }
}

/**
 * Fallback for a database without the RPC: compare-and-swap on the balance.
 * `update ... where credits = <the value we read>` — if someone else moved it
 * first, nothing is updated and we retry with a fresh read.
 */
async function compareAndSwapSpend(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  attempts = 5
): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .maybeSingle();
    if (!profile) return null;

    const current = Number(profile.credits ?? 0);
    if (current < amount) return null;
    const next = current - amount;

    const { data: updated, error } = await supabaseAdmin
      .from('profiles')
      .update({ credits: next })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select('credits');

    if (!error && Array.isArray(updated) && updated.length > 0) return next;
  }
  console.warn(`[billing] compare-and-swap spend gave up after ${attempts} attempts`);
  return null;
}

/** Atomically add credits. Returns the new balance, or null on failure. */
export async function addCreditsAtomic(
  supabaseAdmin: any,
  userId: string,
  amount: number
): Promise<number | null> {
  const requested = Number(amount) || 0;
  if (requested <= 0) return creditBalance(supabaseAdmin, userId);

  try {
    const ownerId = await resolveBillingOwner(supabaseAdmin, userId);
    const { data, error } = await supabaseAdmin.rpc('add_credits_atomic', {
      p_user_id: ownerId,
      p_amount: requested,
    });
    if (!error) return data === null || data === undefined ? null : Number(data);

    if (!isMissingFunction(error)) {
      console.warn(`[billing] add_credits_atomic failed: ${error.message}`);
      return null;
    }
    warnUnavailable('add_credits_atomic', error);

    // Fallback: still better than a blind write if nothing else is holding it.
    const balance = await creditBalance(supabaseAdmin, ownerId);
    if (balance === null) return null;
    const next = balance + requested;
    const { error: writeErr } = await supabaseAdmin
      .from('profiles')
      .update({ credits: next })
      .eq('id', ownerId);
    return writeErr ? null : next;
  } catch (e: any) {
    console.warn(`[billing] add_credits_atomic threw: ${e?.message || e}`);
    return null;
  }
}

export interface GrantOptions {
  userId: string;
  amount: number;
  /**
   * Ledger category. `credit_transactions.category` is a plain varchar, so this
   * is intentionally wider than the six categories in utils/credits.ts: the
   * 7-day trial grant already writes 'trial'.
   */
  category: CreditCategory;
  description: string;
  /** Idempotency key, e.g. `razorpay:pay_ABC123`. Required. */
  ref: string;
}

export type CreditCategory =
  | 'calling'
  | 'whatsapp'
  | 'ai_generation'
  | 'campaign_launch'
  | 'topup'
  | 'subscription'
  | 'trial';

export interface GrantResult {
  /** true only for the caller that actually applied this ref. */
  granted: boolean;
  balance: number | null;
  /** true when the ref had already been applied — return success, do not credit. */
  duplicate: boolean;
  degraded?: boolean;
}

/**
 * Apply a payment exactly once.
 *
 * A native app retrying on a flaky network sends the same `razorpay_payment_id`
 * two or three times. Before this, every valid signature added credits again.
 * Now the unique index on `credit_transactions.ref` decides the single winner and
 * every other caller gets `duplicate: true`.
 */
export async function grantCreditsOnce(
  supabaseAdmin: any,
  opts: GrantOptions
): Promise<GrantResult> {
  const amount = Number(opts.amount) || 0;
  try {
    const ownerId = await resolveBillingOwner(supabaseAdmin, opts.userId);
    const { data, error } = await supabaseAdmin.rpc('grant_credits_once', {
      p_user_id: ownerId,
      p_amount: amount,
      p_category: opts.category,
      p_description: opts.description,
      p_ref: opts.ref,
    });

    if (error) {
      if (!isMissingFunction(error)) {
        console.warn(`[billing] grant_credits_once failed: ${error.message}`);
        return { granted: false, balance: null, duplicate: false };
      }
      warnUnavailable('grant_credits_once', error);
      return grantCreditsFallback(supabaseAdmin, ownerId, opts, amount);
    }

    if (data === null || data === undefined) {
      // NULL = this ref was already applied. Do not credit again.
      return { granted: false, balance: null, duplicate: true };
    }
    return { granted: true, balance: Number(data), duplicate: false };
  } catch (e: any) {
    console.warn(`[billing] grant_credits_once threw: ${e?.message || e}`);
    return { granted: false, balance: null, duplicate: false };
  }
}

/**
 * Without the RPC the best we can do is claim the ledger row first (it has the
 * unique index from the same migration) and only then add the balance. Weaker —
 * the two writes are not in one transaction — but still single-grant.
 */
async function grantCreditsFallback(
  supabaseAdmin: any,
  userId: string,
  opts: GrantOptions,
  amount: number
): Promise<GrantResult> {
  const { error: claimErr } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount,
    category: opts.category,
    description: opts.description,
    ref: opts.ref,
  });

  if (claimErr) {
    if (String(claimErr.code) === '23505') {
      return { granted: false, balance: null, duplicate: true };
    }
    console.warn(`[billing] fallback grant claim failed: ${claimErr.message}`);
    return { granted: false, balance: null, duplicate: false, degraded: true };
  }

  const balance = await addCreditsAtomic(supabaseAdmin, userId, amount);
  return { granted: true, balance, duplicate: false, degraded: true };
}

// ---------------------------------------------------------------- quotes

export interface QuoteLine {
  id: string;
  label: string;
  credits: number;
}

export interface Quote {
  jobId: string;
  lines: QuoteLine[];
  costInCredits: number;
  /** True when the total is large enough to be worth a human's yes. */
  needsApproval: boolean;
}

/** Above this many credits, quote to the owner before executing. */
export const QUOTE_APPROVAL_THRESHOLD = 200;

export const CREDIT_UNIT_COSTS = {
  image: CREDIT_COSTS.AI_IMAGE_GENERATION,
  /** Per 15 seconds of generated video. */
  videoPer15s: CREDIT_COSTS.AI_VIDEO_15SEC_CHUNK,
  callMinute: CREDIT_COSTS.VOICE_CALL_MINUTE,
  copy: CREDIT_COSTS.AI_COPY_GENERATION,
};

export interface QuoteStepInput {
  id: string;
  label?: string;
  kind: 'image' | 'video' | 'call' | 'copy';
  /** Images: count. Video: seconds. Call: minutes. Copy: count. */
  units: number;
}

/**
 * Price a job before doing any of it.
 *
 * Estimate low on purpose — the rule is that a job which would exceed its hold
 * pauses and asks, so an optimistic quote surfaces the overrun early rather than
 * silently spending the difference.
 */
export function quoteJob(jobId: string, steps: QuoteStepInput[]): Quote {
  const lines: QuoteLine[] = steps.map((step) => {
    const units = Math.max(0, Number(step.units) || 0);
    const credit =
      step.kind === 'image'
        ? CREDIT_UNIT_COSTS.image * units
        : step.kind === 'video'
          ? CREDIT_UNIT_COSTS.videoPer15s * Math.ceil(units / 15)
          : step.kind === 'call'
            ? CREDIT_UNIT_COSTS.callMinute * Math.ceil(units)
            : CREDIT_UNIT_COSTS.copy * units;

    return {
      id: step.id,
      label: step.label || step.id,
      credits: Math.round(credit * 100) / 100,
    };
  });

  const costInCredits = Math.round(lines.reduce((sum, l) => sum + l.credits, 0) * 100) / 100;
  return {
    jobId,
    lines,
    costInCredits,
    needsApproval: costInCredits > QUOTE_APPROVAL_THRESHOLD,
  };
}
