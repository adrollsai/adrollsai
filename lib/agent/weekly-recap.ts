/**
 * Last week, in one sentence the owner could have said himself.
 *
 * THE SLOT NOBODY FILLED
 * `routine-composer` has rendered `- last week's conclusion: …` into every daily brief since it
 * was written, and `routines.ts` declared the field. Nothing ever passed it. So the single line
 * that would let the business improve *day over day* — "what did last week teach us" — was
 * always absent, and every morning started from zero. A daily job with no memory is not a
 * manager; it is a printing press.
 *
 * WHY IT IS COMPUTED, NOT REMEMBERED
 * Same reasoning as `creative-learning.ts`: there is no conclusions table and no cache. The
 * conclusion is a pure function of numbers we already own, so two runs on the same week agree
 * exactly, a corrupt store cannot invent a lesson, and nothing has to be migrated or backfilled.
 * It also cannot flatter: if the week was bad, the arithmetic says so.
 *
 * WHAT "IMPROVEMENT" MEANS HERE
 * Week against the week before, on the four things a business owner actually feels: how many
 * enquiries came in, what each one cost in ad money, how many calls were answered, and how many
 * pieces of content went out. That is the definition used everywhere in this file, and the
 * scorecard script measures the same four so the claim can be checked rather than asserted.
 */
import type { MetricsReader, MetricsWindow } from './ceo-metrics';

export interface WeekRecap {
  /** Window labels for the week being described, e.g. "17–23 Nov". */
  label: string;
  leads: { now: number; before: number };
  /** Ad money and what it bought, for the last 7 days. */
  ads: { spendPaise: number; measured: boolean; enquiries: number; costPerEnquiryPaise: number | null; beforeCostPaise: number | null };
  calls: { placed: number; answered: number };
  whatsapp: { sent: number; replied: number };
  content: { published: number };
  booked: number;
  /** Figures that could not be read, named so the caller never presents them as zero. */
  missing: string[];
  /** The paragraph. Plain language, no jargon, no percentages. */
  text: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** The last 7 days, and the 7 before those, in the business's own timezone. */
export function weekWindow(now: Date, timezone = 'Asia/Kolkata'): MetricsWindow {
  const startOfToday = startOfDayIn(now, timezone);
  const from = new Date(startOfToday.getTime() - 7 * DAY);
  const to = startOfToday;
  const label = (date: Date) =>
    new Intl.DateTimeFormat('en-IN', { timeZone: timezone, day: 'numeric', month: 'short' }).format(date);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    previousFrom: new Date(from.getTime() - 7 * DAY).toISOString(),
    previousTo: from.toISOString(),
    labelFrom: label(from),
    labelTo: label(new Date(to.getTime() - 1)),
  };
}

