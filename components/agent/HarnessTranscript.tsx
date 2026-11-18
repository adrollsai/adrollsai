'use client';

/**
 * Renders a projected harness session.
 *
 * This is the replay view: it is a pure function of the event log, so a session
 * opened today looks identical to the one that streamed live last week. The
 * in-flight turn still renders from AI-SDK message parts (see AgentChat), and
 * both paths share `FeedRows` so they cannot drift apart visually.
 */
import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import AgentMarkdown from './AgentMarkdown';
import { NoboOrb } from './NoboMascot';
import { ThinkFeedRow, ToolFeedRow } from './FeedRows';
import type { HarnessItem } from '@/lib/agent/harness/projection';
import { artifactFrom } from '@/lib/agent/tool-output';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the label simply does not change */
    }
  };

  return (
    <button
      onClick={onCopy}
      title="Copy"
      aria-label="Copy this message"
      // A phone conversation stacks eight or more of these down the screen, so they have to be
      // thumb-sized. Pixel values on purpose: this app's rem is ~14.5px, so a Tailwind step that
      // looks like 44 measures 40.
      className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center transition"
      style={{ color: 'var(--dsw-alias-label-caption)' }}
    >
      {copied ? <Check size={14} style={{ color: 'var(--dsw-alias-state-success-primary)' }} /> : <Copy size={14} />}
    </button>
  );
}

