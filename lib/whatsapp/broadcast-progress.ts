import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A campaign's real progress, and the four things a person must be able to do about it.
 *
 * THE FAILURE THIS FIXES
 * A Blue Square Infra broadcast created 16,317 recipients. 122 were delivered and then Meta answered
 * 131042 — "business eligibility payment issue" — for every remaining send. The worker paused the
 * campaign (correct) and then left 14,173 rows at `pending`, wrote the reason only into each failed
 * row's error text, and the screen counted a capped 1,000-row page and said "1,000 recipients, 122
 * sent". Nothing could be resumed, retried or cancelled from the product.
 *
 * So: counts come from exact head-counts (never a capped page), the reason for stopping is stored on
 * the campaign, and the four operator actions exist: resume, retry failures, cancel, and block the
 * ones that can never be sent.
 */

export const RECIPIENTS = 'whatsapp_broadcast_recipients';
export const BROADCASTS = 'whatsapp_broadcasts';

/** How many attempts a recipient gets before a recoverable failure becomes final. */
export const MAX_SEND_ATTEMPTS = 3;

/** Errors worth trying again: throttling, transient provider/BFF failures. */
const RETRYABLE_CODES = new Set([4, 2, 130429, 131056, 429, 500, 502, 503, 504]);

/**
 * Errors that mean STOP THE WHOLE CAMPAIGN: nothing else will get through either, and continuing
 * only burns through the recipient list marking rows failed for a reason the owner has to fix at
 * Meta. 131042 is the payment/eligibility refusal that started this.
 */
const FATAL_CODES = new Set([131042, 130497, 131031, 368, 190, 200, 10, 100, 102, 80007]);

export type RecipientStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'blocked';

export function isRetryableError(code: number | null | undefined, message: string | null | undefined): boolean {
  if (code != null && RETRYABLE_CODES.has(Number(code))) return true;
  const text = String(message ?? '');
  return /rate limit|temporarily|try again|timeout|timed out|unavailable|too many/i.test(text);
}

export function isFatalError(code: number | null | undefined, message: string | null | undefined): boolean {
  if (code != null && FATAL_CODES.has(Number(code))) return true;
  const text = String(message ?? '');
  return /131042|payment|eligibility|business account|permission|not authorized|access token|131047|re-engagement/i.test(text);
}

/**
 * A message a person can act on, from Meta's own words.
 *
 * The raw text ("Error 131042: Business eligibility payment issue") is technically correct and
 * practically useless: it does not say what to do, or that every remaining send will fail the same
 * way. These are the cases that actually happen.
 */
export function explainMetaError(code: number | string | null | undefined, message: string | null | undefined): string {
  const text = String(message ?? '');
  const n = code == null ? null : Number(code);

  if (n === 131042 || /131042|eligibility|payment/i.test(text)) {
    return (
      'Meta refused this message because the WhatsApp Business account has a payment or eligibility ' +
      'problem (error 131042). Every remaining send will fail the same way until that is fixed in ' +
      'Meta Business Manager → WhatsApp Manager → Account health / Payment settings.'
    );
  }
  if (n === 131047 || /131047|re-engagement/i.test(text)) {
    return 'Meta only allows an approved template outside the 24-hour window (error 131047).';
  }
  if (n === 131026) return 'That number cannot receive WhatsApp messages (131026).';
  if (n === 131049) {
    return (
      'Meta withheld this marketing template for this person: they have received too many marketing ' +
      'messages recently (131049). It is per-recipient, not a problem with the campaign.'
    );
  }
  if (n === 132000 || n === 132001) return 'The template does not exist in that language on this WABA (132000/132001).';
  if (n === 132005) return 'The template is missing a parameter value it needs (132005).';
  if (n === 130429 || n === 131056 || n === 429) {
    return 'Meta is rate-limiting this number (130429/131056). The rest will be retried automatically with backoff.';
  }
  if (n === 190 || n === 200 || n === 10 || n === 100 || n === 102) {
    return 'The WhatsApp access token is invalid or lacks permission (190/200). Reconnect WhatsApp in settings.';
  }
  return text || 'Meta refused the message without a reason.';
}

export interface BroadcastCounts {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  processing: number;
  blocked: number;
  /** Everything that will not be attempted again. */
  done: number;
  percentComplete: number;
}

async function countByStatus(supabase: SupabaseClient, broadcastId: string, status: RecipientStatus): Promise<number> {
  const { count } = await supabase
    .from(RECIPIENTS)
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId)
    .eq('status', status);
  return count ?? 0;
}

/**
 * Exact counts, in parallel.
 *
 * `count: 'exact', head: true` is the whole point: selecting the rows and counting them in JS caps at
 * the database's max-rows (1,000 here), which is exactly how a 16,317-recipient campaign reported
 * itself as 1,000.
 */
