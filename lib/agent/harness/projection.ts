/**
 * Harness projections: pure, synchronous folds from the event log to UI state.
 *
 * No React, no IO, no Date.now() — a projection is a function of the log only,
 * so the same log always renders the same screen. That is what makes resume,
 * replay and multi-device consistency possible, and it is what the previous
 * design (client-owned `useChat` state in localStorage) could not do.
 *
 * Reference: `@deepseek-ai/dsh-session-projection` — "a pure synchronous fold
 * plus declarations and an optional client view … A unit uninterested in an
 * event MUST return the same state reference."
 */
import type { HarnessEvent } from './events';

export type HarnessItem =
  | { kind: 'user'; id: string; text: string; attachments?: AttachmentView[] }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      input?: unknown;
      output?: unknown;
      status: 'running' | 'done' | 'failed';
    }
  | { kind: 'error'; id: string; message: string };

export interface AttachmentView {
  name: string;
  url?: string;
  type: string;
  size?: number;
}

export interface HarnessState {
  sessionId: string;
  title: string;
  workspaceId: string;
  /** Session status for the sidebar dot. */
  status: 'idle' | 'running' | 'error';
  /** Latest durable-run lifecycle state, if the session has background runs. */
  runStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancelled_partial' | 'paused';
  /** Detail for the current run status (e.g. why it failed). */
  runDetail?: string;
  /** Ordered, exactly as a DSH conversation renders. */
  items: HarnessItem[];
  /** toolCallId → index into `items`, so a result can update its call in place. */
  toolIndex: Record<string, number>;
  /** Item ids already folded — makes replay of the same log a no-op. */
  seenIds: Record<string, true>;
  /** Tool calls that already have a result — same reason. */
  resolvedCalls: Record<string, true>;
  /** Incremented whenever the projection changes; cheap change detection. */
  version: number;
}

export function initialState(sessionId: string): HarnessState {
  return {
    sessionId,
    title: 'New session',
    workspaceId: 'default',
    status: 'idle',
    items: [],
    toolIndex: {},
    seenIds: {},
    resolvedCalls: {},
    version: 0,
  };
}

/** Same-reference return helper — the framework relies on it to skip work. */
function unchanged(state: HarnessState): HarnessState {
  return state;
}

/**
 * Fold one event. Returns the SAME reference when the event does not apply, so
 * callers can compare with `===` to decide whether to re-render.
 */
