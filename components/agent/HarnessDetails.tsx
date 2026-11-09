'use client';

/**
 * Right-hand details column — the third pane of the AppFrame.
 *
 * Renders the trajectory of the active session from the projection: what the
 * agent actually did, in order. In DSH this is the "details host" that the
 * conversation column publishes into; here it reads the same projected items,
 * so it can never disagree with the transcript.
 */
import * as React from 'react';
import { BrainCircuit, CircleAlert, MessageSquare, PanelRightClose, Wrench } from 'lucide-react';
import type { HarnessItem } from '@/lib/agent/harness/projection';
import { resolveToolPresentation } from '@/lib/agent/presentation';

export interface HarnessDetailsProps {
  title: string;
  status: 'idle' | 'running' | 'error';
  workspaceId: string;
  items: HarnessItem[];
  /** True when the transcript is backed by the durable log. */
  logBacked: boolean;
  onClose: () => void;
}

function StatusDot({ status }: { status: HarnessDetailsProps['status'] }) {
  const color =
    status === 'running'
      ? 'var(--dsw-alias-state-warn-primary)'
      : status === 'error'
      ? 'var(--dsw-alias-state-error-primary)'
      : 'var(--dsw-alias-state-success-primary)';
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: 6, height: 6, background: color }}
      title={status}
    />
  );
}

function Stats({ items }: { items: HarnessItem[] }) {
  const counts = { prompt: 0, reply: 0, tool: 0, reason: 0, error: 0 };
  for (const item of items) {
    if (item.kind === 'user') counts.prompt++;
    else if (item.kind === 'assistant') counts.reply++;
    else if (item.kind === 'tool') counts.tool++;
    else if (item.kind === 'reasoning') counts.reason++;
    else if (item.kind === 'error') counts.error++;
  }

  const rows: Array<[string, number]> = [
    ['Prompts', counts.prompt],
    ['Replies', counts.reply],
    ['Tool calls', counts.tool],
    ['Reasoning steps', counts.reason],
  ];
  if (counts.error) rows.push(['Errors', counts.error]);

  return (
    <div className="space-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between dsh-t-xs">
          <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{label}</span>
          <span className="dsh-tnum dsh-strong" style={{ color: 'var(--dsw-alias-label-secondary)' }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function HarnessDetails({
  title,
  status,
  workspaceId,
  items,
  logBacked,
  onClose,
}: HarnessDetailsProps) {
  // The trajectory is the run itself: prompts, reasoning and tool traffic.
  const steps = React.useMemo(
    () => items.filter((i) => i.kind === 'user' || i.kind === 'reasoning' || i.kind === 'tool' || i.kind === 'error'),
    [items]
  );

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 w-80 h-full"
      style={{
        background: 'var(--dsw-alias-bg-layer-1)',
        borderLeft: '1px solid var(--dsw-alias-border-l1)',
      }}
    >
      <div
        className="h-12 shrink-0 flex items-center justify-between px-4"
        style={{ borderBottom: '1px solid var(--dsw-alias-border-l1)' }}
      >
        <span
          className="dsh-t-xxs dsh-strong uppercase"
          style={{ color: 'var(--dsw-alias-label-caption)', letterSpacing: '0.05em' }}
        >
          Trajectory
        </span>
        <button onClick={onClose} title="Close panel" style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
          <PanelRightClose size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <span className="dsh-t-s dsh-strong dsh-label-primary truncate">{title}</span>
          </div>
          <div className="dsh-t-xs dsh-mono truncate" style={{ color: 'var(--dsw-alias-label-caption)' }}>
            {workspaceId}
          </div>
          <div className="dsh-t-xs" style={{ color: 'var(--dsw-alias-label-caption)' }}>
            {logBacked ? 'Durable event log' : 'Session log unavailable'}
          </div>
        </section>

        <section className="space-y-2">
          <div
            className="dsh-t-xxxs dsh-strong uppercase"
            style={{ color: 'var(--dsw-alias-label-caption)', letterSpacing: '0.05em' }}
          >
            Activity
          </div>
          <Stats items={items} />
        </section>

        <section className="space-y-1">
          <div
            className="dsh-t-xxxs dsh-strong uppercase"
            style={{ color: 'var(--dsw-alias-label-caption)', letterSpacing: '0.05em' }}
          >
            Steps
          </div>
          {steps.length === 0 ? (
            <p className="dsh-t-xs py-2" style={{ color: 'var(--dsw-alias-label-caption)' }}>
              Nothing has run in this session yet.
            </p>
          ) : (
            steps.map((step) => {
              if (step.kind === 'tool') {
                const { presentation } = resolveToolPresentation(step.name);
                const Icon = presentation.icon;
                return (
                  <div key={step.id} className="flex items-start gap-2 py-1 dsh-t-xs">
                    <Icon size={13} className="shrink-0 mt-[2px]" style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
                    <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                      {presentation.label}
                    </span>
                    <span
                      style={{
                        color:
                          step.status === 'failed'
                            ? 'var(--dsw-alias-state-error-primary)'
                            : step.status === 'done'
                            ? 'var(--dsw-alias-state-success-primary)'
                            : 'var(--dsw-alias-label-caption)',
                      }}
                    >
                      {step.status}
                    </span>
                  </div>
                );
              }

              if (step.kind === 'user') {
                return (
                  <div key={step.id} className="flex items-start gap-2 py-1 dsh-t-xs">
                    <MessageSquare size={13} className="shrink-0 mt-[2px]" style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
                    <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                      {step.text}
                    </span>
                  </div>
                );
              }

              if (step.kind === 'reasoning') {
                return (
                  <div key={step.id} className="flex items-start gap-2 py-1 dsh-t-xs">
                    <BrainCircuit size={13} className="shrink-0 mt-[2px]" style={{ color: 'var(--dsw-alias-label-tertiary)' }} />
                    <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--dsw-alias-label-tertiary)' }}>
                      {step.text}
                    </span>
                  </div>
                );
              }

              return (
                <div key={step.id} className="flex items-start gap-2 py-1 dsh-t-xs">
                  <CircleAlert size={13} className="shrink-0 mt-[2px]" style={{ color: 'var(--dsw-alias-state-error-primary)' }} />
                  <span className="flex-1 min-w-0" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>
                    {step.message}
                  </span>
                </div>
              );
            })
          )}
        </section>
      </div>
    </aside>
  );
}