const UserItem = React.memo(function UserItem({ item }: { item: Extract<HarnessItem, { kind: 'user' }> }) {
  return (
    <div className="my-3 flex justify-end">
      <div className="flex flex-col items-end max-w-[80%]">
        <div
          className="nobo-bubble-user px-4 py-2.5 dsh-t-prose break-words space-y-1.5"
          style={{
            // Tinted, right-aligned and clearly bounded: the user's turn should
            // read as a card sitting above the agent's working surface, not as
            // another block of the same page.
            background: 'var(--nobo-bubble-user)',
            border: '1px solid rgba(124, 58, 237, 0.12)',
            borderRadius: '20px 20px 6px 20px',
            color: 'var(--dsw-alias-label-primary)',
          }}
        >
          {item.attachments?.map((a, i) => (
            <div
              key={`${a.name}_${i}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 dsh-t-xs dsh-mono"
              style={{
                borderRadius: 'var(--dsh-radius-sm)',
                background: 'var(--dsw-alias-markdown-inline-code)',
                border: '1px solid var(--dsw-alias-border-l1)',
                color: 'var(--dsw-alias-label-secondary)',
              }}
            >
              <span className="truncate max-w-[240px]">{a.name}</span>
              {a.url && (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: 'var(--dsw-alias-state-business-primary)' }}
                >
                  view
                </a>
              )}
            </div>
          ))}
          {item.text && <AgentMarkdown content={item.text} />}
        </div>
        <div className="mt-1">
          <CopyButton text={item.text} />
        </div>
      </div>
    </div>
  );
});

const AssistantItem = React.memo(function AssistantItem({ item }: { item: Extract<HarnessItem, { kind: 'assistant' }> }) {
  return (
    <div className="nobo-agent-row mt-2 mb-4">
      {/* The mascot is the assistant's avatar here too, so a reply is visibly
          Nobo's in the replay view and not an unlabelled block of text among the
          tool rows. */}
      <div className="pt-0.5">
        <NoboOrb size="sm" state="idle" />
      </div>
      <div className="nobo-agent-card">
      {/* Answer typography: a readable measure, generous but not wasteful line height,
          and no hero-sized gaps between paragraphs. The old spacing made a two-line
          answer look like it was floating in an empty page. */}
        <div
          className="dsh-t-prose dsh-label-primary"
          style={{ maxWidth: '68ch', fontSize: '14.5px', lineHeight: 1.62 }}
        >
        <AgentMarkdown content={item.text} />
      </div>
        <div className="pt-1.5">
          <CopyButton text={item.text} />
        </div>
      </div>
    </div>
  );
});

const ErrorItem = React.memo(function ErrorItem({ item }: { item: Extract<HarnessItem, { kind: 'error' }> }) {
  return (
    <div
      className="my-2 px-3 py-2 dsh-t-s"
      style={{
        borderRadius: 'var(--dsh-radius-md)',
        background: 'var(--dsw-alias-state-error-tertiary)',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        color: 'var(--dsw-alias-state-error-primary)',
      }}
    >
      {item.message}
    </div>
  );
});

/**
 * Tool row, memoised on the projected item.
 *
 * `ToolFeedRow` needs a synthesised AI-SDK-shaped object; building that inline
 * in the parent created a new object every render and defeated memoisation, so
 * it is built here instead and the component only re-renders when the item does.
 */
/**
 * Identity of a staged approval, so a run of retries can be collapsed to the last
 * one. Two cards with the same tool and the same arguments are the same decision.
 */
function approvalFingerprint(output: unknown): string | null {
  const artifact: any = artifactFrom(output);
  if (!artifact || artifact.type !== 'action_confirmation') return null;
  const kind = String(artifact.actionType ?? 'custom');
  let payload = '';
  try {
    payload = JSON.stringify(artifact.payload ?? artifact.spec ?? null);
  } catch {
    payload = '';
  }
  return `${kind}|${payload}`;
}

const ToolItem = React.memo(function ToolItem({
  item,
  onOptionSelect,
  onResume,
}: {
  item: Extract<HarnessItem, { kind: 'tool' }>;
  onOptionSelect?: (text: string) => void;
  onResume?: (prompt: string) => void;
}) {
  return (
    <ToolFeedRow
      tool={{
        type: `tool-${item.name}`,
        toolName: item.name,
        input: item.input,
        output: item.output,
        state: item.status === 'running' ? 'call' : 'result',
      }}
      isLoading={item.status === 'running'}
      onOptionSelect={onOptionSelect}
      onResume={onResume}
    />
  );
});

export interface HarnessTranscriptProps {
  items: HarnessItem[];
  onOptionSelect?: (text: string) => void;
  /**
   * Sends the staged instruction back into the conversation when the owner approves.
   *
   * This has to be threaded through, and it was not. Approving recorded the decision and
   * then nothing happened: the card had the resume sentence, the server marked the row
   * `approved`, and the client had no handler to continue with because this component never
   * accepted one. Every approval in the durable transcript — which is the DEFAULT path — was
   * a dead end.
   */
  onResume?: (prompt: string) => void;
}

export default function HarnessTranscript({ items, onOptionSelect, onResume }: HarnessTranscriptProps) {
  // Stable callback identity so memoised rows are not invalidated every render,
  // while still always calling the latest handler.
  const optionRef = React.useRef(onOptionSelect);
  optionRef.current = onOptionSelect;
  const stableOptionSelect = React.useCallback((text: string) => optionRef.current?.(text), []);

  const resumeRef = React.useRef(onResume);
  resumeRef.current = onResume;
  const stableResume = React.useCallback((prompt: string) => resumeRef.current?.(prompt), []);

  if (!items.length) return null;

  // The projection can legitimately contain the same turn twice: the live stream
  // records it, and so does the queued run created from it. Rendering both is what
  // made the sender's own message — and, with a continuation run, the agent's reply
  // — appear twice in a row, which reads as a bug in the app rather than a
  // duplicate event. Collapse consecutive identical text for both roles.
  //
  // Whitespace is normalised before comparing: the two writers do not always agree
  // on trailing newlines, and a difference of one "\n" is not a different message.
  const norm = (t?: string) => (t || '').replace(/\s+/g, ' ').trim();
  const visible = items.filter((item, i) => {
    if (item.kind !== 'user' && item.kind !== 'assistant') return true;
    const prev = items[i - 1];
    if (!prev || prev.kind !== item.kind) return true;
    const prevText = norm((prev as { text?: string }).text);
    const ownText = norm((item as { text?: string }).text);
    // An empty repeat is never meaningful; a different text always is.
    if (!ownText) return false;
    return prevText !== ownText;
  });

  /**
   * One card per distinct staged action, not one per retry.
   *
   * The gate refuses a gated tool by writing a NEW approval row and returns a new
   * actionId each time, so an agent that retries piles up identical pending cards
   * in the transcript. They are indistinguishable to the owner and only one of
   * them needs a tap, so keep the LAST of a run of identical ones. Actions with a
   * different payload are untouched — those really are different work.
   */
  const deduped = visible.filter((item, i) => {
    if (item.kind !== 'tool') return true;
    const own = approvalFingerprint((item as any).output);
    if (!own) return true;
    for (let j = i + 1; j < visible.length; j++) {
      const next = visible[j];
      if (next.kind !== 'tool') continue;
      if (approvalFingerprint((next as any).output) === own) return false;
    }
    return true;
  });

  return (
    <>
      {deduped.map((item, idx) => {
        switch (item.kind) {
          case 'user':
            return <UserItem key={item.id} item={item} />;

          case 'assistant':
            return <AssistantItem key={item.id} item={item} />;

          case 'reasoning':
            return <ThinkFeedRow key={item.id} text={item.text} />;

          case 'tool':
            return (
              <ToolItem
                key={item.id}
                item={item}
                onOptionSelect={stableOptionSelect}
                onResume={stableResume}
              />
            );

          case 'error':
            return <ErrorItem key={item.id} item={item} />;

          default:
            // An unknown future item kind must never blank the transcript.
            return <React.Fragment key={idx} />;
        }
      })}
    </>
  );
}