/** Midnight in the business's timezone, as an instant. */
function startOfDayIn(at: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const naive = Date.UTC(num('year'), num('month') - 1, num('day'), 0, 0, 0);
  // Measure the offset at that instant and re-apply, so a DST week does not shift the window.
  let candidate = naive;
  for (let pass = 0; pass < 3; pass += 1) {
    const offsetParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(candidate));
    const get = (type: string) => Number(offsetParts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    const next = candidate - (asUtc - candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(Math.min(candidate, naive));
}

export const rupeesPlain = (paise: number | null | undefined): string =>
  `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;

/** "12" / "12, up from 8" — comparison only when there is a real number to compare to. */
function withTrend(now: number, before: number | null | undefined): string {
  if (before === null || before === undefined) return `${now}`;
  if (now === before) return `${now}, same as the week before`;
  const direction = now > before ? 'up from' : 'down from';
  return `${now}, ${direction} ${before}`;
}

/** A price comparison in words, or null when there is nothing honest to compare. */
function costTrend(nowPaise: number | null, beforePaise: number | null): string | null {
  if (nowPaise === null) return null;
  if (beforePaise === null) return `${rupeesPlain(nowPaise)} each`;
  if (Math.abs(nowPaise - beforePaise) < 100) return `about the same as the week before (${rupeesPlain(beforePaise)} each)`;
  return nowPaise < beforePaise
    ? `${rupeesPlain(nowPaise)} each, down from ${rupeesPlain(beforePaise)} — cheaper than the week before`
    : `${rupeesPlain(nowPaise)} each, up from ${rupeesPlain(beforePaise)} — dearer than the week before`;
}

/**
 * Gather last week and describe it.
 *
 * Never throws: each section that fails is named in `missing` and left out of the sentence, so a
 * half-readable week produces a shorter true sentence rather than a longer false one.
 */
export async function weekRecap(
  reader: MetricsReader,
  now = new Date(),
  timezone = 'Asia/Kolkata',
): Promise<WeekRecap> {
  const window = weekWindow(now, timezone);
  const missing: string[] = [];

  const grab = async <T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch {
      missing.push(name);
      return fallback;
    }
  };

  const [leads, ads, calls, whatsapp, content] = await Promise.all([
    grab('enquiries', () => reader.leadsInWindow(window), {
      created: 0,
      contacted: 0,
      replied: 0,
      booked: 0,
      lost: 0,
      previousCreated: 0,
    }),
    grab('ad money', () => reader.ads(), {
      active: 0,
      spendPaise: null as number | null,
      leads: null as number | null,
      previousCplPaise: null as number | null,
    }),
    grab('calls', () => reader.callsInWindow(window), { placed: 0, connected: 0, averageSeconds: 0 }),
    grab('messages', () => reader.whatsappInWindow(window), { sent: 0, replied: 0 }),
    grab('content', () => reader.postsInWindow(window), { published: 0, created: 0 }),
  ]);

  const adMeasured = ads.spendPaise !== null;
  const spendPaise = ads.spendPaise ?? 0;
  const adEnquiries = ads.leads ?? 0;
  const costPerEnquiryPaise = adMeasured && adEnquiries > 0 ? Math.round(spendPaise / adEnquiries) : null;
  if (!adMeasured) missing.push('ad money');

  const parts: string[] = [];
  parts.push(
    `Last week (${window.labelFrom} to ${window.labelTo}): ${withTrend(leads.created, leads.previousCreated)} new enquiries.`,
  );

  if (adMeasured && spendPaise > 0) {
    const trend = costTrend(costPerEnquiryPaise, ads.previousCplPaise ?? null);
    parts.push(
      adEnquiries > 0
        ? `Ads cost ${rupeesPlain(spendPaise)} and brought ${adEnquiries} of those enquiries — ${trend}.`
        : `Ads cost ${rupeesPlain(spendPaise)} and brought no enquiries at all.`,
    );
  } else if (!adMeasured) {
    parts.push('What the ads cost and brought could not be read, so those figures are unknown, not zero.');
  }

  if (leads.booked > 0) parts.push(`${leads.booked} of the enquiries turned into a booking.`);
  if (calls.placed > 0) parts.push(`We made ${calls.placed} calls and ${calls.connected} were answered.`);
  if (whatsapp.sent > 0) parts.push(`${whatsapp.sent} messages went out and ${whatsapp.replied} came back.`);
  parts.push(
    content.published > 0
      ? `${content.published} piece(s) of content went live.`
      : 'Nothing was published.',
  );

  return {
    label: `${window.labelFrom} to ${window.labelTo}`,
    leads: { now: leads.created, before: leads.previousCreated },
    ads: {
      spendPaise,
      measured: adMeasured,
      enquiries: adEnquiries,
      costPerEnquiryPaise,
      beforeCostPaise: ads.previousCplPaise ?? null,
    },
    calls: { placed: calls.placed, answered: calls.connected },
    whatsapp: { sent: whatsapp.sent, replied: whatsapp.replied },
    content: { published: content.published },
    booked: leads.booked,
    missing: [...new Set(missing)],
    text: parts.join(' '),
  };
}
