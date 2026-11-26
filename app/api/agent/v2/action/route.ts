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
/**
 * What happened to a staged action — asked again when the card is re-rendered.
 *
 * THE BUG THIS FIXES
 * Approving a card turns it green, but that was only ever component state inside the card. The decision is
 * recorded on the `agent_events` row, and the transcript is rebuilt from the harness log — which has no
 * idea about it. So leaving the tab and coming back re-rendered the card from the original artifact, still
 * carrying its buttons, as if nothing had ever been approved. An owner reading that concludes the approval
 * was lost, and presses it again.
 *
 * This answers the only question the card needs: is this action already decided?
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const actionId = new URL(req.url).searchParams.get('actionId') || '';
    if (!actionId) return NextResponse.json({ error: 'actionId is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('agent_events')
      .select('id, status, created_at')
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('payload->>actionId', actionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ found: false, status: null });

    // `pending` is the row's own state before anyone decides; anything else is a decision already made.
    const status = String(data.status || '').toLowerCase();
    return NextResponse.json({
      found: true,
      status,
      decided: status === 'approved' || status === 'rejected' ? status : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}

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
      /**
       * CANCEL MUST ACTUALLY LAND.
       *
       * This update ignored its own error, so an RLS refusal or a transient failure returned `success: true` while the
       * row stayed `pending` — the card said cancelled and the gate still held the step. The row's new state is now read
       * back and reported, and only a row that is genuinely decided counts as success.
       */
      const { error: rejectError } = await supabase
        .from('agent_events')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', event.id)
        .eq('status', 'pending');

      const { data: afterReject } = await supabase
        .from('agent_events')
        .select('status')
        .eq('id', event.id)
        .maybeSingle();

      const settledAs = String((afterReject as any)?.status || '').toLowerCase();
      if (rejectError || settledAs !== 'rejected') {
        return NextResponse.json(
          {
            error:
              rejectError?.message ||
              `The step is still '${settledAs || 'unknown'}' — it was not cancelled. Refresh the chat.`,
          },
          { status: 500 }
        );
      }

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
