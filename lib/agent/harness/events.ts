/**
 * Harness event vocabulary.
 *
 * The session log is append-only; the UI is a projection over it. This mirrors
 * the DeepSeek Harness model (`@deepseek-ai/dsh-session-projection`): state is
 * plain JSON, folds are pure and synchronous, and an event that a projection
 * does not care about must leave the previous state reference untouched.
 *
 * Add a new capability by adding an event type here plus a fold case in
 * `projection.ts` — never by adding client-side state.
 */
import { z } from 'zod';

export const HARNESS_EVENT_TYPES = [
  /** Session opened. Carries the full post-change metadata. */
  'session.opened',
  /** Title changed (auto-titled from the first prompt, or renamed). */
  'session.titled',
  /** Run state for the sidebar dot. */
  'session.status',
  /** A message from the human. */
  'user.message',
  /** Assistant reasoning / thinking block. */
  'assistant.reasoning',
  /** Assistant prose for one step. */
  'assistant.text',
  /** A tool call started. */
  'tool.call',
  /** A tool call produced a result (or failed). */
  'tool.result',
  /** Terminal error for a turn. */
  'turn.error',
  /** Durable background run lifecycle, so the UI can show queued/running/etc. */
  'run.status',
] as const;

export type HarnessEventType = (typeof HARNESS_EVENT_TYPES)[number];

const attachmentSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  type: z.string(),
  size: z.number().optional(),
});

export const eventDataSchemas = {
  'session.opened': z.object({
    title: z.string(),
    workspaceId: z.string(),
  }),
  'session.titled': z.object({
    title: z.string(),
  }),
  'session.status': z.object({
    status: z.enum(['idle', 'running', 'error']),
  }),
  'user.message': z.object({
    id: z.string(),
    text: z.string(),
    attachments: z.array(attachmentSchema).optional(),
  }),
  'assistant.reasoning': z.object({
    id: z.string(),
    text: z.string(),
  }),
  'assistant.text': z.object({
    id: z.string(),
    text: z.string(),
  }),
  'tool.call': z.object({
    callId: z.string(),
    name: z.string(),
    input: z.unknown().optional(),
  }),
  'tool.result': z.object({
    callId: z.string(),
    name: z.string().optional(),
    output: z.unknown().optional(),
    isError: z.boolean().optional(),
  }),
  'turn.error': z.object({
    message: z.string(),
  }),
  'run.status': z.object({
    status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'cancelled_partial', 'paused']),
    /** Short human-readable reason, e.g. "continuing" or the failure message. */
    detail: z.string().optional(),
    slice: z.number().optional(),
  }),
} satisfies Record<HarnessEventType, z.ZodTypeAny>;

/** A persisted log row. */
export interface HarnessEvent {
  seq: number;
  type: HarnessEventType;
  data: Record<string, unknown>;
  createdAt?: string;
}

export type EventData<T extends HarnessEventType> = z.infer<(typeof eventDataSchemas)[T]>;

/**
 * Build an event with validated data. Throws on a malformed payload — at the
 * write site, never in the renderer.
 */
export function createEvent<T extends HarnessEventType>(
  type: T,
  data: EventData<T>
): { type: T; data: Record<string, unknown> } {
  const parsed = eventDataSchemas[type].parse(data) as Record<string, unknown>;
  return { type, data: parsed };
}

/** Validate an untrusted log row (e.g. straight from Postgres). */
export function parseEvent(row: unknown): HarnessEvent | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const type = r.type;
  if (typeof type !== 'string' || !HARNESS_EVENT_TYPES.includes(type as HarnessEventType)) {
    return null;
  }
  const schema = eventDataSchemas[type as HarnessEventType];
  const parsed = schema.safeParse(r.data ?? {});
  if (!parsed.success) return null;
  return {
    seq: typeof r.seq === 'number' ? r.seq : Number(r.seq) || 0,
    type: type as HarnessEventType,
    data: parsed.data as Record<string, unknown>,
    createdAt: typeof r.created_at === 'string' ? r.created_at : undefined,
  };
}
