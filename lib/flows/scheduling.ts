/**
 * Durable waiting, safe sending.
 *
 * A flow cannot sleep for an hour: the thing executing it has to finish. So a wait is not a pause,
 * it is a row in a ledger — "do step 3 for lead 812 at 09:25" — and a clock tick picks up whatever
 * is due. That is the difference between a flow that can follow up tomorrow and a flow that robocalls
 * someone at 9:15pm because its 10-second cap clamped the wait.
 *
 * Every send passes these gates in order, and each one exists because of a real failure mode:
 *   1. kill switch        - the owner can stop every flow at once
 *   2. flow paused        - one flow can be stopped on its own
 *   3. opt-out            - someone who said stop never gets another message
 *   4. BRANCH             - the step is on a side of a condition this lead is not on
 *   5. quiet hours        - a due step at 23:40 waits until morning instead of calling
 *   6. cross-flow freshness - another flow messaging this lead minutes ago means this one holds
 *   7. idempotency        - a retried tick cannot send the same step twice
 */

import { evaluateGates, type BranchGate } from './branching';

export type StepStatus = 'pending' | 'claimed' | 'done' | 'skipped';

export interface ScheduledStep {
  id: string;
  flowId: string;
  leadId: string;
  /** Index of the action inside the flow, so a step is identifiable independent of time. */
  stepIndex: number;
  /** What the step does when it fires. */
  kind?: 'message' | 'call' | 'email' | 'dm_reply' | 'handoff';
  /** When it should run, ISO string. */
  runAt: string;
  status: StepStatus;
  attempts: number;
  /**
   * Branch predicates this step has to satisfy before it may run.
   *
   * A step on the TRUE side of "pipeline_stage == New Lead" carries that condition with
   * `want: true`; the step on the FALSE side carries it with `want: false`. Both rows exist in the
   * ledger from the start (that is what a ledger is), and when one is due it is either run or
   * skipped with a reason that names the condition. Exactly one side can run, because a lead cannot
   * be on both sides of the same comparison.
   */
  gates?: BranchGate[];
  /**
   * Which run of the flow this step belongs to.
   *
   * Without this a flow could fire once per lead for ever: the idempotency key was
   * (flow, lead, step), so a genuinely new inbound message produced a silent no-op. The run key
   * is the event that started the run ('once' for a flow that should only ever fire one way).
   */
  runKey?: string;
}

export interface QuietHours {
  /** 0–23, inclusive start. */
  startHour: number;
  /** 0–23, exclusive end. A window of 21 → 9 means "do not send between 21:00 and 09:00". */
  endHour: number;
  timeZone?: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 21, endHour: 9 };

/** How recently another flow may have messaged a lead before this step holds. */
export const CROSS_FLOW_WINDOW_MS = 60 * 60 * 1000;

export interface FlowStore {
  /** Steps whose time has come, oldest first. */
  dueSteps(now: Date, limit: number): Promise<ScheduledStep[]>;
  /** Atomic claim. False means somebody else got it — the whole point of the ledger. */
  claim(stepId: string, now: Date): Promise<boolean>;
  complete(stepId: string): Promise<void>;
  skip(stepId: string, reason: string): Promise<void>;
  /** Idempotency: has this exact step of this exact run already happened for this lead? */
  hasRun(flowId: string, leadId: string, stepIndex: number, runKey?: string): Promise<boolean>;
  recordRun(flowId: string, leadId: string, stepIndex: number, at: Date, runKey?: string): Promise<void>;
  lastMessageAtForLead(leadId: string): Promise<Date | null>;
  /**
   * The lead a branch predicate is evaluated against, or null when it cannot be read.
   *
   * Optional so an existing store (and every gate's fake store) keeps working. A store that cannot
   * supply the row does not get to run the step: see the branch gate in runDueSteps, which refuses a
   * gated step it cannot evaluate rather than assuming a side.
   */
  leadFor?(leadId: string): Promise<Record<string, any> | null>;
  /**
   * `'unreadable'` is distinct from `true` on purpose: "this person opted out" and "we could not
   * read this person" both stop the send, but only one of them is their decision, and a report that
   * confuses them sends somebody hunting for a consent they never withdrew.
   */
  isOptedOut(leadId: string): Promise<boolean | 'unreadable'>;
  isPaused(flowId: string): Promise<boolean>;
  isAllPaused(): Promise<boolean>;
}

