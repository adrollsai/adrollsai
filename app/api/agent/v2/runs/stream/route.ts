/**
 * POST /api/agent/v2/runs/stream — the LIVE path for a chat turn.
 *
 * The durable run and the live stream are two separate concerns, and conflating
 * them is what made replies crawl:
 *
 *   DURABLE  A `harness_runs` row is created and claimed before a single token
 *            is generated. If the tab closes, the request is killed or the
 *            slice runs out of budget, `finishRun(status: 'queued')` leaves the
 *            checkpoint behind and the cron worker carries on. Nothing is lost.
 *
 *   LIVE     The model's stream is piped straight to the browser over SSE
 *            (`result.toUIMessageStreamResponse()`). No token touches Postgres
 *            on its way out of the process.
 *
 * The event log is still written — but once per finished step, by
 * `persistStep` inside the runner's `onStepFinish`. So a reply that used to
 * cost ~337 `assistant.text` rows now costs one row per step, and the typing
 * speed is the model's, not the database's.
 *
 * The browser treats this stream as the live view and Realtime as the
 * reconnect path: if the stream dies, the projection (a fold of the log) still
 * fills the transcript in, and the queued slice finishes the work.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isAvailable, appendEvents, setSessionStatus, loadEvents } from '@/lib/agent/harness/store';
import { createEvent } from '@/lib/agent/harness/events';
import {
  runsAvailableCheck,
  createClaimedRun,
  finishRun,
  heartbeatRun,
  hasLiveRun,
  isCancelRequested,
} from '@/lib/agent/harness/runs';
import { openRunTurn, type SliceResult } from '@/lib/agent/harness/runner';
import { loadTenantContext } from '@/lib/agent/orchestrator';

/**
 * Must stay a literal: Next reads route segment config by static analysis.
 * Deliberately SHORTER than the worker's 1800s. A turn that needs longer than
 * this is re-queued with its checkpoint and continued by the cron worker, which
 * is the same durability guarantee the queue already gave us.
 */
export const maxDuration = 300;

/** Leave headroom under maxDuration so the slice can still checkpoint and finish. */
const TURN_BUDGET_MS = 270_000;
const TURN_MAX_STEPS = 30;
const LEASE_SECONDS = 300;

/** How the client should read the body. Also sent as a header so a fetch caller
 *  can branch before it starts parsing the stream. */
type Outcome = 'streaming' | 'steered' | 'queued' | 'refused';

function jsonOutcome(outcome: Outcome, body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'X-Nobo-Outcome': outcome } });
}

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

