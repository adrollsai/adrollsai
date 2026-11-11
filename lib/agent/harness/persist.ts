/**
 * Writes a streamed agent step into the harness event log.
 *
 * Kept out of the route handler so the mapping from AI-SDK step results to log
 * events lives in one testable place. The ordering here is the rendering order:
 * reasoning → tool calls → tool results → prose.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEvent, type HarnessEventType } from './events';
import { appendEvents, renameSession } from './store';

const DEFAULT_TITLE = 'New session';

interface ToolCallLike {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
}

interface ToolResultLike {
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
}

/** A step from `streamText`'s `onStepFinish` — typed structurally so we do not
 *  depend on the SDK's generic parameters here. */
export interface StreamedStep {
  stepNumber?: number;
  text?: string;
  reasoningText?: string;
  toolCalls?: readonly ToolCallLike[];
  toolResults?: readonly ToolResultLike[];
}

function isFailedResult(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false;
  const o = output as Record<string, unknown>;
  return o.success === false || typeof o.error === 'string';
}

/** Convert one finished step into the events that reproduce it. */
export function stepToEvents(step: StreamedStep): Array<{
  type: HarnessEventType;
  data: Record<string, unknown>;
}> {
  const events: Array<{ type: HarnessEventType; data: Record<string, unknown> }> = [];
  // Unique per step so replaying the same step twice cannot duplicate rows.
  const tag = `st${step.stepNumber ?? 0}`;

  const reasoning = typeof step.reasoningText === 'string' ? step.reasoningText.trim() : '';
  if (reasoning) {
    events.push(createEvent('assistant.reasoning', { id: `${tag}_r`, text: reasoning }));
  }

  for (const call of step.toolCalls ?? []) {
    if (!call?.toolCallId || !call?.toolName) continue;
    events.push(
      createEvent('tool.call', {
        callId: call.toolCallId,
        name: call.toolName,
        input: call.input,
      })
    );
  }

  for (const result of step.toolResults ?? []) {
    if (!result?.toolCallId) continue;
    events.push(
      createEvent('tool.result', {
        callId: result.toolCallId,
        name: result.toolName,
        output: result.output,
        isError: isFailedResult(result.output),
      })
    );
  }

  const text = typeof step.text === 'string' ? step.text.trim() : '';
  if (text) {
    events.push(createEvent('assistant.text', { id: `${tag}_t`, text }));
  }

  return events;
}

/** Persist a finished step. Never throws — the stream must not die on a write. */
export async function persistStep(
  supabase: SupabaseClient,
  sessionId: string,
  step: StreamedStep
): Promise<void> {
  try {
    const events = stepToEvents(step);
    if (!events.length) return;
    await appendEvents(supabase, sessionId, events);
  } catch (err: any) {
    console.error('[Harness] persistStep failed:', err?.message || err);
  }
}

/** Record a terminal failure for the turn. */
export async function persistTurnError(
  supabase: SupabaseClient,
  sessionId: string,
  message: string
): Promise<void> {
  try {
    const event = createEvent('turn.error', { message: message.slice(0, 2000) });
    await appendEvents(supabase, sessionId, [event]);
  } catch (err: any) {
    console.error('[Harness] persistTurnError failed:', err?.message || err);
  }
}

/**
 * Name a brand-new session after its first prompt, so the sidebar tree shows
 * something meaningful. Only replaces the default title.
 */
export async function maybeAutoTitle(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  prompt: string
): Promise<string | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('harness_sessions')
      .select('title')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    if (data.title && data.title !== DEFAULT_TITLE) return data.title;

    const clean = prompt.replace(/\s+/g, ' ').trim();
    if (!clean) return null;

    // Summarise, don't truncate. Slicing the first 60 characters produced names
    // like "hey can you make me a ..." — a half-sentence, not a name. A short
    // model call yields a 2-6 word label, which is what the reference harness does.
    let title = '';
    try {
      const { callDeepSeekWithUsage } = await import('@/utils/external-apis');
      const res = await callDeepSeekWithUsage(
        `Name this chat. Rules: 2 to 5 words, no quotes, no trailing punctuation, ` +
          `Title Case, describe the TASK not the greeting. Reply with the name only.\n\n` +
          `First message: ${clean.slice(0, 500)}`,
        { maxTokens: 24, temperature: 0.2, timeoutMs: 6000 }
      );
      const raw = String(res.text || '').split('\n')[0].trim();
      title = raw.replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?:;,]+$/, '').trim();
      if (title.split(/\s+/).length > 7 || title.length > 60) title = '';
    } catch {
      /* naming must never block a turn */
    }

    if (!title) {
      title = clean.length > 60 ? `${clean.slice(0, 59)}\u2026` : clean;
    }
    if (title === DEFAULT_TITLE) return null;

    const ok = await renameSession(supabase, userId, sessionId, title);
    return ok ? title : null;
  } catch {
    return null;
  }
}
