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
import { ThinkFeedRow, ToolFeedRow } from './FeedRows';
import type { HarnessItem } from '@/lib/agent/harness/projection';

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
      className="p-0.5 transition"
      style={{ color: 'var(--dsw-alias-label-caption)' }}
    >
      {copied ? <Check size={13} style={{ color: 'var(--dsw-alias-state-success-primary)' }} /> : <Copy size={13} />}
    </button>
  );
}

const UserItem = React.memo(function UserItem({ item }: { item: Extract<HarnessItem, { kind: 'user' }> }) {
  return (
    <div className="my-3 flex justify-end">
      <div className="flex flex-col items-end max-w-[80%]">
        <div
          className="px-4 py-2.5 dsh-t-prose break-words space-y-1.5"
          style={{
            background: 'var(--dsw-alias-bg-layer-2)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 'var(--dsh-radius-lg)',
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
    <div className="my-3">
      <div className="dsh-t-prose dsh-label-primary">
        <AgentMarkdown content={item.text} />
      </div>
      <div className="pt-2">
        <CopyButton text={item.text} />
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
const ToolItem = React.memo(function ToolItem({
  item,
  onOptionSelect,
}: {
  item: Extract<HarnessItem, { kind: 'tool' }>;
  onOptionSelect?: (text: string) => void;
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
    />
  );
});

export interface HarnessTranscriptProps {
  items: HarnessItem[];
  onOptionSelect?: (text: string) => void;
}

export default function HarnessTranscript({ items, onOptionSelect }: HarnessTranscriptProps) {
  // Stable callback identity so memoised rows are not invalidated every render,
  // while still always calling the latest handler.
  const optionRef = React.useRef(onOptionSelect);
  optionRef.current = onOptionSelect;
  const stableOptionSelect = React.useCallback((text: string) => optionRef.current?.(text), []);

  if (!items.length) return null;

  return (
    <>
      {items.map((item, idx) => {
        switch (item.kind) {
          case 'user':
            return <UserItem key={item.id} item={item} />;

          case 'assistant':
            return <AssistantItem key={item.id} item={item} />;

          case 'reasoning':
            return <ThinkFeedRow key={item.id} text={item.text} />;

          case 'tool':
            return <ToolItem key={item.id} item={item} onOptionSelect={stableOptionSelect} />;

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