export function applyEvent(state: HarnessState, event: HarnessEvent): HarnessState {
  const d = event.data as Record<string, any>;

  switch (event.type) {
    case 'session.opened':
      return {
        ...state,
        title: typeof d.title === 'string' ? d.title : state.title,
        workspaceId: typeof d.workspaceId === 'string' ? d.workspaceId : state.workspaceId,
        version: state.version + 1,
      };

    case 'session.titled':
      if (typeof d.title !== 'string' || d.title === state.title) return unchanged(state);
      return { ...state, title: d.title, version: state.version + 1 };

    case 'session.status': {
      const status = d.status;
      if (status !== 'idle' && status !== 'running' && status !== 'error') return unchanged(state);
      if (status === state.status) return unchanged(state);
      return { ...state, status, version: state.version + 1 };
    }

    case 'user.message': {
      if (typeof d.id !== 'string' || typeof d.text !== 'string') return unchanged(state);
      if (state.seenIds[d.id]) return unchanged(state);
      return {
        ...state,
        items: [
          ...state.items,
          {
            kind: 'user',
            id: d.id,
            text: d.text,
            attachments: Array.isArray(d.attachments) ? d.attachments : undefined,
          },
        ],
        seenIds: { ...state.seenIds, [d.id]: true },
        version: state.version + 1,
      };
    }

    case 'assistant.reasoning': {
      if (typeof d.id !== 'string' || typeof d.text !== 'string' || !d.text.trim()) {
        return unchanged(state);
      }
      if (state.seenIds[d.id]) return unchanged(state);
      return {
        ...state,
        items: [...state.items, { kind: 'reasoning', id: d.id, text: d.text }],
        seenIds: { ...state.seenIds, [d.id]: true },
        version: state.version + 1,
      };
    }

    case 'assistant.text': {
      if (typeof d.id !== 'string' || typeof d.text !== 'string' || !d.text.trim()) {
        return unchanged(state);
      }
      // Upsert by id rather than first-write-wins.
      //
      // The runner streams partial text and rewrites this event with the same id
      // as the answer grows. Ignoring repeats meant the UI only ever showed the
      // first fragment, so a long reply appeared to stall and then jump. Writing
      // the same text twice is still a no-op, which keeps replay idempotent.
      const at = state.items.findIndex((i) => i.kind === 'assistant' && i.id === d.id);
      if (at === -1) {
        return {
          ...state,
          items: [...state.items, { kind: 'assistant', id: d.id, text: d.text }],
          seenIds: { ...state.seenIds, [d.id]: true },
          version: state.version + 1,
        };
      }
      const existing = state.items[at];
      if (existing.kind === 'assistant' && existing.text === d.text) return unchanged(state);
      const items = state.items.slice();
      items[at] = { kind: 'assistant', id: d.id, text: d.text };
      return { ...state, items, version: state.version + 1 };
    }

    case 'tool.call': {
      if (typeof d.callId !== 'string' || typeof d.name !== 'string') return unchanged(state);
      // Idempotent: a replayed log must not duplicate the row.
      if (state.toolIndex[d.callId] !== undefined) return unchanged(state);
      const items = [
        ...state.items,
        {
          kind: 'tool' as const,
          id: d.callId,
          name: d.name,
          input: d.input,
          status: 'running' as const,
        },
      ];
      return {
        ...state,
        items,
        toolIndex: { ...state.toolIndex, [d.callId]: items.length - 1 },
        version: state.version + 1,
      };
    }

    case 'tool.result': {
      if (typeof d.callId !== 'string') return unchanged(state);
      const at = state.toolIndex[d.callId];
      if (at === undefined) return unchanged(state);
      if (state.resolvedCalls[d.callId]) return unchanged(state);
      const existing = state.items[at];
      if (!existing || existing.kind !== 'tool') return unchanged(state);
      const items = state.items.slice();
      items[at] = {
        ...existing,
        output: d.output,
        status: d.isError ? 'failed' : 'done',
      };
      return {
        ...state,
        items,
        resolvedCalls: { ...state.resolvedCalls, [d.callId]: true },
        version: state.version + 1,
      };
    }

    case 'turn.error': {
      if (typeof d.message !== 'string' || !d.message) return unchanged(state);
      const id = `err_${event.seq}`;
      if (state.seenIds[id]) return unchanged(state);
      return {
        ...state,
        status: 'error',
        items: [...state.items, { kind: 'error', id, message: d.message }],
        seenIds: { ...state.seenIds, [id]: true },
        version: state.version + 1,
      };
    }

    case 'run.status': {
      // The event schema already validated this; narrow it for the type system.
      const status = d.status as HarnessState['runStatus'];
      if (typeof status !== 'string') return unchanged(state);
      return {
        ...state,
        runStatus: status,
        runDetail: typeof d.detail === 'string' ? d.detail : undefined,
        // A busy run makes the session look busy in the sidebar.
        status: status === 'running' || status === 'queued' ? 'running' : state.status === 'error' ? 'error' : 'idle',
        version: state.version + 1,
      };
    }

    default:
      return unchanged(state);
  }
}

/** Fold a whole log. Order by `seq` first — the log is authoritative. */
export function project(sessionId: string, events: HarnessEvent[]): HarnessState {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let state = initialState(sessionId);
  for (const ev of ordered) {
    state = applyEvent(state, ev);
  }
  return state;
}

