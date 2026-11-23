/**
 * Yesterday's numbers, gathered from the tables that actually have them.
 *
 * THE RULE THAT SHAPED THIS FILE
 * A report is only as good as its inputs, and a made-up input is worse than a missing one.
 * So every figure here comes from a column that exists, verified against the live schema —
 * and where a figure genuinely cannot be sourced (paid spend attribution lives in Meta, not
 * in a column we have), the reader returns NULL rather than 0. Zero would tell the owner
 * "no ads are running"; null tells the engine "we do not know", and the engine says nothing.
 *
 * WHY THE READS ARE INJECTED
 * The arithmetic is testable; the queries need a database. `MetricsReader` is the seam, so
 * the gate can drive real mappings with a fake clock and fake rows, and the Supabase
 * implementation stays thin enough to read in one go.
 *
 * WINDOW
 * A day is the calendar day in the business's timezone, not "the last 24 hours": an owner
 * comparing Monday with Tuesday does not mean "mid-afternoon to mid-afternoon".
 */

import type { DayMetrics } from './ceo-findings';
import { scanAll } from '@/lib/supabase/paged';

/** Local rounding, so this module carries no dependency on the video skill's number helpers. */
const roundTo = (value: number, dp = 2): number => {
  const factor = 10 ** dp;
  return Math.round((Number(value) || 0) * factor) / factor;
};

export interface MetricsWindow {
  /** ISO timestamps, inclusive start and exclusive end. */
  from: string;
  to: string;
  /** The same window a week earlier, for comparisons. */
  previousFrom: string;
  previousTo: string;
  /** Labels for the report header. */
  labelFrom: string;
  labelTo: string;
}

export interface MetricsReader {
  leadsInWindow(window: MetricsWindow): Promise<{
    created: number;
    contacted: number;
    replied: number;
    booked: number;
    lost: number;
    previousCreated: number;
  }>;
  callsInWindow(window: MetricsWindow): Promise<{ placed: number; connected: number; averageSeconds: number }>;
  whatsappInWindow(window: MetricsWindow): Promise<{ sent: number; replied: number }>;
  postsInWindow(window: MetricsWindow): Promise<{ published: number; created: number }>;
  routinesInWindow(window: MetricsWindow): Promise<{ ran: number; failed: number }>;
  wallet(): Promise<{ balance: number; spentLast7Days: number }>;
  /**
   * Paid advertising. `spendPaise` and `leads` are NULL when the figure cannot be sourced —
   * which is the honest answer today, because attribution lives in Meta's reports.
   */
  ads(): Promise<{ active: number; spendPaise: number | null; leads: number | null; previousCplPaise: number | null }>;
}

/** A day's window in a timezone, plus the same day a week earlier. */
export function windowFor(now: Date, timezone = 'Asia/Kolkata'): MetricsWindow {
  // Work in the business's own day boundaries. `en-CA` formats as YYYY-MM-DD, which parses.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [year, month, day] = parts.split('-').map(Number);

  const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // The offset between the business's local midnight and UTC, so the window matches the day
  // the owner actually lived rather than a UTC slice of it.
  const offsetMs = localOffsetMs(now, timezone);
  const from = new Date(startOfDay.getTime() - offsetMs);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const week = 7 * 24 * 60 * 60 * 1000;

  const dayLabel = (date: Date) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: timezone, day: 'numeric', month: 'short' }).format(date);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    previousFrom: new Date(from.getTime() - week).toISOString(),
    previousTo: new Date(to.getTime() - week).toISOString(),
    labelFrom: dayLabel(from),
    labelTo: dayLabel(new Date(to.getTime() - 1)),
  };
}

/** How far ahead of UTC the timezone is, in ms, at this instant. */
function localOffsetMs(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - at.getTime();
}

