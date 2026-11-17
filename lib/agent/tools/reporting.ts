import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reporting the agent can actually trust.
 *
 * Why this exists: asked "how many calls today", the agent had no tool that
 * reads call logs — only one that PLACES calls — so it improvised, took minutes
 * and still got the number wrong. Guessing at analytics is worse than not
 * answering, so the counting lives here, in SQL, with the two things that are
 * easy to get wrong done properly:
 *
 *   1. TIMEZONE. "Today" means the customer's today. Counting a UTC day puts an
 *      Indian morning into the previous date, so every early call vanishes.
 *   2. ORGANISATION. A super-admin or agency owner means "my org", which spans
 *      sub-accounts. Counting only their own rows reports a fraction.
 */

/** Offset of a timezone at a given instant, in ms. */
function tzOffsetMs(tz: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const p: any = {};
    for (const part of dtf.formatToParts(at)) p[part.type] = part.value;
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - at.getTime();
  } catch {
    return 0; // unknown zone: fall back to UTC rather than throwing
  }
}

/** UTC instant of local midnight, `daysAgo` days back, in `tz`. */
function startOfDayInZone(tz: string, daysAgo = 0): Date {
  const now = new Date();
  const off = tzOffsetMs(tz, now);
  const local = new Date(now.getTime() + off);
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCDate(local.getUTCDate() - daysAgo);
  return new Date(local.getTime() - off);
}

