/**
 * WHEN a routine actually runs.
 *
 * THE BUG THIS FIXES
 * `nextRunAfter()` decided the next slot by adding days to *now*:
 *
 *     const next = new Date(now); next.setUTCDate(next.getUTCDate() + stepDays);
 *
 * It never read `run_at_hour` and never read `timezone`. So a routine whose row says
 * "weekly at 18:00 Asia/Kolkata" fired at whatever clock time it happened to be created or last
 * bumped, and `run_at_hour` was decoration — a number the UI showed, the CEO tab accepted and the
 * agent would happily confirm, that the scheduler never looked at. That is worse than not offering
 * the control: the owner sets 6pm, is told 6pm, and the work appears at 11am.
 *
 * WHAT THIS DOES
 * Resolves the next occurrence at the routine's own wall-clock hour in its own timezone, stepping by
 * its cadence, correctly across DST (the offset is measured at the candidate instant, twice, rather
 * than assumed once).
 *
 * Pure: no database, no clock of its own, so the arithmetic is testable against fixed instants.
 */

export type ScheduleCadence = 'daily' | 'weekly' | 'monthly';

export interface ScheduleSpec {
  cadence?: ScheduleCadence | string | null;
  /** Wall-clock hour in the routine's timezone. 0-23. */
  run_at_hour?: number | string | null;
  /** IANA zone, e.g. Asia/Kolkata. */
  timezone?: string | null;
}

export const DEFAULT_RUN_HOUR = 7;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** Milliseconds that local time is ahead of UTC at a given instant (positive east of Greenwich). */
function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some engines report midnight as hour 24; normalise it.
  const hour = num('hour') % 24;
  const asUtc = Date.UTC(num('year'), num('month') - 1, num('day'), hour, num('minute'), num('second'));
  return asUtc - instant.getTime();
}

/** The calendar date `instant` falls on, in the routine's timezone. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: num('year'), month: num('month'), day: num('day') };
}

/** Add whole days to a calendar date without timezone drift. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Add whole months, letting the calendar roll a short month into the next one (31 Jan + 1 month = 2/3 Mar). */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1 + months, date.day));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The exact instant a wall-clock hour on a local date happens.
 *
 * The offset is measured at the candidate instant and applied again, because around a DST boundary
 * the offset at midnight is not the offset at 18:00. Two passes converge; the third is a safety net
 * for zones that move by 30 or 45 minutes.
 */
export function instantForLocalHour(date: LocalDate, hour: number, timeZone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0);
  let candidate = naive;
  for (let pass = 0; pass < 3; pass++) {
    const offset = timezoneOffsetMs(new Date(candidate), timeZone);
    const next = naive - offset;
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

/**
 * The next time this routine should run, strictly after `now`.
 *
 * A slot that is exactly now is treated as gone — the run for that period already exists — which is
 * what keeps this consistent with the (routine_id, period_key) idempotency key.
 */
export function nextRunAt(now: Date, spec: ScheduleSpec): Date {
  const timeZone = String(spec.timezone || DEFAULT_TIMEZONE);
  const rawHour = Number(spec.run_at_hour ?? DEFAULT_RUN_HOUR);
  const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, Math.trunc(rawHour))) : DEFAULT_RUN_HOUR;
  const cadence = String(spec.cadence || 'daily') as ScheduleCadence;

  const today = localDateOf(now, timeZone);
  const horizon = cadence === 'monthly' ? 24 : 40;

  for (let step = 0; step < horizon; step++) {
    const date =
      cadence === 'monthly'
        ? addMonths(today, step)
        : addDays(today, step * (cadence === 'weekly' ? 7 : 1));
    const candidate = instantForLocalHour(date, hour, timeZone);
    if (candidate.getTime() > now.getTime()) return candidate;
  }

  // Unreachable for sane input; never return a past instant.
  return new Date(now.getTime() + 86_400_000);
}

/** One line for the agent to show, e.g. "weekly at 18:00 Asia/Kolkata, next 2026-11-22 18:00 IST". */
export function describeSchedule(spec: ScheduleSpec, next: Date): string {
  const timeZone = String(spec.timezone || DEFAULT_TIMEZONE);
  const hour = Math.min(23, Math.max(0, Math.trunc(Number(spec.run_at_hour ?? DEFAULT_RUN_HOUR))));
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(next);
  return `${spec.cadence || 'daily'} at ${String(hour).padStart(2, '0')}:00 ${timeZone}, next ${when}`;
}
