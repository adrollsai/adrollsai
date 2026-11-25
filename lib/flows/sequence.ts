/**
 * Sequences: when this happens, send that — now, then again later, or relative to an appointment.
 *
 * WHAT THIS ADDS TO THE EXISTING SCHEDULER
 * `lib/flows/scheduling.ts` already turns waits into absolute times on a durable ledger, and the
 * WhatsApp delivery layer already sends approved templates. What was missing was the vocabulary to
 * SAY the thing a business owner actually asks for:
 *
 *   "when a lead comes from this new campaign, send the intro template straight away, then the
 *    brochure template two days later"
 *   "when someone books, send the confirmation template 24 hours before the meeting, and a
 *    directions template 30 minutes before"
 *
 * So there are two kinds of timing here, and they are genuinely different:
 *
 *   delayMinutes       — relative to the trigger, or to the step before it ("2 days after").
 *   beforeEventMinutes — relative to the EVENT'S OWN time ("24 hours before the appointment").
 *
 * The second one is where naive implementations go wrong. If a meeting is booked for 10am tomorrow
 * and the sequence says "24 hours before", that moment has already passed. Firing it immediately
 * would send a reminder that says "your meeting is tomorrow" when it is in nine hours — worse than
 * silence, because the customer rearranges their day around it. So a step whose moment has passed is
 * DROPPED and reported, never fired late, and quiet hours are never allowed to push a reminder past
 * the meeting it is reminding them about.
 *
 * Pure: no database, no clock of its own, so the gate can prove the arithmetic instead of trusting it.
 */

import {
  DEFAULT_QUIET_HOURS,
  nextAllowedTime,
  scheduleFor,
  type PlannedAction,
  type QuietHours,
} from './scheduling';

/** What a sequence step does when its moment arrives. */
export type SequenceStepKind = 'template' | 'message' | 'call' | 'handoff';

export interface SequenceAction extends PlannedAction {
  /** Wait this long after the previous step (or after the trigger, for the first step). */
  delayMinutes?: number;
  /** This many minutes before the event's own time. Negative means after the event. */
  beforeEventMinutes?: number;
  /** Approved Meta template to send. Templates are the only way to reopen a closed 24h window. */
  templateName?: string | null;
}

export type SequenceDropReason =
  | 'no_event_time'
  | 'already_past_for_this_event'
  | 'quiet_hours_would_land_after_the_event';

export interface DroppedStep {
  /** Position in the sequence the owner wrote, so the message can point at the right step. */
  position: number;
  reason: SequenceDropReason;
  /** Plain language, for the owner or the agent, never a code. */
  message: string;
}

export interface PlannedTime {
  /** Which runnable action this is (waits are not actions). Indexes the non-wait actions in order. */
  stepIndex: number;
  runAt: Date;
  kind: 'message' | 'call' | 'handoff';
  /** True when the time came from the event, not the trigger — used only for reporting. */
  anchored: boolean;
}

export interface TimePlan {
  at: PlannedTime[];
  dropped: DroppedStep[];
  /** True when any step was timed against the event, so the caller knows the anchor was needed. */
  usedAnchor: boolean;
}

const MINUTE_MS = 60 * 1000;

/** Only steps that reach a customer are moved out of quiet hours. */
function reachesCustomer(kind: SequenceAction['kind']): boolean {
  return kind !== 'handoff';
}

/**
 * Turn a sequence into absolute times.
 *
 * `anchorAt` is the event's own moment — the appointment — and is only needed when some step is
 * timed against it.
 */
