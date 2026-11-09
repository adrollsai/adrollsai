/**
 * How long and how far a single agent turn may run.
 *
 * Two separate limits were silently throttling the agent:
 *
 *  1. `maxDuration = 60` — the platform kills any HTTP request at the declared
 *     duration. Other heavy routes in this app already declare 300, so 60 was a
 *     stale default, not a plan ceiling.
 *  2. `stepCountIs(10)` — the model loop stopped after ten steps no matter how
 *     much work remained, so any real task was cut off mid-way.
 *
 * 300s is still the practical per-request ceiling on Vercel, so we stop
 * ourselves slightly earlier: a stream killed by the platform loses the step in
 * flight, whereas stopping on our own terms means every completed step is
 * already in the durable session log and can be continued by the next turn.
 */
import { stepCountIs } from 'ai';

/** Route segment config value — import it, never hardcode 60 again. */
export const CHAT_MAX_DURATION = 300;

/**
 * Why a turn stopped.
 *
 * `finishReason` alone is not a reliable signal: when our own `stopWhen`
 * condition ends the loop, the provider's finish reason still describes the
 * last step, which is often plain text even though real work remained. The
 * chat route needs to know "we cut this off with work left" so it can hand the
 * rest to the durable queue, so the stop reason is recorded explicitly here.
 */
export interface TurnStopTracker {
  reason: 'time' | 'steps' | null;
  steps: number;
  elapsedMs: number;
}

export function createTurnStopTracker(): TurnStopTracker {
  return { reason: null, steps: 0, elapsedMs: 0 };
}

/**
 * Wall-clock budget for one turn, kept below CHAT_MAX_DURATION on purpose.
 *
 * Override with `AGENT_TURN_BUDGET_MS`:
 *   - on Vercel keep it below the function limit (default 275000)
 *   - self-hosted / Docker you can raise it freely, or set it to 0 to disable
 *     the time stop entirely and let a turn run as long as it needs
 */
function resolveTurnBudgetMs(): number {
  const raw = (process.env.AGENT_TURN_BUDGET_MS || '').replace(/^["']|["']$/g, '').trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    console.warn(`[turn-limits] ignoring invalid AGENT_TURN_BUDGET_MS="${raw}"`);
  }
  return 275_000;
}

export const TURN_BUDGET_MS = resolveTurnBudgetMs();

/** Model steps allowed in one turn (was 10 — far too low for real tasks). */
export const MAX_STEPS_PER_TURN = Number(
  (process.env.AGENT_MAX_STEPS || '').replace(/^["']|["']$/g, '').trim() || 60
);

/**
 * `stopWhen` conditions for one turn. The AI SDK OR-s an array.
 * Call once per request so the budget is measured from the turn's start.
 */
export function turnStopConditions(
  startedAt: number,
  label = 'agent',
  tracker?: TurnStopTracker
): any {
  const conditions: any[] = [
    // Record the step cap ourselves rather than leaning on stepCountIs, so a
    // capped turn is distinguishable from a turn that genuinely finished.
    ({ steps }: { steps: Array<unknown> }) => {
      if (steps.length < MAX_STEPS_PER_TURN) return false;
      if (tracker) {
        tracker.reason = tracker.reason ?? 'steps';
        tracker.steps = steps.length;
        tracker.elapsedMs = Date.now() - startedAt;
      }
      console.warn(`[${label}] stopped at the step cap: ${steps.length} step(s).`);
      return true;
    },
  ];

  if (TURN_BUDGET_MS > 0) {
    conditions.push(({ steps }: { steps: Array<unknown> }) => {
      const elapsed = Date.now() - startedAt;
      if (elapsed <= TURN_BUDGET_MS) return false;
      if (tracker) {
        tracker.reason = tracker.reason ?? 'time';
        tracker.steps = steps.length;
        tracker.elapsedMs = elapsed;
      }
      console.warn(
        `[${label}] stopped by time budget: ${steps.length} step(s) in ` +
          `${Math.round(elapsed / 1000)}s (budget ${Math.round(TURN_BUDGET_MS / 1000)}s). ` +
          `Completed steps are saved; continuing in the background.`
      );
      return true;
    });
  }

  return conditions;
}

/**
 * How many continuation runs one session may chain before we stop trying.
 *
 * A task that keeps hitting the turn budget forever is a bug or an impossible
 * request, and silently re-queueing would burn credits without limit.
 */
export const MAX_CONTINUATIONS_PER_SESSION = Number(
  (process.env.AGENT_MAX_CONTINUATIONS || '').replace(/^["']|["']$/g, '').trim() || 6
);

/**
 * Should this finished turn be handed to the durable queue to carry on?
 *
 * Kept as a pure function so the decision can be tested directly: getting it
 * wrong is expensive in both directions (a dropped task, or a runaway loop).
 *
 * Continue when we stopped the turn ourselves AND the model had not delivered a
 * real answer — either it still wanted tools, or its closing text was too thin
 * to count as finished. A model that produced a proper answer and then happened
 * to hit the clock is done, and re-queueing it would just repeat the work.
 */
export function shouldContinueAfterTurn(input: {
  stopReason: 'time' | 'steps' | null;
  finishReason?: string;
  steps?: Array<any>;
  finalText?: string;
}): boolean {
  const stoppedByLimit = input.stopReason !== null || input.finishReason === 'tool-calls';
  if (!stoppedByLimit) return false;

  const steps = Array.isArray(input.steps) ? input.steps : [];
  const last = steps[steps.length - 1];
  const lastWantedTools =
    (last?.toolCalls?.length || 0) > 0 ||
    (Array.isArray(last?.content) && last.content.some((p: any) => p?.type === 'tool-call'));

  const answered = typeof input.finalText === 'string' && input.finalText.trim().length > 80;
  return lastWantedTools || !answered;
}
