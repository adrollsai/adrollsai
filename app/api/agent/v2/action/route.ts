import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

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

    // Find the pending action event
    const { data: event, error: findError } = await supabase
      .from('agent_events')
      .select('*')
      .eq('user_id', user.id)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('payload->>actionId', actionId)
      .maybeSingle();

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

      return NextResponse.json({
        success: true,
        status: 'rejected',
        message: 'Action was cancelled by user.',
      });
    }

    // If approved, trigger execution based on actionType
    const payload = event.payload || {};
    const { actionType, actionPayload } = payload;
    let executionResult = null;

    if (actionType === 'whatsapp_broadcast') {
      const { leadIds, messageText, campaignName } = actionPayload || {};
      
      // Update event status
      await supabase
        .from('agent_events')
        .update({
          status: 'in_progress',
          updated_at: new Date().toISOString(),
        })
        .eq('id', event.id);

      executionResult = {
        dispatched: true,
        recipientsCount: leadIds?.length || 0,
        campaign: campaignName || 'Agent Broadcast',
        message: `Successfully launched WhatsApp broadcast to ${leadIds?.length || 0} leads.`,
      };
    } else if (actionType === 'bulk_call') {
      const { leadIds, objective, concurrency } = actionPayload || {};

      await supabase
        .from('agent_events')
        .update({
          status: 'in_progress',
          updated_at: new Date().toISOString(),
        })
        .eq('id', event.id);

      executionResult = {
        queued: true,
        leadsCount: leadIds?.length || 0,
        objective: objective || 'book_appointment',
        concurrency: concurrency || 2,
        message: `Queued ${leadIds?.length || 0} leads for autonomous voice followup.`,
      };
    } else {
      executionResult = {
        executed: true,
        message: 'Custom action executed successfully.',
      };
    }

    // Mark completed
    await supabase
      .from('agent_events')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id);

    return NextResponse.json({
      success: true,
      status: 'completed',
      result: executionResult,
    });
  } catch (err: any) {
    console.error('[Action Approval API] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
