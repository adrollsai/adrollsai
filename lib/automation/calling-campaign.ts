/* eslint-disable @typescript-eslint/no-explicit-any -- audience rows and campaign payloads are untyped. */
/**
 * A calling campaign the agent can actually start.
 *
 * THE HOLE THIS FILLS
 * The UI starts a calling campaign through `/api/voice/campaign/start`: it filters leads by the campaign's
 * `audience_filter`, de-duplicates by phone number, assigns the campaign to the leads and kicks the runner
 * (`dispatchNextCall`), which the cron continues every 5 minutes. The agent had NO path to any of that. It had
 * `launch_bulk_calling_campaign`, which returned an approval payload that nothing executed - a card whose approval
 * did nothing at all - and `nobogent_voice_dispatch_call`, which dials exactly one number.
 *
 * So "call my 400 Diwali leads with this script" was answered with a single call or a link to the dashboard.
 *
 * DESIGN
 *  - It reuses the audience layer the rest of the agent uses (`lib/audiences`), so a group the agent created is the
 *    same group a call campaign can ring. No second definition of "who is in this audience".
 *  - It reuses the runner the UI uses. The calling window (9am-7pm IST), the credit check, the concurrency limit and
 *    the `voice_campaign_id` link are enforced where they already were.
 *  - It is HARD CAPPED: `maxLeads` defaults to 25 and can never exceed 200 in one call. A campaign is N real phones
 *    ringing; an agent that can queue 16,000 of them in one step is a liability, and the rest can be queued with a
 *    second, equally approved step.
 *  - It can be created PAUSED, and there is a stop tool, because the first thing anyone needs after a mistake is to
 *    make it stop.
 */

import { fetchLeadsForAudience, findAudienceGroup } from '@/lib/audiences/groups';
import { leadMatchesFilters, normaliseFilters, normalisePhone, dateWindow, type AudienceLead, type AudienceFilters } from '@/lib/audiences/filters';
import { isIndianPhoneNumber } from '@/utils/phone-validation';

/** Default number of leads one approved step may queue. */
export const DEFAULT_MAX_LEADS_PER_CAMPAIGN = 25;
/** Absolute ceiling for a single approved step, whatever the caller asks for. */
export const HARD_MAX_LEADS_PER_CAMPAIGN = 200;

export interface CallingCampaignRequest {
  name: string;
  /** What the call is about, in the owner's words. Becomes the campaign script's core. */
  purpose: string;
  /** Who to call: a saved group, raw filters, or explicit lead ids. Exactly one. */
  audience: {
    groupName?: string;
    filters?: Record<string, unknown>;
    leadIds?: string[];
  };
  voiceName?: string;
  language?: string;
  /** Extra instruction for the script (tone, what to confirm, what to offer). */
  scriptNotes?: string;
  maxLeads?: number;
  /** Create the campaign but do not dial yet. */
  startPaused?: boolean;
  /** Provider-side concurrency for this campaign, 1-5. */
  concurrency?: number;
}

export interface CallingCampaignValidation {
  ok: boolean;
  missing?: string[];
  error?: string;
}

/**
 * Pure validation, so the refusals are testable and the agent is told EVERY missing piece at once.
 */
