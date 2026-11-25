'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { ShieldAlert, Check, X, Loader2, Coins, Mic, ImageIcon, ChevronDown } from 'lucide-react';
import { ActionConfirmationArtifact } from '@/lib/agent/types';
import { buildResumePrompt } from '@/lib/agent/resume-prompt';
import { toast } from 'sonner';

interface ActionConfirmationCardProps {
  artifact: ActionConfirmationArtifact;
  onDecision?: (actionId: string, decision: 'approved' | 'rejected') => void;
  /** Called with the staged instruction when the user approves, so the job carries on. */
  onResume?: (prompt: string) => void;
  /**
   * Reports whether this decision is still outstanding.
   *
   * The transcript pins the newest undecided card to the bottom of the viewport so it cannot be
   * scrolled away by whatever the agent produces after staging it — which is the reported
   * confusion: the card appears, the agent keeps talking, and the owner can no longer see that
   * anything is waiting for them. The transcript cannot know this on its own, because a decision
   * lives in `agent_events` and the transcript is rebuilt from the harness log.
   */
  onStatusChange?: (actionId: string, status: 'pending' | 'approved' | 'rejected') => void;
}

/** "templateName" / "template_name" -> "Template name". */
function humanise(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** One readable line for any staged value. */
function showValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(showValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * The exact arguments being approved, as rows.
 *
 * An approval card that says "a real customer receives it" without naming the
 * recipient is not an approval — the owner cannot check the one thing that
 * matters. The gate stages the tool's real arguments in `payload`; show those
 * whenever the artifact does not already carry a curated `spec`.
 */
function payloadRows(payload: unknown): Array<{ label: string; value: string }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const rows: Array<{ label: string; value: string }> = [];
  for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
    // Internal bookkeeping the owner should never have to read.
    if (key === 'approvalId') continue;
    const value = showValue(raw);
    if (!value.trim()) continue;
    rows.push({ label: humanise(key), value });
    if (rows.length >= 8) break;
  }
  return rows;
}

