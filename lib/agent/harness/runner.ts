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
 *
 * ── the wire and the log are different things ──────────────────────────────
 * This module used to write every streaming delta into `harness_events` so the
 * browser could render it over Realtime. That made typing speed a function of
 * Postgres insert throughput plus Realtime fan-out (measured: ~1 token/second,
 * four writes a second), and it filled the log with hundreds of
 * `assistant.text` rows for one reply — which eventually pushed the
 * reconstructed history past the model window and had requests rejected
 * outright (steps:0, no tokens).
 *
 * So: the event log is HISTORY and is written once per finished step
 * (`persistStep`), while the live answer travels straight from the model to
 * whichever browser is watching, over SSE. `openRunTurn()` is the seam those
 * two paths share: the cron worker drains the model stream with nobody
 * watching, and the streaming route hands the same stream to the browser.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { streamText, stepCountIs } from 'ai';
import { getAgentModel } from '../deepseek';
import { createAgentContext, type TenantContext } from '../orchestrator';
import { appendEvent, appendEvents, loadEvents } from './store';
import { createEvent, type HarnessEvent } from './events';
import { persistStep } from './persist';
import { buildDiscoverableTools, discoveryPromptSection } from './tool-proxy';
import { project, itemsToModelMessages } from './projection';
import { isCancelRequested, nextBackoffMs, saveCheckpoint, type HarnessRun } from './runs';
import { wrapToolsWithIdempotency, countToolOccurrences, UnsafeToRetryError } from './idempotency';
import { maybeCompact } from './compaction';
import { startUsageMeter, settleUsage } from '../usage';
import { AGENT_MODEL } from '../models';

/** Generous output budget: reasoning is billed inside it, so a small default starves the answer. */
const HARNESS_MAX_OUTPUT_TOKENS = 16000;

/** The opening turn a goal-only run needs. See `goalSeedFor`. */
export interface GoalSeed {
  /** The log entry to append, validated against the `user.message` schema by createEvent. */
  event: { type: 'user.message'; data: Record<string, unknown> };
  /** The same thing as a model message, so the run can start even if the log write fails. */
  message: { role: 'user'; content: string };
}

/**
 * Decide whether a run needs its `goal` turned into an opening user turn.
 *
 * The bug this exists for: routines, WhatsApp approvals and the `run_routine` tool queue a run
 * with the instruction in `run.goal` and no `user.message` in the session log. The runner
 * rebuilds the conversation from that log, got nothing, and dead-lettered the run — 36 times
 * over 11 days on one tenant, every one with `attempts: 0`, so nothing looked broken.
 *
 * Extracted and exported rather than inlined so `scripts/verify-runner-goal-seed.ts` can prove
 * the decision without calling a model: that it seeds a goal-bearing run, and refuses to seed a
 * run that already has a conversation or carries no goal at all (the case where seeding would
 * put words in the owner's mouth).
 */
export function goalSeedFor(goal: string | null | undefined, runId: string): GoalSeed | null {
  const text = typeof goal === 'string' ? goal.trim() : '';
  if (!text) return null;
  return {
    // `createEvent` parses the payload against the schema, so a malformed seed throws here at
    // the write site rather than being rejected later by `parseEvent` in the renderer.
    event: createEvent('user.message', { id: `run-goal-${runId}`, text }),
    message: { role: 'user', content: text },
  };
}

