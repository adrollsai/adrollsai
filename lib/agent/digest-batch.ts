/**
 * Who gets a CEO email on this run, and which email.
 *
 * WHY THIS EXISTS
 * The digest cron used to take a `slot` from the URL and loop over every enabled routine in one
 * invocation. That was fine for twelve businesses. With the CEO switched on for the whole platform
 * it is not: each business costs a Meta read, a findings pass and an email send (measured at 3-5
 * seconds), so 79 businesses exceed the route's 300-second ceiling and the loop is killed part-way.
 * The failure is silent in the worst way — the businesses early in the table get their email and
 * the rest never do, with no error the owner can see.
 *
 * So the work is sliced: each invocation decides per business whether it is inside that business's
 * own send window, skips the ones already sent, and sends at most `limit`. The cron runs every
 * fifteen minutes, and `routine_runs.digest` records which slot went out for which period, so
 * repeated invocations sweep the whole platform without ever mailing anyone twice.
 *
 * Windows are in the business's OWN timezone, not the server's: an owner in Dubai should not get
 * their morning plan at 4am because the cron runs in UTC.
 *
 * Pure on purpose — no database, no clock of its own — so the gate can drive it with a fake `now`
 * and prove the edge cases instead of trusting them.
 */

import { DEFAULT_TIMEZONE } from './routine-schedule';

export type DigestSlot = 'morning' | 'eod';

/** The morning plan goes out between 06:00 and 11:59 local time. */
export const MORNING_FROM_HOUR = 6;
export const MORNING_UNTIL_HOUR = 12;
/** The evening wrap goes out from 17:00 local time to midnight. */
export const EOD_FROM_HOUR = 17;

/** The hour of the day (0-23) in the given timezone. */
export function localHour(now: Date, timezone?: string | null): number {
  const tz = String(timezone || DEFAULT_TIMEZONE);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    return Number.isFinite(hour) ? hour : 0;
  } catch {
    // An unknown timezone must not silently mail at the wrong hour, but it also must not throw:
    // fall back to the product's default and let the window decide.
    return localHour(now, DEFAULT_TIMEZONE);
  }
}

/**
 * Which email this business is owed right now — or none, because it is the middle of its night.
 *
 * Returning null is the important half: the cron runs every fifteen minutes around the clock, and
 * "no window" must mean "send nothing", not "send the morning plan at 2am".
 */
export function digestSlotFor(now: Date, timezone?: string | null): DigestSlot | null {
  const hour = localHour(now, timezone);
  if (hour >= MORNING_FROM_HOUR && hour < MORNING_UNTIL_HOUR) return 'morning';
  if (hour >= EOD_FROM_HOUR) return 'eod';
  return null;
}

export interface DigestCandidate {
  user_id: string;
  timezone?: string | null;
}

export interface DigestPlan<T> {
  /** What to send on this invocation, in order. */
  due: Array<{ routine: T; slot: DigestSlot }>;
  /** Businesses that are outside their send window right now. */
  outsideWindow: number;
  /** Businesses already mailed for this slot and period. */
  alreadySent: number;
  /** Eligible, but over this invocation's limit — the next run picks them up. */
  deferred: number;
}

/**
 * Choose this invocation's sends.
 *
 * `isSent` is a callback rather than a data structure because the answer lives per business and
 * per period, and the caller already has that map; anything this function cannot see, it cannot
 * get wrong.
 */
export function planDigestSends<T extends DigestCandidate>(
  routines: T[],
  opts: {
    now: Date;
    /** Force a slot (manual send, or the old `?slot=` contract). Null/undefined derives it. */
    forcedSlot?: DigestSlot | null;
    isSent: (routine: T, slot: DigestSlot) => boolean;
    limit: number;
  }
): DigestPlan<T> {
  const limit = Math.max(1, Math.trunc(Number(opts.limit) || 1));
  const plan: DigestPlan<T> = { due: [], outsideWindow: 0, alreadySent: 0, deferred: 0 };

  for (const routine of routines) {
    const slot = opts.forcedSlot ?? digestSlotFor(opts.now, routine.timezone);
    if (!slot) {
      plan.outsideWindow++;
      continue;
    }
    if (opts.isSent(routine, slot)) {
      plan.alreadySent++;
      continue;
    }
    if (plan.due.length >= limit) {
      plan.deferred++;
      continue;
    }
    plan.due.push({ routine, slot });
  }

  return plan;
}