export function validateCallingCampaign(req: CallingCampaignRequest): CallingCampaignValidation {
  const missing: string[] = [];
  const r = req || ({} as CallingCampaignRequest);

  if (!String(r.name || '').trim()) missing.push('a campaign name');
  if (!String(r.purpose || '').trim()) missing.push('what the call is about (one sentence, in the owner\'s words)');

  const audience = r.audience || ({} as CallingCampaignRequest['audience']);
  const sources = [audience.groupName, audience.filters, audience.leadIds].filter(Boolean).length;
  if (sources === 0) missing.push('who to call: a saved audience group, filters, or explicit lead ids');
  if (sources > 1) {
    return {
      ok: false,
      error: 'Give exactly ONE audience selector (groupName, filters, or leadIds). Several at once is ambiguous about who gets rung.',
    };
  }

  if (r.maxLeads !== undefined) {
    const n = Number(r.maxLeads);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'maxLeads must be a whole number above zero' };
  }

  if (r.concurrency !== undefined) {
    const c = Number(r.concurrency);
    if (!Number.isInteger(c) || c < 1 || c > 5) return { ok: false, error: 'concurrency must be 1-5 simultaneous lines' };
  }

  if (missing.length) {
    return {
      ok: false,
      missing,
      error:
        `This calling campaign is missing ${missing.length} thing(s): ${missing.join('; ')}. ` +
        'Nothing was queued and nobody was called.',
    };
  }
  return { ok: true };
}

