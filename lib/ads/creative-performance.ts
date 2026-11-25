/**
 * What each creative actually did, and what to do about it.
 *
 * The Optimize button used to open a form asking the owner to pick creatives before anything was
 * measured, then hand a thin table of spend-and-leads to a model and call the answer an analysis.
 * Two things were wrong with that:
 *
 *   1. It ranked by SPEND. Spend is not performance; an expensive creative that converted nobody is
 *      the worst one on the account, and it sorted to the top as a "winner".
 *   2. It read `date_preset=maximum` — lifetime totals. A creative from six months ago carries
 *      every rupee it ever spent, and wins an all-time comparison against the ad that is working
 *      this week. The account's current best creative can be invisible in that ranking.
 *
 * So the judgement lives here, in code, on one window, with thresholds the product already uses
 * elsewhere (`creative-learning`: 1,000 impressions or ₹500 spent before a creative may be called).
 * A model may then write the recommendations, but it does not get to decide which creative won.
 *
 * Pure: takes rows, returns a verdict. No network, no clock.
 */

import {
  deriveResults,
  MIN_IMPRESSIONS_FOR_JUDGEMENT,
  MIN_SPEND_FOR_JUDGEMENT,
  parseNumber,
} from './creative-learning';

export type CreativeVerdict = 'winner' | 'average' | 'loser' | 'too_early';

export interface CreativePerformance {
  adId: string;
  adName: string;
  /** Money Meta says it spent, in paise. */
  spendPaise: number;
  impressions: number;
  clicks: number;
  /** Meta's own CTR when it sent one, otherwise derived from clicks / impressions. */
  ctrPct: number | null;
  results: number;
  /** spend / results, in paise. Null when nothing was attributed. */
  costPerResultPaise: number | null;
  frequency: number | null;
  imageUrl?: string | null;
  headline?: string | null;
  primaryText?: string | null;
  isVideo?: boolean;
  verdict: CreativeVerdict;
  /** One sentence a business owner can act on, e.g. "₹4,120 spent, no enquiries". */
  why: string;
}

export interface CreativeTotals {
  spendPaise: number;
  results: number;
  impressions: number;
  clicks: number;
  costPerResultPaise: number | null;
  /** How many creatives had enough delivery to be judged. */
  judged: number;
  /** How many were too new to call. */
  unjudged: number;
}

export interface CreativeAnalysis {
  /** The window these numbers cover, in words, so it is never mistaken for lifetime. */
  window: string;
  /** Every creative, worst last: results first, then the cheaper enquiry, then the spend. */
  creatives: CreativePerformance[];
  winners: CreativePerformance[];
  losers: CreativePerformance[];
  tooEarly: CreativePerformance[];
  totals: CreativeTotals;
  /** The account's typical cost per enquiry across judged creatives. The yardstick. */
  baselineCostPerResultPaise: number | null;
  /** How many creatives had both enough delivery and at least one enquiry to compare. */
  comparable: number;
  /** Deterministic prose summary. No model involved, so it can never contradict the table. */
  summary: string;
}

export interface AnalyseOptions {
  window?: string;
  minImpressions?: number;
  minSpendPaise?: number;
}

const rupees = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** A creative is a winner when it buys an enquiry for at least 20% less than the account's usual. */
export const WINNER_MULTIPLE = 0.8;
/** …and a loser when it pays 50% more than usual for the same thing. */
export const LOSER_MULTIPLE = 1.5;
/**
 * How many creatives must carry real results before any of them can be called a winner or a loser.
 *
 * Two creatives are not a trend: whatever number sits between them will always put one below the
 * line and one above it, so a two-creative account would be told to stop one of its only two ads on
 * no evidence at all. Three is the smallest set where "better than usual" means something.
 */
export const MIN_COMPARABLE_CREATIVES = 3;

/**
 * The yardstick: what an enquiry costs this account across the creatives that could be judged.
 *
 * Deliberately the portfolio figure (total spend / total enquiries) rather than the median of the
 * per-creative costs. The median of four creatives is the average of the two in the middle, which
 * lets one very cheap creative drag it down far enough that the honest mid-priced creatives — the
 * ones actually carrying the spend — all look expensive. The portfolio number is also the figure
 * the owner already sees on the account, so the comparison cannot contradict it.
 */

