/**
 * What this business's advertising actually did — read once, used everywhere.
 *
 * THE HOLE THIS FILLS
 * The daily report could not see ad money. `supabaseMetricsReader.ads()` returns
 * `spendPaise: null, leads: null, previousCplPaise: null` because those figures live in Meta,
 * not in our tables — and the two findings that matter most, "you are paying for ads that bring
 * no leads" and "cost per lead has risen", are guarded on `spendPaise > 0`. Both were dead
 * branches. Meanwhile `?? 0` turned "we cannot see Meta" into "you spent nothing", which is the
 * most confident possible way to be wrong.
 *
 * So the report was made of leads, calls and posts — real, but blind to the one number a
 * business owner checks first. An engine that cannot see the money cannot improve it.
 *
 * WHY ONE LOADER
 * `optimize_meta_campaign` already did this work for a single conversation: read insights, tie
 * each row to the argument its launch recorded, and judge the argument. The daily brief needed
 * the same thing, and a second copy would have drifted. So this is the shared read: the tool and
 * the routine both call it, and there is exactly one definition of "measured".
 *
 * HONEST WHEN BLIND, NOT SILENT
 * `measured: false` is a first-class answer — no Meta connection, no token, no permissions, or
 * Meta unreachable. Callers must pass that through as "we could not read your ad account"
 * rather than as a zero. A zero is a claim; this is an absence.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRecordedLaunches } from './launch-service';
import {
  attributePerformance,
  deriveResults,
  parseNumber,
  summariseLearnings,
  type CreativeLearnings,
} from './creative-learning';

export type InsightLevel = 'campaign' | 'adset' | 'ad';

export interface AccountPerformance {
  /** True only when Meta answered AND at least one row came back with an identity. */
  measured: boolean;
  currency: string;
  /** Money spent in the window, in paise. Zero is real only when `measured`. */
  spendPaise: number;
  /** Enquiries/results Meta attributed to ads in the window. */
  results: number;
  /** spend / results, or null when no results were attributed (never Infinity, never 0). */
  costPerResultPaise: number | null;
  /** The same figure for the week before, derived by subtracting the two windows. Null when unknown. */
  previousCostPerResultPaise: number | null;
  /** How many ad-level rows the verdict is based on. */
  rows: number;
  /** Per-argument verdicts. Null when nothing could be read. */
  learnings: CreativeLearnings | null;
  /** Set when `measured` is false: the reason, in words a caller can show. */
  error?: string;
}

const NOT_MEASURED = (error?: string): AccountPerformance => ({
  measured: false,
  currency: 'INR',
  spendPaise: 0,
  results: 0,
  costPerResultPaise: null,
  previousCostPerResultPaise: null,
  rows: 0,
  learnings: null,
  error,
});

/** Meta's own payload, with `results` derived — the shape both halves of the loop need. */
function numericRowsFrom(insights: any): any[] {
  const source: any[] = Array.isArray(insights?.raw) && insights.raw.length > 0
    ? insights.raw
    : Array.isArray(insights?.rows)
      ? insights.rows
      : [];
  // `insights.rows` is built for a human to read: money as "₹2,000.00", CTR as "1.25%", no ids.
  // Judging those gave NaN against every threshold, which is how "nothing crossed the spend
  // bar" was once the answer to every account. `insights.raw` is numeric and id-bearing.
  return source.map((row) => ({ ...row, results: deriveResults(row) }));
}

/**
 * What one result cost, in paise.
 *
 * Meta reports spend in the account's currency (rupees here), not in paise, and the two figures in
 * this module must be in the SAME unit or the comparison is nonsense — the first version derived the
 * older week in rupees and the current week in paise, so the scorecard said "₹44 each, against ₹0"
 * and every week looked like a price rise. Pure and exported so the unit can be tested directly.
 */
export function costPerResultPaise(spendInCurrency: number, results: number): number | null {
  if (!(results > 0) || !Number.isFinite(spendInCurrency)) return null;
  return Math.round((spendInCurrency * 100) / results);
}

interface WindowTotals {
  spend: number;
  results: number;
}

