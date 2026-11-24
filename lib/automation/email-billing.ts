/**
 * Emails cost us money, so they cost the account double that. Same rule as everything else.
 *
 * THE HOLE THIS FILLS
 * `lib/agent/usage.ts` already prices model tokens, sandbox compute and media at our cost and charges
 * twice that through the credit ledger. Nothing charged for the emails we send, so the twice-daily
 * digest to every business — model work plus a real message on a real SMTP bill — was the one thing an
 * account could consume forever and never pay for. The owner's rule is not "charge for the expensive
 * things", it is "double whatever it costs us", so an email is billed on the same terms as a video.
 *
 * WHERE THE NUMBER COMES FROM
 * `EMAIL_SEND_COST_INR` is OUR cost for one message on the transactional provider. It is a single
 * constant on purpose: when the invoice changes, one line changes and every caller follows. It is
 * deliberately conservative (a little above Resend's paid tier) because under-charging compounds
 * silently across every account, which is exactly how this hole appeared in the first place.
 *
 * WHAT IT WILL NOT DO
 *   - it never charges for a send that failed, and never throws into the caller: a billing failure must
 *     not make a digest email go missing, it must be visible in the log;
 *   - it never charges a fraction to hide a rounding error — crediting is 2dp, and a single email is
 *     worth less than that, so the arithmetic is done per batch and rounded once;
 *   - it never touches the owner's own master account differently from a tenant: the rule is per
 *     account, not per customer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Our cost, in rupees, to deliver one transactional email.
 *
 * Resend's paid tier is roughly $0.0004/message; that is the number this tracks, rounded up. When the
 * provider or the plan changes, change this and every charge follows.
 */
export const EMAIL_SEND_COST_INR = 0.035;

/** The margin applied to every metered action, everywhere in this product. */
export const CREDIT_MARGIN = 2;

/**
 * Credits to charge for `count` emails. Pure, so the rule can be tested without a database.
 *
 * A single email rounds to less than one paisa, so this returns the exact value to 2dp rather than
 * pretending a message is free: at scale the ledger shows the real total instead of a column of zeroes.
 */
export function emailCredits(count = 1): number {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (!n) return 0;
  return Math.round(EMAIL_SEND_COST_INR * n * CREDIT_MARGIN * 100) / 100;
}

/** What we actually paid, before the margin — for the ledger's own description. */
export function emailCostInr(count = 1): number {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return Math.round(EMAIL_SEND_COST_INR * n * 100) / 100;
}

export interface EmailChargeResult {
  /** Credits the account was charged (0 when the send failed or nothing was owed). */
  credits: number;
  /** Our own cost for the same sends. */
  costInr: number;
  charged: boolean;
}

/**
 * Charge an account for emails that have ALREADY been sent.
 *
 * Called after the provider accepts the message, never before: an account must not pay for an email
 * that failed to leave. Never throws — a billing problem is logged and reported, not raised into a cron
 * that is in the middle of finishing a report.
 */
export async function chargeEmailSends(
  supabase: SupabaseClient,
  userId: string,
  opts: { count?: number; label: string }
): Promise<EmailChargeResult> {
  const count = Number(opts.count ?? 1) || 0;
  const credits = emailCredits(count);
  const costInr = emailCostInr(count);
  if (!userId || credits <= 0) return { credits: 0, costInr, charged: false };

  try {
    const { deductCreditsByCost } = await import('@/utils/credits');
    const ok = await deductCreditsByCost(
      supabase as any,
      userId,
      costInr,
      // Filed under the existing 'ai_generation' ledger type rather than widening the ledger's
      // transaction union for a fraction of a paisa per message: the description carries the truth
      // ("N email(s) at ₹X each, billed at 2×"), and adding a new type would ripple through every
      // report that groups by it.
      'ai_generation',
      `${opts.label} — ${count} email(s) at ₹${EMAIL_SEND_COST_INR} each, billed at ${CREDIT_MARGIN}×`.slice(0, 500)
    );
    return { credits: ok ? credits : 0, costInr, charged: Boolean(ok) };
  } catch (e: any) {
    console.warn(`[email-billing] charge failed for ${userId}: ${e?.message || e}`);
    return { credits: 0, costInr, charged: false };
  }
}
