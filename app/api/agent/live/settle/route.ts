import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as admin } from '@supabase/supabase-js';
import { deductCreditsByCost } from '@/utils/credits';
import { liveVoiceRupeeCost } from '@/lib/agent/pricing';

export const maxDuration = 60;

/**
 * Bills one voice conversation.
 *
 * Called when the panel closes, and again on a heartbeat for long sessions so a closed
 * tab cannot buy a free hour. Charged from measured audio seconds, through the same
 * `deductCreditsByCost` path as every other cost in the app — so live voice carries
 * exactly the same 2x margin as images, video and text, and there is no second billing
 * system to audit.
 *
 * `conversationId` is the idempotency key: the panel reports cumulative totals, and a
 * repeat report of the same totals charges only the difference.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const conversationId = String(body.conversationId || '').slice(0, 80);
  const secondsIn = Math.max(0, Math.min(6 * 3600, Number(body.secondsIn) || 0));
  const secondsOut = Math.max(0, Math.min(6 * 3600, Number(body.secondsOut) || 0));
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
  }

  const adminClient = admin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // What has already been charged for this conversation, per the ledger we keep on the
  // event row. Cumulative reports then bill only the delta.
  const { data: prior } = await adminClient
    .from('agent_events')
    .select('id, payload')
    .eq('user_id', user.id)
    .eq('event_type', 'LIVE_VOICE_BILLING')
    .eq('status', 'in_progress')
    .contains('payload', { conversationId })
    .maybeSingle();

  const priorIn = Number(prior?.payload?.secondsIn || 0);
  const priorOut = Number(prior?.payload?.secondsOut || 0);
  const deltaIn = Math.max(0, secondsIn - priorIn);
  const deltaOut = Math.max(0, secondsOut - priorOut);

  const rupee = liveVoiceRupeeCost(deltaIn, deltaOut);
  if (rupee <= 0) {
    return NextResponse.json({ ok: true, charged: 0, credits: 0 });
  }

  const credits = Math.round(rupee * 2 * 100) / 100;
  const charged = await deductCreditsByCost(
    adminClient,
    user.id,
    rupee,
    'ai_generation',
    `Live voice conversation (${Math.round(deltaIn)}s in / ${Math.round(deltaOut)}s out)`
  );

  const payload = { conversationId, secondsIn, secondsOut, credits: (prior?.payload?.credits || 0) + credits };
  if (prior?.id) {
    await adminClient
      .from('agent_events')
      .update({ payload, updated_at: new Date().toISOString() })
      .eq('id', prior.id);
  } else {
    await adminClient.from('agent_events').insert({
      user_id: user.id,
      event_type: 'LIVE_VOICE_BILLING',
      status: 'in_progress',
      scheduled_for: new Date().toISOString(),
      payload,
    });
  }

  return NextResponse.json({
    ok: true,
    charged: charged ? credits : 0,
    credits: payload.credits,
    secondsIn,
    secondsOut,
  });
}
