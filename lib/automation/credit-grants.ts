/**
 * The ONE place a payment becomes credits.
 *
 * There were already two ways money arrived: Razorpay verification calls
 * `billing.grantCreditsOnce` directly, and the trial writes a `category: 'trial'`
 * row. Both are correct in themselves, but "correct in themselves" is how a wallet
 * ends up with two grants for one rupee: a native app on a flaky connection retries
 * a verification callback, a webhook and a client both land, and the customer is
 * paid twice. The unique index on `credit_transactions.ref` is the only thing
 * standing between that and a free month, so every caller has to name its event the
 * SAME way.
 *
 * That naming is what this module owns. `paymentRef`, `trialRef` and `topUpRef`
 * build the idempotency key from the event's own identity, and `grantTierOnce` is
 * the single entry point for a plan purchase. It delegates to
 * `billing.grantCreditsOnce`, so the atomic path and its degraded fallback are
 * unchanged — this is a naming and validation layer, not a second money path.
 *
 * THE RULE: a grant is identified by what happened, never by when it ran. No
 * `Date.now()` in a ref — a retry one second later must produce byte-identical
 * keys, or exactly-once is a story we tell ourselves.
 */

import { grantCreditsOnce, type GrantResult } from '@/lib/automation/billing';
import { PAISE_PER_RUPEE, tierById, topUpCredits, type CreditTier } from '@/lib/automation/credit-tiers';

export class CreditGrantError extends Error {
  readonly reason:
    | 'unknown_tier'
    | 'missing_payment'
    | 'amount_mismatch'
    | 'no_credits'
    | 'grant_failed';