function fmtDay(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const STATUS_LABELS: Record<string, string> = {
  CONNECTED: 'connected',
  connected: 'connected',
  completed: 'connected',
  NOT_CONNECTED: 'not connected',
  'not_connected': 'not connected',
  'no-answer': 'not connected',
  NO_ANSWER: 'not connected',
  MISSED: 'missed',
  missed: 'missed',
  busy: 'busy',
  BUSY: 'busy',
  failed: 'failed',
  FAILED: 'failed',
  cancelled: 'cancelled',
  initiated: 'in progress',
};

/**
 * Stages that mean a human actually engaged. Used for "how many positive
 * leads" — deliberately conservative: a lead that is merely NEW is not positive.
 */
const POSITIVE_STAGES = [
  'Contacted',
  'Requirement Taken',
  'Visit Planned',
  'Booked',
  'Site Visit Done',
  'Negotiation',
  'Closed',
  'Won',
  'Dealer',
];

export function createReportingTools(supabase: SupabaseClient, userId: string) {
  /** The org root plus every account that rolls up into it. */
  async function orgMemberIds(): Promise<{ root: string; ids: string[]; names: Record<string, string> }> {
    const { data: me } = await supabase
      .from('profiles')
      .select('id, parent_id, agency_id, business_name, role')
      .eq('id', userId)
      .maybeSingle();

    const root = me?.parent_id || me?.agency_id || me?.id || userId;

    // NOTE: scope stays "the organisation this user administers" — the same set the
    // Analytics page renders. An earlier attempt widened a super admin to every account on
    // the platform, which over-counted (198 vs the 38 their dashboard showed). The mismatch
    // was never the scope: it was that this tool read `call_logs` while Analytics reads
    // `lead_history`. Fix the source, not the scope.

    const { data: members } = await supabase
      .from('profiles')
      .select('id, business_name, role, parent_id, agency_id')
      .or(`id.eq.${root},parent_id.eq.${root},agency_id.eq.${root}`);

    const names: Record<string, string> = {};
    const ids: string[] = [];
    for (const m of members || []) {
      ids.push(m.id);
      names[m.id] = m.business_name || m.role || m.id.slice(0, 8);
    }
    if (!ids.includes(root)) ids.push(root);
    return { root, ids, names };
  }

  return {
    org_lead_report: tool({
      description:
        'Lead funnel for the whole organisation over a period: totals, how many are positive (engaged past "New"), the stage breakdown, how many were actually reached by phone, and which campaigns they came from. Use this for "how many positive leads", "how is the funnel", "which campaign brings leads".',
      inputSchema: z.object({
        period: z
          .enum(['today', 'yesterday', 'last_7_days', 'last_30_days', 'all_time'])
          .default('last_30_days')
          .describe('Which window of lead ARRIVAL to count'),
        campaignContains: z.string().optional().describe('Only leads whose ad/campaign name contains this text'),
      }),
      execute: async ({ period, campaignContains }) => {
        const tz = 'Asia/Kolkata';
        const { ids, names } = await orgMemberIds();

        const now = new Date();
        let since: Date | null = null;
        if (period === 'today') since = startOfDayInZone(tz, 0);
        else if (period === 'yesterday') since = startOfDayInZone(tz, 1);
        else if (period === 'last_7_days') since = startOfDayInZone(tz, 6);
        else if (period === 'last_30_days') since = startOfDayInZone(tz, 29);

        try {
          let q = supabase
            .from('leads')
            .select('id, name, pipeline_stage, voice_call_status, last_call_status, ad_name, form_name, source, created_at, last_call_at, voice_call_summary, calling_enabled')
            .in('user_id', ids)
            .limit(5000);
          if (since) q = q.gte('created_at', since.toISOString());
          if (campaignContains) q = q.or(`ad_name.ilike.%${campaignContains}%,form_name.ilike.%${campaignContains}%`);

          const { data, error } = await q;
          if (error) throw new Error(error.message);
          const leads = data || [];

          const stages: Record<string, number> = {};
          let positive = 0;
          let reachedByPhone = 0;
          const campaigns: Record<string, number> = {};
          let awaitingFirstCall = 0;

          for (const l of leads) {
            const stage = l.pipeline_stage || 'New';
            stages[stage] = (stages[stage] || 0) + 1;
            if (POSITIVE_STAGES.includes(stage)) positive += 1;
            // voice_call_status is the field that actually carries state:
            // not_called / completed / no_answer / failed / qualified_via_whatsapp.
            // `last_call_status` is effectively always null, so it is not used.
            if (['completed', 'qualified_via_whatsapp'].includes(String(l.voice_call_status || '').toLowerCase())) {
              reachedByPhone += 1;
            }
            if (!l.last_call_at && l.calling_enabled !== false) awaitingFirstCall += 1;
            const c = l.ad_name || l.form_name || l.source || 'unattributed';
            campaigns[c] = (campaigns[c] || 0) + 1;
          }

          const topCampaigns = Object.entries(campaigns)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([campaign, count]) => ({ campaign, leads: count }));

          const periodLabel =
            period === 'today' ? `today, ${fmtDay(now, tz)}` :
            period === 'yesterday' ? 'yesterday' :
            period === 'last_7_days' ? 'in the last 7 days' :
            period === 'last_30_days' ? 'in the last 30 days' : 'all time';

          const answer =
            leads.length === 0
              ? `No leads arrived ${periodLabel}${campaignContains ? ` for campaigns matching "${campaignContains}"` : ''}.`
              : `${leads.length} lead${leads.length === 1 ? '' : 's'} arrived ${periodLabel}` +
                ` — ${positive} positive (${Math.round((positive / leads.length) * 100)}%), ` +
                `${reachedByPhone} reached by phone${awaitingFirstCall > 0 ? `, ${awaitingFirstCall} never called yet` : ''}.`;

          return {
            success: true,
            answer,
            period: periodLabel,
            totalLeads: leads.length,
            positiveLeads: positive,
            positiveRate: leads.length ? Math.round((positive / leads.length) * 100) : 0,
            reachedByPhone,
            awaitingFirstCall,
            byStage: stages,
            topCampaigns,
            accountsInScope: ids.length,
            positiveDefinition: `stages: ${POSITIVE_STAGES.join(', ')}`,
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not report on leads' };
        }
      },
    }),

    lead_conversations: tool({
      description:
        'What the AI caller actually said on the phone. Returns the call summary (and transcript when available) plus the agent\'s last thought for specific leads, or the most recent leads that have call summaries. Use this for "what did the AI talk about", "summarise the calls", "what did lead X say".',
      inputSchema: z.object({
        leadId: z.string().optional().describe('A specific lead id'),
        leadNameContains: z.string().optional().describe('Find leads whose name contains this text'),
        onlyWithSummary: z.boolean().default(true).describe('Only leads that have a call summary'),
        limit: z.number().default(5).describe('How many leads to return (1-15)'),
      }),
      // Defaults are applied here, not just in the schema: zod defaults only run
      // when the model's args are parsed, so a direct call would otherwise skip
      // the summary filter entirely.
      execute: async ({ leadId, leadNameContains, onlyWithSummary = true, limit = 5 }) => {
        const { ids } = await orgMemberIds();
        const take = Math.min(Math.max(limit || 5, 1), 15);
        try {
          // A `not null` filter is not enough here: many rows hold an EMPTY
          // STRING rather than NULL, so they pass the filter and then get
          // dropped in JS, returning fewer results than asked for. Fetch a wider
          // window and filter honestly against real text.
          const wantSummary = onlyWithSummary && !leadId && !leadNameContains;
          // Scan a wide window: summaries sit on a minority of leads, so a
          // small recent slice would report 'none found' while 25 exist.
          const fetchLimit = wantSummary ? 500 : take;

          let q = supabase
            .from('leads')
            .select('id, name, phone, pipeline_stage, voice_call_status, last_call_at, updated_at, voice_call_summary, voice_call_transcript, summary, notes, last_agent_thought, ad_name')
            .in('user_id', ids)
            .order('updated_at', { ascending: false })
            .limit(fetchLimit);

          if (leadId) q = q.eq('id', leadId);
          if (leadNameContains) q = q.ilike('name', `%${leadNameContains}%`);

          const { data, error } = await q;
          if (error) throw new Error(error.message);

          let source = data || [];
          if (wantSummary) {
            source = source.filter((l) => {
              const s = l.voice_call_summary;
              return typeof s === 'string' && s.trim().length > 0;
            });
          }
          const selected = source.slice(0, take);

          const rows = selected.map((l) => ({
            leadId: l.id,
            name: l.name,
            phone: l.phone,
            stage: l.pipeline_stage,
            lastCallAt: l.last_call_at,
            lastCallStatus: l.voice_call_status,
            callSummary: l.voice_call_summary || null,
            transcriptExcerpt: l.voice_call_transcript
              ? String(l.voice_call_transcript).slice(0, 1200)
              : null,
            notes: l.notes ? String(l.notes).slice(0, 400) : null,
            agentThought: l.last_agent_thought ? String(l.last_agent_thought).slice(0, 300) : null,
            campaign: l.ad_name || null,
          }));

          const withSummary = rows.filter((r) => r.callSummary);
          const answer =
            rows.length === 0
              ? 'No leads with call summaries found for this organisation.'
              : withSummary.length === 0
                ? `Found ${rows.length} lead(s) but none have a call summary recorded yet.`
                : `Here ${withSummary.length === 1 ? 'is' : 'are'} ${withSummary.length} lead call summar${withSummary.length === 1 ? 'y' : 'ies'}` +
                  ` (most recent first): ` +
                  withSummary
                    .slice(0, 3)
                    .map((r) => `${r.name} — ${String(r.callSummary).slice(0, 140)}`)
                    .join(' | ');

          return { success: true, answer, count: rows.length, leads: rows };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not read lead conversations' };
        }
      },
    }),

    /** The CEO's own report, for any period the owner asks about. */
    ceo_report: tool({
      description:
        'The daily CEO report, for any period the owner names: yesterday, today, the last 7 or 30 days, or all time. ' +
        'For a single day it returns ranked findings - each with the claim, what it means, a recommendation and the ' +
        'numbers it came from - ordered by what costs the owner most if ignored. For a longer period it sums the stored ' +
        'daily rollups into totals plus a day-by-day trend, so a direction is visible rather than a single day. ' +
        'Use this for "how did yesterday go", "how was last week", "what has the agent done this month", "is it getting ' +
        'better". It reports and recommends; it never acts, and anything that would spend money or message a customer is ' +
        'flagged for approval.',
      inputSchema: z.object({
        period: z
          .enum(['today', 'yesterday', 'last_7_days', 'last_30_days', 'all_time'])
          .default('yesterday')
          .describe('Which window to report on'),
        timezone: z.string().optional().describe('IANA timezone. Defaults to Asia/Kolkata.'),
      }),
      execute: async ({ period, timezone }) => {
        const tz = timezone || 'Asia/Kolkata';
        try {
          const { windowFor, gatherDayMetrics, supabaseMetricsReader } = await import('@/lib/agent/ceo-metrics');
          const { analyseDay, renderReport } = await import('@/lib/agent/ceo-findings');

          if (period === 'today' || period === 'yesterday') {
            const when = period === 'today' ? new Date() : new Date(Date.now() - 86_400_000);
            const window = windowFor(when, tz);
            const { metrics, missing } = await gatherDayMetrics(supabaseMetricsReader(supabase, userId), window);
            const findings = analyseDay(metrics, { quiet: false });
            return {
              success: true,
              period,
              report: renderReport(metrics, findings),
              findings: findings.slice(0, 8).map((f: any) => ({
                severity: f.severity,
                claim: f.claim ?? f.headline,
                means: f.meaning,
                recommendation: f.recommendation,
                evidence: f.evidence,
                needsReview: Boolean(f.needsReview),
              })),
              // Null means "we could not source it". Never zero.
              missing,
              note: missing.length
                ? `Some figures could not be sourced (${missing.join(', ')}), so the report says nothing about them rather than reporting a false zero.`
                : 'Every figure in this report comes from a column that exists.',
            };
          }

          // Longer periods come from the bounded daily rollups: 365 rows a year per tenant, whatever the activity.
          const days = period === 'last_7_days' ? 7 : period === 'last_30_days' ? 30 : 3650;
          const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
          const { data: rollups, error } = await supabase
            .from('ceo_daily_rollups')
            .select('day, payload')
            .eq('user_id', userId)
            .gte('day', since)
            .order('day', { ascending: true });
          if (error) return { success: false, error: error.message };

          const rows = (rollups ?? []).map((r: any) => ({ day: r.day, ...(r.payload ?? {}) }));
          const sum = (key: string) => rows.reduce((total: number, row: any) => total + (Number(row[key]) || 0), 0);
          const series = rows.map((row: any) => ({
            day: row.day,
            events: row.agentEvents ?? 0,
            routines: row.routineRuns ?? 0,
            failed: row.failedRuns ?? 0,
            artefacts: row.artifacts ?? 0,
            credits: row.creditsSpent ?? 0,
          }));
          const first = series.slice(0, Math.max(1, Math.floor(series.length / 2)));
          const second = series.slice(Math.max(1, Math.floor(series.length / 2)));
          const avg = (list: any[], key: string) => (list.length ? list.reduce((t, r) => t + (Number(r[key]) || 0), 0) / list.length : 0);
          const trend = series.length >= 4
            ? {
                artefacts: { firstHalfAvg: Number(avg(first, 'artefacts').toFixed(1)), secondHalfAvg: Number(avg(second, 'artefacts').toFixed(1)) },
                failed: { firstHalfAvg: Number(avg(first, 'failed').toFixed(1)), secondHalfAvg: Number(avg(second, 'failed').toFixed(1)) },
                direction: avg(second, 'artefacts') > avg(first, 'artefacts') ? 'more output' : avg(second, 'artefacts') < avg(first, 'artefacts') ? 'less output' : 'flat',
              }
            : null;

          return {
            success: true,
            period,
            days_covered: series.length,
            totals: {
              agent_events: sum('agentEvents'),
              routine_runs: sum('routineRuns'),
              failed_runs: sum('failedRuns'),
              artefacts: sum('artifacts'),
              credits_spent: sum('creditsSpent'),
            },
            trend,
            series,
            note: series.length
              ? 'Totals come from the stored daily rollups, so they are bounded and cheap to read at any range.'
              : 'No rollups stored yet for this range, so there is no history to report. A single day still reports in full.',
          };
        } catch (err: any) {
          return { success: false, error: String(err?.message || err) };
        }
      },
    }),

    /** What is queued to be called right now, and how many lines are free to call them. */
    call_queue_status: tool({
      description:
        'What the calling queue looks like RIGHT NOW: how many leads are waiting to be called, how many of those ' +
        'arrived in the last day, how many have never been contacted, how many are retries, and what capacity the ' +
        'Vobiz channels give. Also says why the other leads are NOT in the queue (already said yes or no, no phone, ' +
        'called the maximum number of times, asked not to be called). Use this for "what is the state of calling", ' +
        '"who is next", "how many are queued", "are we using all our lines". The first few leads name the reason ' +
        'they are queued, so you can explain the order rather than just the count.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(4000).default(400).describe('How many leads to examine, newest first'),
        freshHours: z.number().min(1).max(168).default(24).describe('What counts as "just arrived", in hours'),
      }),
      execute: async ({ limit, freshHours }) => {
        try {
          const { prioritiseCallQueue, summariseQueue, toQueueRow, formatAge } = await import('@/lib/automation/call-queue');
          const { loadVoiceChannels, channelCapacity, describeCapacity, pickChannel } = await import('@/lib/automation/voice-channels');

          const { data: profile } = await supabase
            .from('profiles')
            .select('business_info, voice_concurrency_limit, voice_vobiz_number, contact_number')
            .eq('id', userId)
            .maybeSingle();
          const { data: policy } = await supabase
            .from('tenant_automations')
            .select('master_enabled, ai_calling, call_max_attempts, call_max_age_days, call_fresh_stages, call_window_start, call_window_end')
            .eq('user_id', userId)
            .maybeSingle();

          const { data: leads } = await supabase
            .from('leads')
            .select('id, user_id, phone, name, created_at, voice_call_retry_count, voice_call_status, pipeline_stage, last_call_at, custom_fields, booked_time, processing_lock_until')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

          const decisions = prioritiseCallQueue((leads ?? []).map(toQueueRow), {
            now: new Date(),
            freshHours,
            maxAttempts: Number(policy?.call_max_attempts) || 3,
            maxAgeDays: Number(policy?.call_max_age_days) || 365,
          });
          const summary = summariseQueue(decisions);

          const channels = loadVoiceChannels({
            profileNumber: profile?.voice_vobiz_number,
            businessInfo: profile?.business_info,
            concurrencyLimit: profile?.voice_concurrency_limit,
          });
          const capacity = channelCapacity(channels.channels);

          // How many are on the phone right now decides how many lines are actually free.
          const calling = (leads ?? []).filter((l: any) => String(l.voice_call_status ?? '').toLowerCase() === 'calling').length;

          const skippedSentences: Record<string, string> = {
            decided: 'already gave a yes or a no',
            max_attempts: 'called as many times as the policy allows',
            no_phone: 'no phone number on the lead',
            not_indian: 'not an Indian mobile number',
            opted_out: 'asked not to be called',
            unsubscribed: 'unsubscribed',
            in_flight: 'on a call right now',
            booked: 'already booked',
            too_old: 'older than the policy allows',
            locked: 'being processed by another job',
            stage_not_fresh: 'not in a stage that gets called',
          };

          return {
            success: true,
            automation: {
              calling_enabled: Boolean(policy?.master_enabled && policy?.ai_calling),
              calling_window: policy ? `${policy.call_window_start ?? 9}:00–${policy.call_window_end ?? 19}:00 IST` : null,
              attempts_allowed: Number(policy?.call_max_attempts) || 3,
              note: policy?.master_enabled && policy?.ai_calling
                ? 'Calling is switched on for this account.'
                : 'Calling is switched OFF for this account, so nothing in the queue will be dialled until it is switched on.',
            },
            queue: {
              in_queue: summary.inQueue,
              just_arrived: summary.justArrived,
              never_contacted: summary.neverContacted,
              retry: summary.retryDue,
              examined: summary.total,
            },
            skipped: Object.entries(summary.skipped).map(([code, count]) => ({
              count,
              why: skippedSentences[code] ?? code,
            })),
            lines: {
              capacity,
              in_use: calling,
              free: Math.max(0, capacity - calling),
              channels: channels.channels.map((channel) => channel.label),
              summary: describeCapacity(channels.channels, channels.source),
              note:
                channels.source === 'fallback'
                  ? 'These are the default lines, not individually configured channels. Set VOBIZ_CHANNELS to list the ' +
                    'lines you pay for and capacity follows automatically.'
                  : 'Capacity is the sum of the configured Vobiz channels.',
            },
            next: decisions
              .filter((decision) => decision.inQueue)
              .slice(0, 8)
              .map((decision) => ({
                name: decision.name ?? '(no name)',
                phone: decision.phone,
                why: decision.reason,
                arrived: formatAge(decision.minutesSinceArrival),
                // With no explicitly configured channel the dialler rotates across the shared DID pool, so say that rather
                // than showing null and implying no line is chosen.
                dials_from: pickChannel(channels.channels, decision.id)?.number || 'rotated from the shared DID pool',
              })),
            plain_english:
              `${summary.inQueue} lead${summary.inQueue === 1 ? '' : 's'} waiting to be called ` +
              `(${summary.justArrived} arrived today, ${summary.neverContacted} never contacted, ${summary.retryDue} retries), ` +
              `across ${capacity} line${capacity === 1 ? '' : 's'} with ${Math.max(0, capacity - calling)} free right now.`,
          };
        } catch (err: any) {
          return { success: false, error: String(err?.message || err) };
        }
      },
    }),

    org_call_report: tool({
      description:
        'Counts call attempts for the WHOLE organisation (the account plus every sub-account that rolls up to it) ' +
        'over a period, in the user\'s own timezone. These are the SAME numbers the Analytics → Action Report ' +
        'shows, because both count lead_history call actions. Use this for any "how many calls / attempts / DNP ' +
        'today, this week, this month" question — never estimate or query another source.',
      inputSchema: z.object({
        period: z
          .enum(['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'all_time'])
          .default('today')
          .describe('Which window to count'),
        timezone: z
          .string()
          .optional()
          .describe('IANA timezone for day boundaries, e.g. "Asia/Kolkata". Defaults to Asia/Kolkata.'),
      }),
      execute: async ({ period, timezone }) => {
        const tz = timezone || 'Asia/Kolkata';
        const { root, ids, names } = await orgMemberIds();

        const now = new Date();
        let since: Date | null = null;
        let until: Date | null = null;
        let periodLabel = '';
        let datePart = '';

        switch (period) {
          case 'today':
            since = startOfDayInZone(tz, 0);
            periodLabel = 'today';
            datePart = `, ${fmtDay(now, tz)}`;
            break;
          case 'yesterday':
            since = startOfDayInZone(tz, 1);
            until = startOfDayInZone(tz, 0);
            periodLabel = 'yesterday';
            datePart = `, ${fmtDay(new Date(until.getTime() - 1000), tz)}`;
            break;
          case 'last_7_days':
            since = startOfDayInZone(tz, 6);
            periodLabel = 'in the last 7 days';
            break;
          case 'last_30_days':
            since = startOfDayInZone(tz, 29);
            periodLabel = 'in the last 30 days';
            break;
          case 'this_month':
            since = startOfDayInZone(tz, 0);
            since = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
            since = new Date(since.getTime() - tzOffsetMs(tz, since));
            periodLabel = `in ${new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: 'long', year: 'numeric' }).format(now)}`;
            break;
          case 'all_time':
            periodLabel = 'ever';
            break;
        }

        try {
          // Count the SAME rows the Analytics → Action Report counts: `lead_history`
          // actions. This tool used to read `call_logs`, which is a narrower table, so the
          // agent told an owner "0 calls yesterday" on a day their dashboard showed 38
          // attempts. Two different numbers for one question is worse than a slow answer.
          let q = supabase
            .from('lead_history')
            .select('user_id, action_type, description, created_at, lead_id')
            .in('user_id', ids)
            .order('created_at', { ascending: false })
            .limit(20000);
          if (since) q = q.gte('created_at', since.toISOString());
          if (until) q = q.lt('created_at', until.toISOString());

          const { data, error } = await q;
          if (error) throw new Error(error.message);

          const isAttempt = (row: any) => {
            const type = String(row.action_type || '').toUpperCase();
            const desc = String(row.description || '').toLowerCase();
            if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT'].includes(type)) return false;
            if (
              desc.includes('facebook ad submission') ||
              desc.includes('reopened from facebook') ||
              desc.includes('bulk transferred') ||
              desc.includes('transferred from')
            ) {
              return false;
            }
            if (['CALL_FEEDBACK', 'CALL', 'OUTBOUND_CALL', 'CALL_LOG', 'DNP'].includes(type)) return true;
            if (desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) return true;
            if (desc.includes('call') || desc.includes('followup') || desc.includes('feedback')) return true;
            return false;
          };

          const rows = (data || []).filter(isAttempt);
          const total = rows.length;

          const byStatus: Record<string, number> = {};
          const byMember: Record<string, number> = {};
          const leads = new Set<string>();

          for (const r of rows) {
            const desc = String(r.description || '').toLowerCase();
            const type = String(r.action_type || '').toUpperCase();
            const isDnp =
              type === 'DNP' || desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick');
            const key = desc.includes('whatsapp') ? 'whatsapp followup' : isDnp ? 'dnp (not picked)' : 'connected';
            byStatus[key] = (byStatus[key] || 0) + 1;
            byMember[r.user_id] = (byMember[r.user_id] || 0) + 1;
            if (r.lead_id) leads.add(r.lead_id);
          }

          const connected = byStatus.connected || 0;
          // "Call attempts" is what the team did; connected is how many landed.
          const attempts = total;

          // Talk time only exists on telephony rows; lead_history has no duration, so it
          // is measured from call_logs when available and left at 0 rather than invented.
          let connectedSeconds = 0;
          try {
            let dq = supabase
              .from('call_logs')
              .select('duration, status')
              .in('user_id', ids)
              .limit(5000);
            dq = since ? dq.gte('created_at', since.toISOString()) : dq;
            dq = until ? dq.lt('created_at', until.toISOString()) : dq;
            const { data: durRows } = await dq;
            for (const d of durRows || []) {
              if (String(d.status || '').toLowerCase() === 'connected') connectedSeconds += Number(d.duration || 0);
            }
          } catch {}
          const mins = Math.round(connectedSeconds / 60);

          // A zero answer is a real answer, but it is almost never about the period
          // alone — give the last actual attempt so it is actionable.
          let lastCallNote: string | undefined;
          if (total === 0) {
            const { data: lastAny } = await supabase
              .from('lead_history')
              .select('created_at, action_type, description')
              .in('user_id', ids)
              .order('created_at', { ascending: false })
              .limit(200);
            const lastAt = (lastAny || []).find(isAttempt)?.created_at;
            if (lastAt) {
              const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000);
              lastCallNote = `The most recent call attempt in the organisation was on ${fmtDay(new Date(lastAt), tz)} (${days} day${days === 1 ? '' : 's'} ago).`;
            } else {
              lastCallNote = 'No call attempts have ever been logged for the organisation.';
            }
          }

          const memberBreakdown = Object.entries(byMember)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([id, count]) => ({ account: names[id] || id.slice(0, 8), calls: count }));

          const headline =
            total === 0
              ? `No calls were made ${periodLabel}${datePart}${timezoneLabel(tz)}.`
              : `${total} call${total === 1 ? '' : 's'} ${periodLabel}${datePart}${timezoneLabel(tz)}` +
                (connected > 0 ? `, ${connected} connected (${mins} min total talk time)` : '') +
                (leads.size > 0 ? `, across ${leads.size} distinct lead${leads.size === 1 ? '' : 's'}` : '') +
                '.';

          return {
            success: true,
            answer: headline,
            period: periodLabel,
            timezone: tz,
            rangeStart: since?.toISOString() || null,
            rangeEnd: until?.toISOString() || new Date().toISOString(),
            totalCalls: total,
            callAttempts: attempts,
            byStatus,
            connectedCalls: connected,
            talkTimeMinutes: mins,
            distinctLeads: leads.size,
            byAccount: memberBreakdown,
            accountsInScope: ids.length,
            ...(lastCallNote ? { note: lastCallNote } : {}),
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not count calls' };
        }
      },
    }),
  };
}

function timezoneLabel(tz: string): string {
  const map: Record<string, string> = {
    'Asia/Kolkata': ' (IST)',
    'Asia/Dubai': ' (GST)',
    'Asia/Singapore': ' (SGT)',
    'Europe/London': ' (UK)',
    'America/New_York': ' (ET)',
    UTC: ' (UTC)',
  };
  return map[tz] || ` (${tz})`;
}
