/**
 * Executes one bounded slice of a durable run.
 *
 * A slice stops when:
 *   - the model finishes its answer             → run completed
 *   - the step cap or the time budget is hit    → run re-queued with a checkpoint
 *   - the owner asked to cancel                 → run cancelled
 *   - a transient error occurred                → re-queued with exponential backoff
 *   - retries are exhausted, or a side effect   → dead-lettered for human review
 *     may have half-executed
 *
 * Three production guarantees live here:
 *   * checkpoints make a slice resumable
 *   * the idempotency ledger makes side effects at-most-once per run
 *   * backoff + attempts + dead-letter stop a broken run from spinning forever
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { streamText, stepCountIs } from 'ai';
import { getAgentModel } from '../deepseek';
import { createAgentContext } from '../orchestrator';
import { appendEvents, loadEvents } from './store';
import { createEvent } from './events';
import { persistStep } from './persist';
import { project, itemsToModelMessages } from './projection';
import { isCancelRequested, nextBackoffMs, saveCheckpoint, type HarnessRun } from './runs';
import { wrapToolsWithIdempotency, countToolOccurrences, UnsafeToRetryError } from './idempotency';
import { maybeCompact } from './compaction';
import { startUsageMeter, settleUsage } from '../usage';
import { AGENT_MODEL } from '../models';

export interface SliceOptions {
  worker: string;
  /** Wall-clock budget for this slice. Keep below the route's maxDuration. */
  budgetMs: number;
  /** Model steps allowed in this slice. */
  maxSteps: number;
  /** Called periodically so the lease does not expire mid-slice. */
  onHeartbeat?: () => Promise<unknown>;
}

export interface SliceResult {
  status: 'completed' | 'failed' | 'cancelled' | 'queued' | 'dead';
  steps: number;
  /** Present when status === 'queued' — the loop state for the next slice. */
  checkpoint?: { messages: unknown[]; slices: number };
  error?: string;
  /** Retry backoff gate for the worker to persist. */
  nextAttemptAt?: string | null;
  /** Count this slice as a failed attempt. */
  incrementAttempt?: boolean;
}

const HEARTBEAT_EVERY_MS = 60_000;

async function appendRunStatus(
  supabase: SupabaseClient,
  sessionId: string,
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
  detail?: string,
  slice?: number
) {
  try {
    await appendEvents(supabase, sessionId, [
      createEvent('run.status', {
        status,
        ...(detail ? { detail: detail.slice(0, 500) } : {}),
        ...(typeof slice === 'number' ? { slice } : {}),
      }),
    ]);
  } catch (err: any) {
    console.warn('[Harness runner] could not append run.status:', err?.message);
  }
}

