/**
 * Closing the loop: what ran, how it did, and what the next creative should argue instead.
 *
 * THE GAP THIS FILLS
 * The platform could already JUDGE an ad — `recommendOptimisation` reads spend, CTR and frequency and says
 * pause this, keep that. What it could not do was LEARN. Nothing joined "this creative argued the offer"
 * to "and it brought leads at half the cost of the one that argued authority", so every new batch started
 * from zero and the owner paid to rediscover the same lesson every month.
 *
 * DESIGNED STATELESS ON PURPOSE
 * There is no learnings table and no learnings cache. Everything here is a PURE function of two things we
 * already own: the launches we recorded (`campaign_jobs.payload.creativePlan`) and the numbers Meta
 * returns. Three properties fall out of that, and they are the reason for the choice:
 *
 *   NO MIGRATION.        Nothing to deploy, nothing to backfill, no schema to keep in sync.
 *   NO LOST UPDATES.     A cache written by two readers at once silently loses one of them. A value
 *                        recomputed from source cannot: two runs on the same numbers agree exactly.
 *   SELF-HEALING.        Corrupt, pruned or missing input degrades to "no learnings" — never to a wrong
 *                        one — and the next run is correct again with no cleanup.
 *
 * WHAT IT REFUSES TO DO
 *   - It will not learn from noise. An angle needs real impressions AND real spend before it is judged,
 *     because "3 clicks and no leads" is not a lesson, it is a Tuesday.
 *   - It will not hide what it could not attribute. Spend that cannot be tied to an angle is counted and
 *     reported, because a tidy summary that silently drops half the money is worse than no summary.
 *   - It will not overrule the owner. `angleGuidance` returns SUGGESTIONS. The owner's own instruction,
 *     and the standing creative directives enforced in `creative-directives.ts`, always win — the
 *     learnings are the machine's opinion, the directives are the person's decision.
 */

import { AD_ANGLES } from '@/lib/agent/creative/ad-prompt-compiler';

/**
 * Judgement thresholds.
 *
 * The impression floor is the ad-creative playbook's own rule: allow 1,000+ impressions before judging a
 * creative. The spend floor matches `recommendOptimisation`'s default, so the two halves of the loop
 * cannot disagree about whether an item is worth a verdict.
 */
export const MIN_IMPRESSIONS_FOR_JUDGEMENT = 1000;
export const MIN_SPEND_FOR_JUDGEMENT = 500;

/** A launch, as recorded at the moment it went out. */
export interface LaunchedCreative {
  campaignId: string | null;
  adsetId?: string | null;
  adId?: string | null;
  /** One of AD_ANGLES ids. Null when the launch predates plan recording, or did not name one. */
  angleId?: string | null;
  headline?: string | null;
}

/** One ad's numbers, already numeric. Ids are required for attribution. */
export interface PerformanceRow {
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  /** Leads / results as the account counts them. Zero is a real answer, not a missing one. */
  results: number;
  /** Null when the row carried no usable CTR, so it is never confused with 0%. */
  ctr: number | null;
}

export type AngleVerdict = 'winning' | 'losing' | 'promising' | 'too_early';

export interface AngleLearning {
  angleId: string;
  /** Human name from AD_ANGLES, so a prompt reads "Proof" rather than "proof". */
  label: string;
  spend: number;
  impressions: number;
  results: number;
  /** How many performance rows contributed. One angle can span several ads and campaigns. */
  samples: number;
  costPerResult: number | null;
  ctr: number | null;
  verdict: AngleVerdict;
  /** Why, in a sentence an owner can argue with. */
  reason: string;
}

export interface CreativeLearnings {
  period: string;
  currency: string;
  /** Performance rows that were successfully tied to an angle. */
  observed: number;
  /** Rows that could NOT be tied to an angle, and the money in them. Reported, never hidden. */
  unattributedRows: number;
  unattributedSpend: number;
  angles: AngleLearning[];
  winners: string[];
  losers: string[];
  tooEarly: string[];
  /** One paragraph for the agent to read. */
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Reading numbers out of provider-shaped rows
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Parse a money value that may be a number, a numeric string, or a formatted one.
 *
 * `meta_graph_insights` formats its display rows ("₹2,000.00", "1.25%") for a human to read. Calling
 * `Number()` on those yields NaN, which compares false against everything and silently turns a real
 * verdict into "nothing to judge". Every number that crosses this module therefore goes through here.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[,\s]/g, '');
  if (!text) return null;
  // Strip any currency symbol or code and a trailing percent; keep digits, sign and decimal point.
  const cleaned = text.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Action types Meta reports that mean "this was a result" for the products we run. */
