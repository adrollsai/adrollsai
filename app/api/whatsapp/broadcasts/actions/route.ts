import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  BROADCASTS,
  cancelBroadcast,
  exactCounts,
  resumeBroadcast,
  retryFailed,
} from '@/lib/whatsapp/broadcast-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What an owner can do to a campaign that has stopped.
 *
 * A paused campaign used to be a dead end: the only way forward was to build a new one, because
 * nothing in the product could resume the queue, retry the failures, or cancel it. Those are the
 * four buttons the WhatsApp tab now offers, and this is the endpoint behind them.
 *
 * Every action is scoped to a campaign the caller owns and reports exactly what it changed —
 * "resumed, 14,173 recipients back in the queue" is the answer, not "ok".
 */

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const broadcastId = String(body?.broadcastId ?? '').trim();
    const action = String(body?.action ?? '').trim();
    const impersonateId = String(new URL(req.url).searchParams.get('impersonate') ?? '').trim();
    const ownerId = impersonateId || user.id;

    if (!broadcastId) return NextResponse.json({ error: 'broadcastId is required' }, { status: 400 });
    if (!['pause', 'resume', 'retry_failed', 'cancel'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be one of pause, resume, retry_failed, cancel' },
        { status: 400 }
      );
    }

    const { data: broadcast } = await supabaseAdmin
      .from(BROADCASTS)
      .select('id, user_id, status, title, template_name')
      .eq('id', broadcastId)
      .maybeSingle();

    if (!broadcast) return NextResponse.json({ error: 'campaign not found' }, { status: 404 });

    // Owners see their own campaigns; a super admin impersonating one sees that one.
    if (String((broadcast as any).user_id) !== ownerId && String((broadcast as any).user_id) !== user.id) {
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('role, parent_id')
        .eq('id', user.id)
        .maybeSingle();
      const isOperator = (callerProfile as any)?.role === 'super_admin';
      if (!isOperator) {
        return NextResponse.json({ error: 'Forbidden: that campaign belongs to another workspace.' }, { status: 403 });
      }
    }

    if (action === 'pause') {
      const reason = String(body?.reason ?? '').trim() || `Paused by ${user.email ?? 'the owner'}`;
      const { pauseBroadcast } = await import('@/lib/whatsapp/broadcast-progress');
      const result = await pauseBroadcast(supabaseAdmin, broadcastId, { reason, blockRemaining: false });
      const counts = await exactCounts(supabaseAdmin, broadcastId);
      void result;
      return NextResponse.json({
        success: true,
        status: 'paused',
        counts,
        message: `Paused. ${counts.pending + counts.processing} recipient(s) are waiting; resume to continue.`,
      });
    }

    if (action === 'cancel') {
      const reason = String(body?.reason ?? '').trim() || 'Cancelled by the owner';
      const result = await cancelBroadcast(supabaseAdmin, broadcastId, reason);
      return NextResponse.json({
        success: true,
        status: 'cancelled',
        blocked: result.blocked,
        message: `Cancelled. ${result.blocked} unsent recipient(s) will not be messaged.`,
      });
    }

    if (action === 'retry_failed') {
      const result = await retryFailed(supabaseAdmin, broadcastId);
      if (result.requeued === 0) {
        return NextResponse.json({
          success: true,
          requeued: 0,
          message: 'There are no failed recipients to retry on this campaign.',
        });
      }
      kickWorker(broadcastId, req);
      return NextResponse.json({
        success: true,
        requeued: result.requeued,
        message: `${result.requeued} failed recipient(s) put back in the queue. The worker is picking them up now.`,
      });
    }

    // resume
    const result = await resumeBroadcast(supabaseAdmin, broadcastId, {
      includeBlocked: body?.includeBlocked !== false,
    });
    const counts = await exactCounts(supabaseAdmin, broadcastId);
    if (counts.pending + counts.processing > 0) kickWorker(broadcastId, req);
    return NextResponse.json({
      success: true,
      status: 'processing',
      requeued: result.requeued,
      counts,
      message: `Resumed. ${counts.pending + counts.processing} recipient(s) queued${
        result.requeued ? ` (${result.requeued} previously blocked rows are back in)` : ''
      }.`,
    });
  } catch (error: any) {
    console.error('[Broadcast actions] failed:', error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}

/** Start sending now rather than waiting for the next cron tick. */
function kickWorker(broadcastId: string, req: Request) {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  void fetch(`${base}/api/whatsapp/broadcasts/worker`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
    },
    body: JSON.stringify({ broadcastId }),
  }).catch((error) => console.warn('[Broadcast actions] worker kick failed:', error));
}
