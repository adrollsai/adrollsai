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

  return (
    <div className="my-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {status === 'running' && <Loader2 size={16} className="text-blue-500 animate-spin" />}
          {status === 'completed' && <CheckCircle2 size={16} className="text-emerald-500" />}
          {status === 'failed' && <AlertCircle size={16} className="text-rose-500" />}
          {status === 'paused' && <PlayCircle size={16} className="text-amber-500" />}
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">{title}</h4>
        </div>
        <span className="text-[11px] font-mono font-medium text-slate-500 dark:text-slate-400">
          {current} / {total} {label || ''}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 mb-3 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${
            status === 'completed'
              ? 'bg-emerald-500'
              : status === 'failed'
              ? 'bg-rose-500'
              : 'bg-blue-600'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Metric badges */}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          {stats.map((stat, idx) => (
            <div key={idx} className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                {stat.label}
              </span>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