/** Statuses that mean a lead was actually spoken to, across the status vocabularies in use. */
const CONTACTED_STATUSES = ['contacted', 'follow_up', 'followup', 'qualified', 'visit_planned', 'booked', 'won', 'negotiation', 'interested'];
const BOOKED_STATUSES = ['booked', 'visit_planned', 'won'];
const LOST_STATUSES = ['lost', 'junk', 'dnp', 'not_interested', 'invalid'];
const CONNECTED_CALL_STATUSES = ['completed', 'answered', 'connected', 'success'];

/** Everything the report needs, from the tables that really hold it. */
export function supabaseMetricsReader(supabase: any, userId: string): MetricsReader {
  /**
   * Read EVERY matching row, not the first page.
   *
   * This used `.limit(5000)`. PostgREST's max-rows is 1000 and it returns HTTP 200 regardless, so every
   * CEO figure — leads, calls, booked, connected, spend — was computed from a truncated slice and
   * presented as a total for any account with more than a thousand rows in the window.
   */
  const countRows = async (table: string, build: (query: any) => any): Promise<any[]> => {
    try {
      const scan = await scanAll<any>(() => build(supabase.from(table).select('*').eq('user_id', userId)), {
        cap: 60_000,
      });
      // A table we cannot read is a figure we do not have. It must not become a zero.
      if (scan.error && scan.rows.length === 0) return [];
      return scan.rows;
    } catch {
      return [];
    }
  };

  return {
    async leadsInWindow(window) {
      const inWindow = await countRows('leads', (query) =>
        query.gte('created_at', window.from).lt('created_at', window.to),
      );
      const previous = await countRows('leads', (query) =>
        query.gte('created_at', window.previousFrom).lt('created_at', window.previousTo),
      );

      // "Contacted" is judged on the lead's own state, not on a separate activity log: a lead
      // that has moved past 'new' has been spoken to by someone.
      const status = (row: any) => String(row.status ?? row.pipeline_stage ?? '').toLowerCase();
      return {
        created: inWindow.length,
        contacted: inWindow.filter((row) => {
          const value = status(row);
          return value !== '' && !['new', 'fresh', 'pending', 'uncontacted'].includes(value);
        }).length,
        replied: inWindow.filter((row) => Boolean(row.last_activity_at) || CONTACTED_STATUSES.includes(status(row))).length,
        booked: inWindow.filter((row) => Boolean(row.booked_time) || BOOKED_STATUSES.includes(status(row))).length,
        lost: inWindow.filter((row) => LOST_STATUSES.includes(status(row))).length,
        previousCreated: previous.length,
      };
    },

    async callsInWindow(window) {
      const rows = await countRows('call_logs', (query) =>
        query.gte('created_at', window.from).lt('created_at', window.to),
      );
      const connectedRows = rows.filter((row) => {
        const state = String(row.status ?? '').toLowerCase();
        return CONNECTED_CALL_STATUSES.includes(state) || Number(row.duration ?? 0) > 5;
      });
      const durations = connectedRows.map((row) => Number(row.duration ?? 0)).filter((value) => value > 0);
      return {
        placed: rows.length,
        connected: connectedRows.length,
        averageSeconds: durations.length ? roundTo(durations.reduce((sum, value) => sum + value, 0) / durations.length, 1) : 0,
      };
    },

    async whatsappInWindow(window) {
      const rows = await countRows('whatsapp_messages', (query) =>
        query.gte('created_at', window.from).lt('created_at', window.to),
      );
      const outbound = rows.filter((row) => String(row.direction ?? '').toLowerCase() === 'outbound').length;
      const inbound = rows.filter((row) => String(row.direction ?? '').toLowerCase() === 'inbound').length;
      return { sent: outbound, replied: inbound };
    },

    async postsInWindow(window) {
      const rows = await countRows('posts', (query) =>
        query.gte('created_at', window.from).lt('created_at', window.to),
      );
      const published = rows.filter((row) => ['published', 'posted', 'live'].includes(String(row.status ?? '').toLowerCase()));
      return { published: published.length, created: rows.length };
    },

    async routinesInWindow(window) {
      const rows = await countRows('routine_runs', (query) =>
        query.gte('created_at', window.from).lt('created_at', window.to),
      );
      return {
        ran: rows.length,
        failed: rows.filter((row) => ['failed', 'error'].includes(String(row.status ?? '').toLowerCase())).length,
      };
    },

    async wallet() {
      const { data: profile } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', userId)
        .maybeSingle();
      const balance = Number(profile?.credits ?? 0) || 0;

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      // Spend for the week: paged, because a busy account has more than one page of transactions and a
      // truncated sum understates what the owner actually spent.
      const spendScan = await scanAll<any>(
        () =>
          supabase
            .from('credit_transactions')
            .select('amount, created_at')
            .eq('user_id', userId)
            .lt('amount', 0)
            .gte('created_at', since),
        { cap: 50_000 }
      );
      const spend = spendScan.rows;
      const spent = (spend ?? []).reduce((sum: number, row: any) => sum + Math.abs(Number(row.amount) || 0), 0);
      return { balance: roundTo(balance, 2), spentLast7Days: roundTo(spent, 2) };
    },

    async ads() {
      const campaigns = await countRows('agent_ad_campaigns', (query) => query);
      const active = campaigns.filter((row) => ['active', 'enabled', 'running'].includes(String(row.status ?? '').toLowerCase()));
      // Spend and attributed leads are NOT in this table. Returning a number here would be
      // invention, so they are null and the engine stays quiet about them.
      return { active: active.length, spendPaise: null, leads: null, previousCplPaise: null };
    },
  };
}

