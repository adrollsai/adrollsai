/**
 * When should the app warn an owner that their plan is about to end?
 *
 * The dashboard already shows a banner once a plan HAS ended, and redirects to billing. What it never
 * did was warn beforehand: an owner found out when a campaign stopped or the caller ID went into its
 * grace period. §3.7 calls these "plan-validity popups".
 *
 * PURE on purpose. Every real bug in this area is a boundary bug — a plan expiring "today" reading as
 * still fine because of a timezone offset, or a date in the past producing a friendly "5 days left".
 * A pure function with `now` passed in can be tested at every boundary, which a component that calls
 * `new Date()` inside itself cannot.
 *
 * The rules:
 *   - No usable `validUntil`  -> no notice. Never invent an expiry, and never warn a plan that is
 *                                simply not date-bounded (many accounts have no date at all).
 *   - Already expired         -> 'expired'.
 *   - Ends within 3 days      -> 'critical', including "today".
 *   - Ends within 7 days      -> 'warning'.
 *   - Further out             -> null. A notice eight days early is noise, and noise gets dismissed,
 *                                which is how the notice that mattered gets dismissed too.
 */

export type PlanNoticeLevel = 'expired' | 'critical' | 'warning';

export interface PlanNotice {
  level: PlanNoticeLevel;
  /** Whole days until the plan ends. 0 means "today"; negative means it has already ended. */
  daysLeft: number;
  /** One sentence, in the owner's terms. No marketing, no exclamation marks. */
  message: string;
  actionLabel: string;
  /** The date the plan ends, as an ISO string, so a caller can format it in its own locale. */
  validUntil: string;
}

export interface PlanValidityInput {
  /** `profiles.subscription_status`, any case, may be null. */
  status?: string | null;
  /** `profiles.subscription_valid_until`, an ISO timestamp or date, may be null. */
  validUntil?: string | null;
  /** Passed in, never read from the clock: that is what makes this testable. */
  now: Date;
  /** Warn this many days ahead. Defaults to 7, with 3 being the critical window. */
  warnDays?: number;
  criticalDays?: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days remaining, floored: "at least this many days are left".
 *
 * It was rounded UP first, which reported a plan ending in five hours as "1 day left" — so an owner
 * whose plan died the same afternoon was told they had a day, and the "ends today" message could
 * never fire at all. Flooring gives: five hours -> 0 (today), exactly 24h -> 1, 47h -> 1, 48h -> 2.
 */
function daysUntil(until: Date, now: Date): number {
  return Math.floor((until.getTime() - now.getTime()) / MS_PER_DAY);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function planValidityNotice(input: PlanValidityInput): PlanNotice | null {
  const status = String(input.status ?? '').toLowerCase().trim();
  const raw = String(input.validUntil ?? '').trim();
  const warnDays = Number.isFinite(input.warnDays) ? Number(input.warnDays) : 7;
  const criticalDays = Number.isFinite(input.criticalDays) ? Number(input.criticalDays) : 3;

  // An explicit "expired" status outranks the date: billing may have marked it before the date
  // arrived, and telling the owner "5 days left" on an account already cut off would be worse than
  // saying nothing.
  if (status === 'expired') {
    return {
      level: 'expired',
      daysLeft: -1,
      message: 'Your plan has ended. Recharge to restart campaigns and keep your caller ID.',
      actionLabel: 'Recharge now',
      validUntil: raw || '',
    };
  }

  if (!raw) return null;

  const until = new Date(raw);
  if (Number.isNaN(until.getTime())) return null; // a broken date is not an expiry date

  const daysLeft = daysUntil(until, input.now);

  if (daysLeft < 0) {
    return {
      level: 'expired',
      daysLeft,
      message: 'Your plan has ended. Recharge to restart campaigns and keep your caller ID.',
      actionLabel: 'Recharge now',
      validUntil: until.toISOString(),
    };
  }

  if (daysLeft === 0) {
    return {
      level: 'critical',
      daysLeft,
      message: 'Your plan ends today. Recharge to keep campaigns and your caller ID running.',
      actionLabel: 'Recharge now',
      validUntil: until.toISOString(),
    };
  }

  if (daysLeft <= criticalDays) {
    return {
      level: 'critical',
      daysLeft,
      message:
        `Your plan ends in ${daysLeft} ${plural(daysLeft, 'day', 'days')}. ` +
        'Recharge to keep campaigns and your caller ID running.',
      actionLabel: 'Recharge now',
      validUntil: until.toISOString(),
    };
  }

  if (daysLeft <= warnDays) {
    return {
      level: 'warning',
      daysLeft,
      message:
        `Your plan ends in ${daysLeft} ${plural(daysLeft, 'day', 'days')}. ` +
        'You can recharge any time before then.',
      actionLabel: 'View plans',
      validUntil: until.toISOString(),
    };
  }

  return null;
}
