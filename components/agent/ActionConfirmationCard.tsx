'use client';

import * as React from 'react';
import { useState } from 'react';
import { ShieldAlert, Check, X, Loader2, Coins } from 'lucide-react';
import { ActionConfirmationArtifact } from '@/lib/agent/types';
import { toast } from 'sonner';

interface ActionConfirmationCardProps {
  artifact: ActionConfirmationArtifact;
  onDecision?: (actionId: string, decision: 'approved' | 'rejected') => void;
}

export default function ActionConfirmationCard({ artifact, onDecision }: ActionConfirmationCardProps) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>(artifact.status || 'pending');
  const [loading, setLoading] = useState(false);

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
