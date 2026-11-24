'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { ShieldAlert, Check, X, Loader2, Coins, Mic, ImageIcon } from 'lucide-react';
import { ActionConfirmationArtifact } from '@/lib/agent/types';
import { buildResumePrompt } from '@/lib/agent/resume-prompt';
import { toast } from 'sonner';

interface ActionConfirmationCardProps {
  artifact: ActionConfirmationArtifact;
  onDecision?: (actionId: string, decision: 'approved' | 'rejected') => void;
  /** Called with the staged instruction when the user approves, so the job carries on. */
  onResume?: (prompt: string) => void;
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

export default function ActionConfirmationCard({ artifact, onDecision, onResume }: ActionConfirmationCardProps) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>(artifact.status || 'pending');
  const [loading, setLoading] = useState(false);

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

  return (
    <div
      className="my-3 p-4"
      style={{
        borderRadius: 'var(--dsh-radius-md)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderLeft: `2px solid ${tone.edge}`,
        background: 'var(--dsw-alias-bg-layer-2)',
        opacity: status === 'rejected' ? 0.7 : 1,
        boxShadow: status === 'pending' ? 'var(--dsw-shadow-lv1)' : 'none',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="p-2 shrink-0"
          style={{ borderRadius: 'var(--dsh-radius-sm)', background: tone.soft, color: tone.text }}
        >
          <ShieldAlert size={18} />
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <h4 className="dsh-t-s dsh-strong dsh-label-primary">{artifact.title}</h4>
            {artifact.estimatedCost && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full dsh-t-xxxs dsh-strong"
                style={{ background: 'var(--dsw-alias-state-warn-tertiary)', color: 'var(--dsw-alias-state-warn-secondary)' }}
              >
                <Coins size={10} /> Est: {artifact.estimatedCost}
              </span>
            )}
          </div>

          <p className="dsh-t-s dsh-label-secondary mb-3" style={{ lineHeight: '22px' }}>
            {artifact.description}
          </p>

          {detailRows.length > 0 && (
            <div
              className="mb-3 overflow-hidden"
              style={{ border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 'var(--dsh-radius-sm)' }}
            >
              {detailRows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-1.5 dsh-t-xs"
                  style={{
                    background: i % 2 ? 'var(--dsw-alias-bg-layer-1)' : 'transparent',
                    borderTop: i ? '1px solid var(--dsw-alias-border-l1)' : 'none',
                  }}
                >
                  <span className="dsh-label-caption uppercase dsh-t-xxxs dsh-strong shrink-0 w-24 pt-0.5">
                    {row.label}
                  </span>
                  <span className="dsh-label-primary dsh-mono whitespace-pre-wrap flex-1 break-words">{row.value}</span>
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

          {status === 'pending' ? (
            <div className="flex items-center gap-2 pt-3 dsh-border-t">
              <button
                disabled={loading}
                onClick={() => handleDecision('approved')}
                className="flex items-center gap-1.5 px-3 py-1.5 dsh-btn-primary dsh-t-s dsh-strong"
                style={{ borderRadius: 'var(--dsh-radius-sm)' }}
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Approve &amp; execute
              </button>
              <button
                disabled={loading}
                onClick={() => handleDecision('rejected')}
                className="flex items-center gap-1.5 px-3 py-1.5 dsh-btn dsh-t-s dsh-strong"
                style={{ borderRadius: 'var(--dsh-radius-sm)' }}
              >
                <X size={13} /> Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 dsh-t-s dsh-strong">
              {status === 'approved' ? (
                <span className="dsh-success flex items-center gap-1">
                  <Check size={14} /> Approved &amp; in progress
                </span>
              ) : (
                <span className="dsh-danger flex items-center gap-1">
                  <X size={14} /> Action cancelled
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
