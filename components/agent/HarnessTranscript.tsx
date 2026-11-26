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
import { visibleTranscriptItems } from '@/lib/agent/harness/transcript-filter';
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
  onApprovalStatus,
}: {
  item: Extract<HarnessItem, { kind: 'tool' }>;
  onOptionSelect?: (text: string) => void;
  onResume?: (prompt: string) => void;
  onApprovalStatus?: (actionId: string, status: 'pending' | 'approved' | 'rejected') => void;
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
      onApprovalStatus={onApprovalStatus}
    />
  );
});

/** The actionId of a staged approval carried by a tool item, if it has one. */
function approvalActionId(output: unknown): string | null {
  const artifact: any = artifactFrom(output);
  if (!artifact || artifact.type !== 'action_confirmation') return null;
  return typeof artifact.actionId === 'string' && artifact.actionId ? artifact.actionId : null;
}

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

  /**
   * Which staged approvals are still outstanding.
   *
   * The transcript is rebuilt from the harness log, which knows about the STAGING but not about
   * the DECISION — that lives in `agent_events`. So each card reports its own state up here
   * (ActionConfirmationCard asks the server on mount), and this map is what the pin below reads.
   *
   * An actionId missing from the map is treated as pending, deliberately: the card must be
   * pinned the instant it is staged, not one round trip later.
   */
  const [approvalState, setApprovalState] = React.useState<Record<string, 'pending' | 'approved' | 'rejected'>>({});
  const stableApprovalStatus = React.useCallback(
    (actionId: string, status: 'pending' | 'approved' | 'rejected') => {
      setApprovalState((prev) => (prev[actionId] === status ? prev : { ...prev, [actionId]: status }));
    },
    []
  );

  if (!items.length) return null;

  /**
   * The projection can legitimately contain the same ASSISTANT turn twice: the live stream records it,
   * and so does the queued run created from it. Rendering both made the agent's reply appear twice in a
   * row, which reads as a bug in the app rather than a duplicate event.
   *
   * A user message is different, and the difference is the fix for "my message disappeared": two
   * identical user messages are two separate acts, not one row written twice. This used to collapse
   * them, so an owner who asked "what is the update?", saw nothing, and asked again watched the second
   * attempt vanish. `visibleTranscriptItems` owns the rule (and `verify:chat-steering` proves it)
   * because it is a behaviour, not a detail of this component.
   */
  const visible = visibleTranscriptItems(items);

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

  /**
   * The item to keep on screen, or -1.
   *
   * The LAST undecided approval, not the first: if the agent staged three things, the one it is
   * actually blocked on is the newest. Computed after dedupe so a run of retries pins the card
   * that survived them.
   */
  const pinnedIndex = (() => {
    for (let i = deduped.length - 1; i >= 0; i--) {
      const item = deduped[i];
      if (item.kind !== 'tool') continue;
      const actionId = approvalActionId((item as any).output);
      if (!actionId) continue;
      const state = approvalState[actionId];
      if (state && state !== 'pending') continue;
      return i;
    }
    return -1;
  })();

  /**
   * BRING A NEW APPROVAL CARD INTO VIEW.
   *
   * The card was pinned with `sticky bottom-0`, which only helps while its own position is still in the scrollport —
   * an owner watching the agent work stays at the bottom, the card is staged further up the transcript, and it is
   * never seen. The owner waited for the agent to do something, found nothing, scrolled up, and discovered the
   * approval had been sitting there. A card that needs a tap must announce itself.
   *
   * So: when a DIFFERENT approval becomes the pinned one, scroll it to the middle of the viewport once. It is keyed on
   * the approval id, so it never fights the user's own scrolling afterwards.
   */
  const pinnedRef = React.useRef<HTMLDivElement | null>(null)
  const lastPinnedApprovalId = React.useRef<string | null>(null)
  const pinnedItem: any = pinnedIndex >= 0 ? deduped[pinnedIndex] : null
  const pinnedApprovalId: string | null = pinnedItem?.id ?? null
  React.useEffect(() => {
    if (!pinnedApprovalId) return
    if (pinnedApprovalId === lastPinnedApprovalId.current) return
    lastPinnedApprovalId.current = pinnedApprovalId
    // Deferred a frame so the card is laid out before we measure where it is.
    const raf = requestAnimationFrame(() => {
      try {
        pinnedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {
        /* an old browser without smooth scrolling still gets the card, just without the animation */
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [pinnedApprovalId])

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

          case 'tool': {
            const row = (
              <ToolItem
                item={item}
                onOptionSelect={stableOptionSelect}
                onResume={stableResume}
                onApprovalStatus={stableApprovalStatus}
              />
            );
            // The newest card still waiting for a decision is pinned to the bottom of the
            // viewport, so nothing the agent says afterwards can bury it.
            if (idx !== pinnedIndex) return <React.Fragment key={item.id}>{row}</React.Fragment>;
            return (
              <div
                key={item.id}
                ref={pinnedRef}
                data-pinned-approval="true"
                className="sticky bottom-0 z-20 pt-3 pb-1"
                style={{
                  background:
                    'linear-gradient(to top, var(--dsw-alias-bg-base) 78%, transparent)',
                }}
              >
                {row}
              </div>
            );
          }

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