export async function executeRunSlice(
  supabase: SupabaseClient,
  run: HarnessRun,
  opts: SliceOptions
): Promise<SliceResult> {
  const startedAt = Date.now();
  const sliceNumber = (run.checkpoint?.slices ?? 0) + 1;

  if (run.continuations >= run.max_continuations) {
    const error = `Run exceeded its continuation limit (${run.max_continuations} slices).`;
    await appendRunStatus(supabase, run.session_id, 'failed', error, sliceNumber);
    return { status: 'dead', steps: 0, error };
  }

  await appendRunStatus(supabase, run.session_id, 'running', run.goal ?? undefined, sliceNumber);

  // ── restore or build the model conversation ───────────────────────────────
  // NOTE: `generateText` wants ModelMessage[] ({ role, content }), not
  // UIMessage[] ({ role, parts }).
  let messages: any[];
  if (run.checkpoint?.messages?.length) {
    messages = run.checkpoint.messages as any[];
    console.log(
      `[Harness runner] resuming run ${run.id.slice(0, 8)} slice ${sliceNumber} ` +
        `from checkpoint (${messages.length} messages, attempt ${run.attempts + 1}/${run.max_attempts})`
    );
  } else {
    const events = await loadEvents(supabase, run.session_id);
    const state = project(run.session_id, events);
    // Faithful reconstruction: keeps tool calls, results AND reasoning. The
    // display-oriented `itemsToUIMessages` drops all three of the first two,
    // which both loses the task history and makes DeepSeek's thinking mode
    // reject the replay ("reasoning_content must be passed back").
    messages = itemsToModelMessages(state.items);
    console.log(
      `[Harness runner] starting run ${run.id.slice(0, 8)} from ${messages.length} reconstructed messages ` +
        `(${messages.filter((m) => m.role === 'tool').length} tool results, ` +
        `${messages.filter((m) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'reasoning')).length} with reasoning)`
    );
  }

  if (!messages.length) {
    const error = 'Nothing to run: the session has no user message.';
    await appendRunStatus(supabase, run.session_id, 'failed', error, sliceNumber);
    return { status: 'dead', steps: 0, error };
  }

  // ── deadline ──────────────────────────────────────────────────────────────
  if (run.deadline_at && new Date(run.deadline_at).getTime() <= Date.now()) {
    const error = `Run deadline (${run.deadline_at}) passed before it finished.`;
    await appendRunStatus(supabase, run.session_id, 'failed', error, sliceNumber);
    return { status: 'dead', steps: 0, error };
  }

  // ── build the agent ───────────────────────────────────────────────────────
  const { systemPrompt, tools: baseTools } = await createAgentContext(supabase, run.user_id, run.user_id);

  // Seed occurrence counters from the conversation we are resuming, so a
  // re-issued call maps to the same ledger row it did before a crash, while a
  // legitimately repeated identical call gets a new occurrence.
  const occurrences = countToolOccurrences(messages);

  // Side-effecting tools go through the ledger: at most once per occurrence.
  const tools = wrapToolsWithIdempotency(baseTools as Record<string, any>, {
    supabase,
    runId: run.id,
    sessionId: run.session_id,
    occurrences,
    onReplay: (toolName) => {
      void appendEvents(supabase, run.session_id, [
        createEvent('run.status', {
          status: 'running',
          detail: `Replayed ${toolName} from the ledger instead of executing it again.`,
          slice: sliceNumber,
        }),
      ]);
    },
  });

  const model = await getAgentModel();

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  if (opts.onHeartbeat) {
    heartbeatTimer = setInterval(() => {
      void opts.onHeartbeat?.().catch(() => {});
    }, HEARTBEAT_EVERY_MS);
  }

  let steps = 0;
  let cancelled = false;
  // Meter this slice's model tokens, sandbox seconds and media calls.
  const usageMeter = startUsageMeter();

  try {
    // Stream, not generateText.
    //
    // generateText only reports at step boundaries, so a durable run showed
    // nothing for 5-20 seconds and then a whole step at once — which is precisely
    // why it felt dead next to a live-streaming harness. streamText lets the
    // partial answer be written incrementally, so the transcript animates.
    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: [
        stepCountIs(opts.maxSteps),
        ({ steps: taken }: { steps: Array<unknown> }) =>
          Date.now() - startedAt > opts.budgetMs || taken.length >= opts.maxSteps,
        async () => {
          if (cancelled) return true;
          const asked = await isCancelRequested(supabase, run.id);
          if (asked) cancelled = true;
          return asked;
        },
      ],
      onStepFinish: async (step: any) => {
        steps++;
        try { usageMeter?.addModelUsage(AGENT_MODEL, step?.usage); } catch {}
        try {
          await persistStep(supabase, run.session_id, step);
        } catch (err: any) {
          console.warn('[Harness runner] persistStep failed:', err?.message);
        }
        // Next step writes to a fresh text id so partials never overwrite the
        // previous step's finished answer.
        partialCounter++;
        flushedLength = 0;
      },
      // Checkpoint at every step boundary, so a crash can lose at most the one
      // step that was in flight — not the whole slice.
      prepareStep: async ({ messages: stepMessages }: { messages: any[] }) => {
        await saveCheckpoint(supabase, run.id, stepMessages, sliceNumber);
        return {};
      },
    });

    // Pump partial text into the event log so Realtime can render it live.
    // Throttled: the projection upserts by id, so each write replaces the row.
    let streamedText = '';
    let flushedLength = 0;
    let partialCounter = 0;
    let lastFlushAt = 0;
    try {
      for await (const delta of result.textStream) {
        streamedText += delta;
        const now = Date.now();
        // ~4 flushes a second is enough to look live without hammering Realtime.
        if (now - lastFlushAt < 250) continue;
        lastFlushAt = now;
        if (streamedText.length <= flushedLength) continue;
        flushedLength = streamedText.length;
        try {
          await appendEvents(supabase, run.session_id, [
            createEvent('assistant.text', {
              id: `${run.id.slice(0, 8)}_p${sliceNumber}_${partialCounter}`,
              text: streamedText,
            }),
          ]);
        } catch {
          /* partial display is best-effort; the step event carries the truth */
        }
      }
    } catch (streamErr: any) {
      console.warn('[Harness runner] partial stream ended early:', streamErr?.message);
    }

    // streamText exposes these as promises (generateText resolved them inline).
    const [response, finishReason] = await Promise.all([result.response, result.finishReason]);
    const nextMessages = [...messages, ...((response as any)?.messages ?? [])];

    if (cancelled) {
      await appendRunStatus(supabase, run.session_id, 'cancelled', 'Stopped at your request.', sliceNumber);
      return { status: 'cancelled', steps, checkpoint: { messages: nextMessages, slices: sliceNumber } };
    }

    // Keep the checkpoint bounded so long runs stay cheap to resume.
    const compacted = await maybeCompact(nextMessages as any);
    const checkpoint = { messages: compacted.messages as unknown[], slices: sliceNumber };

    const unfinished = finishReason === 'tool-calls';
    if (unfinished) {
      console.log(
        `[Harness runner] run ${run.id.slice(0, 8)} slice ${sliceNumber}: ${steps} step(s), more work pending — re-queueing`
      );
      return { status: 'queued', steps, checkpoint };
    }

    await appendRunStatus(supabase, run.session_id, 'completed', undefined, sliceNumber);
    return { status: 'completed', steps, checkpoint };
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 1000);

    // A side effect may have half-happened. Never retry that automatically.
    if (err instanceof UnsafeToRetryError) {
      console.error(`[Harness runner] run ${run.id.slice(0, 8)} dead-lettered: ${message}`);
      await appendRunStatus(
        supabase,
        run.session_id,
        'failed',
        `Needs review before retrying: ${message}`,
        sliceNumber
      );
      return { status: 'dead', steps, error: message, incrementAttempt: true };
    }

    const attempt = run.attempts + 1;
    if (attempt < run.max_attempts) {
      const delay = nextBackoffMs(attempt);
      const nextAttemptAt = new Date(Date.now() + delay).toISOString();
      console.warn(
        `[Harness runner] run ${run.id.slice(0, 8)} failed (attempt ${attempt}/${run.max_attempts}): ` +
          `${message} — retrying in ${Math.round(delay / 1000)}s`
      );
      await appendRunStatus(
        supabase,
        run.session_id,
        'failed',
        `Attempt ${attempt}/${run.max_attempts} failed: ${message} — retrying automatically.`,
        sliceNumber
      );
      return { status: 'queued', steps, error: message, nextAttemptAt, incrementAttempt: true };
    }

    console.error(
      `[Harness runner] run ${run.id.slice(0, 8)} dead-lettered after ${run.max_attempts} attempts: ${message}`
    );
    await appendRunStatus(
      supabase,
      run.session_id,
      'failed',
      `Gave up after ${run.max_attempts} attempts: ${message}`,
      sliceNumber
    );
    return { status: 'dead', steps, error: message, incrementAttempt: true };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    // Charge this slice's measured usage at 2x margin. Runs in `finally` so a
    // slice that fails or is cancelled is still billed for what it consumed.
    try {
      await settleUsage(run.user_id, usageMeter, `Agent run slice ${sliceNumber}`);
    } catch {}
  }
}