/**
 * A short-lived cache, because the report is loaded on every visit to a tab that a person stares at.
 *
 * Measured in production the first time the report read Meta: 6.7 seconds to render the CEO tab,
 * because the findings endpoint now makes one or two live Meta calls. Meta's numbers do not change
 * meaningfully inside five minutes, so this trades nothing for a page that opens.
 *
 * Deliberately process-local and tiny: no store to keep in sync, no invalidation problem, and a cold
 * instance simply pays for one read. Nothing here can go stale in a way that misleads — a cached
 * figure is at most five minutes old and is always a real measurement.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: AccountPerformance }>();

function cacheKey(userId: string, opts: { datePreset: string; level: string; campaignId?: string; skipLearnings?: boolean }) {
  return `${userId}:${opts.datePreset}:${opts.level}:${opts.campaignId || ''}:${opts.skipLearnings ? 'totals' : 'full'}`;
}

/** Meta must never hold the page open. Past this, the report says it could not read and moves on. */
const META_TIMEOUT_MS = 8_000;

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} did not answer within ${ms / 1000}s`)), ms)),
  ]);
}

function totals(rows: readonly any[]): WindowTotals {
  let spend = 0;
  let results = 0;
  for (const row of rows || []) {
    spend += parseNumber(row?.spend) ?? 0;
    results += deriveResults(row);
  }
  return { spend, results };
}

/**
 * Read the account's paid performance.
 *
 * Two Meta calls at most: the judgement window, and a wider window so the week before can be
 * derived by subtraction (Meta has no "the 7 days before last week" preset). Never throws —
 * a brief or a report must still be composable with Meta down, it just has to say so.
 */
export async function loadAccountPerformance(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    /** Meta date preset for the window being judged. Default last_7d. */
    datePreset?: 'today' | 'yesterday' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'maximum';
    level?: InsightLevel;
    campaignId?: string;
    minSpend?: number;
    /** Skip the second Meta call that derives the previous week. */
    skipPrevious?: boolean;
    /** Skip the per-argument verdicts — the report needs totals, not the join. Saves a read. */
    skipLearnings?: boolean;
    /** Ignore a cached answer (the scorecard wants fresh numbers). */
    fresh?: boolean;
  } = {}
): Promise<AccountPerformance> {
  const level = opts.level ?? 'ad';
  const datePreset = opts.datePreset ?? 'last_7d';

  const key = cacheKey(userId, { datePreset, level, campaignId: opts.campaignId, skipLearnings: opts.skipLearnings });
  if (!opts.fresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }

  const value = await readPerformance(supabase, userId, { ...opts, level, datePreset });
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function readPerformance(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    datePreset: string;
    level: InsightLevel;
    campaignId?: string;
    minSpend?: number;
    skipPrevious?: boolean;
    skipLearnings?: boolean;
  }
): Promise<AccountPerformance> {
  const level = opts.level;
  const datePreset = opts.datePreset;

  let graphTools: any;
  try {
    const { createMetaGraphTools } = await import('@/lib/agent/mcp/meta-graph');
    graphTools = createMetaGraphTools(supabase, userId);
  } catch (e: any) {
    return NOT_MEASURED(`the Meta connector could not be loaded: ${e?.message || e}`);
  }

  let insights: any;
  try {
    insights = await withTimeout(
      graphTools.meta_graph_insights.execute({
        level,
        datePreset,
        campaignId: opts.campaignId || undefined,
        limit: 100,
      }),
      META_TIMEOUT_MS,
      'Meta'
    );
  } catch (e: any) {
    return NOT_MEASURED(`Meta could not be read: ${e?.message || e}`);
  }

  if (!insights?.success) {
    return NOT_MEASURED(insights?.error || 'this account has no Meta ad account connected');
  }

  const rows = numericRowsFrom(insights);
  if (!rows.length) {
    // Connected, but nothing ran. That is a measurement, not a failure: zero spend is true.
    return {
      measured: true,
      currency: insights.currency || 'INR',
      spendPaise: 0,
      results: 0,
      costPerResultPaise: null,
      previousCostPerResultPaise: null,
      rows: 0,
      learnings: summariseLearnings([], { period: datePreset, currency: insights.currency || 'INR' }),
    };
  }

  const window = totals(rows);
  const currency = insights.currency || 'INR';

  // ── the week before, by subtraction ───────────────────────────────────────────────────────
  let previousCostPerResultPaise: number | null = null;
  if (!opts.skipPrevious && datePreset === 'last_7d' && !opts.campaignId) {
    try {
      const wider: any = await withTimeout(
        graphTools.meta_graph_insights.execute({ level, datePreset: 'last_14d', limit: 100 }),
        META_TIMEOUT_MS,
        'Meta'
      );
      if (wider?.success) {
        const all = totals(numericRowsFrom(wider));
        const priorSpend = all.spend - window.spend;
        const priorResults = all.results - window.results;
        // Only when the subtraction leaves a real, positive fortnight-plus-this-week picture.
        if (priorSpend > 0 && priorResults > 0) {
          previousCostPerResultPaise = costPerResultPaise(priorSpend, priorResults);
        }
      }
    } catch {
      // A missing comparison is not a failed report. It just means we cannot say "up from".
    }
  }

  // ── the per-argument half ─────────────────────────────────────────────────────────────────
  let learnings: CreativeLearnings | null = null;
  if (!opts.skipLearnings) {
    try {
      const recorded = await loadRecordedLaunches(supabase, userId, { limit: 200 });
      const attributed = attributePerformance(rows, recorded.launches);
      learnings = summariseLearnings(attributed.observations, {
        period: datePreset,
        currency,
        ...(opts.minSpend ? { minSpend: Number(opts.minSpend) } : {}),
      });
      learnings.unattributedRows = attributed.unattributedRows;
      learnings.unattributedSpend = attributed.unattributedSpend;
    } catch {
      learnings = null;
    }
  }

  return {
    measured: true,
    currency,
    spendPaise: Math.round(window.spend * 100),
    results: window.results,
    costPerResultPaise: costPerResultPaise(window.spend, window.results),
    previousCostPerResultPaise,
    rows: rows.length,
    learnings,
  };
}
