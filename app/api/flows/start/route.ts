import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { startFlowRun } from '@/lib/flows/start';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start one run of a flow for one lead.
 *
 * Any trigger site can call this — a webhook, a form submission, a cron — and so can the agent. It
 * writes the steps into the ledger with absolute times and returns immediately: nothing is sent
 * here, and the clock in /api/cron/flows decides what actually goes out, under the gates.
 *
 * Idempotent by construction: the ledger's unique key means calling it twice for the same flow and
 * lead queues the work once.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  const header = request.headers.get('x-cron-secret') ?? '';
  const internal = !!secret && (auth === `Bearer ${secret}` || header === secret);

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON with flowId and leadId' }, { status: 400 });
  }
  const flowId = String(body?.flowId ?? '').trim();
  const leadId = String(body?.leadId ?? '').trim();
  if (!flowId || !leadId) {
    return NextResponse.json({ error: 'flowId and leadId are required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Resolve the flow and its owner. An internal caller names the owner; anyone else must own it.
  let userId = String(body?.userId ?? '').trim();
  let query = supabase.from('automations').select('id, user_id, title, description, is_active').eq('id', flowId);
  if (userId) query = query.eq('user_id', userId);
  if (!internal) {
    const { data: authUser } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));
    if (!authUser?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = authUser.user.id;
    query = supabase.from('automations').select('id, user_id, title, description, is_active').eq('id', flowId).eq('user_id', userId);
  }

  const { data: flow, error } = await query.maybeSingle();
  if (error || !flow) return NextResponse.json({ error: 'flow not found' }, { status: 404 });
  if ((flow as any).is_active === false) {
    return NextResponse.json({ ok: false, queued: 0, blockers: ['the flow is paused; nothing was queued'] }, { status: 200 });
  }

  const result = await startFlowRun(supabase, {
    userId: String((flow as any).user_id),
    flowId: String((flow as any).id),
    leadId,
    description: (flow as any).description,
  });

  return NextResponse.json(
    { ...result, flowId, leadId, title: (flow as any).title },
    { status: result.ok ? 200 : 422 }
  );
}