const RESULT_ACTION_TYPES = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_first_reply',
  'complete_registration',
  'purchase',
];

/**
 * The results count for a row.
 *
 * Meta does not have a `results` field — it has an `actions` array and the meaning of "a result" depends
 * on the campaign. So an explicit `results`/`leads` wins when a caller already resolved it, and otherwise
 * the known result action types are summed. Returning 0 (rather than null) when nothing matched is
 * deliberate: "spent money and produced nothing" is the single most actionable finding in the loop, and
 * treating it as "unknown" would discard it.
 */
export function deriveResults(row: Record<string, any>): number {
  const explicit = parseNumber(row?.results) ?? parseNumber(row?.leads);
  if (explicit !== null) return explicit;

  const actions = Array.isArray(row?.actions) ? row.actions : [];
  let total = 0;
  let found = false;
  for (const action of actions) {
    const type = String(action?.action_type || '');
    if (!RESULT_ACTION_TYPES.includes(type)) continue;
    const value = parseNumber(action?.value);
    if (value === null) continue;
    total += value;
    found = true;
  }
  return found ? total : 0;
}

/** Normalise one raw insights row. Returns null for a row that carries no identity to attribute. */
export function normalisePerformanceRow(row: Record<string, any>): PerformanceRow | null {
  if (!row || typeof row !== 'object') return null;
  const campaignId = row.campaign_id ?? row.campaignId ?? null;
  const adsetId = row.adset_id ?? row.adsetId ?? null;
  const adId = row.ad_id ?? row.adId ?? null;
  // An id is what makes attribution possible; without one the row cannot teach anything about an angle.
  if (!campaignId && !adsetId && !adId) return null;

  return {
    campaignId: campaignId ? String(campaignId) : null,
    adsetId: adsetId ? String(adsetId) : null,
    adId: adId ? String(adId) : null,
    spend: parseNumber(row.spend) ?? 0,
    impressions: parseNumber(row.impressions) ?? 0,
    clicks: parseNumber(row.clicks) ?? 0,
    results: deriveResults(row),
    ctr: parseNumber(row.ctr),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Attribution
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface AttributedObservation extends PerformanceRow {
  angleId: string;
}

/**
 * Tie each performance row to the creative plan recorded for its launch.
 *
 * The join is tried most-specific first — ad, then ad set, then campaign — because a launch records
 * whatever ids it had when it went out, and a campaign-level record is still far better than discarding
 * the row. This is the only place the two halves of the loop meet.
 */
export function attributePerformance(
  rows: readonly Record<string, any>[],
  launched: readonly LaunchedCreative[],
): { observations: AttributedObservation[]; unattributedRows: number; unattributedSpend: number } {
  const byAd = new Map<string, LaunchedCreative>();
  const byAdset = new Map<string, LaunchedCreative>();
  const byCampaign = new Map<string, LaunchedCreative>();
  for (const plan of launched) {
    if (!plan?.angleId) continue;
    if (plan.adId) byAd.set(String(plan.adId), plan);
    if (plan.adsetId) byAdset.set(String(plan.adsetId), plan);
    if (plan.campaignId) byCampaign.set(String(plan.campaignId), plan);
  }

  const observations: AttributedObservation[] = [];
  let unattributedRows = 0;
  let unattributedSpend = 0;

  for (const raw of rows || []) {
    const row = normalisePerformanceRow(raw);
    if (!row) {
      unattributedRows++;
      unattributedSpend += parseNumber((raw as any)?.spend) ?? 0;
      continue;
    }
    const plan =
      (row.adId && byAd.get(row.adId)) ||
      (row.adsetId && byAdset.get(row.adsetId)) ||
      (row.campaignId && byCampaign.get(row.campaignId)) ||
      null;
    if (!plan?.angleId) {
      unattributedRows++;
      unattributedSpend += row.spend;
      continue;
    }
    observations.push({ ...row, angleId: String(plan.angleId) });
  }

  return { observations, unattributedRows, unattributedSpend };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The verdicts
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function angleLabel(angleId: string): string {
  return AD_ANGLES.find((angle) => angle.id === angleId)?.name ?? angleId;
}

/**
 * Turn observations into a verdict per angle.
 *
 * Deterministic: same observations in, same learnings out, with no clock and no sampling. That is what
 * makes the loop safe to run on every pass instead of maintaining a cache that can drift or be lost.
 *
 * The comparison is RATIO-BASED against the best performing judged angle rather than against a fixed
 * cost-per-result, because a fixed number cannot know whether a client's leads cost ₹200 or ₹20,000.
 */
export function summariseLearnings(
  observations: readonly AttributedObservation[],
  opts: { period?: string; currency?: string; minImpressions?: number; minSpend?: number } = {},
): CreativeLearnings {
  const period = opts.period ?? 'the last 7 days';
  const currency = opts.currency ?? 'INR';
  const minImpressions = opts.minImpressions ?? MIN_IMPRESSIONS_FOR_JUDGEMENT;
  const minSpend = opts.minSpend ?? MIN_SPEND_FOR_JUDGEMENT;

  const grouped = new Map<string, { spend: number; impressions: number; clicks: number; results: number; samples: number }>();
  for (const row of observations || []) {
    const entry = grouped.get(row.angleId) ?? { spend: 0, impressions: 0, clicks: 0, results: 0, samples: 0 };
    entry.spend += row.spend;
    entry.impressions += row.impressions;
    entry.clicks += row.clicks;
    entry.results += row.results;
    entry.samples += 1;
    grouped.set(row.angleId, entry);
  }

  const angles: AngleLearning[] = [];
  for (const [angleId, aggregate] of grouped) {
    const judged = aggregate.impressions >= minImpressions && aggregate.spend >= minSpend;
    const costPerResult = aggregate.results > 0 ? aggregate.spend / aggregate.results : null;
    const ctr = aggregate.impressions > 0 ? (aggregate.clicks / aggregate.impressions) * 100 : null;
    angles.push({
      angleId,
      label: angleLabel(angleId),
      spend: aggregate.spend,
      impressions: aggregate.impressions,
      results: aggregate.results,
      samples: aggregate.samples,
      costPerResult,
      ctr,
      // Placeholder verdict — decided against the whole field below, so "winning" means best of what ran
      // rather than "crossed a number I picked in advance".
      verdict: judged ? 'promising' : 'too_early',
      reason: judged
        ? 'Judged on enough delivery to mean something.'
        : `Only ${Math.round(aggregate.impressions)} impressions on ${aggregate.spend.toFixed(0)} ${currency}, below the ` +
          `${minImpressions} / ${minSpend} bar. Too early to call.`,
    });
  }

  const judgedAngles = angles.filter((angle) => angle.verdict !== 'too_early');
  const withResults = judgedAngles.filter((angle) => angle.costPerResult !== null);
  const best = withResults.length ? Math.min(...withResults.map((angle) => angle.costPerResult as number)) : null;

  for (const angle of judgedAngles) {
    if (angle.results === 0) {
      angle.verdict = 'losing';
      angle.reason =
        `Spent ${angle.spend.toFixed(0)} ${currency} across ${angle.samples} ad(s) and produced no results at all ` +
        `on ${Math.round(angle.impressions)} impressions. That is decisive, not noise.`;
      continue;
    }
    if (best !== null && angle.costPerResult !== null && angle.costPerResult <= best * 1.15) {
      angle.verdict = 'winning';
      angle.reason =
        `Cost per result ${angle.costPerResult.toFixed(0)} ${currency} — the best (or within 15% of the best) of ` +
        `everything that ran, on ${angle.results} result(s).`;
      continue;
    }
    if (best !== null && angle.costPerResult !== null && angle.costPerResult > best * 1.5) {
      angle.verdict = 'losing';
      angle.reason =
        `Cost per result ${angle.costPerResult.toFixed(0)} ${currency}, more than 1.5x the best angle's ` +
        `${best.toFixed(0)}. Same audience, same budget, worse answer.`;
      continue;
    }
    angle.verdict = 'promising';
    angle.reason =
      `Cost per result ${angle.costPerResult === null ? 'unknown' : angle.costPerResult.toFixed(0)} ${currency} — ` +
      'mid-field. Worth one more test before a verdict.';
  }

  // Stable order: winners cheapest-first, then promising, then losing, then too early.
  const rank: Record<AngleVerdict, number> = { winning: 0, promising: 1, losing: 2, too_early: 3 };
  angles.sort((a, b) => {
    if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
    const ac = a.costPerResult ?? Number.POSITIVE_INFINITY;
    const bc = b.costPerResult ?? Number.POSITIVE_INFINITY;
    if (ac !== bc) return ac - bc;
    return a.angleId.localeCompare(b.angleId);
  });

  const winners = angles.filter((angle) => angle.verdict === 'winning').map((angle) => angle.angleId);
  const losers = angles.filter((angle) => angle.verdict === 'losing').map((angle) => angle.angleId);
  const tooEarly = angles.filter((angle) => angle.verdict === 'too_early').map((angle) => angle.angleId);

  return {
    period,
    currency,
    observed: (observations || []).length,
    unattributedRows: 0,
    unattributedSpend: 0,
    angles,
    winners,
    losers,
    tooEarly,
    summary: describeLearnings({ period, currency, angles, winners, losers, tooEarly }),
  };
}

function describeLearnings(input: {
  period: string;
  currency: string;
  angles: AngleLearning[];
  winners: string[];
  losers: string[];
  tooEarly: string[];
}): string {
  if (!input.angles.length) {
    return (
      `Nothing to judge from ${input.period}: no launched creative carried an angle, so there is nothing to ` +
      'learn from yet. Nothing was changed.'
    );
  }
  const bits: string[] = [];
  if (input.winners.length) {
    const best = input.angles.find((angle) => angle.verdict === 'winning');
    bits.push(
      `Winning: ${input.winners.map(angleLabel).join(', ')}` +
        (best?.costPerResult != null ? ` (best ${best.costPerResult.toFixed(0)} ${input.currency} per result)` : ''),
    );
  }
  if (input.losers.length) bits.push(`Losing: ${input.losers.map(angleLabel).join(', ')}`);
  if (input.tooEarly.length) bits.push(`Too early to call: ${input.tooEarly.map(angleLabel).join(', ')}`);
  if (!input.winners.length && !input.losers.length) {
    bits.push('Every angle is still short of the impressions or spend needed for a verdict.');
  }
  return `${bits.join('. ')}.`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Feeding it forward
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface AngleGuidance {
  /** Angles worth making more of, best first. */
  prefer: { angleId: string; label: string; reason: string }[];
  /** Angles that already lost. These can be passed straight into the compiler's `avoid`. */
  avoid: { angleId: string; label: string; reason: string }[];
  /** What to tell the model about how much to trust this. */
  note: string;
}

/**
 * The learnings as an instruction for the next creative.
 *
 * ADVISORY, NOT BINDING — and that distinction is the whole safety story. `avoid` is shaped so it can be
 * handed to `composeAdCreative`, which filters angles, but it never overrides an owner's instruction: if
 * the owner asks for an angle that lost, the caller passes their wish through and this list is ignored.
 * A machine that quietly refuses to do what the person asked, because a number was unkind, is a bug.
 */
export function angleGuidance(learnings: CreativeLearnings | null | undefined): AngleGuidance {
  const empty: AngleGuidance = {
    prefer: [],
    avoid: [],
    note: 'No performance data to learn from yet, so choose the angle on the brief alone.',
  };
  if (!learnings || !learnings.angles?.length) return empty;

  const prefer = learnings.angles
    .filter((angle) => angle.verdict === 'winning')
    .map((angle) => ({ angleId: angle.angleId, label: angle.label, reason: angle.reason }));
  const avoid = learnings.angles
    .filter((angle) => angle.verdict === 'losing')
    .map((angle) => ({ angleId: angle.angleId, label: angle.label, reason: angle.reason }));

  if (!prefer.length && !avoid.length) {
    return {
      ...empty,
      note:
        `Nothing judged yet from ${learnings.period}. Keep exploring — and once an angle has ` +
        `${MIN_IMPRESSIONS_FOR_JUDGEMENT}+ impressions, it can be called.`,
    };
  }

  return {
    prefer,
    avoid,
    note:
      'These are measurements from this account, not preferences. Make more of what won and stop re-proposing ' +
      'what lost. The owner\'s explicit instruction still wins over any of it.',
  };
}

/** The learnings as brief lines, for the routine flow. Empty when there is nothing honest to say. */
export function learningsBriefLines(learnings: CreativeLearnings | null | undefined): string[] {
  if (!learnings || !learnings.angles?.length) return [];
  const lines: string[] = [`WHAT HAS ACTUALLY RUN (${learnings.period}) — ${learnings.summary}`];
  for (const angle of learnings.angles.slice(0, 6)) {
    const cost = angle.costPerResult === null ? 'no results' : `${angle.costPerResult.toFixed(0)} ${learnings.currency}/result`;
    lines.push(`  - ${angle.label} [${angle.verdict}] ${angle.spend.toFixed(0)} ${learnings.currency}, ${cost}: ${angle.reason}`);
  }
  if (learnings.unattributedRows) {
    lines.push(
      `  - ${learnings.unattributedRows} row(s) totalling ${learnings.unattributedSpend.toFixed(0)} ` +
        `${learnings.currency} could not be tied to an angle (launched before plans were recorded).`,
    );
  }
  if (learnings.winners.length) {
    lines.push(`  Make more like: ${learnings.winners.join(', ')}.`);
  }
  if (learnings.losers.length) {
    lines.push(`  Do not simply repeat: ${learnings.losers.join(', ')} — change the argument, not just the words.`);
  }
  if (!learnings.winners.length && !learnings.losers.length) {
    lines.push('  No angle has enough delivery to be called yet, so vary the angle rather than repeating one.');
  }
  return lines;
}