export interface TickOptions {
  quietHours?: QuietHours;
  crossFlowWindowMs?: number;
  limit?: number;
  /** Called for each step that passes every gate. Must be idempotent-safe; the store guarantees once. */
  execute: (step: ScheduledStep) => Promise<void>;
}

export interface TickReport {
  considered: number;
  executed: string[];
  skipped: { stepId: string; reason: SkipReason }[];
  deferred: { stepId: string; until: string }[];
}

export type SkipReason =
  | 'kill_switch'
  | 'flow_paused'
  | 'opted_out'
  /** Could not read the lead, so it was not messaged — but it was not cancelled either. */
  | 'lead_unreadable'
  | 'already_ran'
  | 'recently_messaged_by_other_flow'
  /** The step is on the side of a condition this lead is not on, so it never runs for them. */
  | 'branch_not_taken'
  /** The branch could not be evaluated (unreadable lead, or no store support) — the step is held. */
  | 'branch_unreadable'
  | 'claim_lost'
  | 'execute_failed';

/** Is `at` inside the hours we must not message people? */
export function isQuiet(at: Date, quiet: QuietHours): boolean {
  const hour = at.getHours();
  const { startHour, endHour } = quiet;
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour; // wraps midnight
}

/** The first moment at or after `at` when messaging is allowed again. */
export function nextAllowedTime(at: Date, quiet: QuietHours): Date {
  if (!isQuiet(at, quiet)) return at;
  const out = new Date(at);
  out.setMinutes(0, 0, 0);
  // Walk forward an hour at a time; bounded, and the wrap case is handled by isQuiet itself.
  for (let i = 0; i < 48; i++) {
    out.setHours(out.getHours() + 1);
    if (!isQuiet(out, quiet)) return out;
  }
  return out;
}

export function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

/**
 * One clock tick. Claims, gates, executes, records — in that order, so a crash mid-way leaves a
 * claimed row that can be reclaimed after the claim expires rather than a silently lost message.
 */
