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

  return (
    <div className={`my-3 p-4 rounded-xl border transition-all ${
      status === 'approved'
        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20'
        : status === 'rejected'
        ? 'border-rose-200 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20 opacity-70'
        : 'border-amber-200 dark:border-amber-800/80 bg-amber-50/30 dark:bg-amber-950/20 shadow-sm'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${
          status === 'approved'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-400'
            : status === 'rejected'
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-400'
        }`}>
          <ShieldAlert size={18} />
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{artifact.title}</h4>
            {artifact.estimatedCost && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                <Coins size={10} /> Est: {artifact.estimatedCost}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 mb-3 leading-relaxed">
            {artifact.description}
          </p>

          {status === 'pending' ? (
            <div className="flex items-center gap-2 pt-2 border-t border-amber-200/60 dark:border-amber-900/40">
              <button
                disabled={loading}
                onClick={() => handleDecision('approved')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Approve & Execute
              </button>
              <button
                disabled={loading}
                onClick={() => handleDecision('rejected')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold transition disabled:opacity-50"
              >
                <X size={13} /> Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {status === 'approved' ? (
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check size={14} /> Approved & In Progress
                </span>
              ) : (
                <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                  <X size={14} /> Action Cancelled
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
