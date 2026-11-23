'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldQuestion, TrendingUp } from 'lucide-react';

/**
 * Yesterday, in findings.
 *
 * The endpoint (`/api/agent/ceo/findings`) returns findings already ordered blocked → risk →
 * win → note, each with the evidence it came from. This component only has to render them
 * honestly and let the owner refresh.
 *
 * THREE DECISIONS WORTH KNOWING
 *   1. The EVIDENCE is shown, not hidden behind a tooltip. "Cost per lead is up" without the
 *      numbers is an opinion; with them the owner can disagree with the conclusion and still
 *      trust the arithmetic. Collapsing it would undo the point of the engine.
 *   2. Anything needing approval says so on the row. The report never acts, and the owner
 *      should be able to see at a glance which items would need their yes.
 *   3. It reads only what the server sends. If something could not be measured, the server
 *      says so in `missing` and this shows a quiet note — it never fills the gap with a zero
 *      that reads like a fact.
 */

type Severity = 'blocked' | 'risk' | 'win' | 'note';

interface Finding {
  id: string;
  severity: Severity;
  title: string;
  evidence: string;
  recommendation: string;
  needsReview: boolean;
}

interface FindingsPayload {
  ok?: boolean;
  window?: { from: string; to: string };
  findings?: Finding[];
  summary?: string;
  missing?: string[];
  error?: string;
}

const STYLES: Record<Severity, { chip: string; dot: string; Icon: typeof Info; label: string }> = {
  blocked: {
    chip: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
    dot: 'bg-red-500',
    Icon: AlertTriangle,
    label: 'Needs you now',
  },
  risk: {
    chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    dot: 'bg-amber-500',
    Icon: AlertTriangle,
    label: 'Watch',
  },
  win: {
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    dot: 'bg-emerald-500',
    Icon: TrendingUp,
    label: 'Working',
  },
  note: {
    chip: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800',
    dot: 'bg-slate-400',
    Icon: Info,
    label: 'Note',
  },
};

export default function CeoFindingsCard({ impersonateId }: { impersonateId?: string | null } = {}) {
  const [payload, setPayload] = React.useState<FindingsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  // Whose findings these are: a super admin inspecting a tenant must read that
  // tenant's report, not their own.
  const impParam = impersonateId ? `?impersonate=${encodeURIComponent(impersonateId)}` : '';

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/ceo/findings${impParam}`, { cache: 'no-store' });
      const body = (await response.json()) as FindingsPayload;
      if (!response.ok || body?.ok === false) {
        setError(body?.error || `Could not load the report (${response.status})`);
        setPayload(null);
      } else {
        setPayload(body);
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [impParam]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const findings = payload?.findings ?? [];
  const shown = expanded ? findings : findings.slice(0, 4);
  const hidden = Math.max(0, findings.length - shown.length);
  const span = payload?.window ? `${payload.window.from}` : '';

  return (
    <section
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden"
      aria-label="CEO findings"
    >
      <header className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Yesterday, in findings</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {loading ? 'Reading the numbers…' : payload?.summary || 'Nothing to report.'}
            {span && !loading ? ` · ${span}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh findings"
          className="shrink-0 p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="p-3">
        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading findings">
            {[88, 72, 80].map((width, index) => (
              <div key={index} className="animate-pulse flex items-center gap-2 rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                <div className="h-2.5 w-2.5 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />
                <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3">
            <p className="text-xs font-semibold text-red-700 dark:text-red-300">{error}</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
              The report is read-only; nothing was changed. Try refreshing.
            </p>
          </div>
        ) : findings.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-100 dark:border-slate-800 p-3">
            <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Nothing needs you today. The report will look again tomorrow morning.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.map((finding) => {
              const style = STYLES[finding.severity] ?? STYLES.note;
              const Icon = style.Icon;
              return (
                <li
                  key={finding.id}
                  className="rounded-xl border border-slate-100 dark:border-slate-800 p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <Icon size={16} className={`mt-0.5 shrink-0 ${finding.severity === 'win' ? 'text-emerald-500' : finding.severity === 'note' ? 'text-slate-400' : finding.severity === 'risk' ? 'text-amber-500' : 'text-red-500'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${style.chip}`}>
                          {style.label}
                        </span>
                        {finding.needsReview && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                            <ShieldQuestion size={10} /> needs your approval
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                        {finding.title}
                      </p>
                      {/* The evidence stays visible: without the numbers this is an opinion. */}
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{finding.evidence}</p>
                      <p className="mt-1.5 text-xs text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">We suggest: </span>
                        {finding.recommendation}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900 transition"
          >
            Show {hidden} more
          </button>
        )}

        {/* A gap is stated, never filled with a zero that reads like a fact. */}
        {(payload?.missing?.length ?? 0) > 0 && (
          <p className="mt-2 px-1 text-[11px] text-slate-400 dark:text-slate-500">
            Not measured for this report: {payload!.missing!.join(', ')}. Those figures are
            unknown, not zero.
          </p>
        )}
      </div>
    </section>
  );
}