/** The median of the numbers that survived filtering. */
function median(values: number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[middle - 1] + clean[middle]) / 2 : clean[middle];
}

/**
 * Read one Meta ad-level insights row (plus whatever creative metadata we managed to fetch).
 *
 * Money comes in as rupees from Meta and leaves as paise, because every other figure in this
 * product is in paise and mixing the two produces confident nonsense.
 */
export function readCreative(row: Record<string, any>): CreativePerformance | null {
  const adId = row?.ad_id ?? row?.adId ?? null;
  if (!adId) return null;

  const spendRupees = parseNumber(row?.spend) ?? 0;
  const spendPaise = Math.round(spendRupees * 100);
  const impressions = Math.round(parseNumber(row?.impressions) ?? 0);
  const clicks = Math.round(parseNumber(row?.clicks) ?? 0);
  const rawCtr = parseNumber(row?.ctr);
  const ctrPct = rawCtr !== null ? rawCtr : impressions > 0 ? (clicks / impressions) * 100 : null;
  const results = Math.round(deriveResults(row));

  return {
    adId: String(adId),
    adName: String(row?.ad_name ?? row?.adName ?? adId),
    spendPaise,
    impressions,
    clicks,
    ctrPct,
    results,
    costPerResultPaise: results > 0 ? Math.round(spendPaise / results) : null,
    frequency: parseNumber(row?.frequency),
    imageUrl: row?.imageUrl ?? null,
    headline: row?.headline ?? null,
    primaryText: row?.primaryText ?? null,
    isVideo: Boolean(row?.isVideo),
    verdict: 'too_early',
    why: '',
  };
}

/**
 * Judge every creative against the account's own yardstick.
 *
 * The yardstick is the median cost per enquiry of the creatives that delivered enough to be judged,
 * not an industry benchmark: a ₹90 enquiry is good for one business and ruinous for another, and the
 * only comparison that means anything is with the same account's other creative.
 */
export function analyseCreatives(rows: Array<Record<string, any>>, opts: AnalyseOptions = {}): CreativeAnalysis {
  const window = opts.window ?? 'the last 30 days';
  const minImpressions = opts.minImpressions ?? MIN_IMPRESSIONS_FOR_JUDGEMENT;
  const minSpendPaise = opts.minSpendPaise ?? MIN_SPEND_FOR_JUDGEMENT * 100;

  const creatives: CreativePerformance[] = [];
  for (const row of rows ?? []) {
    const creative = readCreative(row);
    if (creative) creatives.push(creative);
  }

  const judged = creatives.filter(
    (creative) => creative.impressions >= minImpressions || creative.spendPaise >= minSpendPaise
  );
  const withResults = judged.filter((creative) => creative.results > 0);
  const comparable = withResults.length;
  const comparisonReady = comparable >= MIN_COMPARABLE_CREATIVES;

  // The yardstick, from the judged creatives only: a creative that has barely delivered must not
  // move the number the others are measured against.
  const judgedSpend = judged.reduce((sum, creative) => sum + creative.spendPaise, 0);
  const judgedResults = judged.reduce((sum, creative) => sum + creative.results, 0);
  const baselineCost = judgedResults > 0 ? Math.round(judgedSpend / judgedResults) : null;

  for (const creative of creatives) {
    const isJudged = judged.includes(creative);

    if (!isJudged) {
      creative.verdict = 'too_early';
      creative.why =
        `${creative.impressions.toLocaleString('en-IN')} impressions and ${rupees(creative.spendPaise)} spent — ` +
        `too little to call either way`;
      continue;
    }

    if (creative.results === 0) {
      creative.verdict = 'loser';
      creative.why = `${rupees(creative.spendPaise)} spent and not one enquiry — this is the one to stop`;
      continue;
    }

    const cost = creative.costPerResultPaise ?? 0;

    if (!comparisonReady || baselineCost === null || baselineCost <= 0) {
      // Not enough creatives with results to compare: say what the number is, claim nothing.
      creative.verdict = 'average';
      creative.why =
        `${creative.results} enquir${creative.results === 1 ? 'y' : 'ies'} at ${rupees(cost)} each. ` +
        `Only ${comparable} creative${comparable === 1 ? ' has' : 's have'} enough delivery to compare, ` +
        `so this is the baseline rather than a winner or a loser`;
      continue;
    }

    if (cost <= baselineCost * WINNER_MULTIPLE) {
      creative.verdict = 'winner';
      creative.why =
        `${rupees(cost)} per enquiry, against your usual ${rupees(baselineCost)} — ` +
        `make more like this one`;
    } else if (cost >= baselineCost * LOSER_MULTIPLE) {
      creative.verdict = 'loser';
      creative.why =
        `${rupees(cost)} per enquiry, ${(cost / baselineCost).toFixed(1)}× your usual ${rupees(baselineCost)} — ` +
        `the cheapest thing to change is this creative`;
    } else {
      creative.verdict = 'average';
      creative.why = `${rupees(cost)} per enquiry, about your usual ${rupees(baselineCost)} — holding its own`;
    }
  }

  // Worst last: most enquiries first, then cheapest enquiry, then the biggest spender.
  creatives.sort((a, b) => {
    if (b.results !== a.results) return b.results - a.results;
    const aCost = a.costPerResultPaise ?? Number.MAX_SAFE_INTEGER;
    const bCost = b.costPerResultPaise ?? Number.MAX_SAFE_INTEGER;
    if (aCost !== bCost) return aCost - bCost;
    return b.spendPaise - a.spendPaise;
  });

  const totals: CreativeTotals = {
    spendPaise: creatives.reduce((sum, creative) => sum + creative.spendPaise, 0),
    results: creatives.reduce((sum, creative) => sum + creative.results, 0),
    impressions: creatives.reduce((sum, creative) => sum + creative.impressions, 0),
    clicks: creatives.reduce((sum, creative) => sum + creative.clicks, 0),
    costPerResultPaise: null,
    judged: judged.length,
    unjudged: creatives.length - judged.length,
  };
  totals.costPerResultPaise =
    totals.results > 0 ? Math.round(totals.spendPaise / totals.results) : null;

  const winners = creatives.filter((creative) => creative.verdict === 'winner');
  const losers = creatives.filter((creative) => creative.verdict === 'loser');
  const tooEarly = creatives.filter((creative) => creative.verdict === 'too_early');

  return {
    window,
    creatives,
    winners,
    losers,
    tooEarly,
    totals,
    baselineCostPerResultPaise: baselineCost,
    comparable,
    summary: summarise({ window, creatives, winners, losers, tooEarly, totals, baselineCost }),
  };
}