export async function runDueSteps(store: FlowStore, now: Date, opts: TickOptions): Promise<TickReport> {
  const quiet = opts.quietHours ?? DEFAULT_QUIET_HOURS;
  const windowMs = opts.crossFlowWindowMs ?? CROSS_FLOW_WINDOW_MS;
  const report: TickReport = { considered: 0, executed: [], skipped: [], deferred: [] };

  if (await store.isAllPaused()) {
    const due = await store.dueSteps(now, opts.limit ?? 20);
    for (const step of due) report.skipped.push({ stepId: step.id, reason: 'kill_switch' });
    report.considered = due.length;
    return report;
  }

  const due = await store.dueSteps(now, opts.limit ?? 20);
  report.considered = due.length;

  for (const step of due) {
    if (await store.isPaused(step.flowId)) {
      report.skipped.push({ stepId: step.id, reason: 'flow_paused' });
      continue;
    }
    const optOut = await store.isOptedOut(step.leadId);
    if (optOut === 'unreadable') {
      // Not skipped: the row stays pending so a transient read failure does not quietly cancel
      // somebody's follow-up. It is reported, so the silence is explainable.
      report.skipped.push({ stepId: step.id, reason: 'lead_unreadable' });
      continue;
    }
    if (optOut) {
      await store.skip(step.id, 'opted_out');
      report.skipped.push({ stepId: step.id, reason: 'opted_out' });
      continue;
    }

    /**
     * BRANCH — evaluated per step, against the lead as it is NOW.
     *
     * A step two days after a condition must ask the question two days later: the lead may have
     * replied, changed stage, or been updated by another flow since. Both sides' rows sit in the
     * ledger; this is where the one this lead is not on is retired, by name.
     *
     * Three outcomes, and the middle one matters: if the lead cannot be read the step is NOT taken
     * (silence would be a guess) and NOT skipped permanently (a transient failure would silently
     * retire somebody's follow-up) — it is reported and left pending for the next tick.
     */
    if (step.gates?.length) {
      if (!store.leadFor) {
        // A store that cannot supply the lead cannot decide the branch, and an unevaluated branch
        // must never be treated as "both sides run".
        report.skipped.push({ stepId: step.id, reason: 'branch_unreadable' });
        continue;
      }
      const lead = await store.leadFor(step.leadId);
      if (!lead) {
        report.skipped.push({ stepId: step.id, reason: 'branch_unreadable' });
        continue;
      }
      const verdict = evaluateGates(step.gates, lead);
      if (!verdict.ok) {
        await store.skip(step.id, 'branch_not_taken');
        report.skipped.push({ stepId: step.id, reason: 'branch_not_taken' });
        console.log(`[flows] step ${step.id} skipped (branch not taken): ${verdict.detail}`);
        continue;
      }
    }

    if (isQuiet(now, quiet)) {
      const until = nextAllowedTime(now, quiet);
      report.deferred.push({ stepId: step.id, until: until.toISOString() });
      continue;
    }
    if (await store.hasRun(step.flowId, step.leadId, step.stepIndex, step.runKey)) {
      await store.skip(step.id, 'already_ran');
      report.skipped.push({ stepId: step.id, reason: 'already_ran' });
      continue;
    }
    // Cross-flow freshness protects a PERSON from being messaged twice in an hour. An internal
    // step messages nobody, so holding it back for an hour would only delay a handoff or a tag —
    // and worse, the step right after a message would always be deferred, because the message it
    // follows is the thing that set the timestamp.
    if (step.kind !== 'handoff') {
      const last = await store.lastMessageAtForLead(step.leadId);
      if (last && now.getTime() - last.getTime() < windowMs) {
        report.deferred.push({ stepId: step.id, until: new Date(last.getTime() + windowMs).toISOString() });
        report.skipped.push({ stepId: step.id, reason: 'recently_messaged_by_other_flow' });
        continue;
      }
    }
    if (!(await store.claim(step.id, now))) {
      report.skipped.push({ stepId: step.id, reason: 'claim_lost' });
      continue;
    }
    try {
      await opts.execute(step);
      await store.recordRun(step.flowId, step.leadId, step.stepIndex, now, step.runKey);
      await store.complete(step.id);
      report.executed.push(step.id);
    } catch {
      report.skipped.push({ stepId: step.id, reason: 'execute_failed' });
    }
  }
  return report;
}

/**
 * Planning a wait: given a flow's actions and a start time, produce the ledger rows it implies.
 * Every `wait` becomes a scheduled step at an absolute time — never an inline sleep — and the time
 * is pushed past quiet hours so nobody is called at midnight.
 */
export interface PlannedAction {
  kind: 'message' | 'call' | 'wait' | 'handoff';
  seconds?: number;
  /** For a `handoff` step: what internal work it does. Never messages a customer. */
  internal?: InternalAction;
}

/**
 * Internal work a flow may do without asking anybody: it touches the CRM, not a person.
 * It is kept as data (not a callback) so a plan stays serialisable and testable.
 */
export interface InternalAction {
  kind: 'note' | 'tag' | 'stage' | 'assign';
  value?: string | null;
}

export function scheduleFor(
  flowId: string,
  leadId: string,
  actions: PlannedAction[],
  startAt: Date,
  quiet: QuietHours = DEFAULT_QUIET_HOURS,
  runKey = 'once'
) {
  const rows: { flowId: string; leadId: string; stepIndex: number; runAt: Date; kind: 'message' | 'call' | 'handoff' }[] = [];
  let cursor = new Date(startAt);
  let stepIndex = 0;
  for (const action of actions) {
    if (action.kind === 'wait') {
      cursor = addSeconds(cursor, Math.max(0, action.seconds ?? 0));
      continue;
    }
    // Quiet hours exist so a customer is not called at midnight. An internal step wakes nobody,
    // so clamping it until morning would delay a tag for no reason.
    const allowed = action.kind === 'handoff' ? new Date(cursor) : nextAllowedTime(cursor, quiet);
    rows.push({ flowId, leadId, stepIndex, runAt: allowed, kind: action.kind });
    stepIndex++;
    cursor = allowed;
  }
  return rows.map((row) => ({ ...row, runKey }));
}
