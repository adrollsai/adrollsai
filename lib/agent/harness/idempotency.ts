/**
 * Exactly-once side effects for durable runs.
 *
 * The failure this prevents: a slice executes a tool that sends a WhatsApp
 * message or launches an ad campaign, then dies before the checkpoint is saved.
 * On resume the model re-issues that tool call — and without a ledger it would
 * fire a second time, spending real money and messaging real people twice.
 *
 * Mechanism (the standard "activity idempotency key" approach):
 *   key = hash(run_id, tool_name, normalised input)
 *   - already `completed`/`failed` → replay the stored outcome, never re-execute
 *   - `started` and fresh             → another slice owns it; retry later
 *   - `started` and stale             → outcome unknown: refuse to retry, and
 *                                       dead-letter the run for human review
 *
 * Only side-effecting tools are wrapped. Read-only tools re-run freely, which
 * keeps repeated identical reads working normally.
 */
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beginToolCall, finishToolCall, type ToolCallRecord } from './runs';

/** A side effect definitely did or may have happened. Do not retry blindly. */
export class UnsafeToRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeToRetryError';
  }
}

/** Transient clash — safe to try again on the next slice. */
export class ToolBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolBusyError';
  }
}

/** Prefixes that mutate state, spend money, or message people. */
const SIDE_EFFECT_PREFIXES = [
  'send_',
  'create_',
  'update_',
  'delete_',
  'launch_',
  'publish_',
  'schedule_',
  'cancel_or_delete_',
  'organize_or_move_',
  'generate_',
  'dispatch',
  'submit_',
  'prepare_',
  'nobogent_whatsapp_send',
  'nobogent_voice_dispatch',
  'nobogent_crm_create',
  'meta_mcp_create',
  'meta_mcp_launch',
  'sandbox_publish',
  'sandbox_write',
  'sandbox_render',
  'vercel_',
  'supabase_mcp_',
];

/** Unambiguously safe to repeat. Checked first so `update_`-style verbs on
 *  read tools are not caught by a prefix rule. */
const READ_ONLY_PREFIXES = [
  'list_',
  'get_',
  'query_',
  'search_',
  'find_',
  'inspect_',
  'analyze_',
  'read_',
  'fetch_',
  'preview_',
  'count_',
  'check_',
];

export function isSideEffecting(toolName: string): boolean {
  if (!toolName) return false;
  const name = toolName.toLowerCase();
  if (READ_ONLY_PREFIXES.some((p) => name.startsWith(p))) return false;
  return SIDE_EFFECT_PREFIXES.some((p) => name.startsWith(p));
}

/** Deterministic JSON: object keys sorted at every depth. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function idempotencyKey(
  runId: string,
  toolName: string,
  input: unknown,
  /** Which occurrence of this exact call within the run (1-based). */
  occurrence = 1
): string {
  return crypto
    .createHash('sha256')
    .update(`${runId}\u0000${toolName}\u0000${occurrence}\u0000${stableStringify(input)}`)
    .digest('hex')
    .slice(0, 40);
}

/**
 * Count how many times each (tool, input) pair already appears in the model
 * conversation we are resuming from.
 *
 * This is the baseline for occurrence numbering. Using the CHECKPOINT (not the
 * event log) is what makes the key stable: the checkpoint is exactly what the
 * model was shown, so a re-issued call means "this occurrence is not yet
 * recorded" and maps to the same ledger row it did before the crash.
 */
export function countToolOccurrences(messages: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (toolName: string, input: unknown) => {
    const key = `${toolName}\u0000${idempotencyKey('', toolName, input, 1)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  for (const message of messages as any[]) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === 'tool-call' && part.toolName) bump(part.toolName, part.input);
    }
  }
  return counts;
}

/** Baseline key used for occurrence lookup (run id and occurrence excluded). */
function occurrenceLookupKey(toolName: string, input: unknown): string {
  return `${toolName}\u0000${idempotencyKey('', toolName, input, 1)}`;
}

function replayedOutcome(record: ToolCallRecord): unknown {
  if (record.status === 'failed') {
    return {
      success: false,
      error: record.error || 'This action previously failed; its recorded outcome is being replayed.',
      replayed: true,
    };
  }
  if (record.output && typeof record.output === 'object') {
    return { ...(record.output as Record<string, unknown>), replayed: true };
  }
  return record.output ?? { success: true, replayed: true };
}

export interface IdempotencyContext {
  supabase: SupabaseClient;
  runId: string;
  sessionId: string;
  /** How long a "started" row may sit before its outcome is unknown. */
  staleAfterMs?: number;
  /**
   * Occurrence counters seeded from the resumed checkpoint (see
   * `countToolOccurrences`). Mutated as calls happen, so two identical calls in
   * one slice get occurrence 1 and 2 — they are legitimate, not duplicates.
   */
  occurrences?: Map<string, number>;
  onReplay?: (toolName: string, record: ToolCallRecord) => void;
}

/**
 * Wrap a tool set so side-effecting tools are executed at most once per
 * (run, occurrence). Non-mutating tools pass through untouched.
 */
export function wrapToolsWithIdempotency<T extends Record<string, any>>(
  tools: T,
  ctx: IdempotencyContext
): T {
  const wrapped: Record<string, any> = {};
  const occurrences = ctx.occurrences ?? new Map<string, number>();

  for (const [name, toolDef] of Object.entries(tools)) {
    if (!toolDef || typeof toolDef.execute !== 'function' || !isSideEffecting(name)) {
      wrapped[name] = toolDef;
      continue;
    }

    const originalExecute = toolDef.execute.bind(toolDef);

    wrapped[name] = {
      ...toolDef,
      execute: async (input: any, options: any) => {
        // Which repetition of this exact call is this?
        const lookupKey = occurrenceLookupKey(name, input);
        const occurrence = (occurrences.get(lookupKey) || 0) + 1;
        occurrences.set(lookupKey, occurrence);

        const inputHash = idempotencyKey(ctx.runId, name, input, occurrence);
        const lookup = await beginToolCall(ctx.supabase, {
          runId: ctx.runId,
          sessionId: ctx.sessionId,
          toolName: name,
          inputHash,
          input,
          staleAfterMs: ctx.staleAfterMs,
        });

        if (lookup.state === 'completed') {
          console.log(
            `[idempotency] replaying ${name} occurrence ${occurrence} (already ran in this run) — not executing again`
          );
          ctx.onReplay?.(name, lookup.record);
          return replayedOutcome(lookup.record);
        }

        if (lookup.state === 'in_flight') {
          throw new ToolBusyError(`${name} is already running in another slice; retrying this slice later.`);
        }

        if (lookup.state === 'unknown_outcome') {
          throw new UnsafeToRetryError(
            `${name} started at ${lookup.record.created_at} but never recorded a result. ` +
              `Its side effect may already have happened, so it will not be retried automatically. ` +
              `Review it, then requeue the run.`
          );
        }

        const recordId = lookup.record?.id;
        try {
          const result = await originalExecute(input, options);
          if (recordId) {
            await finishToolCall(ctx.supabase, recordId, { status: 'completed', output: result });
          }
          return result;
        } catch (err: any) {
          const message = String(err?.message || err).slice(0, 900);
          if (recordId) {
            await finishToolCall(ctx.supabase, recordId, { status: 'failed', error: message });
          }
          throw err;
        }
      },
    };
  }

  return wrapped as T;
}
