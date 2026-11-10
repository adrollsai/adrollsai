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

    org_call_report: tool({
      description:
        'Counts AI phone calls for the WHOLE organisation (the account plus every sub-account that rolls up to it) over a period, in the user\'s own timezone. Use this for any "how many calls today / this week / this month" question — never estimate or query another source.',
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
          let q = supabase
            .from('call_logs')
            .select('user_id, status, duration, created_at, lead_id')
            .in('user_id', ids)
            .order('created_at', { ascending: false })
            .limit(5000);
          if (since) q = q.gte('created_at', since.toISOString());
          if (until) q = q.lt('created_at', until.toISOString());

          const { data, error } = await q;
          if (error) throw new Error(error.message);

          const rows = data || [];
          const total = rows.length;

          const byStatus: Record<string, number> = {};
          const byMember: Record<string, number> = {};
          const leads = new Set<string>();
          let connectedSeconds = 0;

          for (const r of rows) {
            const key = STATUS_LABELS[r.status] || String(r.status || 'unknown').toLowerCase();
            byStatus[key] = (byStatus[key] || 0) + 1;
            byMember[r.user_id] = (byMember[r.user_id] || 0) + 1;
            if (r.lead_id) leads.add(r.lead_id);
            if (key === 'connected') connectedSeconds += Number(r.duration || 0);
          }

          const connected = byStatus.connected || 0;
          const mins = Math.round(connectedSeconds / 60);
          // "Call attempts" is what the agent did; connected is how many landed.
          const attempts = total;

          // A zero answer is a real answer, but it is almost never about the
          // period alone — give the last actual call so it is actionable.
          let lastCallNote: string | undefined;
          if (total === 0) {
            const { data: lastAny } = await supabase
              .from('call_logs')
              .select('created_at')
              .in('user_id', ids)
              .order('created_at', { ascending: false })
              .limit(1);
            const lastAt = lastAny?.[0]?.created_at;
            if (lastAt) {
              const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000);
              lastCallNote = `The most recent call in the organisation was on ${fmtDay(new Date(lastAt), tz)} (${days} day${days === 1 ? '' : 's'} ago).`;
            } else {
              lastCallNote = 'No calls have ever been logged for the organisation.';
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
