'use client';

/**
 * Consumes the live turn stream (`/api/agent/v2/runs/stream`).
 *
 * Why not `useChat`: the same endpoint has to answer three ways — stream,
 * "delivered to the running task", "a worker took it" — and the caller must be
 * able to tell them apart BEFORE it starts parsing a body. `useChat` assumes a
 * pure UI-message stream, so this reads the response itself: one small fetch,
 * `X-Nobo-Outcome` decides what happened, and `readUIMessageStream` turns the
 * SSE into the same `UIMessage` shape the transcript renderer already knows.
 *
 * The numbers it reports are the point of the change: time to first token, and
 * tokens per second, both measured in the browser against the response it
 * actually received.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';

export type RunStreamOutcome = 'streaming' | 'steered' | 'queued' | 'refused' | 'error' | 'idle';

export interface RunStreamMetrics {
  /** Time from POST to response headers — connection, auth, run claim. */
  firstByteMs: number | null;
  /** Time from POST to the first model delta. THE number. */
  ttftMs: number | null;
  /** Time from POST to the stream ending. */
  elapsedMs: number | null;
  /** Measured output tokens, when the server reported usage. */
  outputTokens: number | null;
  /** Measured tokens/sec (null when usage is unavailable). */
  tokensPerSec: number | null;
  /** Characters received — used for the live estimate while streaming. */
  chars: number;
}

export interface RunStreamSendArgs {
  sessionId: string;
  text: string;
  messageId?: string;
  goal?: string;
  attachments?: Array<{ name: string; url?: string; type: string; size?: number }>;
}

export interface UseRunStream {
  /** The assistant message as it is being generated. Null between turns. */
  message: UIMessage | null;
  streaming: boolean;
  outcome: RunStreamOutcome;
  error: string | null;
  metrics: RunStreamMetrics | null;
  /** Start a turn. Resolves with what the server decided to do, and why. */
  send: (args: RunStreamSendArgs) => Promise<RunStreamResult>;
  stop: () => void;
  reset: () => void;
}

export interface RunStreamResult {
  outcome: RunStreamOutcome;
  /** Present when the turn was refused or the connection failed. */
  error?: string;
  /** Present when the turn was handed to a run that is already going. */
  notice?: string;
}

const EMPTY_METRICS: RunStreamMetrics = {
  firstByteMs: null,
  ttftMs: null,
  elapsedMs: null,
  outputTokens: null,
  tokensPerSec: null,
  chars: 0,
};

/** Text a person can see, gathered from a UI message's parts. */
function visibleText(message: UIMessage | null): string {
  if (!message || !Array.isArray(message.parts)) return '';
  return message.parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}

/** Rough token estimate, only used for the live read-out before usage arrives. */
function estimateTokens(chars: number): number {
  return Math.max(1, Math.round(chars / 4));
}

/**
 * Remove from the live overlay anything the committed transcript already shows.
 *
 * The runner persists each step as it finishes, and the projection renders that
 * step immediately. The live overlay, meanwhile, holds the whole assistant turn
 * so far. In a multi-step answer step 1 therefore exists in both places, and the
 * reader sees it twice — which is exactly what "the agent replied twice" looked
 * like from the outside.
 *
 * The persisted text is always a prefix of the live text (same generation, same
 * order, written at the boundary), so subtracting the longest matching prefix is
 * enough and keeps the still-in-flight step on screen.
 */
