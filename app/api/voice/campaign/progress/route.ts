import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What a voice campaign has actually done, and how to stop or restart it.
 *
 * The voice page listed campaigns and their `status`, which says "active" whether the campaign still
 * has 4,000 people to dial or finished last week. There was no count of who had been tried, no list of
 * who failed and why, no ETA, and no way to pause a campaign that was dialling into a bad script —
 * cancelling meant editing leads by hand.
 *
 * The counts are exact head-counts per `voice_call_status`, which is the field the caller writes and
 * the CRM shows, so this number and the CRM can never disagree.
 */

type Counts = Record<string, number>;

const STATUSES = ['not_called', 'pending_qualification', 'calling', 'completed', 'failed', 'dnp', 'skipped_international'];

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const campaignId = String(url.searchParams.get('campaignId') ?? '').trim();
    const impersonate = String(url.searchParams.get('impersonate') ?? '').trim();
    if (!campaignId) return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: campaign } = await admin
      .from('voice_campaigns')
      .select('id, user_id, name, status, created_at')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign) return NextResponse.json({ error: 'campaign not found' }, { status: 404 });
    if (impersonate && String((campaign as any).user_id) !== impersonate && String((campaign as any).user_id) !== user.id) {
      const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if ((callerProfile as any)?.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const counts: Counts = {};
    await Promise.all(
      STATUSES.map(async (status) => {
        const { count } = await admin
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('voice_campaign_id', campaignId)
          .eq('voice_call_status', status);
        counts[status] = count ?? 0;
      })
    );
    const { count: untagged } = await admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('voice_campaign_id', campaignId)
      .is('voice_call_status', null);
    counts.untagged = untagged ?? 0;

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const dialled = (counts.completed ?? 0) + (counts.failed ?? 0) + (counts.dnp ?? 0) + (counts.skipped_international ?? 0);
    const queued = (counts.not_called ?? 0) + (counts.untagged ?? 0) + (counts.pending_qualification ?? 0);
    const inFlight = counts.calling ?? 0;

    // Cadence: the caller ticks every 5 minutes and dials up to N per tenant per tick.
    const perTick = Number(String(process.env.VOICE_MAX_CALLS_PER_TENANT_PER_RUN ?? '25').replace(/[^\d]/g, '')) || 25;
    const ticksLeft = perTick > 0 ? Math.ceil(queued / perTick) : 0;
    const etaMinutes = ticksLeft * 5;

    // The last few failures, so "why did nobody get called?" has an answer on the screen.
    const { data: recentFailures } = await admin
      .from('leads')
      .select('id, name, phone, voice_call_status, updated_at')
      .eq('voice_campaign_id', campaignId)
      .eq('voice_call_status', 'failed')
      .order('updated_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      success: true,
      campaign,
      counts,
      total,
      dialled,
      queued,
      inFlight,
      percentComplete: total ? Math.round((dialled / total) * 100) : 0,
      etaMinutes: queued > 0 ? etaMinutes : null,
      perTick,
      recentFailures: recentFailures ?? [],
      note:
        inFlight > 0
          ? `${inFlight} call(s) in progress.`
          : queued > 0
            ? `About ${etaMinutes} minute(s) of dialling left at ${perTick} calls per run.`
            : 'Nothing left to dial in this campaign.',
    });
  } catch (error: any) {
    console.error('[voice campaign progress] failed:', error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}

/**
 * Pause, resume or cancel a voice campaign.
 *
 * Pause: stop dialling new leads (the queue is untouched, so nothing is lost).
 * Resume: put the campaign back to running so the caller picks the queue up again.
 * Cancel: stop for good and take the untouched leads out of the campaign, so they are not dialled by a
 * resumed rhythm later and can be re-used by a different campaign.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const campaignId = String(body?.campaignId ?? '').trim();
    const action = String(body?.action ?? '').trim();
    if (!campaignId) return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    if (!['pause', 'resume', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'action must be pause, resume or cancel' }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: campaign } = await admin
      .from('voice_campaigns')
      .select('id, user_id, name, status')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign) return NextResponse.json({ error: 'campaign not found' }, { status: 404 });
    if (String((campaign as any).user_id) !== user.id) {
      const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if ((callerProfile as any)?.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    if (action === 'pause') {
      await admin.from('voice_campaigns').update({ status: 'paused' }).eq('id', campaignId);
      return NextResponse.json({ success: true, status: 'paused', message: 'Paused. The queue is kept — resume to continue dialling.' });
    }

    if (action === 'resume') {
      await admin.from('voice_campaigns').update({ status: 'running' }).eq('id', campaignId);
      return NextResponse.json({ success: true, status: 'running', message: 'Resumed. The caller will pick the queue up on its next run.' });
    }

    // cancel
    const { data: released } = await admin
      .from('leads')
      .update({ voice_campaign_id: null, voice_call_status: null })
      .eq('voice_campaign_id', campaignId)
      .in('voice_call_status', ['not_called', 'pending_qualification'])
      .select('id');
    await admin.from('voice_campaigns').update({ status: 'completed' }).eq('id', campaignId);
    return NextResponse.json({
      success: true,
      status: 'completed',
      released: (released ?? []).length,
      message: `Cancelled. ${(released ?? []).length} undialled lead(s) were taken out of the campaign.`,
    });
  } catch (error: any) {
    console.error('[voice campaign actions] failed:', error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