  constructor(reason: CreditGrantError['reason'], message: string) {
    super(message);
    this.name = 'CreditGrantError';
    this.reason = reason;
    Object.setPrototypeOf(this, CreditGrantError.prototype);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Idempotency keys
// ────────────────────────────────────────────────────────────────────────────

/** Trim and collapse a payment id so whitespace cannot fork one payment into two keys. */
function normaliseId(value: string, what: string): string {
  const id = String(value ?? '').trim();
  if (!id) throw new CreditGrantError('missing_payment', `${what} is required: it is the idempotency key`);
  return id;
}

/**
 * A plan purchase: `razorpay:<payment_id>:<tier_id>`.
 *
 * The tier is in the key because a customer can upgrade inside one billing cycle,
 * and the upgrade is a second payment with its own id. Two different payments for
 * the same tier are two grants; the same payment retried is one.
 */
export function paymentRef(paymentId: string, tierId: string): string {
  return `razorpay:${normaliseId(paymentId, 'paymentId')}:${normaliseId(tierId, 'tierId')}`;
}

/** A one-off top-up: `razorpay:<payment_id>:topup`. */
export function topUpRef(paymentId: string): string {
  return `razorpay:${normaliseId(paymentId, 'paymentId')}:topup`;
}

/**
 * The trial grant: one per owner, forever.
 *
 * Keyed on the OWNER, not the signup event, so a second signup in the same
 * workspace cannot claim a second trial — and keyed without a date, so the same
 * owner retrying a year later still resolves to the same row.
 */
export function trialRef(ownerId: string): string {
  return `trial:${normaliseId(ownerId, 'ownerId')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// The grant
// ────────────────────────────────────────────────────────────────────────────

export interface GrantTierOptions {
  /** Who is being credited. A team member is resolved to the owner's wallet. */
  userId: string;
  /** Tier id from `CREDIT_TIERS`. */
  tierId: string;
  /** The provider's payment id. The idempotency key, so it is required. */
  paymentId: string;
  /**
   * What the customer was actually charged, in paise.
   *
   * When supplied, it must match the tier's price. A mismatch means the payment
   * and the plan disagree — an edited price, a coupon, or a wrong tier id — and
   * crediting silently would hand over a plan nobody paid for.
   */
  paidPaise?: number;
  /** Overrides the default description, for the ledger and the admin view. */
  description?: string;
}

export interface GrantOutcome {
  /** true only for the caller that actually moved the wallet. */
  granted: boolean;
  /** true when this event had already been applied. Render it as success. */
  duplicate: boolean;
  balance: number | null;
  /** true when the atomic RPC was missing and the weaker fallback ran. */
  degraded?: boolean;
  /** The idempotency key this grant claimed. Log it for support. */
  ref: string;
  /** Credits actually added. Zero on a duplicate. */
  credits: number;
  /** The plan purchased; null for a top-up or a trial, which are not plans. */
  tier: CreditTier | null;
}

function outcome(result: GrantResult, ref: string, credits: number, tier: CreditTier | null): GrantOutcome {
  return { ...result, ref, credits: result.granted ? credits : 0, tier };
}

/**
 * Credit a plan purchase, exactly once.
 *
 * Returns `duplicate: true` when this payment has already been applied. That is a
 * SUCCESS the caller should render as "your plan is active" — never as an error,
 * because the retry that produced it came from a customer who was watching.
 */
export async function grantTierOnce(
  supabaseAdmin: any,
  options: GrantTierOptions,
): Promise<GrantOutcome> {
  const tier = tierById(options.tierId);
  if (!tier) {
    throw new CreditGrantError(
      'unknown_tier',
      `"${options.tierId}" is not a plan in CREDIT_TIERS. Refusing to guess credits for an unknown plan.`,
    );
  }

  if (options.paidPaise !== undefined && options.paidPaise !== null) {
    const paid = Number(options.paidPaise);
    if (!Number.isFinite(paid) || paid !== tier.pricePaise) {
      throw new CreditGrantError(
        'amount_mismatch',
        `payment was for ${paid} paise but ${tier.id} costs ${tier.pricePaise} paise. ` +
          'Nothing was credited: reconcile the payment against the plan before granting.',
      );
    }
  }

  const ref = paymentRef(options.paymentId, tier.id);
  const result = await grantCreditsOnce(supabaseAdmin, {
    userId: options.userId,
    amount: tier.monthlyCredits,
    category: 'subscription',
    description:
      options.description ??
      `${tier.label} plan: ${tier.monthlyCredits} credits for ${tier.pricePaise / PAISE_PER_RUPEE} rupees`,
    ref,
  });

  if (!result.granted && !result.duplicate && !result.degraded) {
    throw new CreditGrantError(
      'grant_failed',
      `the wallet did not accept ${tier.monthlyCredits} credits for ${ref}; nothing was credited`,
    );
  }

  return outcome(result, ref, tier.monthlyCredits, tier);
}

export interface GrantTopUpOptions {
  userId: string;
  paymentId: string;
  /** What the customer paid, in paise. Converted at the recommended plan's rate. */
  paidPaise: number;
  description?: string;
}

/**
 * Credit a one-off top-up at the recommended plan's rate.
 *
 * Floored to whole credits: a ₹50 top-up at ₹2/credit is 25 credits, and a ₹51
 * top-up is still 25 — the odd rupee is not worth a fractional credit in a wallet
 * that can only pay for whole things.
 */
export async function grantTopUpOnce(
  supabaseAdmin: any,
  options: GrantTopUpOptions,
): Promise<GrantOutcome> {
  const credits = topUpCredits(options.paidPaise);
  if (credits <= 0) {
    throw new CreditGrantError(
      'no_credits',
      `${options.paidPaise} paise buys no whole credits at the current rate; nothing was credited`,
    );
  }

  const ref = topUpRef(options.paymentId);
  const result = await grantCreditsOnce(supabaseAdmin, {
    userId: options.userId,
    amount: credits,
    category: 'topup',
    description: options.description ?? `Top-up: ${credits} credits`,
    ref,
  });

  if (!result.granted && !result.duplicate && !result.degraded) {
    throw new CreditGrantError('grant_failed', `the wallet did not accept a ${credits}-credit top-up for ${ref}`);
  }

  return outcome(result, ref, credits, null);
}

/**
 * Credit the 7-day trial, exactly once per owner.
 *
 * `trialCredits` is a parameter rather than a constant because the trial size is a
 * business decision that has moved before; the IDEMPOTENCY, which is the part that
 * must not move, is `trialRef(ownerId)`.
 */
export async function grantTrialOnce(
  supabaseAdmin: any,
  options: { userId: string; ownerId: string; trialCredits: number },
): Promise<GrantOutcome> {
  const credits = Math.max(0, Math.floor(Number(options.trialCredits) || 0));
  if (credits <= 0) {
    throw new CreditGrantError('no_credits', 'the trial grant has no credits, so it was not applied');
  }

  const ref = trialRef(options.ownerId);
  const result = await grantCreditsOnce(supabaseAdmin, {
    userId: options.userId,
    amount: credits,
    category: 'trial',
    description: `${credits} trial credits`,
    ref,
  });

  if (!result.granted && !result.duplicate && !result.degraded) {
    throw new CreditGrantError('grant_failed', `the wallet did not accept the ${credits}-credit trial for ${ref}`);
  }

  return outcome(result, ref, credits, null);
}