/** Deduplicate by the last 10 digits and drop numbers telephony cannot dial. Pure. */
export function selectDialableLeads(leads: AudienceLead[]): { leads: AudienceLead[]; skipped: number } {
  const seen = new Set<string>();
  const out: AudienceLead[] = [];
  let skipped = 0;

  for (const lead of leads || []) {
    const phone = String((lead as any)?.phone || '');
    if (!phone || !isIndianPhoneNumber(phone)) {
      skipped++;
      continue;
    }
    const key = normalisePhone(phone).replace(/\D/g, '').slice(-10);
    if (!key || key.length < 10 || /^0+$/.test(key) || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    out.push(lead);
  }
  return { leads: out, skipped };
}

/** The campaign script the bridge reads: purpose + notes, with the tenant's language and voice. */
export function buildCallingCampaignPrompt(req: CallingCampaignRequest, businessName: string, language: string): string {
  return [
    `--- OUTBOUND CALLING CAMPAIGN ---`,
    `BUSINESS: "${businessName}"`,
    `PURPOSE OF THIS CAMPAIGN: ${String(req.purpose || '').trim()}`,
    `STARTING LANGUAGE: ${language}`,
    req.scriptNotes ? `EXTRA INSTRUCTIONS FROM THE OWNER: ${String(req.scriptNotes).trim()}` : '',
    '',
    'RULES',
    '1. Open by saying who you are and which business you are calling from. Never claim to be a human.',
    '2. Stay on the campaign purpose. Do not invent prices, dates, approvals, fees, guarantees or availability.',
    '3. Keep every answer under 50 spoken words, and never read out a list.',
    '4. If the person asks to stop, says they are not interested, or asks for no more calls - acknowledge once, end the call, and treat it as an opt-out.',
    '5. If you reach voicemail, end the call without leaving a message.',
    '6. If they ask for a person, take the best number and time and say a colleague will call shortly.',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface CallingCampaignOutcome {
  ok: boolean;
  needsInput?: boolean;
  missing?: string[];
  error?: string;
  campaignId?: string | null;
  matched?: number;
  queued?: number;
  skipped?: number;
  capped?: boolean;
  maxLeads?: number;
  status?: string;
  message?: string;
}

/**
 * Create the campaign, attach the leads and (unless paused) start the runner.
 *
 * Deliberately NOT awaiting `dispatchNextCall`: the runner dials sequentially and can take minutes, and a tool call
 * that blocks on 25 phone calls would hit the turn budget. The cron continues the queue anyway, so returning while
 * the first calls are in flight is the same contract the UI has.
 */
export async function startCallingCampaign(
  db: any,
  userId: string,
  req: CallingCampaignRequest,
  opts: { language: string; voiceName: string }
): Promise<CallingCampaignOutcome> {
  const validation = validateCallingCampaign(req);
  if (!validation.ok) {
    return { ok: false, needsInput: true, missing: validation.missing, error: validation.error };
  }

  const { data: profile } = await db
    .from('profiles')
    .select('business_name, voice_twilio_number, business_info')
    .eq('id', userId)
    .maybeSingle();

  const bi = (() => {
    try {
      return typeof profile?.business_info === 'string' ? JSON.parse(profile.business_info) : profile?.business_info || {};
    } catch {
      return {};
    }
  })();

  // Telephony first: a campaign with no line behind it queues 400 leads and rings nobody.
  const hasNumber = !!(
    bi?.claimed_vobiz_number ||
    bi?.voice_vobiz_number ||
    (profile?.voice_twilio_number && String(profile.voice_twilio_number).startsWith('+91')) ||
    process.env.VOBIZ_TEST_NUMBER
  );
  if (!hasNumber) {
    return {
      ok: false,
      error:
        'This account has no outbound phone number assigned, so a campaign would queue leads and call nobody. ' +
        'Assign a number in Voice settings first. Nothing was queued.',
    };
  }

  // ---- who to call
  let candidates: AudienceLead[] = [];
  let filterNote = '';
  try {
    const audience = req.audience;
    if (audience.leadIds?.length) {
      const ids = audience.leadIds.slice(0, HARD_MAX_LEADS_PER_CAMPAIGN);
      const { data } = await db
        .from('leads')
        .select('id, name, phone, email, source, ad_name, form_name, csv_audience, pipeline_stage, property_id, custom_fields, created_at, whatsapp_enabled')
        .eq('user_id', userId)
        .in('id', ids);
      candidates = (data || []) as AudienceLead[];
      filterNote = `${ids.length} explicitly named lead(s)`;
    } else {
      let filters: AudienceFilters;
      if (audience.groupName) {
        const group = await findAudienceGroup(db, userId, { name: String(audience.groupName) });
        if (!group) {
          return {
            ok: false,
            error: `there is no saved audience group called "${audience.groupName}". Create it with create_audience_group, or pass filters instead.`,
          };
        }
        filters = group.filters;
        filterNote = `the saved group "${audience.groupName}"`;
      } else {
        filters = normaliseFilters(audience.filters);
        filterNote = 'the filters given';
      }
      const { leads, capped } = await fetchLeadsForAudience(db, userId);
      const window = dateWindow(filters);
      candidates = leads.filter((lead) => leadMatchesFilters(lead, filters, window));
      if (capped) filterNote += ' (lead scan hit its cap, so this is a floor rather than the whole account)';
    }
  } catch (e: any) {
    return { ok: false, error: `could not read the audience: ${e?.message || 'unknown error'}. Nothing was queued.` };
  }

  const { leads: dialable, skipped } = selectDialableLeads(candidates);
  if (!dialable.length) {
    return {
      ok: false,
      error: `no dialable Indian numbers matched ${filterNote}, so nothing was queued. ${skipped} lead(s) were unusable.`,
    };
  }

  const requested = Number(req.maxLeads ?? DEFAULT_MAX_LEADS_PER_CAMPAIGN);
  const maxLeads = Math.max(1, Math.min(Math.floor(requested), HARD_MAX_LEADS_PER_CAMPAIGN));
  const chosen = dialable.slice(0, maxLeads);
  const capped = dialable.length > chosen.length;

  // ---- the campaign row the runner reads
  const language = String(opts.language || 'hinglish');
  const prompt = buildCallingCampaignPrompt(req, String(profile?.business_name || 'the business'), language);
  const { data: campaign, error: campErr } = await db
    .from('voice_campaigns')
    .insert({
      user_id: userId,
      name: String(req.name).trim(),
      audience_filter: {
        voice_name: opts.voiceName,
        language,
        business_name: profile?.business_name || null,
        agent_started: true,
        ...(req.audience.filters || {}),
      },
      custom_prompt: prompt,
      status: req.startPaused ? 'paused' : 'running',
    })
    .select('id, status')
    .single();

  if (campErr || !campaign?.id) {
    return { ok: false, error: `could not create the campaign: ${campErr?.message || 'unknown error'}. Nothing was queued.` };
  }

  // ---- attach the leads, in batches
  const batchSize = 100;
  let attached = 0;
  for (let i = 0; i < chosen.length; i += batchSize) {
    const ids = chosen.slice(i, i + batchSize).map((l) => (l as any).id);
    const { error } = await db
      .from('leads')
      .update({ voice_campaign_id: campaign.id, voice_call_status: null, voice_call_retry_count: 0 })
      .in('id', ids);
    if (!error) attached += ids.length;
  }

  let started = false;
  if (!req.startPaused) {
    try {
      const { dispatchNextCall } = require('@/utils/voice-helper');
      dispatchNextCall(db, userId).catch((e: any) =>
        console.warn('[CALLING CAMPAIGN] runner warning:', e?.message || e)
      );
      started = true;
    } catch (e: any) {
      console.warn('[CALLING CAMPAIGN] could not start the runner:', e?.message || e);
    }
  }

  return {
    ok: true,
    campaignId: campaign.id,
    matched: dialable.length,
    queued: attached,
    skipped,
    capped,
    maxLeads,
    status: campaign.status,
    message:
      `${attached} lead(s) queued for "${req.name}" from ${filterNote}` +
      (capped ? ` - capped at ${maxLeads} of ${dialable.length} dialable leads; run it again for the next batch` : '') +
      (req.startPaused
        ? '. The campaign is PAUSED: nothing will dial until it is started.'
        : started
          ? '. The runner is dialling now, inside the 9am-7pm IST calling window, and the cron continues the queue.'
          : '. The leads are queued; the 5-minute caller cron will pick them up.'),
  };
}

export interface StopOutcome {
  ok: boolean;
  error?: string;
  campaignId?: string;
  cleared?: number;
  message?: string;
}

/** Stop a campaign: pause the row AND clear the queue, so the cron cannot pick the leads back up. */
export async function stopCallingCampaign(db: any, userId: string, campaignId: string): Promise<StopOutcome> {
  const { data: campaign, error } = await db
    .from('voice_campaigns')
    .select('id, name, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !campaign) return { ok: false, error: 'that campaign does not belong to this account, or does not exist' };

  await db.from('voice_campaigns').update({ status: 'paused' }).eq('id', campaignId);

  // Only the ones that have not been dialled yet: clearing a completed call's status would lose history.
  const { data: cleared } = await db
    .from('leads')
    .update({ voice_campaign_id: null })
    .eq('voice_campaign_id', campaignId)
    .is('voice_call_status', null)
    .select('id');

  return {
    ok: true,
    campaignId,
    cleared: (cleared || []).length,
    message: `"${campaign.name}" is paused and ${(cleared || []).length} un-dialled lead(s) were detached from it, so the cron cannot pick them up.`,
  };
}

export interface CampaignStatusOutcome {
  ok: boolean;
  error?: string;
  campaigns?: Array<Record<string, unknown>>;
}

/** Every campaign and how far through it the dialling is, from the counters the UI already shows. */
export async function listCallingCampaigns(db: any, userId: string, limit = 10): Promise<CampaignStatusOutcome> {
  const { data: campaigns, error } = await db
    .from('voice_campaigns')
    .select('id, name, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 10, 1), 25));

  if (error) return { ok: false, error: error.message };

  const out: Array<Record<string, unknown>> = [];
  for (const campaign of campaigns || []) {
    const tally: Record<string, number> = {};
    for (const status of ['calling', 'queued', 'completed', 'no_answer', 'failed', 'pending']) {
      const { count } = await db
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('voice_campaign_id', (campaign as any).id)
        .eq('voice_call_status', status);
      if (count) tally[status] = count;
    }
    out.push({
      id: (campaign as any).id,
      name: (campaign as any).name,
      status: (campaign as any).status,
      createdAt: (campaign as any).created_at,
      callStatus: tally,
    });
  }
  return { ok: true, campaigns: out };
}
