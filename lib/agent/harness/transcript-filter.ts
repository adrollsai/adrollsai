/**
 * What the transcript is allowed to hide.
 *
 * WHY THIS FILE EXISTS
 * The owner reported that a message typed while the agent is working "just disappears — it seems like we
 * didn't send anything", even though the app said it would be considered before the next step. The log
 * held the message (verified on production in `harness_events`: a `user.message` written mid-run at seq
 * 46 of one session and seq 254 of another), so the message was not lost — it was HIDDEN by a rendering
 * rule.
 *
 * The rule collapsed consecutive identical items for both roles. For an assistant reply that is right:
 * the live stream writes the reply and the queued run writes it again, and two identical paragraphs
 * read as a bug. For a USER message it is wrong, because two identical user messages are two separate
 * acts, not one row rendered twice:
 *
 *   - the owner asks "what is the update?", sees nothing happen, and asks again — the second question
 *     is real and must appear, or the UI is telling them their second attempt was not received;
 *   - a steering message that happens to repeat an earlier instruction (very common: "no, the other
 *     one") must be visible exactly where it was said.
 *
 * A duplicate of the SAME send is already impossible: every event carries a client id and the projection
 * dedupes on it (`seenIds`), so collapsing by text was never what protected us from double sends.
 *
 * Pure, and exported, so `scripts/verify-chat-steering.ts` can prove the rule rather than trust it.
 */
import type { HarnessItem } from './projection';

/** Whitespace-insensitive comparison: the two writers do not agree on trailing newlines. */
const norm = (t?: string) => (t || '').replace(/\s+/g, ' ').trim();

/**
 * Drop only what is genuinely not content:
 *   - an empty text block (nothing to read);
 *   - a REPEATED ASSISTANT reply (the same answer written by the stream and by the run).
 *
 * A user message is never dropped, however many times it repeats.
 */
export function visibleTranscriptItems(items: readonly HarnessItem[]): HarnessItem[] {
  const out: HarnessItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'user') {
      const text = norm((item as { text?: string }).text);
      // An attachment-only message has no text but is still a real act: keep any user item that has
      // attachments, and drop only one that is completely empty.
      const hasAttachments = Array.isArray((item as { attachments?: unknown[] }).attachments)
        ? ((item as { attachments?: unknown[] }).attachments as unknown[]).length > 0
        : false;
      if (!text && !hasAttachments) continue;
      out.push(item);
      continue;
    }
    if (item.kind === 'assistant') {
      const text = norm((item as { text?: string }).text);
      if (!text) continue;
      // The previous KEPT item, not the previous raw item: an empty or duplicate assistant block in
      // between must not let the same reply through twice.
      const prev = out[out.length - 1];
      if (prev && prev.kind === 'assistant' && norm((prev as { text?: string }).text) === text) continue;
      out.push(item);
      continue;
    }
    out.push(item);
  }
  return out;
}
