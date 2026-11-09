/**
 * Model-context compaction for durable runs.
 *
 * The checkpoint holds the model conversation, so a long run would otherwise
 * grow it without bound until the row is huge, every slice is slow, and the
 * provider eventually rejects the prompt for length.
 *
 * Compaction only touches the MODEL's copy of the conversation. The display log
 * (`harness_events`) keeps every step, so the transcript the user reads is never
 * summarised or truncated — the same split DeepSeek Harness makes between its
 * session log and its compaction plugin.
 */
import type { ModelMessage } from 'ai';
import { generateText } from 'ai';
import { getAgentModel } from '../deepseek';

/** Compact once the conversation exceeds this many characters (~15k tokens). */
export const COMPACT_CHAR_THRESHOLD = 60_000;

/** Always keep this many most-recent messages verbatim. */
export const KEEP_RECENT_MESSAGES = 12;

/** Never let a summary balloon. */
const MAX_SUMMARY_CHARS = 4_000;

export interface CompactionResult {
  messages: ModelMessage[];
  compacted: boolean;
  beforeChars: number;
  afterChars: number;
}

/** Rough size of a message list — string length of its serialised form. */
export function estimateChars(messages: unknown[]): number {
  try {
    return JSON.stringify(messages).length;
  } catch {
    return 0;
  }
}

function textOf(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part?.text === 'string') return part.text;
        if (part?.type === 'tool-call') return `[called ${part.toolName}(${JSON.stringify(part.input).slice(0, 400)})]`;
        if (part?.type === 'tool-result') {
          const out = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
          return `[${part.toolName} returned ${String(out).slice(0, 600)}]`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function summarise(transcript: string): Promise<string> {
  const model = await getAgentModel();
  const { text } = await generateText({
    model,
    prompt:
      'Compress the following agent task transcript into a compact working brief for the same agent, which will ' +
      'continue the task. Preserve: what the user asked for, decisions made, every tool action already taken and ' +
      'its outcome, file paths and URLs produced, important facts learned, and anything still pending or blocked. ' +
      'Drop pleasantries and repetition. Use terse bullet points. Do not invent anything.\n\n' +
      transcript.slice(0, 120_000),
  });
  const summary = (text || '').trim();
  return summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…` : summary;
}

/**
 * Compact if the conversation is over budget. Returns the same array untouched
 * when there is nothing to do.
 */
export async function maybeCompact(
  messages: ModelMessage[],
  opts: { thresholdChars?: number; keepRecent?: number; force?: boolean } = {}
): Promise<CompactionResult> {
  const threshold = opts.thresholdChars ?? COMPACT_CHAR_THRESHOLD;
  const keepRecent = opts.keepRecent ?? KEEP_RECENT_MESSAGES;
  const before = estimateChars(messages);

  if (!opts.force && before <= threshold) {
    return { messages, compacted: false, beforeChars: before, afterChars: before };
  }
  if (messages.length <= keepRecent + 2) {
    return { messages, compacted: false, beforeChars: before, afterChars: before };
  }

  const cutoff = Math.max(1, messages.length - keepRecent);
  const head = messages.slice(0, cutoff);
  const tail = messages.slice(cutoff);

  const transcript = head
    .map((m, i) => `#${i + 1} ${m.role}: ${textOf(m)}`)
    .filter((line) => line.trim().length > 12)
    .join('\n');

  if (transcript.length < 500) {
    return { messages, compacted: false, beforeChars: before, afterChars: before };
  }

  try {
    const summary = await summarise(transcript);
    if (!summary) return { messages, compacted: false, beforeChars: before, afterChars: before };

    const bridge: ModelMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `[Compacted earlier context — ${cutoff} messages were condensed to save space. ` +
            `The full transcript is still in the session log.]\n\n${summary}`,
        },
      ],
    };

    const next = [bridge, ...tail];
    const after = estimateChars(next);
    console.log(`[compaction] ${messages.length} → ${next.length} messages, ${before} → ${after} chars`);
    return { messages: next, compacted: true, beforeChars: before, afterChars: after };
  } catch (err: any) {
    // Never let compaction break a run — carry on with the full context.
    console.warn('[compaction] failed, keeping the full context:', err?.message);
    return { messages, compacted: false, beforeChars: before, afterChars: before };
  }
}
