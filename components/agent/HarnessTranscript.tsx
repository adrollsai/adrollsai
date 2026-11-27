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
import { Check, ChevronRight, Copy } from 'lucide-react';
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

/**
 * One card per distinct staged action, not one per retry.
 *
 * The gate refuses a gated tool by writing a NEW approval row and returns a new actionId each time, so an
 * agent that retries piles up identical pending cards in the transcript. They are indistinguishable to the
 * owner and only one of them needs a tap, so keep the LAST of a run of identical ones. Actions with a
 * different payload are untouched — those really are different work.
 *
 * Pure and module-scope so the component stays a component: it was inline below an early return, which is
 * how the hook-order crash got in.
 */
function collapseRepeatedApprovals(items: HarnessItem[]): HarnessItem[] {
  return items.filter((item, i) => {
    if (item.kind !== 'tool') return true;
    const own = approvalFingerprint((item as any).output);
    if (!own) return true;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j];
      if (next.kind !== 'tool') continue;
      if (approvalFingerprint((next as any).output) === own) return false;
    }
    return true;
  });
}

/**
 * The item to keep on screen, or -1.
 *
 * The LAST undecided approval, not the first: if the agent staged three things, the one it is actually
 * blocked on is the newest. Computed after dedupe so a run of retries pins the card that survived them. An
 * actionId missing from `approvalState` counts as pending, deliberately — the card must be pinned the
 * instant it is staged, not one round trip later.
 */
function lastPendingApprovalIndex(
  items: HarnessItem[],
  approvalState: Record<string, 'pending' | 'approved' | 'rejected'>
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== 'tool') continue;
    const actionId = approvalActionId((item as any).output);
    if (!actionId) continue;
    const state = approvalState[actionId];
    if (state && state !== 'pending') continue;
    return i;
  }
  return -1;
}

/**
 * The transcript as it should READ: conversation, and the working behind it.
 *
 * WHY THIS EXISTS
 * Every reasoning block and every tool row used to render as its own top-level row, so a session with
 * thirty tool calls and thirty thinking blocks was a wall of interleaved grey lines with the answer
 * buried somewhere in it. The owner's report: "all the thinking steps still pile into the final chat, no
 * proper formatting at all."
 *
 * So consecutive non-conversation items (reasoning + tool traffic) become ONE `work` block, which renders
 * as a single collapsed line — "N steps of working · show" — exactly the shape the live view already uses
 * (`AgentChat` has had that toggle all along; the replay view never did, which is why reopening a session
 * looked so different from watching it). The answer and the owner's own messages stay visible.
 */
type TranscriptBlock =
  | { kind: 'chat'; item: HarnessItem }
  | { kind: 'work'; items: HarnessItem[] };

export function groupIntoBlocks(items: HarnessItem[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const item of items) {
    const isWork = item.kind === 'reasoning' || item.kind === 'tool';
    if (!isWork) {
      blocks.push({ kind: 'chat', item });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'work') last.items.push(item);
    else blocks.push({ kind: 'work', items: [item] });
  }
  return blocks;
}

/** What one work block says when collapsed: how much happened, and what kind. */
export function describeWorking(items: HarnessItem[]): string {
  const thoughts = items.filter((item) => item.kind === 'reasoning').length;
  const tools = items.length - thoughts;
  const parts: string[] = [];
  if (tools) parts.push(`${tools} tool call${tools === 1 ? '' : 's'}`);
  if (thoughts) parts.push(`${thoughts} thought${thoughts === 1 ? '' : 's'}`);
  const detail = parts.join(' · ');
  return `${items.length} step${items.length === 1 ? '' : 's'} of working${detail ? ` (${detail})` : ''}`;
}

