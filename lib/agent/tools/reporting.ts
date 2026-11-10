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
  completed: 'connected',
  CONNECTED: 'connected',
  'no-answer': 'no answer',
  'NO_ANSWER': 'no answer',
  busy: 'busy',
  BUSY: 'busy',
  failed: 'failed',
  FAILED: 'failed',
  cancelled: 'cancelled',
  initiated: 'in progress',
};

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
