import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { decideDelivery, describeDelivery, dispatchDelivery, listDeliveries, type DeliveryStatus } from '@/lib/flows/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The approvals queue for flow steps.
 *
 * This is the endpoint that made flows able to reach anybody at all. The scheduler writes one row
 * per due step with status `pending_approval`; nothing sends those rows until a signed-in owner
 * says yes here. That is on purpose — a flow decides who to contact and what to say, a person
 * decides whether it goes out.
 *
 * GET  — what is waiting, oldest first, with a sentence per row a person can act on.
 * POST — approve (then send, immediately and honestly) or reject.
 *
 * Every answer says what actually happened. "Approved" and "sent" are deliberately different
 * states, because reporting one as the other is how a queue starts lying.
 */

const QUEUE_KEY = 'deliveries';

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const ALLOWED_STATUS: DeliveryStatus[] = [
  'pending_approval',
  'approved',
  'sending',
  'delivered',
  'blocked',
  'failed',
  'rejected',
  'expired',
];

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const requested = params.get('status');
    const status = requested && ALLOWED_STATUS.includes(requested as DeliveryStatus) ? [requested as DeliveryStatus] : undefined;
    const limit = Math.min(Number(params.get('limit') ?? 50) || 50, 200);

    // Service role, but scoped to the signed-in owner on every call: the queue is only ever read
    // for the account that is asking.
    const rows = await listDeliveries(admin(), user.id, { status: status ?? ['pending_approval'], limit });
    return NextResponse.json({
      ok: true,
      [QUEUE_KEY]: rows.map((d) => ({ ...d, summary: describeDelivery(d) })),
      count: rows.length,
      status: status ?? ['pending_approval'],
    });
  } catch (error: any) {
    console.error('[Flow deliveries] GET failed:', error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const deliveryId = String(body?.deliveryId ?? '').trim();
    const decision = String(body?.decision ?? '').trim();
    if (!deliveryId) return NextResponse.json({ error: 'deliveryId is required' }, { status: 400 });
    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
    }

    const db = admin();
    const decided = await decideDelivery(db, { userId: user.id, deliveryId, decision, decidedBy: user.id });
    if (!decided.ok) return NextResponse.json({ ok: false, error: decided.error }, { status: 400 });

    if (decision === 'reject') {
      return NextResponse.json({
        ok: true,
        status: 'rejected',
        message: 'Rejected. Nothing was sent.',
      });
    }

    // Approved — now actually send it, and report exactly what the provider said. A failure here
    // is not a failed approval: the row stays on record with its error so it can be retried or
    // fixed, and the answer says so instead of implying the customer was reached.
    const outcome = await dispatchDelivery(db, decided.delivery!);
    return NextResponse.json({
      ok: outcome.status === 'delivered',
      status: outcome.status,
      to: outcome.to,
      providerMessageId: outcome.providerMessageId,
      message:
        outcome.status === 'delivered'
          ? outcome.detail
          : outcome.status === 'blocked'
            ? `Approved, but not sent: ${outcome.detail}`
            : `Approved, but the send failed: ${outcome.detail}`,
    });
  } catch (error: any) {
    console.error('[Flow deliveries] POST failed:', error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