export interface HarnessTranscriptProps {  items: HarnessItem[];
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

/**
 * One collapsed group of reasoning + tool rows.
 *
 * Open when the owner asks for it, or when it contains an approval card waiting for a tap — a card that
 * needs a decision must never be hidden behind a collapsed disclosure.
 */
const WorkingGroup = React.memo(function WorkingGroup({
  items,
  forceOpen,
  pinnedApprovalId,
  pinnedRef,
  onOptionSelect,
  onResume,
  onApprovalStatus,
}: {
  items: HarnessItem[];
  forceOpen: boolean;
  pinnedApprovalId: string | null;
  pinnedRef: React.RefObject<HTMLDivElement | null>;
  onOptionSelect?: (text: string) => void;
  onResume?: (prompt: string) => void;
  onApprovalStatus?: (actionId: string, status: 'pending' | 'approved' | 'rejected') => void;
}) {
  const [open, setOpen] = React.useState(false);
  const expanded = open || forceOpen;

  return (
    <div className="my-1.5">
      {forceOpen ? (
        // A group held open because it contains an approval waiting for a tap. It must not offer to
        // collapse: "Hide working" that does nothing when clicked is the kind of small lie that makes an
        // app feel broken.
        <div className="dsh-label-caption dsh-t-xs flex items-center gap-1.5 py-1">
          <ChevronRight size={12} style={{ transform: 'rotate(90deg)' }} />
          <span>
            {describeWorking(items)}
            <span className="dsh-strong" style={{ color: 'var(--dsw-alias-state-business-primary)' }}>
              {' '}
              · needs your approval
            </span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={expanded}
          title={expanded ? 'Hide the working' : 'Show the working behind this reply'}
          className="dsh-interactive dsh-label-caption dsh-t-xs flex items-center gap-1.5 py-1"
        >
          <ChevronRight
            size={12}
            style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
          />
          <span>{expanded ? 'Hide working' : describeWorking(items)}</span>
        </button>
      )}

      {expanded && (
        <div className="mt-1">
          {items.map((item) => {
            if (item.kind === 'reasoning') return <ThinkFeedRow key={item.id} text={item.text} />;
            if (item.kind !== 'tool') return null;
            const row = (
              <ToolItem
                item={item}
                onOptionSelect={onOptionSelect}
                onResume={onResume}
                onApprovalStatus={onApprovalStatus}
              />
            );
            // The newest card still waiting for a decision is pinned to the bottom of the viewport, so
            // nothing the agent says afterwards can bury it.
            if (item.id !== pinnedApprovalId) return <React.Fragment key={item.id}>{row}</React.Fragment>;
            return (
              <div
                key={item.id}
                ref={pinnedRef}
                data-pinned-approval="true"
                className="sticky bottom-0 z-20 pt-3 pb-1"
                style={{
                  background: 'linear-gradient(to top, var(--dsw-alias-bg-base) 78%, transparent)',
                }}
              >
                {row}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

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

  /**
   * EVERY HOOK LIVES ABOVE THE EMPTY RETURN, AND THAT IS THE WHOLE POINT.
   *
   * `if (!items.length) return null` used to sit ABOVE the approval-state state and the pin effect
   * below, so the first render (an empty transcript while the session loads) ran FEWER hooks than the
   * next one. React throws "Rendered more hooks than during the previous render" — error #300 — and the
   * whole screen died with "Application error: a client-side exception has occurred", then "Display
   * Interruption Prevented". The agent page crashed on the first paint of every session that took more
   * than a frame to load, which is every one of them.
   *
   * Hooks are unconditional; only the RENDER is allowed to bail out early.
   */
  const pinnedRef = React.useRef<HTMLDivElement | null>(null)
  const lastPinnedApprovalId = React.useRef<string | null>(null)

  const visible = React.useMemo(() => visibleTranscriptItems(items), [items]);
  const deduped = React.useMemo(() => collapseRepeatedApprovals(visible), [visible]);
  const pinnedIndex = React.useMemo(
    () => lastPendingApprovalIndex(deduped, approvalState),
    [deduped, approvalState]
  );
  const pinnedApprovalId: string | null =
    pinnedIndex >= 0 ? ((deduped[pinnedIndex] as any)?.id ?? null) : null;

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

  if (!deduped.length) return null;

  const blocks = groupIntoBlocks(deduped);

  return (
    <>
      {blocks.map((block) => {
        if (block.kind === 'work') {
          return (
            <WorkingGroup
              key={`work_${block.items[0].id}`}
              items={block.items}
              // An approval waiting for a tap must never be hidden behind a collapsed group.
              forceOpen={block.items.some((item) => (item as any).id === pinnedApprovalId)}
              pinnedApprovalId={pinnedApprovalId}
              pinnedRef={pinnedRef}
              onOptionSelect={stableOptionSelect}
              onResume={stableResume}
              onApprovalStatus={stableApprovalStatus}
            />
          );
        }
        const item = block.item;
        switch (item.kind) {
          case 'user':
            return <UserItem key={item.id} item={item} />;

          case 'assistant':
            return <AssistantItem key={item.id} item={item} />;

          case 'error':
            return <ErrorItem key={item.id} item={item} />;

          default:
            // Reasoning and tool rows are grouped into `work` blocks above, so anything else that
            // reaches here is an unknown future kind — it must never blank the transcript.
            return <React.Fragment key={item.id} />;
        }
      })}
    </>
  );
}