export function stripPersistedPrefix(
  message: UIMessage | null,
  persisted: { text?: string[]; reasoning?: string[] }
): UIMessage | null {
  if (!message || !Array.isArray(message.parts)) return message;

  const dropPrefix = (parts: any[], kind: 'text' | 'reasoning', candidates: string[] | undefined) => {
    const keys = (candidates || []).map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    if (!keys.length) return parts;
    const raw = parts
      .filter((p) => p?.kind === kind && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (!raw) return parts;
    // `persistStep` trims each step's text, so the persisted prefix matches the
    // live text with its leading whitespace removed.
    const leading = raw.length - raw.trimStart().length;
    const body = raw.slice(leading);

    let drop = 0;
    for (const key of keys) {
      if (key.length > 0 && body.startsWith(key) && leading + key.length > drop) {
        drop = leading + key.length;
      }
    }
    if (!drop) return parts;

    let remaining = drop;
    return parts.map((p) => {
      if (p?.kind !== kind || typeof p.text !== 'string' || remaining <= 0) return p;
      const cut = Math.min(remaining, p.text.length);
      remaining -= cut;
      return { ...p, text: p.text.slice(cut) };
    });
  };

  const isText = (p: any) => p?.type === 'text';
  const isReasoning = (p: any) => p?.type === 'reasoning' || p?.type === 'thinking';

  const tagged = message.parts.map((part: any) => ({
    ...part,
    kind: isText(part) ? 'text' : isReasoning(part) ? 'reasoning' : 'other',
  })) as any[];

  let next = dropPrefix(tagged, 'text', persisted.text);
  next = dropPrefix(next, 'reasoning', persisted.reasoning);

  return {
    ...message,
    parts: next
      .map((p) => {
        const { kind, ...rest } = p;
        return rest;
      })
      .filter((p: any) => {
        if (isText(p) || isReasoning(p)) return typeof p.text === 'string' ? p.text.trim().length > 0 : false;
        return true;
      }),
  } as UIMessage;
}

/**
 * Convert a raw SSE body into the chunk stream `readUIMessageStream` wants.
 * This is the same pipeline `useChat` uses internally; it is inlined here only
 * because we need to read the response headers first.
 */
function toChunkStream(body: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
  const parsed = parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema });
  return parsed.pipeThrough(
    new TransformStream<any, UIMessageChunk>({
      transform(chunk, controller) {
        if (!chunk?.success) {
          controller.error(chunk?.error ?? new Error('Malformed stream chunk'));
          return;
        }
        controller.enqueue(chunk.value as UIMessageChunk);
      },
    })
  );
}

