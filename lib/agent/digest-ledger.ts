/**
 * CAN THIS DAY'S EMAIL SAY ANYTHING YET?
 *
 * WHY THIS FILE EXISTS
 * The owner received a "Today's wrap" that told them their daily marketing "did not run", on a day
 * the routine ledger was not in a state anyone could read. Two separate holes produced that:
 *
 *   1. `routine_runs` rows sat `queued` for ever because nothing wrote the harness run's outcome
 *      back (measured on production 2026-11-26: 79 of 80 rows over seven days were `queued` while
 *      every harness run behind them had already ended). A row that still says "waiting" is not
 *      evidence that the job ran, and it is not evidence that it did not.
 *   2. The findings engine treated `routines.ran === 0` — nothing queued at all — as proof of "it is
 *      a job that is switched off". That inference is only sound when the ledger is settled. Against
 *      an unsettled ledger, zero is a reading error, and the email asserted it as a fact about the
 *      owner's business.
 *
 * So the email is now gated on a verdict about the LEDGER, not on a number that cannot distinguish
 * "did not run" from "not recorded yet". The rule the owner set is the rule implemented here: an
 * email that describes a day should only go out once the day can actually be described.
 *
 * The arithmetic is pure and exported so `scripts/verify-digest-honesty.ts` can prove it with fakes:
 * no database, no model, no clock.
 */

/** What the routine ledger holds for one business for one day. */
export interface RoutineLedgerDay {
  /**
   * `routine_runs` rows for that business and that `period_key`. Usually 1 — one daily routine —
   * but a business with several routines, or a month of monthlies, is why this is a count.
   */
  rows: number;
  /** Rows still saying `queued` AFTER the settle sweep has had its turn. */
  queued: number;
  /** Rows that ended one way or the other: `completed` or `failed`. */
  settled: number;
}

export type LedgerVerdict =
  /** Nothing was ever queued for this day. "It did not run" is a fact about a job that never started. */
  | 'nothing-queued'
  /** Every row settled. The day can be described from the ledger. */
  | 'settled'
  /** Rows exist but some are still `queued`, so the day cannot be read yet. */
  | 'unreconciled'
  /** The stored rollup and the ledger disagree. One of them is stale; the ledger is the evidence. */
  | 'rollup-contradicts-ledger';

export interface LedgerDecision {
  verdict: LedgerVerdict;
  /**
   * May the report say "your daily marketing did not run"? False unless the ledger positively
   * supports it — never merely because a number came back zero.
   */
  canClaimNothingRan: boolean;
  /** Plain words the report may use about this day. No acronyms, no terms of art. */
  sentence: string;
  /** Should the evening wrap wait instead of describing a day it cannot read? */
  holdEod: boolean;
  /** Why it is being held. Recorded on the run row so the wait is visible, not silent. */
  holdReason?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a day's ledger supports, given also what the stored rollup says about it.
 *
 * `rollupRoutineRuns` is `ceo_daily_rollups.payload.routineRuns` for the same day, or null when no
 * rollup row exists (which is normal for today — the rollup summarises a finished day).
 */
export function routineLedgerVerdict(input: {
  ledger: RoutineLedgerDay;
  rollupRoutineRuns?: number | null;
  /** A human label for the day, so the sentence reads like a sentence. */
  dayLabel?: string;
}): LedgerDecision {
  const rows = Math.max(0, Math.floor(Number(input.ledger.rows) || 0));
  const queued = Math.max(0, Math.min(rows, Math.floor(Number(input.ledger.queued) || 0)));
  const settled = Math.max(0, Math.min(rows - queued, Math.floor(Number(input.ledger.settled) || 0)));
  const rollup =
    input.rollupRoutineRuns === null || input.rollupRoutineRuns === undefined
      ? null
      : Math.max(0, Math.floor(Number(input.rollupRoutineRuns) || 0));
  const day = input.dayLabel || 'that day';

  if (rows === 0) {
    // The only case where the old sentence was ever true: no job was queued at all.
    if (rollup !== null && rollup > 0) {
      return {
        verdict: 'rollup-contradicts-ledger',
        canClaimNothingRan: false,
        sentence:
          `The stored summary of ${day} says ${plural(rollup, 'daily job', 'daily jobs')} ran, ` +
          `while the job ledger holds none. The summary is stale — I am reading the ledger, not it.`,
        holdEod: false,
      };
    }
    return {
      verdict: 'nothing-queued',
      canClaimNothingRan: true,
      sentence: `No daily job was queued for ${day}.`,
      holdEod: false,
    };
  }

  if (queued > 0) {
    const reason =
      `${plural(queued, 'daily job', 'daily jobs')} of ${rows} for ${day} still say they are waiting ` +
      'and nothing has settled them yet';
    return {
      verdict: 'unreconciled',
      canClaimNothingRan: false,
      sentence:
        `${reason}, so I cannot tell you what went out on ${day}. I settle these automatically and ` +
        'this report will follow once the day is readable.',
      holdEod: true,
      holdReason: reason,
    };
  }

  if (rollup !== null && rollup === 0) {
    return {
      verdict: 'rollup-contradicts-ledger',
      canClaimNothingRan: false,
      sentence:
        `The stored summary of ${day} says nothing ran, while the job ledger holds ` +
        `${plural(rows, 'run', 'runs')}. The summary is stale — the ledger is the evidence, and it ` +
        'is what this report is written from.',
      holdEod: false,
    };
  }

  return {
    verdict: 'settled',
    canClaimNothingRan: false,
    sentence: `${plural(rows, 'daily job', 'daily jobs')} for ${day} finished: ${settled} settled.`,
    holdEod: false,
  };
}

/**
 * Which day does an email describe?
 *
 * The morning email is a plan for today but its numbers are yesterday's, and the evening wrap
 * describes the day that is ending. Both are resolved from the business's own clock, because a
 * ledger keyed by `period_key` is keyed by the business's calendar day, not by UTC.
 */
export function digestReportedDay(slot: 'morning' | 'eod', now: Date): Date {
  return slot === 'eod' ? now : new Date(now.getTime() - 86_400_000);
}
