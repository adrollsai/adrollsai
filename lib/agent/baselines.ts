/**
 * This business's own normal — so an insight can say "compared to what?".
 *
 * THE PROBLEM WITH A THRESHOLD
 * The engine's rules fire on fixed numbers: cost per enquiry above ₹500, connect rate below 40%. Those numbers
 * were chosen by us, for nobody in particular. For a business whose enquiries cost ₹200, ₹500 is a disaster
 * that never triggers; for one whose enquiries cost ₹2,000, it fires every single day until the owner stops
 * reading. A threshold cannot know what normal is for this business, and an analyst who does not know that is
 * just a traffic light.
 *
 * WHAT A BASELINE IS HERE
 * The median of the last N weeks of the SAME metric, computed from the figures we already own. Median, not
 * mean: one Diwali week with three times the volume should not raise the bar so high that a good week looks
 * bad, and one dead week should not lower it. Pure and recomputed from source on every read — same reasoning
 * as `creative-learning.ts`: no table to drift, no cache to lose, two runs on the same data agree exactly.
 *
 * What it deliberately does NOT do: decide whether a number is good. It answers "what does this business
 * normally do", and the comparison is stated as a multiple ("2.1× your usual") so the reader judges.
 */
import type { MetricsReader } from './ceo-metrics';

const DAY = 24 * 60 * 60 * 1000;

/** Median of a list, ignoring values that are not finite numbers. Null when nothing is measurable. */
export function median(values: readonly (number | null | undefined)[]): number | null {
  const clean = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A window covering one week, `weeksAgo` weeks before `now`, in plain UTC boundaries. */
export function weekWindowBack(now: Date, weeksAgo: number): {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  labelFrom: string;
  labelTo: string;
} {
  const to = new Date(now.getTime() - weeksAgo * 7 * DAY);
  const from = new Date(to.getTime() - 7 * DAY);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    previousFrom: new Date(from.getTime() - 7 * DAY).toISOString(),
    previousTo: from.toISOString(),
    labelFrom: fmt(from),
    labelTo: fmt(new Date(to.getTime() - 1)),
  };
}

export interface WeeklySample {
  week: string;
  enquiries: number;
  enquiriesFromAds: number | null;
  costPerEnquiryPaise: number | null;
  contentPublished: number;
  callsAnswered: number;
  callsPlaced: number;
}

export interface Baselines {
  weeks: WeeklySample[];
  enquiriesPerWeek: number | null;
  costPerEnquiryPaise: number | null;
  contentPerWeek: number | null;
  callAnswerRate: number | null;
  /** How many weeks contributed. A median of two weeks is a rumour, and the caller is told so. */
  sampleWeeks: number;
}

const round = (value: number | null): number | null => (value === null ? null : Math.round(value * 100) / 100);

/**
 * Gather `weeks` completed weeks and take the median of each metric.
 *
 * Ad figures are a single live 7-day read (Meta does not hand us history per week here), so they are used for
 * the CURRENT week only and excluded from the historical median rather than being repeated seven times and
 * pretending to be seven observations.
 */
export async function computeBaselines(
  reader: MetricsReader,
  now: Date = new Date(),
  weeks = 8
): Promise<Baselines> {
  const samples: WeeklySample[] = [];
  for (let back = 1; back <= weeks; back += 1) {
    const window = weekWindowBack(now, back);
    try {
      const [leads, posts, calls] = await Promise.all([
        reader.leadsInWindow(window as any),
        reader.postsInWindow(window as any),
        reader.callsInWindow(window as any),
      ]);
      samples.push({
        week: window.labelFrom,
        enquiries: leads.created,
        enquiriesFromAds: null,
        costPerEnquiryPaise: null,
        contentPublished: posts.published,
        callsAnswered: calls.connected,
        callsPlaced: calls.placed,
      });
    } catch {
      // A week we cannot read is a week we do not average. Silence beats an invented zero.
    }
  }

  const answerRates = samples
    .filter((s) => s.callsPlaced > 0)
    .map((s) => s.callsAnswered / s.callsPlaced);

  return {
    weeks: samples,
    enquiriesPerWeek: round(median(samples.map((s) => s.enquiries))),
    costPerEnquiryPaise: null, // filled by the caller from its live ad read, when it has one
    contentPerWeek: round(median(samples.map((s) => s.contentPublished))),
    callAnswerRate: answerRates.length ? round(median(answerRates)) : null,
    sampleWeeks: samples.length,
  };
}

/** "2.1× your usual" / "in line with your usual" / "below your usual" — never a bare number. */
export function compareToBaseline(current: number | null | undefined, baseline: number | null | undefined, noun = ''): string | null {
  if (typeof current !== 'number' || typeof baseline !== 'number' || !Number.isFinite(current) || !Number.isFinite(baseline)) {
    return null;
  }
  if (baseline <= 0) return null;
  const ratio = current / baseline;
  const suffix = noun ? ` ${noun}` : '';
  if (ratio >= 1.85) return `${ratio.toFixed(1)}× your usual${suffix}`;
  if (ratio >= 1.15) return `above your usual${suffix}`;
  if (ratio <= 0.55) return `about ${ratio.toFixed(1)}× your usual${suffix}`;
  if (ratio <= 0.85) return `below your usual${suffix}`;
  return `in line with your usual${suffix}`;
}

/**
 * One sentence the analyst brief can carry.
 *
 * States the baseline, the sample size and — when the sample is thin — that it is thin. "Against your usual
 * 12 a week (median of 8 weeks)" is a real comparison; "against your usual 12 a week" from two weeks of data
 * is a coincidence wearing a suit.
 */
export function describeBaselines(baselines: Baselines): string | null {
  const bits: string[] = [];
  if (baselines.enquiriesPerWeek !== null) bits.push(`${baselines.enquiriesPerWeek} enquiries a week`);
  if (baselines.contentPerWeek !== null) bits.push(`${baselines.contentPerWeek} pieces of content a week`);
  if (baselines.callAnswerRate !== null) bits.push(`${Math.round(baselines.callAnswerRate * 100)} in 100 calls answered`);
  if (!bits.length) return null;
  const thin = baselines.sampleWeeks < 4 ? ` (only ${baselines.sampleWeeks} week(s) of history, so treat this as provisional)` : ` (median of ${baselines.sampleWeeks} weeks)`;
  return `This business's own normal: ${bits.join(', ')}${thin}.`;
}
