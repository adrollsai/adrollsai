'use client';

import * as React from 'react';
import { Loader2, CheckCircle2, AlertCircle, PlayCircle } from 'lucide-react';
import { ProgressTrackerArtifact } from '@/lib/agent/types';

export default function ProgressTrackerCard({
  title,
  current,
  total,
  label,
  stats,
  status,
}: ProgressTrackerArtifact) {
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const barColor =
    status === 'completed'
      ? 'var(--dsw-alias-state-success-primary)'
      : status === 'failed'
      ? 'var(--dsw-alias-state-error-primary)'
      : 'var(--dsw-alias-state-business-primary)';

  return (
    <div
      className="my-3 p-4"
      style={{
        borderRadius: 'var(--dsh-radius-md)',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {status === 'running' && <Loader2 size={16} className="dsh-accent animate-spin shrink-0" />}
          {status === 'completed' && <CheckCircle2 size={16} className="dsh-success shrink-0" />}
          {status === 'failed' && <AlertCircle size={16} className="dsh-danger shrink-0" />}
          {status === 'paused' && <PlayCircle size={16} className="dsh-warn shrink-0" />}
          <h4 className="dsh-t-s dsh-strong dsh-label-primary truncate">{title}</h4>
        </div>
        <span className="dsh-t-xs dsh-mono dsh-tnum dsh-label-tertiary shrink-0 ml-2">
          {current} / {total} {label || ''}
        </span>
      </div>

      <div
        className="w-full h-2 mb-3 overflow-hidden rounded-full"
        style={{ background: 'var(--dsw-alias-bg-layer-3)' }}
      >
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%`, background: barColor }}
        />
      </div>

      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-3 dsh-border-t">
          {stats.map((stat, idx) => (
            <div
              key={idx}
              className="p-2 text-center"
              style={{ background: 'var(--dsw-alias-bg-layer-1)', borderRadius: 'var(--dsh-radius-sm)' }}
            >
              <span
                className="dsh-t-xxxs uppercase dsh-strong dsh-label-caption block"
                style={{ letterSpacing: '0.05em' }}
              >
                {stat.label}
              </span>
              <span className="dsh-t-s dsh-strong dsh-tnum dsh-label-primary">{stat.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