export interface SliceOptions {
  worker: string;
  /** Wall-clock budget for this slice. Keep below the route's maxDuration. */
  budgetMs: number;
  /** Model steps allowed in this slice. */
  maxSteps: number;
  /** Called periodically so the lease does not expire mid-slice. */
  onHeartbeat?: () => Promise<unknown>;
  /**
   * Abort the model call when this signal fires (the browser goes away).
   * Only the streaming route passes one; the worker is never aborted by a client.
   */
  abortSignal?: AbortSignal;
  /**
   * The session's event log, already read by the caller.
   *
   * Reading it is on the critical path but does not depend on the run row, so the
   * route starts the read while the queue work happens and hands it over here.
   * Ignored when resuming from a checkpoint, which carries its own history.
   */
  preloadedEvents?: HarnessEvent[];
  /**
   * The tenant's profile and skill catalogue, already read by the caller.
   *
   * `loadTenantContext` is started straight after auth in the streaming route,
   * because reading who the business is does not depend on the conversation —
   * while the tool-group selection does. Passing it here keeps two round trips
   * off the path to the first token.
   */
  prefetchedTenant?: TenantContext;
  /**
   * Called as each setup stage completes. Time-to-first-token is dominated by
   * what happens BEFORE the model is asked anything, so the route records these
   * and logs them; without that, "it feels slow" is the only diagnosis available.
   */
  onStage?: (stage: string) => void;
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

/** A slice that is already generating, plus the promise that settles it. */
export interface OpenedTurn {
  /** The AI SDK stream result — already producing tokens. */
  result: any;
  /** Resolves once the slice is settled: steps persisted, checkpoint decided. */
  done: Promise<SliceResult>;
  /** Wall clock when the model call started. */
  startedAt: number;
  /** Milliseconds until the first text or reasoning delta arrived (null until then). */
  ttftMs: () => number | null;
  /** The run this turn belongs to, for logging and metrics. */
  runId: string;
  sliceNumber: number;
}

/**
 * Either a turn that is now streaming, or a slice that never got that far
 * (continuation limit, past deadline, empty conversation). The caller records
 * the outcome either way.
 */
export type TurnOpening = { kind: 'settled'; result: SliceResult } | { kind: 'open'; turn: OpenedTurn };

const HEARTBEAT_EVERY_MS = 60_000;

/** Wait for `promise`, but never longer than `ms`. Keeps a stuck SDK promise from pinning a lease. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

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

/**
 * Build the model call for one slice and start it.
 *
 * Everything the worker and the streaming route have in common lives here:
 * history reconstruction, tool surface, steering, the step-boundary persistence
 * and the decision of what the slice's outcome is. What they do NOT share is
 * how the tokens reach a human — the worker drains them, the route pipes them.
 */
export async function openRunTurn(
  supabase: SupabaseClient,
  run: HarnessRun,
  opts: SliceOptions
): Promise<TurnOpening> {
  const startedAt = Date.now();
  const sliceNumber = (run.checkpoint?.slices ?? 0) + 1;
  const stage = (name: string) => opts.onStage?.(name);

  if (run.continuations >= run.max_continuations) {
    const error = `Run exceeded its continuation limit (${run.max_continuations} slices).`;
    await appendRunStatus(supabase, run.session_id, 'failed', error, sliceNumber);
    return { kind: 'settled', result: { status: 'dead', steps: 0, error } };
  }

  // The "running" marker is for the transcript's status strip, nothing else reads
  // it before the answer arrives. Firing it without awaiting keeps a round trip
  // off the path to the first token.
  void appendRunStatus(supabase, run.session_id, 'running', run.goal ?? undefined, sliceNumber);

  // Provider probe AND provider construction start here, not after the prompt is
  // built: `getAgentModel()` makes a network round trip to check the key, and it
  // has nothing to do with reading the conversation. On the critical path it was
  // pure added latency before the first token.
  const modelPromise = getAgentModel();

  // ── restore or build the model conversation ───────────────────────────────
  // NOTE: `generateText` wants ModelMessage[] ({ role, content }), not
  // UIMessage[] ({ role, parts }).
  let messages: any[];
  /** Highest event sequence folded into `messages` — derived, not queried, when we
   *  have just read the whole log. */
  let loadedMaxSeq = 0;
  if (run.checkpoint?.messages?.length) {
    messages = run.checkpoint.messages as any[];
    console.log(
      `[Harness runner] resuming run ${run.id.slice(0, 8)} slice ${sliceNumber} ` +
        `from checkpoint (${messages.length} messages, attempt ${run.attempts + 1}/${run.max_attempts})`
    );
  } else {
    const events = opts.preloadedEvents ?? (await loadEvents(supabase, run.session_id));
    for (const ev of events) loadedMaxSeq = Math.max(loadedMaxSeq, Number(ev.seq) || 0);
    const state = project(run.session_id, events);
    // Faithful reconstruction: keeps tool calls, results AND reasoning. The
    // display-oriented `itemsToUIMessages` drops all three of the first two,
    // which both loses the task history and makes DeepSeek's thinking mode
    // reject the replay ("reasoning_content must be passed back").
    messages = itemsToModelMessages(state.items);

    // ── a queued run whose brief was never written down as a turn ────────────
    // Routines, WhatsApp approvals and the `run_routine` tool all enqueue a run with
    // their instruction in `run.goal` and never record a user message. The log then
    // contains only `run.status` bookkeeping, projects to zero messages, and the run
    // is dead-lettered before it does any work — with `attempts: 0`, because nothing
    // ever failed, there was simply nothing to run.
    //
    // Measured in production before this was fixed: 36 runs over 11 days, one tenant's
    // daily marketing never happening, and approval round trips that silently did
    // nothing. The goal IS the task, so it is recorded as the user turn it always was
    // — in the LOG, not only in memory, so the transcript shows the owner what was
    // asked for and a later resume reconstructs the same conversation.
    const seed = messages.length ? null : goalSeedFor(run.goal, run.id);
    if (seed) {
      const appended = await appendEvent(supabase, run.session_id, seed.event.type, seed.event.data);
      messages = [seed.message];
      // Claim the sequence we just wrote, so the post-slice reader does not read our own
      // seeded turn back as a new event and echo it a second time.
      if (appended) loadedMaxSeq += 1;
      console.log(
        `[Harness runner] run ${run.id.slice(0, 8)} had no user message; seeded its goal as the opening turn` +
          (appended ? ' and recorded it in the log' : ' (log write failed — continuing from memory)')
      );
    }

    console.log(
      `[Harness runner] starting run ${run.id.slice(0, 8)} from ${messages.length} reconstructed messages ` +
        `(${messages.filter((m) => m.role === 'tool').length} tool results, ` +
        `${messages.filter((m) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'reasoning')).length} with reasoning)`
    );
  }
  stage('history');

  if (!messages.length) {
    // Genuinely unrunnable: no conversation and no goal to seed one from. This is now the
    // real edge case rather than the normal path it had become.
    const error = 'Nothing to run: the session has no user message and the run carries no goal.';
    await appendRunStatus(supabase, run.session_id, 'failed', error, sliceNumber);
    return { kind: 'settled', result: { status: 'dead', steps: 0, error } };
  }

  // ── deadline ──────────────────────────────────────────────────────────────
  if (run.deadline_at && new Date(run.deadline_at).getTime() <= Date.now()) {
    const error = `Run deadline (${run.deadline_at}) passed before it finished.`;
    await appendRunStatus(supabase, run.session_id, 'failed', error, sliceNumber);
    return { kind: 'settled', result: { status: 'dead', steps: 0, error } };
  }

  // ── build the agent ───────────────────────────────────────────────────────
  // The tool catalogue is selected from what the conversation is actually
  // about, so a reporting question does not carry the Meta ads suite and a
  // creative request does not carry the reporting suite.
  const intentText = messages
    .filter((m) => m.role === 'user')
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((c: any) => (c.type === 'text' ? c.text : '')).join(' ')
          : ''
    )
    .join('\n');
  const { systemPrompt, tools: baseTools } = await createAgentContext(supabase, run.user_id, {
    operatorUserId: run.user_id,
    intentText,
    ...(opts.prefetchedTenant ? { prefetched: opts.prefetchedTenant } : {}),
  });
  stage('context');

