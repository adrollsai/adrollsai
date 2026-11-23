/**
 * What stage of learning is this ad set actually in?
 *
 * WHY THIS EXISTS
 * Meta reports `learning_stage_info` per ad set: `IN_LEARNING`, `SUCCESS`, or
 * `LEARNING_LIMITED` (when edits, small budgets or few conversions keep resetting it).
 * The dashboard never read it, so the only number anyone optimised against was a
 * conversion count that had not yet stabilised — the classic way to pause a winning ad
 * set because it had produced "only" two leads in its first eight hours.
 *
 * This module is pure: Meta's rows in, a per-campaign verdict plus one sentence of
 * advice out. The route that calls it only does the Graph read.
 */

/** Meta's own values for `learning_stage_info.status`. */
export type LearningStatus = 'IN_LEARNING' | 'SUCCESS' | 'LEARNING_LIMITED' | 'UNKNOWN';

export interface LearningStageRow {
  id: string;
  name?: string;
  /** `learning_stage_info: { status, conversions, last_sig_edit_ts }` */
  learning_stage_info?: {
    status?: string;
    conversions?: number;
    last_sig_edit_ts?: number;
  } | null;
  effective_status?: string;
}

export interface LearningSummary {
  status: LearningStatus;
  /** Meta's own count of conversions still needed to leave learning, when reported. */
  conversions?: number;
  /** True when this ad set has NOT stabilised, so performance numbers are provisional. */
  provisional: boolean;
  /** One line an operator can act on. */
  advice: string;
}

const STATUSES: LearningStatus[] = ['IN_LEARNING', 'SUCCESS', 'LEARNING_LIMITED'];

export function normaliseStatus(raw: unknown): LearningStatus {
  const value = String(raw || '').toUpperCase().replace(/[\s-]+/g, '_');
  return STATUSES.includes(value as LearningStatus) ? (value as LearningStatus) : 'UNKNOWN';
}

/**
 * Judge one ad set.
 *
 * `provisional` is the important bit: while Meta is still learning, the cost per lead
 * on screen is an average over an unfinished sample, and cutting the budget or editing
 * the ad resets the clock. Saying that out loud is the whole point.
 */
export function summariseAdSet(row: LearningStageRow): LearningSummary {
  const info = row.learning_stage_info || {};
  const status = normaliseStatus(info.status);
  const conversions = typeof info.conversions === 'number' ? info.conversions : undefined;

  if (status === 'IN_LEARNING') {
    return {
      status,
      conversions,
      provisional: true,
      advice:
        'Meta is still learning this ad set, so its cost per result is not final yet. ' +
        'Changing the budget, the creative or the targeting restarts the learning phase — ' +
        'give it the full 50 events before judging it.',
    };
  }
  if (status === 'LEARNING_LIMITED') {
    return {
      status,
      conversions,
      provisional: true,
      advice:
        'This ad set is stuck in learning-limited: it is not getting enough conversions to ' +
        'stabilise, usually because the budget is small, the audience is narrow, or it has been ' +
        'edited too often. Widen the audience or raise the budget rather than editing it again.',
    };
  }
  if (status === 'SUCCESS') {
    return {
      status,
      conversions,
      provisional: false,
      advice: 'Learning is complete, so the numbers are stable and worth acting on.',
    };
  }
  return {
    status,
    conversions,
    provisional: true,
    advice:
      'Meta did not report a learning stage for this ad set (it can take a few hours after ' +
      'launch), so treat its numbers as provisional for now.',
  };
}

export interface CampaignLearning {
  campaignId?: string;
  adSets: Array<LearningSummary & { id: string; name: string; effectiveStatus?: string }>;
  /** The most cautious verdict across the campaign's ad sets. */
  campaign: LearningSummary;
  /** Counts, for a header line. */
  counts: { inLearning: number; learningLimited: number; success: number; unknown: number };
}

/**
 * Roll the ad sets up into one campaign verdict.
 *
 * Precedence is deliberately pessimistic: if any ad set is still learning, the campaign
 * as a whole is provisional, because the aggregate number the client sees includes it.
 */
export function summariseCampaign(rows: LearningStageRow[], campaignId?: string): CampaignLearning {
  const adSets = rows.map((row) => ({
    ...summariseAdSet(row),
    id: row.id,
    name: String(row.name || row.id),
    effectiveStatus: row.effective_status,
  }));

  const counts = {
    inLearning: adSets.filter((a) => a.status === 'IN_LEARNING').length,
    learningLimited: adSets.filter((a) => a.status === 'LEARNING_LIMITED').length,
    success: adSets.filter((a) => a.status === 'SUCCESS').length,
    unknown: adSets.filter((a) => a.status === 'UNKNOWN').length,
  };

  let campaign: LearningSummary;
  if (!adSets.length) {
    campaign = summariseAdSet({ id: 'none' });
  } else if (counts.inLearning > 0) {
    campaign = {
      status: 'IN_LEARNING',
      provisional: true,
      advice:
        `${counts.inLearning} of ${adSets.length} ad set(s) are still learning, so this campaign's ` +
        'cost per result is provisional. Do not judge it (or edit it) until learning finishes.',
    };
  } else if (counts.learningLimited > 0) {
    campaign = {
      status: 'LEARNING_LIMITED',
      provisional: true,
      advice:
        `${counts.learningLimited} of ${adSets.length} ad set(s) are learning-limited: not enough ` +
        'conversions to stabilise. Raise the budget or widen the audience instead of editing again.',
    };
  } else if (counts.success > 0) {
    campaign = {
      status: 'SUCCESS',
      provisional: false,
      advice: 'Every ad set has finished learning, so the numbers are stable.',
    };
  } else {
    campaign = summariseAdSet({ id: 'unknown' });
  }

  return { campaignId, adSets, campaign, counts };
}