/** The paragraph the owner reads first. Every claim in it comes from the table below it. */
function summarise(input: {
  window: string;
  creatives: CreativePerformance[];
  winners: CreativePerformance[];
  losers: CreativePerformance[];
  tooEarly: CreativePerformance[];
  totals: CreativeTotals;
  baselineCost: number | null;
}): string {
  const { window, creatives, winners, losers, tooEarly, totals, baselineCost } = input;
  if (!creatives.length) return 'No creative has delivered anything in this window, so there is nothing to judge yet.';

  const parts: string[] = [];
  parts.push(
    `${creatives.length} creative${creatives.length === 1 ? '' : 's'} spent ${rupees(totals.spendPaise)} over ${window} ` +
      `and brought ${totals.results} enquir${totals.results === 1 ? 'y' : 'ies'}` +
      `${totals.costPerResultPaise !== null ? ` at ${rupees(totals.costPerResultPaise)} each` : ''}.`
  );

  if (winners.length) {
    const cheapest = winners.reduce((best, creative) =>
      (creative.costPerResultPaise ?? Infinity) < (best.costPerResultPaise ?? Infinity) ? creative : best
    );
    parts.push(
      `${winners.length} ${winners.length === 1 ? 'is' : 'are'} buying enquiries below your usual ` +
        `${baselineCost !== null ? rupees(baselineCost) : 'cost'} — the cheapest is "${cheapest.adName}" at ` +
        `${rupees(cheapest.costPerResultPaise ?? 0)} each.`
    );
  }

  if (losers.length) {
    const waste = losers.reduce((sum, creative) => sum + creative.spendPaise, 0);
    const noLead = losers.filter((creative) => creative.results === 0).length;
    parts.push(
      `${losers.length} should stop: they spent ${rupees(waste)}` +
        `${noLead ? ` and ${noLead} of them brought nobody` : ''}.`
    );
  }

  if (tooEarly.length) {
    parts.push(`${tooEarly.length} ha${tooEarly.length === 1 ? 's' : 've'} not delivered enough to judge yet.`);
  }

  return parts.join(' ');
}