export default function ActionConfirmationCard({ artifact, onDecision, onResume, onStatusChange }: ActionConfirmationCardProps) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>(artifact.status || 'pending');
  const [loading, setLoading] = useState(false);

  /**
   * Tell the transcript whether this card still needs a decision, so it can keep it on screen.
   *
   * Kept in a ref-held callback and fired on every status change: the parent uses this to decide
   * which card (if any) is pinned to the bottom of the scrolling transcript.
   */
  const statusSink = React.useRef(onStatusChange);
  statusSink.current = onStatusChange;
  useEffect(() => {
    if (!artifact.actionId) return;
    statusSink.current?.(artifact.actionId, status);
  }, [artifact.actionId, status]);

  /**
   * Ask the server what was already decided, every time this card is rendered.
   *
   * `status` above is only this component's own state, and the transcript is rebuilt from the harness log —
   * which does not know about approvals. So a decision made in an earlier visit was invisible on return: the
   * card came back with its Approve/Reject buttons, as though the owner had never answered. That reads as a
   * lost approval, and invites a second press on something already done.
   */
  useEffect(() => {
    if (!artifact.actionId) return;
    if (status !== 'pending') return;
    let alive = true;
    fetch(`/api/agent/v2/action?actionId=${encodeURIComponent(artifact.actionId)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!alive) return;
        if (body?.decided === 'approved' || body?.decided === 'rejected') setStatus(body.decided);
      })
      .catch(() => {
        /* a card that cannot confirm stays pending rather than claiming a decision it did not see */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.actionId]);

  // Either the artifact's curated spec, or its raw staged arguments.
  const detailRows = artifact.spec && artifact.spec.length > 0 ? artifact.spec : payloadRows(artifact.payload);

  const handleDecision = async (decision: 'approved' | 'rejected') => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/v2/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionId: artifact.actionId,
          decision,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit decision');

      setStatus(decision);
      if (decision === 'approved') {
        toast.success('Action approved! Executing now.');
        // Approving used to just mark the row approved on the server, which left a
        // creative job dead in the water. The staged instruction goes back into the
        // conversation so the agent actually continues.
        //
        // The sentence is built here rather than taken from the model's own `resumePrompt`:
        // in production that prose read as an ordinary request, so the agent re-planned and
        // staged the same approval again — an approval loop. See lib/agent/resume-prompt.ts.
        if (onResume) {
          onResume(
            buildResumePrompt({
              actionId: artifact.actionId,
              actionType: artifact.actionType,
              title: artifact.title,
              resumePrompt: artifact.resumePrompt,
            }),
          );
        }
      } else {
        toast.info('Action cancelled.');
      }

      if (onDecision) {
        onDecision(artifact.actionId, decision);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error processing action');
    } finally {
      setLoading(false);
    }
  };

  const tone =
    status === 'approved'
      ? { edge: 'var(--dsw-alias-state-success-primary)', soft: 'var(--dsw-alias-state-success-tertiary)', text: 'var(--dsw-alias-state-success-primary)' }
      : status === 'rejected'
      ? { edge: 'var(--dsw-alias-state-error-primary)', soft: 'var(--dsw-alias-state-error-tertiary)', text: 'var(--dsw-alias-state-error-primary)' }
      : { edge: 'var(--dsw-alias-state-warn-primary)', soft: 'var(--dsw-alias-state-warn-tertiary)', text: 'var(--dsw-alias-state-warn-secondary)' };

  /**
   * Laid out like the harness's own question card, because that is the interaction the owner has
   * already learned: a quiet label and a chevron in a header row, the actual question as the
   * heaviest thing in the card, the detail as a numbered scrollable block, and the two decisions
   * anchored at the bottom right with the secondary one first.
   *
   * The reference card also carries a ✕ that dismisses the question. This one deliberately does
   * not: an approval cannot be dismissed, because dismissing it would leave the gate closed with
   * nothing on screen to say why the agent had stopped. The chevron collapses it instead, and the
   * header keeps saying what is waiting.
   */
  const [collapsed, setCollapsed] = React.useState(false);
  const waiting = status === 'pending';

  return (
    <div
      className="my-3"
      data-approval-card={status}
      style={{
        borderRadius: 'var(--dsh-radius-md)',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        opacity: status === 'rejected' ? 0.75 : 1,
        overflow: 'hidden',
        boxShadow: waiting ? 'var(--dsw-shadow-lv2)' : 'none',
      }}
    >
      {/* Header: what this is, on the left; the collapse control on the right. */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2.5"
        style={{ borderBottom: collapsed ? 'none' : '1px solid var(--dsw-alias-border-l1)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex items-center justify-center shrink-0"
            style={{ width: 18, height: 18, borderRadius: '50%', background: tone.soft, color: tone.text }}
          >
            <ShieldAlert size={11} />
          </span>
          <span className="dsh-t-xxs dsh-label-tertiary truncate">
            {waiting ? 'Needs your approval' : status === 'approved' ? 'Approved' : 'Cancelled'}
          </span>
          {waiting && artifact.estimatedCost && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full dsh-t-xxxs dsh-strong shrink-0"
              style={{ background: 'var(--dsw-alias-state-warn-tertiary)', color: 'var(--dsw-alias-state-warn-secondary)' }}
            >
              <Coins size={9} /> {artifact.estimatedCost}
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Show the details of this approval' : 'Hide the details of this approval'}
          aria-expanded={!collapsed}
          className="shrink-0 flex items-center justify-center dsh-label-tertiary dsh-interactive"
          style={{ width: 24, height: 24, borderRadius: 'var(--dsh-radius-xs)' }}
        >
          <ChevronDown size={14} style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }} />
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 pt-3 pb-3">
          {/* The question itself — the heaviest thing in the card, as in the reference. */}
          <h4 className="dsh-t-s dsh-strong dsh-label-primary mb-1.5">{artifact.title}</h4>
          <p className="dsh-t-xs dsh-label-tertiary mb-3" style={{ lineHeight: '19px' }}>
            {artifact.description}
          </p>

          {/* The staged arguments: numbered, in a bounded scroller, so a long payload cannot push
              the decisions off the card. */}
          {detailRows.length > 0 && (
            <div
              className="mb-3 overflow-y-auto"
              style={{
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 'var(--dsh-radius-sm)',
                maxHeight: 208,
              }}
            >
              {detailRows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 px-2.5 py-2"
                  style={{ borderTop: i ? '1px solid var(--dsw-alias-border-l1)' : 'none' }}
                >
                  <span
                    className="shrink-0 flex items-center justify-center dsh-t-xxxs dsh-strong dsh-label-tertiary"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 'var(--dsh-radius-xs)',
                      background: 'var(--dsw-alias-bg-layer-3)',
                      marginTop: 1,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="dsh-t-xxs dsh-strong dsh-label-secondary">{row.label}</div>
                    <div className="dsh-t-xxs dsh-label-primary dsh-mono whitespace-pre-wrap break-words">
                      {row.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {artifact.previews && artifact.previews.length > 0 && (
            <div className="mb-3 space-y-2">
              {artifact.previews.map((p, i) => (
                <div
                  key={i}
                  className="p-2.5"
                  style={{
                    background: 'var(--dsw-alias-bg-layer-1)',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    borderRadius: 'var(--dsh-radius-sm)',
                  }}
                >
                  <div className="flex items-center gap-1.5 dsh-t-xxxs dsh-label-tertiary mb-1.5">
                    {p.kind === 'audio' ? <Mic size={11} /> : <ImageIcon size={11} />}
                    <span>{p.caption || (p.kind === 'audio' ? 'Voiceover preview' : 'Preview')}</span>
                  </div>
                  {p.kind === 'audio' && (
                    <audio src={p.url} controls preload="metadata" className="w-full" />
                  )}
                  {p.kind === 'image' && (
                    <img
                      src={p.url}
                      alt={p.caption || 'preview'}
                      className="rounded-[6px] object-contain max-h-48 mx-auto"
                    />
                  )}
                  {p.kind === 'video' && (
                    <video src={p.url} controls playsInline className="rounded-[6px] max-h-56 mx-auto" />
                  )}
                </div>
              ))}
            </div>
          )}

          {waiting ? (
            /* Decisions anchored bottom-right, secondary first — the reference card's
               "Skip this question" / "Next" pair, carrying the real meanings here. */
            <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: '1px solid var(--dsw-alias-border-l1)' }}>
              <button
                disabled={loading}
                onClick={() => handleDecision('rejected')}
                className="flex items-center gap-1.5 px-3 py-1.5 dsh-t-xs dsh-strong dsh-label-secondary dsh-interactive"
                style={{ borderRadius: 'var(--dsh-radius-sm)' }}
              >
                <X size={12} /> Cancel
              </button>
              <button
                disabled={loading}
                onClick={() => handleDecision('approved')}
                className="flex items-center gap-1.5 px-3 py-1.5 dsh-btn-primary dsh-t-xs dsh-strong"
                style={{ borderRadius: 'var(--dsh-radius-sm)' }}
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Approve &amp; execute
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 dsh-t-xs dsh-strong">
              {status === 'approved' ? (
                <span className="dsh-success flex items-center gap-1">
                  <Check size={13} /> Approved &amp; in progress
                </span>
              ) : (
                <span className="dsh-danger flex items-center gap-1">
                  <X size={13} /> Action cancelled
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
