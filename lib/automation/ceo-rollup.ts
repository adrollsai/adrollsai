/**
 * Bounded history for the CEO tab.
 *
 * WHY THIS EXISTS
 * The tab used to read raw routine_runs / agent_events, which grow forever. That degrades the query,
 * and — the real risk — anything that later fed history into an agent prompt would grow the context
 * until the model got worse. One summary row per tenant per day is bounded by construction: 365 rows a
 * year per tenant whatever the activity level.
 *
 * The pure parts live here so the windowing and the summarising can be tested without a database.
 */

/** How far back the CEO tab may look. Anything older reads from rollups, never from raw events. */
export const CEO_WINDOW_DAYS = 30;

/** Hard cap on rows a single tab render may pull, so a 30-day window cannot become 30,000 rows. */
export const CEO_MAX_ROWS = 120;

/** `YYYY-MM-DD` in a specific timezone — the rollup key, and the same shape periodKey uses. */
export function rollupDay(now: Date, timezone = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // A bad timezone must not lose the rollup; fall back to UTC rather than throw mid-cron.
    return now.toISOString().slice(0, 10);
  }
}

/** The oldest day a 30-day window may include, as `YYYY-MM-DD`. */
export function windowStartDay(now: Date, days = CEO_WINDOW_DAYS, timezone = 'Asia/Kolkata'): string {
  const bounded = Math.max(1, Math.min(CEO_WINDOW_DAYS, Math.floor(Number(days) || CEO_WINDOW_DAYS)));
  return rollupDay(new Date(now.getTime() - bounded * 86_400_000), timezone);
}

export interface RawDayCounts {
  agentEvents: number;
  routineRuns: number;
  failedRuns: number;
  artifacts: number;
  creditsSpent: number;
}

export interface DayRollupPayload {
  schema: 1;
  day: string;
  agentEvents: number;
  routineRuns: number;
  failedRuns: number;
  artifacts: number;
  creditsSpent: number;
  /** One plain sentence, so the tab can show history without re-deriving prose from numbers. */
  headline: string;
}

/**
 * Summarise one day. PURE.
 *
 * Deliberately a COUNT summary rather than a copy of every event: the point of the rollup is that it
 * stays small. `artifacts` and `creditsSpent` are carried because those are the two numbers an owner
 * actually asks about later ("what did last Tuesday cost me?").
 */
export function buildDayRollup(day: string, counts: RawDayCounts): DayRollupPayload {
  const safe = (n: unknown) => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  };
  const agentEvents = safe(counts.agentEvents);
  const routineRuns = safe(counts.routineRuns);
  const failedRuns = Math.min(safe(counts.failedRuns), routineRuns || safe(counts.failedRuns));
  const artifacts = safe(counts.artifacts);
  const creditsSpent = safe(counts.creditsSpent);

  const bits: string[] = [];
  if (routineRuns > 0) bits.push(`${routineRuns} routine run${routineRuns === 1 ? '' : 's'}`);
  if (artifacts > 0) bits.push(`${artifacts} artefact${artifacts === 1 ? '' : 's'}`);
  if (creditsSpent > 0) bits.push(`${creditsSpent} credits`);
  if (failedRuns > 0) bits.push(`${failedRuns} failed`);

  const headline = bits.length ? bits.join(' · ') : 'Nothing ran.';

  return {
    schema: 1,
    day,
    agentEvents,
    routineRuns,
    failedRuns,
    artifacts,
    creditsSpent,
    headline,
  };
}
