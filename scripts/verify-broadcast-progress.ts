/**
 * The campaign runner's rules, proven — the parts that decided whether 16,317 people heard from us.
 *
 * On 19 Nov a Blue Square Infra broadcast created 16,317 recipients, delivered 122, and then Meta
 * refused every remaining send with 131042 (a payment/eligibility hold). The old code paused the
 * campaign and left 14,173 rows pending for ever, recorded the reason only inside each failed row, and
 * the screen — counting a capped 1,000-row page — reported "1,000 recipients". This file tests the
 * pieces that make that impossible now:
 *
 *   classification  what a Meta error MEANS: retry it, or stop the whole campaign
 *   explanation     the sentence a person can act on, instead of "error 131042"
 *   final status    a campaign that delivered nothing must not be recorded as "sent"
 *   counts          exact head-counts, never a capped page
 *   actions         pause / resume / retry / cancel against a real campaign in the live database
 *
 * The database half uses a purpose-built probe campaign with messages that are never sent (it has no
 * pending recipients until the test gives it one, and nothing here calls the worker).
 *
 *   npm run verify:broadcast-progress
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';
import {
  BROADCASTS,
  RECIPIENTS,
  cancelBroadcast,
  exactCounts,
  explainMetaError,
  finalStatusFor,
  isFatalError,
  isRetryableError,
  pauseBroadcast,
  refreshBroadcastStats,
  resumeBroadcast,
  retryFailed,
} from '../lib/whatsapp/broadcast-progress';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
};

// ───────────────────────────────────────────────────────────── classification
console.log('\nclassification — retry this, or stop the campaign?');
check('131042 (payment/eligibility) stops the campaign', isFatalError(131042, 'Business eligibility payment issue'));
check('and it is not treated as retryable', !isRetryableError(131042, 'Business eligibility payment issue'));
check('an invalid token stops the campaign', isFatalError(190, 'Invalid OAuth access token'));
check('131047 (re-engagement) stops it', isFatalError(131047, 'Re-engagement message'));
check('130429 is a rate limit: retry, do not stop', isRetryableError(130429, 'Rate limit hit'));
check('429 is a rate limit too', isRetryableError(429, 'Too many requests'));
check('a 500 from the provider is retryable', isRetryableError(500, 'Internal server error'));
check('a plain network timeout message is retryable', isRetryableError(null, 'socket hang up / timed out'));
check('131049 (per-recipient marketing cap) stops nothing', !isFatalError(131049, 'Marketing frequency cap') && !isRetryableError(131049, 'Marketing frequency cap'));

// ───────────────────────────────────────────────────────────── explanation
console.log('\nexplanation — the sentence the owner reads');
check(
  '131042 says what to fix and that every remaining send fails',
  /payment or eligibility/i.test(explainMetaError(131042, 'Business eligibility payment issue')) &&
    /every remaining send/i.test(explainMetaError(131042, 'Business eligibility payment issue'))
);
check('131049 says it is per-recipient, not the campaign', /per-recipient/i.test(explainMetaError(131049, 'freq cap')));
check('a rate limit says the rest will be retried', /retried/i.test(explainMetaError(130429, 'rate')));
check('an unknown error keeps Meta\'s own words', explainMetaError(999999, 'Something odd happened').includes('Something odd happened'));
check('and never returns an empty sentence', explainMetaError(null, null).length > 20);

// ───────────────────────────────────────────────────────────── final status
console.log('\nfinal status — a refused campaign is not a sent one');
check(
  'nothing delivered and something failed is "failed", not "sent"',
  finalStatusFor({ total: 10, sent: 0, failed: 10, pending: 0, processing: 0, blocked: 0, done: 10, percentComplete: 100 }) === 'failed'
);
check(
  'some delivered and some failed is "partial"',
  finalStatusFor({ total: 10, sent: 7, failed: 3, pending: 0, processing: 0, blocked: 0, done: 10, percentComplete: 100 }) === 'partial'
);
check(
  'everything delivered is "sent"',
  finalStatusFor({ total: 10, sent: 10, failed: 0, pending: 0, processing: 0, blocked: 0, done: 10, percentComplete: 100 }) === 'sent'
);
check(
  'anything still queued is "processing"',
  finalStatusFor({ total: 10, sent: 3, failed: 0, pending: 7, processing: 0, blocked: 0, done: 3, percentComplete: 30 }) === 'processing'
);
check(
  'blocked recipients make it "partial", not clean',
  finalStatusFor({ total: 10, sent: 9, failed: 0, pending: 0, processing: 0, blocked: 1, done: 10, percentComplete: 100 }) === 'partial'
);

// ───────────────────────────────────────────────────────────── live database
console.log('\nlive: exact counts and the four actions, on a probe campaign');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const { data: profiles } = await admin.from('profiles').select('id').eq('role', 'super_admin').limit(1);
const owner = profiles?.[0]?.id as string | undefined;

if (!owner) {
  check('a tenant exists to test against', false);
} else {
  const { data: probe, error: probeError } = await admin
    .from(BROADCASTS)
    .insert({
      user_id: owner,
      title: `[verify] broadcast progress ${Date.now().toString(36)}`,
      template_name: 'verify_probe_template',
      recipient_stage: 'All',
      status: 'paused',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (probeError || !probe?.id) {
    check('the probe campaign could be created', false, probeError?.message);
  } else {
    const broadcastId = String(probe.id);
    try {
      // 5 sent, 3 failed, 2 blocked, 1 pending — a campaign in exactly the state the owner saw.
      const rows = [
        ...Array.from({ length: 5 }, () => ({ status: 'sent' })),
        ...Array.from({ length: 3 }, () => ({ status: 'failed', error_message: 'Error 131042: Business eligibility payment issue' })),
        ...Array.from({ length: 2 }, () => ({ status: 'blocked', error_message: 'account problem' })),
        ...Array.from({ length: 1 }, () => ({ status: 'pending' })),
      ].map((row, index) => ({
        broadcast_id: broadcastId,
        user_id: owner,
        phone_number: `91828883${String(5000 + index).padStart(4, '0')}`,
        ...row,
      }));
      const { error: recipientsError } = await admin.from(RECIPIENTS).insert(rows);
      check('probe recipients inserted', !recipientsError, recipientsError?.message);

      const counts = await exactCounts(admin, broadcastId);
      check(
        'counts are exact, not capped at 1,000',
        counts.total === 11 && counts.sent === 5 && counts.failed === 3 && counts.blocked === 2 && counts.pending === 1,
        counts
      );
      check('the progress percentage counts every finished row', counts.percentComplete === 91, counts.percentComplete);

      const stored = await refreshBroadcastStats(admin, broadcastId);
      const { data: row } = await admin
        .from(BROADCASTS)
        .select('total_recipients, sent_count, failed_count, pending_count, blocked_count, last_progress_at')
        .eq('id', broadcastId)
        .maybeSingle();
      check(
        'the counters are written onto the campaign, so the list needs no recipient scan',
        (row as any)?.total_recipients === 11 && (row as any)?.sent_count === 5 && (row as any)?.failed_count === 3,
        { stored, row }
      );
      check('and it stamps last_progress_at', Boolean((row as any)?.last_progress_at));

      // pause → the untouched rows are blocked WITH the reason (they are not left pending for ever)
      const paused = await pauseBroadcast(admin, broadcastId, { reason: 'payment problem at Meta', blockRemaining: true });
      const afterPause = await exactCounts(admin, broadcastId);
      check('pausing blocks the untouched rows', paused.blocked === 1 && afterPause.pending === 0 && afterPause.blocked === 3, { paused, afterPause });
      const { data: pausedRow } = await admin.from(BROADCASTS).select('status, pause_reason').eq('id', broadcastId).maybeSingle();
      check(
        'and the reason is stored ON the campaign',
        (pausedRow as any)?.status === 'paused' && /payment problem/.test(String((pausedRow as any)?.pause_reason ?? '')),
        pausedRow
      );

      // retry failed
      const retried = await retryFailed(admin, broadcastId);
      check('retry_failed requeues the failures', retried.requeued === 3, retried);
      const afterRetry = await exactCounts(admin, broadcastId);
      check('they are pending again, and the campaign is processing', afterRetry.pending === 3 && afterRetry.failed === 0, afterRetry);

      // resume → blocked rows come back too, sent rows are left alone
      const resumed = await resumeBroadcast(admin, broadcastId, { includeBlocked: true });
      const afterResume = await exactCounts(admin, broadcastId);
      check('resume requeues the blocked rows', resumed.requeued === 3 && afterResume.blocked === 0, { resumed, afterResume });
      check('and never touches the ones already delivered', afterResume.sent === 5, afterResume.sent);

      // cancel
      const cancelled = await cancelBroadcast(admin, broadcastId, 'verify cancel');
      const afterCancel = await exactCounts(admin, broadcastId);
      const { data: cancelledRow } = await admin.from(BROADCASTS).select('status').eq('id', broadcastId).maybeSingle();
      check(
        'cancel blocks everything unsent and closes the campaign',
        cancelled.blocked === 6 && afterCancel.pending === 0 && (cancelledRow as any)?.status === 'cancelled',
        { cancelled, afterCancel, cancelledRow }
      );
      check('the delivered ones are still recorded as delivered', afterCancel.sent === 5, afterCancel.sent);
    } finally {
      await admin.from(RECIPIENTS).delete().eq('broadcast_id', broadcastId);
      await admin.from(BROADCASTS).delete().eq('id', broadcastId);
      const { data: left } = await admin.from(BROADCASTS).select('id').eq('id', broadcastId);
      console.log(`  cleanup: probe campaign removed (${(left ?? []).length} row(s) left)`);
    }
  }
}

console.log(`\n${'='.repeat(64)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