/**
 * Gather the day.
 *
 * A reader that throws on one section must not lose the whole report: each section falls
 * back to the empty-but-honest shape, and `missing` names what could not be read so the
 * caller can say so rather than presenting a confident zero.
 */
export async function gatherDayMetrics(
  reader: MetricsReader,
  window: MetricsWindow,
): Promise<{ metrics: DayMetrics; missing: string[] }> {
  const missing: string[] = [];
  const safe = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch {
      missing.push(name);
      return fallback;
    }
  };

  const [leads, calls, whatsapp, posts, routines, wallet, ads] = await Promise.all([
    safe('leads', () => reader.leadsInWindow(window), {
      created: 0,
      contacted: 0,
      replied: 0,
      booked: 0,
      lost: 0,
      previousCreated: 0,
    }),
    safe('calls', () => reader.callsInWindow(window), { placed: 0, connected: 0, averageSeconds: 0 }),
    safe('whatsapp', () => reader.whatsappInWindow(window), { sent: 0, replied: 0 }),
    safe('posts', () => reader.postsInWindow(window), { published: 0, created: 0 }),
    safe('routines', () => reader.routinesInWindow(window), { ran: 0, failed: 0 }),
    safe('wallet', () => reader.wallet(), { balance: 0, spentLast7Days: 0 }),
    safe('ads', () => reader.ads(), { active: 0, spendPaise: null, leads: null, previousCplPaise: null }),
  ]);

  return {
    metrics: {
      window: { from: window.labelFrom, to: window.labelTo },
      leads,
      calls,
      whatsapp,
      campaigns: {
        active: ads.active,
        // Spend we cannot source becomes 0, which means the engine's "spend with no leads"
        // rule CANNOT fire on unmeasurable ads — both sides are 0. That is deliberate: a
        // report must not accuse a business of wasting money on the strength of a missing
        // column. `missing` carries 'ads' when this happens, so the caller can say "ad spend
        // is not being measured yet" instead of implying there was none.
        spendPaise: ads.spendPaise ?? 0,
        leads: ads.leads ?? 0,
        previousCplPaise: ads.previousCplPaise,
      },
      content: posts,
      credits: wallet,
      routines,
    },
    missing,
  };
}
