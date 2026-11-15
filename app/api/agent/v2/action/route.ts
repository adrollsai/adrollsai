import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { approvalOutcome, rejectionOutcome } from '@/lib/agent/approval-outcome';

/**
 * A human decided on a staged action.
 *
 * This route NEVER performs the action and never says that it did. Approving marks the event
 * `approved`, which unlocks the review gate; the client then hands the staged instruction back
 * to the agent, which performs the work with its real tools. The gate matches those tool
 * arguments against the payload the owner was shown, so what runs is what was approved — and
 * the only honest thing this route can report is "approved, continuing".
 *
 * It used to answer "Successfully launched WhatsApp broadcast to 400 leads" without sending
 * anything. See lib/agent/approval-outcome.ts for why that mattered.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { actionId, decision } = await req.json();

    if (!actionId || !['approved', 'rejected'].includes(decision)) {
      return NextResponse.json({ error: 'Invalid actionId or decision' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, email')
      .eq('id', user.id)
      .single();

    const isSuperAdmin =
      profile?.role === 'super_admin' ||
      profile?.email === 'rchopra489@gmail.com' ||
      user.email === 'rchopra489@gmail.com';

    // Find the pending action event
    let query = supabase
      .from('agent_events')
      .select('*')
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('payload->>actionId', actionId);

    if (!isSuperAdmin) {
      query = query.eq('user_id', user.id);
    }

    const { data: event, error: findError } = await query.maybeSingle();

    if (findError || !event) {
      return NextResponse.json({ error: 'Action not found or already processed' }, { status: 404 });
    }

    if (decision === 'rejected') {
      await supabase
        .from('agent_events')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', event.id);

      const outcome = rejectionOutcome();
      return NextResponse.json({ success: true, status: outcome.status, message: outcome.message });
    }

    // Approved: unlock the gate and hand the staged instruction back to the conversation.
    // Deliberately identical for every action type — including ad spend and deletion, which
    // previously fell through to a fabricated "Custom action executed successfully."
    const actionType = String(event.payload?.actionType ?? 'custom');
    const outcome = approvalOutcome(actionType);

    await supabase
      .from('agent_events')
      .update({ status: outcome.status, updated_at: new Date().toISOString() })
      .eq('id', event.id);

    return NextResponse.json({
      success: true,
      status: outcome.status,
      result: {
        resumed: outcome.resumed,
        executed: outcome.executed,
        message: outcome.message,
      },
    });
  } catch (err: any) {
    console.error('[Action Approval API] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