export async function POST(req: Request) {
  const requestStartedAt = Date.now();
  const stages: Array<[string, number]> = [];
  const stage = (name: string) => stages.push([name, Date.now() - requestStartedAt]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonOutcome('refused', { error: 'Unauthorized' }, 401);
  }
  stage('auth');

  // Everything below needs only `user.id`, and all of it is independent, so all
  // of it starts now and is awaited where it is actually needed:
  //
  //   * the tenant context (profile + skills) is the data half of building the
  //     agent — it does NOT depend on the conversation, so it must not queue
  //     behind the queue writes. Note this is a PREFETCH, not a cache: nothing
  //     is kept between requests, because the tool closures capture this
  //     request's Supabase client and its JWT.
  //   * the affordability check walks the credit pots, and only the model call
  //     costs money, so it is enforced later, not first.
  const tenantPromise = loadTenantContext(supabase, user.id).catch(() => undefined);
  const affordablePromise = import('@/lib/agent/usage')
    .then(({ canStartTurn }) => canStartTurn(user.id))
    .catch(() => ({ ok: true }) as { ok: boolean; reason?: string });

  // Both are schema probes and both are cached per process, but on a cold
  // instance that is the first thing that happens — so they go together rather
  // than one after the other.
  const [storeReady, runsReady] = await Promise.all([
    isAvailable(supabase),
    runsAvailableCheck(supabase),
  ]);
  if (!storeReady || !runsReady) {
    return jsonOutcome(
      'refused',
      { error: 'Durable runs are not initialized. Apply the harness migrations.' },
      503
    );
  }
  stage('schema');

  const body = await req.json().catch(() => ({} as any));
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return jsonOutcome('refused', { error: 'sessionId is required' }, 400);

  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const attachments = Array.isArray(body?.attachments) ? body.attachments : undefined;
  const messageId =
    typeof body?.messageId === 'string' && body.messageId ? body.messageId : `u_${Date.now()}`;

  // ── steering ──────────────────────────────────────────────────────────────
  // One run per session at a time. A message sent while a run is live is not a
  // second run — it is written to the event log and folded into the running
  // agent's next step, so the task adapts without restarting.
  const live = await hasLiveRun(supabase, sessionId);
  if (live) {
    if (!message) {
      return jsonOutcome(
        'refused',
        { error: 'run_in_progress', message: 'A run is already working on this chat.' },
        409
      );
    }
    await appendEvents(supabase, sessionId, [
      createEvent('user.message', { id: messageId, text: message, ...(attachments ? { attachments } : {}) }),
    ]);
    return jsonOutcome('steered', {
      sessionId,
      message: 'Delivered to the running task — it will pick this up on its next step.',
    });
  }

  // The CLIENT owns its own displayed message id, so the optimistic bubble and
  // the persisted row are one row. Exactly one writer per event type.
  if (message) {
    await appendEvents(supabase, sessionId, [
      createEvent('user.message', { id: messageId, text: message, ...(attachments ? { attachments } : {}) }),
    ]);
    void (async () => {
      try {
        const { maybeAutoTitle } = await import('@/lib/agent/harness/persist');
        await maybeAutoTitle(supabase, user.id, sessionId, message);
      } catch {
        /* naming never blocks a turn */
      }
    })();
  }

  const goal = typeof body?.goal === 'string' && body.goal.trim() ? body.goal.trim() : message;
  const idempotencyKey =
    typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 120)
      : undefined;

  // ── durability first, stream second ───────────────────────────────────────
  //
  // The conversation is read here, not inside the turn, so the read overlaps the
  // queue work below instead of queuing behind it. Nothing about the run row is
  // needed to read a session's log.
  const eventsPromise = loadEvents(supabase, sessionId).catch(() => []);

  // One round trip, not three: the row is created already leased to this request,
  // and the "does this session belong to you" question is part of the same write
  // (harness_create_claimed_run). See createClaimedRun.
  const worker = `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const claim = await createClaimedRun(supabase, {
    sessionId,
    userId: user.id,
    goal: goal || 'Continue the conversation.',
    worker,
    leaseSeconds: LEASE_SECONDS,
    idempotencyKey,
    priority: 1,
  });
  if (!claim.ok) {
    void eventsPromise;
    void tenantPromise;
    void affordablePromise;
    if (claim.reason === 'not_owned') {
      // Same answer the ownership query used to give, without the query.
      return jsonOutcome('refused', { error: 'Session not found' }, 404);
    }
    return jsonOutcome(
      'refused',
      { error: 'Could not queue the run', detail: claim.detail },
      500
    );
  }
  const claimed = claim.run;
  stage('claimed');

  // ── the affordability gate, immediately before anything that costs money ──
  // Same rule as before — an empty wallet must not start work we then fail to
  // bill — but no longer in front of the queue work. If it refuses, the run is
  // cancelled rather than left for a worker to pick up.
  const affordable = await affordablePromise;
  if (!affordable.ok) {
    void eventsPromise;
    void tenantPromise;
    await finishRun(supabase, claimed.id, worker, {
      status: 'cancelled',
      error: 'Stopped before it started: not enough credits.',
    });
    await setSessionStatus(supabase, sessionId, 'idle');
    return jsonOutcome(
      'refused',
      { error: 'insufficient_credits', message: (affordable as any).reason },
      402
    );
  }
  stage('affordable');

  // The sidebar dot, not the answer. Waiting for it put an UPDATE in front of the
  // first token for no reason the reader can see.
  void setSessionStatus(supabase, sessionId, 'running');

  let opening;
  try {
    opening = await openRunTurn(supabase, claimed, {
      worker,
      budgetMs: TURN_BUDGET_MS,
      maxSteps: TURN_MAX_STEPS,
      preloadedEvents: await eventsPromise,
      // Started right after auth, so the profile and skills reads are already done
      // by the time the prompt is assembled.
      prefetchedTenant: await tenantPromise,
      // NOTE: no `abortSignal: req.signal` here.
      //
      // Next can abort `req.signal` as part of finishing a streamed response,
      // and handing that to `streamText` turns an ordinary completion into a
      // cancelled run. The SDK already propagates a real disconnect: the client
      // dropping the connection cancels the UI-message stream, which cancels
      // the model stream, which fires `onAbort` in the runner — and `onAbort`
      // is what re-queues the unfinished work.
      onHeartbeat: () => heartbeatRun(supabase, claimed.id, worker, LEASE_SECONDS),
      onStage: stage,
    });
  } catch (err: any) {
    const reason = String(err?.message || err).slice(0, 500);
    console.error('[Harness stream] could not open the turn:', reason);
    await finishRun(supabase, claimed.id, worker, { status: 'failed', error: reason });
    await setSessionStatus(supabase, sessionId, 'error');
    return jsonOutcome('refused', { error: reason }, 500);
  }
  stage('turn-open');

  if (opening.kind === 'settled') {
    // Never got as far as generating (continuation cap, past deadline, empty log).
    const settled = opening.result;
    await finishRun(supabase, claimed.id, worker, {
      status: settled.status === 'dead' ? 'dead' : settled.status,
      checkpoint: settled.checkpoint ?? null,
      error: settled.error ?? null,
      incrementAttempt: settled.incrementAttempt ?? false,
    });
    await setSessionStatus(supabase, sessionId, 'idle');
    return jsonOutcome('refused', { error: settled.error || 'The run could not start.' }, 409);
  }

  const turn = opening.turn;

  /** Record this slice's outcome. Runs inside the stream's own onFinish, which is
   *  the only place the platform still keeps the function alive. */
  let finalised = false;
  let usageSeen: any = null;
  const finalise = async (outcome: SliceResult | null) => {
    if (finalised) return;
    finalised = true;
    const settled: SliceResult =
      outcome ?? {
        status: 'queued',
        steps: 0,
        error: 'The turn did not report completion before the stream closed.',
      };

    // A stream that ended because the browser went away is re-queued so the work
    // survives. A stream that ended because the owner pressed Stop is NOT: the
    // client flags the run first, and that flag has to win here or Stop would
    // quietly hand the task to the background instead of stopping it.
    let finalStatus: SliceResult['status'] = settled.status;
    if (finalStatus === 'queued') {
      try {
        const cancelledByOwner = await isCancelRequested(supabase, claimed.id);
        if (cancelledByOwner) finalStatus = 'cancelled';
      } catch {
        /* if we cannot tell, assume a dropped connection and keep the work */
      }
    }

    try {
      await finishRun(supabase, claimed.id, worker, {
        status: finalStatus === 'dead' ? 'dead' : finalStatus,
        checkpoint: settled.checkpoint ?? null,
        error: finalStatus === 'cancelled' ? 'Stopped at your request.' : (settled.error ?? null),
        nextAttemptAt: settled.nextAttemptAt ?? null,
        incrementAttempt: finalStatus === 'queued' ? (settled.incrementAttempt ?? false) : false,
      });
    } catch (err: any) {
      console.warn('[Harness stream] finishRun failed:', err?.message);
    }

    await setSessionStatus(
      supabase,
      sessionId,
      finalStatus === 'failed' || finalStatus === 'dead' ? 'error' : 'idle'
    );

    // The one number this whole change exists to move.
    const elapsed = Date.now() - turn.startedAt;
    const outputTokens = Number(usageSeen?.outputTokens ?? 0);
    const ttft = turn.ttftMs();
    // Where the wait actually went. `firstDeltaMs` is the whole distance from the
    // POST arriving to the first token reaching the client's socket; the stages
    // before it are setup, and `ask` is the provider's own latency.
    const firstDeltaMs = ttft === null ? null : Date.now() - requestStartedAt - (elapsed - ttft);
    console.log(
      '[Harness stream] METRICS ' +
        JSON.stringify({
          runId: claimed.id.slice(0, 8),
          slice: turn.sliceNumber,
          status: finalStatus,
          steps: settled.steps,
          ttftMs: ttft,
          firstDeltaMs,
          setupMs: stages.length ? stages[stages.length - 1][1] : null,
          stages: Object.fromEntries(stages),
          uptimeMs: Math.round(process.uptime() * 1000),
          elapsedMs: elapsed,
          outputTokens,
          tokensPerSec: elapsed > 0 && outputTokens > 0 ? Math.round((outputTokens / elapsed) * 1000) : null,
        })
    );

    if (finalStatus === 'failed' || finalStatus === 'dead') {
      try {
        const { persistTurnError } = await import('@/lib/agent/harness/persist');
        await persistTurnError(supabase, sessionId, settled.error || 'The turn failed.');
      } catch {
        /* the stream closed; the log is best effort here */
      }
    }
  };

  const response = turn.result.toUIMessageStreamResponse({
    sendReasoning: true,
    // Numbers for the client (and for the acceptance check) ride along on the
    // message itself rather than in a second request.
    messageMetadata: ({ part }: any) => {
      if (part?.type === 'start') return { runId: claimed.id, startedAt: Date.now() };
      if (part?.type === 'finish') {
        usageSeen = part.totalUsage ?? null;
        return {
          runId: claimed.id,
          ttftMs: turn.ttftMs(),
          elapsedMs: Date.now() - turn.startedAt,
          usage: part.totalUsage ?? null,
        };
      }
      return undefined;
    },
    onError: (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err || 'The turn failed.');
      console.error('[Harness stream] error:', text);
      return text;
    },
    onFinish: async () => {
      // streamText's own onFinish has (almost certainly) already settled `done`;
      // the timeout only exists so a wedged SDK promise cannot hold the lease.
      const settled = await withTimeout(turn.done, 20_000);
      await finalise(settled);
    },
  });

  // Tell the caller which body it got before it starts parsing, and keep proxies
  // from buffering the stream (banner ads for "slow typing" are usually this).
  const headers = new Headers(response.headers);
  headers.set('X-Nobo-Outcome', 'streaming');
  headers.set('X-Nobo-Run-Id', claimed.id);
  headers.set('Cache-Control', 'no-store, no-transform');
  headers.set('X-Accel-Buffering', 'no');

  return new Response(response.body, { status: 200, headers });
}