export function useRunStream(): UseRunStream {
  const [message, setMessage] = useState<UIMessage | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [outcome, setOutcome] = useState<RunStreamOutcome>('idle');
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<RunStreamMetrics | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const noticeRef = useRef<string | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    noticeRef.current = null;
    setMessage(null);
    setStreaming(false);
    setOutcome('idle');
    setError(null);
    setMetrics(null);
  }, []);

  const stop = useCallback(() => {
    // Ask the RUN to stop before dropping the connection.
    //
    // Aborting the fetch alone is indistinguishable from a closed tab, and the
    // server deliberately re-queues that case so no work is lost. Pressing Stop
    // is not a lost connection, so the run is told first and only then is the
    // stream abandoned.
    const runId = runIdRef.current;
    if (runId) {
      void fetch(`/api/agent/v2/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' }).catch(() => {});
    }
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async (args: RunStreamSendArgs): Promise<RunStreamResult> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    noticeRef.current = null;
    setMessage(null);
    setError(null);
    setStreaming(true);
    setOutcome('streaming');
    setMetrics({ ...EMPTY_METRICS });

    const startedAt = Date.now();
    let firstByteMs: number | null = null;
    let ttftMs: number | null = null;
    let chars = 0;

    try {
      const res = await fetch('/api/agent/v2/runs/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: args.sessionId,
          message: args.text,
          messageId: args.messageId,
          goal: args.goal,
          attachments: args.attachments,
        }),
        signal: controller.signal,
      });
      firstByteMs = Date.now() - startedAt;

      const decision = (res.headers.get('X-Nobo-Outcome') || '') as RunStreamOutcome | '';
      runIdRef.current = res.headers.get('X-Nobo-Run-Id') || null;

      if (!res.ok || decision !== 'streaming' || !res.body) {
        const body = await res.json().catch(() => ({}) as any);
        const reason = String(body?.error || body?.message || `Request failed (${res.status})`);

        if (decision === 'steered' || decision === 'queued') {
          // Not an error: the turn is being handled elsewhere — either folded into
          // the run that is already working, or picked up by a worker. Realtime
          // fills the transcript in, so this must not raise a red banner.
          const notice =
            String(body?.message || '') ||
            (decision === 'steered'
              ? 'Delivered to the running task.'
              : 'A worker picked this up — the reply will appear here.');
          noticeRef.current = notice;
          if (mountedRef.current) {
            setStreaming(false);
            setOutcome(decision);
            setMetrics({ ...EMPTY_METRICS, firstByteMs, elapsedMs: Date.now() - startedAt });
          }
          return { outcome: decision, notice };
        }

        if (mountedRef.current) {
          setStreaming(false);
          setOutcome(decision === 'refused' ? 'refused' : 'error');
          setError(reason);
          setMetrics({ ...EMPTY_METRICS, firstByteMs, elapsedMs: Date.now() - startedAt });
        }
        return { outcome: decision === 'refused' ? 'refused' : 'error', error: reason };
      }

      let latest: UIMessage | null = null;
      let usage: any = null;

      // Re-rendering the transcript once per token is its own kind of slow: at a
      // healthy rate that is 60-100 markdown re-renders a second, and the UI
      // becomes the bottleneck instead of the transport. Paint at ~20fps and
      // always paint the final state.
      const FLUSH_MS = 50;
      let lastFlush = 0;

      for await (const next of readUIMessageStream({ stream: toChunkStream(res.body) })) {
        latest = next as UIMessage;
        const text = visibleText(latest);
        chars = text.length;
        if (ttftMs === null && text.length > 0) ttftMs = Date.now() - startedAt;

        const meta: any = (latest as any)?.metadata;
        if (meta?.usage) usage = meta.usage;

        if (!mountedRef.current) continue;
        const now = Date.now();
        if (now - lastFlush < FLUSH_MS) continue;
        lastFlush = now;
        setMessage(latest);
        setMetrics({
          firstByteMs,
          ttftMs,
          elapsedMs: now - startedAt,
          outputTokens: usage?.outputTokens ?? null,
          tokensPerSec: null, // filled in below once the stream ends
          chars,
        });
      }

      const elapsed = Date.now() - startedAt;
      const measuredTokens = Number(usage?.outputTokens ?? 0);
      // Streaming stops before the last token, so the honest rate is measured
      // from the first token to the last one, not from the request.
      const generationMs = ttftMs === null ? elapsed : Math.max(1, elapsed - ttftMs);
      const tokensForRate = measuredTokens > 0 ? measuredTokens : estimateTokens(chars);

      if (mountedRef.current) {
        setMessage(latest);
        setStreaming(false);
        setOutcome('idle');
        setMetrics({
          firstByteMs,
          ttftMs,
          elapsedMs: elapsed,
          outputTokens: measuredTokens > 0 ? measuredTokens : null,
          tokensPerSec: Math.round((tokensForRate / generationMs) * 1000 * 10) / 10,
          chars,
        });
      }
      return { outcome: 'streaming' };
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      const reason = aborted ? undefined : err?.message || 'The connection dropped.';
      if (mountedRef.current) {
        setStreaming(false);
        setOutcome(aborted ? 'idle' : 'error');
        if (reason) setError(reason);
        setMetrics((prev) => ({
          ...(prev || EMPTY_METRICS),
          firstByteMs,
          ttftMs,
          elapsedMs: Date.now() - startedAt,
          chars,
        }));
      }
      return { outcome: aborted ? 'idle' : 'error', error: reason };
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { message, streaming, outcome, error, metrics, send, stop, reset };
}

/** Log the last turn's numbers once, so a slow reply is visible in the console
 *  instead of only as a feeling. */
export function logStreamMetrics(label: string, metrics: RunStreamMetrics | null): void {
  if (!metrics) return;
  console.info(
    `[Nobo stream] ${label}`,
    JSON.stringify({
      firstByteMs: metrics.firstByteMs,
      ttftMs: metrics.ttftMs,
      elapsedMs: metrics.elapsedMs,
      chars: metrics.chars,
      outputTokens: metrics.outputTokens,
      tokensPerSec: metrics.tokensPerSec,
    })
  );
}