  // Seed occurrence counters from the conversation we are resuming, so a
  // re-issued call maps to the same ledger row it did before a crash, while a
  // legitimately repeated identical call gets a new occurrence.
  const occurrences = countToolOccurrences(messages);

  // Side-effecting tools go through the ledger: at most once per occurrence.
  const wrappedTools = wrapToolsWithIdempotency(baseTools as Record<string, any>, {
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

  // Only a handful of schemas travel with each request; the rest are found on demand.
  const discovery = buildDiscoverableTools(wrappedTools as Record<string, any>);
  const tools = discovery.tools;
  console.error(
    '[Harness runner] TOOL SURFACE ' +
      JSON.stringify({
        exposed: discovery.exposed.length,
        discoverable: discovery.discoverable,
        inlineSchemaChars: discovery.inlineSchemaChars,
        fullSchemaChars: discovery.fullSchemaChars,
      })
  );
  const fullSystemPrompt = systemPrompt + '\n\n' + discoveryPromptSection();
  stage('tools');

  // Started at the top of this function — by now the round trip is usually done.
  const model = await modelPromise;
  stage('model');

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  if (opts.onHeartbeat) {
    heartbeatTimer = setInterval(() => {
      void opts.onHeartbeat?.().catch(() => {});
    }, HEARTBEAT_EVERY_MS);
    // A slice is not supposed to outlive the process, but never let a stray
    // interval keep a serverless invocation warm.
    if (typeof (heartbeatTimer as any)?.unref === 'function') (heartbeatTimer as any).unref();
  }

  let steps = 0;
  let cancelled = false;
  let firstDeltaAt: number | null = null;
  // Meter this slice's model tokens, sandbox seconds and media calls.
  const usageMeter = startUsageMeter();

  let settle!: (result: SliceResult) => void;
  const done = new Promise<SliceResult>((resolve) => {
    settle = resolve;
  });
  let settled = false;

  /** Record the slice outcome exactly once, then release the heartbeat and meter. */
  const settleOnce = async (outcome: SliceResult) => {
    if (settled) return;
    settled = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    // Charge this slice's measured usage at 2x margin. Runs on every path so a
    // slice that fails or is cancelled is still billed for what it consumed.
    try {
      await settleUsage(run.user_id, usageMeter, `Agent run slice ${sliceNumber}`);
    } catch {}
    settle(outcome);
  };

  /** Common tail of every successful generation: decide the checkpoint, then the status. */
  const completeSlice = async (nextMessages: any[], finishReason: string) => {
    if (cancelled) {
      await appendRunStatus(supabase, run.session_id, 'cancelled', 'Stopped at your request.', sliceNumber);
      await settleOnce({
        status: 'cancelled',
        steps,
        checkpoint: { messages: nextMessages, slices: sliceNumber },
      });
      return;
    }

    // Keep the checkpoint bounded so long runs stay cheap to resume.
    const compacted = await maybeCompact(nextMessages as any);
    const checkpoint = { messages: compacted.messages as unknown[], slices: sliceNumber };

    // A slice that ends on a tool call still has work to do; `queued` is the
    // durable way of saying "run me again", and the worker picks it straight up.
    if (finishReason === 'tool-calls') {
      console.log(
        `[Harness runner] run ${run.id.slice(0, 8)} slice ${sliceNumber}: ${steps} step(s), more work pending — re-queueing`
      );
      await settleOnce({ status: 'queued', steps, checkpoint });
      return;
    }

    await appendRunStatus(supabase, run.session_id, 'completed', undefined, sliceNumber);
    await settleOnce({ status: 'completed', steps, checkpoint });
  };

  const settleFailure = async (err: any) => {
    const message = String(err?.message || err || 'Unknown error').slice(0, 1000);

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
      await settleOnce({ status: 'dead', steps, error: message, incrementAttempt: true });
      return;
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
      await settleOnce({ status: 'queued', steps, error: message, nextAttemptAt, incrementAttempt: true });
      return;
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
    await settleOnce({ status: 'dead', steps, error: message, incrementAttempt: true });
  };

  // ── steering ──────────────────────────────────────────────────────────────
  // A message sent while the task is running is not parked until the end: the
  // harness hands it to the running agent so it can adapt mid-flight. We remember
  // the highest event sequence already folded into `messages`, and anything newer
  // arrives as an extra user turn before the next model call.
  // `loadedMaxSeq` is the newest sequence we already folded in — free, because the
  // whole log was just read. Only a resumed checkpoint needs to ask, and asking
  // cost every fresh turn an extra round trip before it could speak.
  let steerCursor = Math.max(
    Number(loadedMaxSeq) || 0,
    ...messages.map((m: any) => Number(m?.__seq) || 0)
  );
  if (!Number.isFinite(steerCursor)) steerCursor = 0;
  if (run.checkpoint?.messages?.length) {
    const { data: newest } = await supabase
      .from('harness_events')
      .select('seq')
      .eq('session_id', run.session_id)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestSeq = Number(newest?.seq) || 0;
    if (latestSeq > steerCursor) steerCursor = latestSeq;
  }
  stage('steering');

  const pullSteering = async (): Promise<string[]> => {
    try {
      const { data } = await supabase
        .from('harness_events')
        .select('seq, type, data')
        .eq('session_id', run.session_id)
        .eq('type', 'user.message')
        .gt('seq', steerCursor)
        .order('seq', { ascending: true })
        .limit(10);
      if (!data?.length) return [];
      const texts: string[] = [];
      for (const ev of data as any[]) {
        steerCursor = Math.max(steerCursor, Number(ev.seq) || steerCursor);
        const text = String(ev?.data?.text || '').trim();
        if (text) texts.push(text);
      }
      if (texts.length) {
        console.log(
          `[Harness runner] steering: ${texts.length} new user message(s) delivered mid-run ` +
            `(run ${run.id.slice(0, 8)})`
        );
      }
      return texts;
    } catch {
      return [];
    }
  };

  const result = streamText({
    model,
    // Reasoning tokens count against this budget. Left undeclared it falls back to a provider
    // default that a long goal exhausts before any answer is emitted, and the SDK reports the
    // empty result as 'No output generated'. Declare it, generously, per call.
    maxOutputTokens: HARNESS_MAX_OUTPUT_TOKENS,
    system: fullSystemPrompt,
    messages,
    tools,
    ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
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
    onChunk: ({ chunk }: any) => {
      // Time to first token is the number the whole change is about: it says how
      // long a person stares at nothing before the answer starts moving.
      if (firstDeltaAt === null && (chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta')) {
        firstDeltaAt = Date.now();
      }
    },
    onStepFinish: async (step: any) => {
      steps++;
      try {
        usageMeter?.addModelUsage(AGENT_MODEL, step?.usage);
      } catch {}
      // THE ONLY WRITE PER STEP. The partial-text pump that used to run four
      // times a second is gone: it is what made the reply type at ~1 token/sec
      // and what filled the log with hundreds of rows per answer.
      //
      // The scope keeps this step's ids unique to this run and slice. Step
      // numbers restart at 0 in every slice and every turn, so an unscoped id
      // let a later reply overwrite an earlier one in the projection.
      try {
        await persistStep(supabase, run.session_id, step, `${run.id.slice(0, 8)}_s${sliceNumber}_`);
      } catch (err: any) {
        console.warn('[Harness runner] persistStep failed:', err?.message);
      }
    },
    // Checkpoint at every step boundary, so a crash can lose at most the one
    // step that was in flight — not the whole slice.
    prepareStep: async ({ messages: stepMessages }: { messages: any[] }) => {
      // Steering happens here: new user messages become an extra user turn before
      // the next model call, so the agent reacts to them without restarting.
      const steered = await pullSteering();
      const withSteering = steered.length
        ? [...stepMessages, ...steered.map((text) => ({ role: 'user' as const, content: text }))]
        : stepMessages;
      await saveCheckpoint(supabase, run.id, withSteering, sliceNumber);
      return steered.length ? { messages: withSteering } : {};
    },
    onFinish: async (event: any) => {
      try {
        const finishReason = String(event?.finishReason ?? 'stop');
        const produced = Array.isArray(event?.response?.messages) ? event.response.messages : [];
        const nextMessages = [...messages, ...produced];
        await completeSlice(nextMessages, finishReason);
      } catch (err: any) {
        // Never leave the caller waiting: an onFinish that throws would strand
        // the promise and keep the run's lease until it expires.
        console.warn('[Harness runner] slice could not be finalised:', err?.message);
        await settleOnce({ status: 'queued', steps, error: String(err?.message || err).slice(0, 500) });
      }
    },
    onAbort: async () => {
      // The browser went away mid-slice. Completed steps are already persisted,
      // so hand the remainder to the durable queue rather than losing the task.
      cancelled = true;
      console.log(`[Harness runner] run ${run.id.slice(0, 8)} aborted by the client after ${steps} step(s)`);
      await settleOnce({
        status: 'queued',
        steps,
        checkpoint: { messages, slices: sliceNumber },
      });
    },
    onError: async ({ error }: any) => {
      console.warn('[Harness runner] stream error:', error?.message || error);
      await settleFailure(error);
    },
  });

  // Everything before this point was setup. From here the only remaining wait is
  // the provider's own time-to-first-token.
  stage('ask');

  return {
    kind: 'open',
    turn: {
      result,
      done,
      startedAt,
      ttftMs: () => (firstDeltaAt === null ? null : firstDeltaAt - startedAt),
      runId: run.id,
      sliceNumber,
    },
  };
}

/**
 * Execute one worker slice: open the turn, drain the model stream with nobody
 * watching, and report the outcome.
 *
 * Draining is not wasted work — it is what drives `streamText` to completion so
 * the tool loop advances. What it deliberately does NOT do is write anything to
 * the database: the wire is not the log.
 */
export async function executeRunSlice(
  supabase: SupabaseClient,
  run: HarnessRun,
  opts: SliceOptions
): Promise<SliceResult> {
  let opening: TurnOpening;
  try {
    opening = await openRunTurn(supabase, run, opts);
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 1000);
    console.error(`[Harness runner] run ${run.id.slice(0, 8)} could not start: ${message}`);
    await appendRunStatus(supabase, run.session_id, 'failed', message, (run.checkpoint?.slices ?? 0) + 1);
    if (err instanceof UnsafeToRetryError) {
      return { status: 'dead', steps: 0, error: message, incrementAttempt: true };
    }
    const attempt = run.attempts + 1;
    if (attempt < run.max_attempts) {
      return {
        status: 'queued',
        steps: 0,
        error: message,
        nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempt)).toISOString(),
        incrementAttempt: true,
      };
    }
    return { status: 'dead', steps: 0, error: message, incrementAttempt: true };
  }

  if (opening.kind === 'settled') return opening.result;
  const { turn } = opening;

  try {
    // Consume the stream so the SDK keeps generating. No DB writes in here.
    for await (const _delta of turn.result.textStream) {
      /* the wire is not the log */
    }
  } catch (streamErr: any) {
    console.warn('[Harness runner] model stream ended early:', streamErr?.message);
  }

  // `done` is settled by onFinish/onError/onAbort. The timeout exists so a stuck
  // SDK promise cannot pin the lease until it expires and strand the run.
  const settled = await withTimeout(turn.done, Math.max(5_000, opts.budgetMs));
  if (settled) return settled;

  console.warn(`[Harness runner] run ${run.id.slice(0, 8)} did not settle — re-queueing.`);
  return {
    status: 'queued',
    steps: 0,
    error: 'The model stream did not report completion in time.',
    incrementAttempt: true,
  };
}
