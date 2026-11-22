import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';

import {
  INBOUND_LANGUAGES,
  INBOUND_VOICES,
  checkReadiness,
  ensureInboundCampaign,
  loadReceptionist,
  saveReceptionist,
  sanitiseConfig,
} from '@/lib/inbound/receptionist';
import { resolveAppUrl } from '@/utils/app-url';

const admin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export const maxDuration = 120;

/** The numbers this account may point a forwarded phone at. */
async function didCandidates(userId: string, currentDid: string) {
  const { data: profile } = await admin
    .from('profiles')
    .select('business_info, voice_twilio_number')
    .eq('id', userId)
    .maybeSingle();

  const numbers = new Set<string>();
  const bi = (() => {
    try {
      return typeof profile?.business_info === 'string' ? JSON.parse(profile.business_info) : profile?.business_info || {};
    } catch {
      return {};
    }
  })();

  for (const candidate of [bi?.voice_vobiz_number, profile?.voice_twilio_number, process.env.INBOUND_TEST_DID, currentDid]) {
    if (candidate) numbers.add(String(candidate));
  }
  return Array.from(numbers).filter(Boolean);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const probe = url.searchParams.get('probe') === '1';

  const { config, profile, stored } = await loadReceptionist(admin, user.id);
  const readiness = await checkReadiness(admin, user.id, config, stored, { probeModel: probe });

  const { data: calls } = await admin
    .from('leads')
    .select('id, name, phone, source, voice_call_status, voice_call_summary, voice_recording_url, created_at')
    .eq('user_id', user.id)
    .ilike('source', 'Inbound%')
    .order('created_at', { ascending: false })
    .limit(12);

  return NextResponse.json({
    config,
    stored,
    businessName: profile?.business_name || null,
    industry: profile?.industry || null,
    readiness,
    recentCalls: calls || [],
    answerUrl: `${resolveAppUrl()}/api/voice/vobiz/xml`,
    choices: { voices: INBOUND_VOICES, languages: INBOUND_LANGUAGES },
    didCandidates: await didCandidates(user.id, config.did),
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || 'save');

  const { config: current, profile, stored } = await loadReceptionist(admin, user.id);

  // ---- 1. save the customisation and prepare the script the bridge will read
  if (action === 'save') {
    const checked = sanitiseConfig(body, current);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

    const next = checked.config;
    const campaign = await ensureInboundCampaign(admin, user.id, next, {
      businessName: profile?.business_name,
      industry: profile?.industry,
    });

    next.campaignId = campaign.campaignId;

    const saved = await saveReceptionist(admin, user.id, next);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });

    const readiness = await checkReadiness(admin, user.id, next, true, { probeModel: body?.probe === true });

    return NextResponse.json({
      ok: true,
      config: next,
      campaignId: campaign.campaignId,
      campaignError: campaign.error || null,
      readiness,
      message: campaign.error
        ? `Saved, but the receptionist script could not be prepared: ${campaign.error}`
        : 'Saved. The next forwarded call will use this greeting, voice and script.',
    });
  }

  // ---- 2. prove the answer webhook without dialling a phone
  //
  // This posts the exact body Vobiz posts to the answer URL when a forwarded call arrives, then
  // reports the XML that came back and whether it points at a media stream. It is the only part of
  // this flow that can be tested without a real phone: the carrier leg is the user's.
  if (action === 'simulate') {
    const did = current.did;
    const origin = new URL(req.url).origin;
    const caller = String(body?.caller || '+919999900001');

    const form = new URLSearchParams({
      From: caller,
      To: did,
      CallUUID: `sim-${Date.now().toString(36)}`,
      CallStatus: 'in-progress',
      Direction: 'inbound',
      Event: 'StartApp',
    });

    let xml = '';
    let status = 0;
    try {
      const res = await fetch(`${origin}/api/voice/vobiz/xml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      status = res.status;
      xml = await res.text();
    } catch (e: any) {
      return NextResponse.json({ error: `Could not reach the answer webhook: ${e?.message || e}` }, { status: 502 });
    }

    const hasStream = /<Stream\b/.test(xml);
    const hasHangup = /<Hangup/.test(xml);
    // The XML escapes `&` as `&amp;`, which is correct XML and useless for reading query params.
    const wsTarget = ((xml.match(/>\s*(wss?:\/\/[^<\s]+)\s*</) || [])[1] || '').replace(/&amp;/g, '&');
    const campaignId = (wsTarget.match(/[?&]campaignId=([^&]+)/) || [])[1] || '';
    const inboundFlag = /[?&]inbound=true/.test(wsTarget);
    const voiceParam = (wsTarget.match(/[?&]voiceName=([^&]+)/) || [])[1] || '';

    // Leave the CRM as we found it: the simulated caller is not a real lead.
    let cleanedUp = false;
    try {
      const { data: probeLead } = await admin
        .from('leads')
        .select('id')
        .eq('user_id', user.id)
        .eq('phone', caller)
        .ilike('source', 'Inbound%')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (probeLead?.id) {
        await admin.from('lead_history').delete().eq('lead_id', probeLead.id);
        await admin.from('leads').delete().eq('id', probeLead.id);
        cleanedUp = true;
      }
    } catch {
      /* best effort */
    }

    return NextResponse.json({
      ok: hasStream && !hasHangup,
      answerStatus: status,
      xml,
      routed: {
        hasStream,
        hasHangup,
        mediaStreamUrl: wsTarget,
        campaignId: decodeURIComponent(campaignId) || null,
        inboundFlag,
        voice: voiceParam ? decodeURIComponent(voiceParam) : null,
      },
      probeLeadCleanedUp: cleanedUp,
      message: hasStream
        ? 'The answer webhook returns a media stream for this DID: a forwarded call would reach the receptionist.'
        : 'The answer webhook did not return a stream. See the XML below and the readiness panel.',
    });
  }

  return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
}
