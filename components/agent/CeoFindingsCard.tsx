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
 *
 * WHY THIS NO LONGER USES TAILWIND `dark:` PAIRS
 * It used to be written as `bg-white dark:bg-slate-950` and so on. Tailwind's `dark:` variant
 * keys off the OS colour scheme (or a `dark` class), but this UI switches theme with
 * `data-theme` on the `.dsh` element — so those pairs always resolved to the LIGHT branch and
 * the card sat there white inside a dark conversation. Same failure the HTML artifact preview
 * had. Colour now comes from the harness tokens, which is the only mechanism that sees
 * `data-theme`: `--dsw-alias-state-*-tertiary` is a pale tint in light and a deep tint in
 * dark, which is exactly what a severity chip needs.
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

const TINTED_CHIP = (state: string): React.CSSProperties => ({
  background: `var(--dsw-alias-state-${state}-tertiary)`,
  color: `var(--dsw-alias-state-${state}-primary)`,
  borderColor: `var(--dsw-alias-state-${state}-primary)`,
});

const STYLES: Record<Severity, { chip: React.CSSProperties; dot: string; Icon: typeof Info; label: string }> = {
  blocked: {
    chip: TINTED_CHIP('error'),
    dot: 'var(--dsw-alias-state-error-primary)',
    Icon: AlertTriangle,
    label: 'Needs you now',
  },
  risk: {
    chip: TINTED_CHIP('warn'),
    dot: 'var(--dsw-alias-state-warn-primary)',
    Icon: AlertTriangle,
    label: 'Watch',
  },
  win: {
    chip: TINTED_CHIP('success'),
    dot: 'var(--dsw-alias-state-success-primary)',
    Icon: TrendingUp,
    label: 'Working',
  },
  note: {
    chip: {
      background: 'var(--dsw-alias-interactive-bg-active)',
      color: 'var(--dsw-alias-label-secondary)',
      borderColor: 'var(--dsw-alias-border-l2)',
    },
    dot: 'var(--dsw-alias-label-caption)',
    Icon: Info,
    label: 'Note',
  },
};

const CARD: React.CSSProperties = {
  background: 'var(--nobo-card, var(--dsw-alias-bg-layer-1))',
  borderColor: 'var(--dsw-alias-border-l2)',
};

const ROW: React.CSSProperties = { borderColor: 'var(--dsw-alias-border-l1)' };

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
      className="rounded-2xl border overflow-hidden"
      style={CARD}
      aria-label="CEO findings"
    >
      <header
        className="flex items-start gap-3 px-4 py-3 border-b"
        style={{ borderColor: 'var(--dsw-alias-border-l1)' }}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold dsh-label-primary">Yesterday, in findings</h2>
          <p className="text-xs dsh-label-tertiary mt-0.5 truncate">
            {loading ? 'Reading the numbers…' : payload?.summary || 'Nothing to report.'}
            {span && !loading ? ` · ${span}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh findings"
          className="shrink-0 p-2 rounded-lg dsh-label-tertiary dsh-interactive transition disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="p-3">
        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading findings">
            {[88, 72, 80].map((width, index) => (
              <div
                key={index}
                className="animate-pulse flex items-center gap-2 rounded-xl border p-3"
                style={ROW}
              >
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: 'var(--dsw-alias-label-dimmed)' }}
                />
                <div
                  className="h-3 rounded-full"
                  style={{ width: `${width}%`, background: 'var(--dsw-alias-interactive-bg-active)' }}
                />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border p-3" style={TINTED_CHIP('error')}>
            <p className="text-xs font-semibold">{error}</p>
            <p className="text-xs mt-1 opacity-80">
              The report is read-only; nothing was changed. Try refreshing.
            </p>
          </div>
        ) : findings.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border p-3" style={ROW}>
            <CheckCircle2 size={16} className="shrink-0 dsh-success" />
            <p className="text-xs dsh-label-secondary">
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
                  className="rounded-xl border p-3"
                  style={ROW}
                >
                  <div className="flex items-start gap-2.5">
                    <Icon size={16} className="mt-0.5 shrink-0" style={{ color: style.dot }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border"
                          style={style.chip}
                        >
                          {style.label}
                        </span>
                        {finding.needsReview && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border"
                            style={{
                              borderColor: 'var(--dsw-alias-border-l2)',
                              color: 'var(--dsw-alias-label-secondary)',
                            }}
                          >
                            <ShieldQuestion size={10} /> needs your approval
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold dsh-label-primary leading-snug">
                        {finding.title}
                      </p>
                      {/* The evidence stays visible: without the numbers this is an opinion. */}
                      <p className="mt-1 text-xs dsh-label-tertiary">{finding.evidence}</p>
                      <p className="mt-1.5 text-xs dsh-label-secondary">
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
            className="mt-2 w-full py-2.5 rounded-xl border text-xs font-semibold dsh-label-secondary dsh-interactive transition"
            style={{ borderColor: 'var(--dsw-alias-border-l2)' }}
          >
            Show {hidden} more
          </button>
        )}

        {/* A gap is stated, never filled with a zero that reads like a fact. */}
        {(payload?.missing?.length ?? 0) > 0 && (
          <p className="mt-2 px-1 text-[11px] dsh-label-caption">
            Not measured for this report: {payload!.missing!.join(', ')}. Those figures are
            unknown, not zero.
          </p>
        )}
      </div>
    </section>
  );
}