export function planTimes(
  actions: SequenceAction[],
  opts: { startAt: Date; anchorAt?: Date | null; quiet?: QuietHours }
): TimePlan {
  const quiet = opts.quiet ?? DEFAULT_QUIET_HOURS;
  const anchorAt = opts.anchorAt ?? null;
  const anchored = actions.some((action) => action.beforeEventMinutes != null);

  // No event-relative step: this is an ordinary "wait then send" flow, and the existing scheduler
  // already does that arithmetic. Delegating keeps every live flow byte-identical.
  if (!anchored) {
    const legacyActions: PlannedAction[] = [];
    for (const action of actions) {
      if (action.kind === 'wait') {
        const seconds = Number(action.seconds ?? 0);
        if (Number.isFinite(seconds) && seconds > 0) legacyActions.push({ kind: 'wait', seconds });
        continue;
      }
      const delay = Number(action.delayMinutes ?? 0);
      if (Number.isFinite(delay) && delay > 0) legacyActions.push({ kind: 'wait', seconds: delay * 60 });
      legacyActions.push({ kind: action.kind as PlannedAction['kind'] });
    }
    const rows = scheduleFor('plan', 'plan', legacyActions, opts.startAt, quiet, 'plan');
    return {
      at: rows.map((row) => ({ stepIndex: row.stepIndex, runAt: row.runAt, kind: row.kind, anchored: false })),
      dropped: [],
      usedAnchor: false,
    };
  }

  const at: PlannedTime[] = [];
  const dropped: DroppedStep[] = [];
  let cursor = new Date(opts.startAt);
  let stepIndex = 0;
  /** Position among the runnable actions, used only to point at the step the owner wrote. */
  let position = -1;

  for (const action of actions) {
    if (action.kind === 'wait') {
      // A stored delay node still advances the clock for the steps that follow it.
      const seconds = Number(action.seconds ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) cursor = new Date(cursor.getTime() + seconds * 1000);
      continue;
    }
    position++;

    const kind = action.kind as 'message' | 'call' | 'handoff';

    if (action.beforeEventMinutes != null) {
      if (!anchorAt) {
        dropped.push({
          position,
          reason: 'no_event_time',
          message:
            'this step is timed against an appointment, and this lead has no appointment time, ' +
            'so nothing was scheduled for it',
        });
        continue;
      }
      const wanted = new Date(anchorAt.getTime() - Number(action.beforeEventMinutes) * MINUTE_MS);
      if (wanted.getTime() < opts.startAt.getTime()) {
        // The moment this step was for has already gone by. Sending it now would tell the customer
        // something untrue about their own diary, so it is dropped and said out loud.
        dropped.push({
          position,
          reason: 'already_past_for_this_event',
          message:
            'this step was for a moment that has already passed before the sequence started, ' +
            'so it was skipped rather than sent late',
        });
        continue;
      }
      let runAt = wanted;
      if (reachesCustomer(action.kind)) {
        runAt = nextAllowedTime(runAt, quiet);
        if (runAt.getTime() > anchorAt.getTime()) {
          // Moving it out of quiet hours would land it after the meeting. A reminder that arrives
          // once the meeting is over is not a reminder.
          dropped.push({
            position,
            reason: 'quiet_hours_would_land_after_the_event',
            message:
              'this step fell in quiet hours and the next allowed hour is after the appointment, ' +
              'so it was skipped rather than sent when it would no longer be true',
          });
          continue;
        }
      }
      at.push({ stepIndex: stepIndex++, runAt, kind, anchored: true });
      continue;
    }

    const delay = Number(action.delayMinutes ?? 0);
    if (Number.isFinite(delay) && delay > 0) {
      cursor = new Date(cursor.getTime() + delay * MINUTE_MS);
    }
    const runAt = reachesCustomer(action.kind) ? nextAllowedTime(cursor, quiet) : new Date(cursor);
    at.push({ stepIndex: stepIndex++, runAt, kind, anchored: false });
    cursor = runAt;
  }

  // Execution order is chronological; identity stays with the step, so a later step timed against
  // the event can legitimately run before an earlier step that waits.
  at.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  return { at, dropped, usedAnchor: true };
}

/**
 * The action a planned step belongs to.
 *
 * `stepIndex` counts the runnable actions only, so indexing the RAW actions array with it lands on
 * a `wait` as soon as a sequence contains a delay — which is every sequence an owner writes. That
 * bug shipped silently: the step fired on time and sent an empty body.
 */
export function actionForStep<T extends SequenceAction>(actions: T[], stepIndex: number): T | null {
  return actions.filter((action) => action.kind !== 'wait')[stepIndex] ?? null;
}