/** Derived: the plain-text transcript, useful for export, copy and re-prompting. */
export function toTranscript(state: HarnessState): string {
  return state.items
    .map((item) => {
      switch (item.kind) {
        case 'user':
          return `User: ${item.text}`;
        case 'assistant':
          return `Assistant: ${item.text}`;
        case 'reasoning':
          return `[reasoning] ${item.text}`;
        case 'tool':
          return `[tool ${item.name}] ${item.status}`;
        case 'error':
          return `[error] ${item.message}`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Derived: a default title from the first user message. */
export function deriveTitle(state: HarnessState, max = 60): string {
  const first = state.items.find((i) => i.kind === 'user');
  if (!first || first.kind !== 'user') return state.title;
  const line = first.text.replace(/\s+/g, ' ').trim();
  if (!line) return state.title;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Rebuild the model-facing conversation from the projection.
 *
 * Needed because `useChat` owns the model context while a turn is streaming.
 * When a session is reopened from the log, the transport must be handed the
 * history again or every follow-up would be a conversation with itself.
 *
 * Only user and assistant prose crosses over: reasoning blocks are display
 * artefacts and tool traffic is replayed through the log, not the prompt.
 * Consecutive same-role messages are merged, which some providers reject
 * otherwise.
 */
export function itemsToUIMessages(
  items: HarnessItem[]
): Array<{ id: string; role: 'user' | 'assistant'; parts: Array<{ type: 'text'; text: string }> }> {
  const out: Array<{ id: string; role: 'user' | 'assistant'; parts: Array<{ type: 'text'; text: string }> }> = [];

  for (const item of items) {
    if (item.kind !== 'user' && item.kind !== 'assistant') continue;
    const text = item.text.trim();
    if (!text) continue;

    const role = item.kind === 'user' ? 'user' : 'assistant';
    const last = out[out.length - 1];

    if (last && last.role === role) {
      last.parts[0].text = `${last.parts[0].text}\n\n${text}`;
      continue;
    }

    out.push({ id: item.id, role, parts: [{ type: 'text', text }] });
  }

  return out;
}

/**
 * Rebuild the MODEL conversation from the projection — faithfully.
 *
 * Unlike `itemsToUIMessages` (for display, deliberately drops reasoning and tool
 * traffic), this reconstructs tool calls and results and keeps reasoning blocks.
 * That matters twice over:
 *  - a resumed run must see what it already did, tool results included;
 *  - DeepSeek's thinking mode rejects replayed history in which assistant turns
 *    have lost their `reasoning_content`
 *    ("The `reasoning_content` in the thinking mode must be passed back to the API").
 *
 * Content-part shapes follow the AI SDK's ModelMessage:
 *   assistant: { type: 'reasoning' | 'text' | 'tool-call' }
 *   tool:      { type: 'tool-result', toolCallId, toolName, output }
 */
export function itemsToModelMessages(items: HarnessItem[]): any[] {
  const out: any[] = [];
  let pendingAssistant: any[] = [];

  const flushAssistant = () => {
    if (!pendingAssistant.length) return;
    out.push({ role: 'assistant', content: pendingAssistant });
    pendingAssistant = [];
  };

  for (const item of items) {
    switch (item.kind) {
      case 'user': {
        flushAssistant();
        const text = item.text?.trim();
        if (text) out.push({ role: 'user', content: [{ type: 'text', text }] });
        break;
      }
      case 'reasoning': {
        const text = item.text?.trim();
        if (text) pendingAssistant.push({ type: 'reasoning', text });
        break;
      }
      case 'assistant': {
        const text = item.text?.trim();
        if (text) pendingAssistant.push({ type: 'text', text });
        break;
      }
      case 'tool': {
        // The call belongs to the assistant turn; the result is a separate
        // `tool` message that must follow it.
        pendingAssistant.push({
          type: 'tool-call',
          toolCallId: item.id,
          toolName: item.name,
          input: item.input ?? {},
        });
        flushAssistant();
        if (item.status !== 'running') {
          out.push({
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: item.id,
                toolName: item.name,
                output: { type: 'json', value: item.output ?? { success: true } },
              },
            ],
          });
        }
        break;
      }
      case 'error': {
        flushAssistant();
        out.push({
          role: 'user',
          content: [{ type: 'text', text: `[system note] a previous attempt failed: ${item.message}` }],
        });
        break;
      }
      default:
        break;
    }
  }

  flushAssistant();
  return out;
}