export async function exactCounts(supabase: SupabaseClient, broadcastId: string): Promise<BroadcastCounts> {
  const [sent, failed, pending, processing, blocked] = await Promise.all([
    countByStatus(supabase, broadcastId, 'sent'),
    countByStatus(supabase, broadcastId, 'failed'),
    countByStatus(supabase, broadcastId, 'pending'),
    countByStatus(supabase, broadcastId, 'processing'),
    countByStatus(supabase, broadcastId, 'blocked'),
  ]);
  const total = sent + failed + pending + processing + blocked;
  const done = sent + failed + blocked;
  return {
    total,
    sent,
    failed,
    pending,
    processing,
    blocked,
    done,
    percentComplete: total ? Math.round((done / total) * 100) : 0,
  };
}

/** Store the counters on the campaign so the list can render progress without five counts per row. */
export async function refreshBroadcastStats(supabase: SupabaseClient, broadcastId: string): Promise<BroadcastCounts> {
  const counts = await exactCounts(supabase, broadcastId);
  await supabase
    .from(BROADCASTS)
    .update({
      total_recipients: counts.total,
      sent_count: counts.sent,
      failed_count: counts.failed,
      pending_count: counts.pending + counts.processing,
      blocked_count: counts.blocked,
      last_progress_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);
  return counts;
}

export interface PauseInput {
  reason: string;
  /** Also stop trying the remaining rows: they cannot succeed until the reason is fixed. */
  blockRemaining?: boolean;
}

/** Stop a campaign, recording exactly why — this is what the UI shows the owner. */
export async function pauseBroadcast(
  supabase: SupabaseClient,
  broadcastId: string,
  input: PauseInput
): Promise<{ blocked: number }> {
  await supabase
    .from(BROADCASTS)
    .update({ status: 'paused', pause_reason: input.reason })
    .eq('id', broadcastId);

  let blocked = 0;
  if (input.blockRemaining !== false) {
    blocked = await blockPending(supabase, broadcastId, input.reason);
  }
  await refreshBroadcastStats(supabase, broadcastId);
  return { blocked };
}

/**
 * Mark the untouched rows `blocked` instead of leaving them `pending` for ever.
 *
 * A paused campaign with 14,000 pending rows looks like work still to do; blocked rows with the
 * reason attached are the truth: they will not be sent until the account problem is fixed.
 */
export async function blockPending(supabase: SupabaseClient, broadcastId: string, reason: string): Promise<number> {
  const { data } = await supabase
    .from(RECIPIENTS)
    .update({ status: 'blocked', error_message: reason, updated_at: new Date().toISOString() })
    .eq('broadcast_id', broadcastId)
    .in('status', ['pending', 'processing'])
    .select('id');
  return (data ?? []).length;
}

/**
 * Put a paused campaign back to work.
 *
 * Blocked rows go back to pending (the owner is asserting the problem is fixed); sent rows are left
 * alone, so a resume can never re-message somebody who already got it.
 */
export async function resumeBroadcast(
  supabase: SupabaseClient,
  broadcastId: string,
  opts: { includeBlocked?: boolean } = {}
): Promise<{ requeued: number }> {
  let requeued = 0;
  if (opts.includeBlocked !== false) {
    const { data } = await supabase
      .from(RECIPIENTS)
      .update({ status: 'pending', error_message: null, next_attempt_at: null, attempts: 0, updated_at: new Date().toISOString() })
      .eq('broadcast_id', broadcastId)
      .eq('status', 'blocked')
      .select('id');
    requeued = (data ?? []).length;
  }
  await supabase
    .from(BROADCASTS)
    .update({ status: 'processing', pause_reason: null })
    .eq('id', broadcastId);
  await refreshBroadcastStats(supabase, broadcastId);
  return { requeued };
}

/** Retry the rows that failed, giving each its attempts back. */
export async function retryFailed(supabase: SupabaseClient, broadcastId: string): Promise<{ requeued: number }> {
  const { data } = await supabase
    .from(RECIPIENTS)
    .update({ status: 'pending', error_message: null, error_code: null, next_attempt_at: null, attempts: 0, updated_at: new Date().toISOString() })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'failed')
    .select('id');
  const requeued = (data ?? []).length;
  if (requeued) {
    await supabase.from(BROADCASTS).update({ status: 'processing', pause_reason: null }).eq('id', broadcastId);
  }
  await refreshBroadcastStats(supabase, broadcastId);
  return { requeued };
}

/** Stop a campaign for good: anything not yet sent is blocked with the reason. */
export async function cancelBroadcast(supabase: SupabaseClient, broadcastId: string, reason = 'Cancelled by the owner'): Promise<{ blocked: number }> {
  const blocked = await blockPending(supabase, broadcastId, reason);
  await supabase
    .from(BROADCASTS)
    .update({ status: 'cancelled', pause_reason: reason })
    .eq('id', broadcastId);
  await refreshBroadcastStats(supabase, broadcastId);
  return { blocked };
}

/**
 * The campaign's final status, from its counts.
 *
 * "sent" must not be written when nothing was delivered — that is how a completely refused campaign
 * came to read as a successful one.
 */
export function finalStatusFor(counts: BroadcastCounts): 'sent' | 'partial' | 'failed' | 'processing' {
  if (counts.pending > 0 || counts.processing > 0) return 'processing';
  if (counts.total === 0) return 'sent';
  if (counts.sent === 0 && counts.failed > 0) return 'failed';
  if (counts.failed > 0 || counts.blocked > 0) return 'partial';
  return 'sent';
}
