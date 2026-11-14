'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Sparkles, Check, Coins, CalendarClock, Bot, ArrowRight, AlertCircle } from 'lucide-react';
import type { CeoToday } from '@/lib/agent/ceo-today';

/**
 * The CEO tab's interactive half.
 *
 * It starts with the data already loaded — the server component above ran the
 * queries and passed the payload in, so the first paint is the real tile rather
 * than a spinner. The only client-side fetch is the refresh after an action.
 *
 * Deliberately not a dashboard: it answers three questions and then gets out of
 * the way — is the daily engine on, what has it done today, and is anything
 * waiting on me. Everything deeper lives in the conversation behind "Talk to the
 * CEO".
 */
export default function CeoTodayPanel({ initial }: { initial: CeoToday }) {
  const [data, setData] = useState<CeoToday>(initial);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/ceo/today');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load today');
      setData(json);
    } catch (e: any) {
      toast.error(e?.message || 'Could not load today');
    }
  }, []);

  const switchOn = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/agent/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not start the daily routine');
      toast.success('Daily engine on — first run is tomorrow morning.');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not start the daily routine');
    } finally {
      setBusy(false);
    }
  };

  const routine = data.routines?.find((r: any) => r.enabled) || data.routines?.[0] || null;
  const run = data.todayRun;
  const spent = run?.credits_spent != null ? Number(run.credits_spent) : 0;
  const cap = Number(routine?.daily_credit_cap || 0);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{data.dateLabel}</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
            {data.businessName || 'Your business'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Your marketing chief of staff. It runs the day, asks before it spends, and reports twice a day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.credits != null && (
            <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
              <Coins size={13} /> {Number(data.credits).toLocaleString('en-IN')} credits
            </span>
          )}
          <Link
            href="/dashboard/agent?ceo=1"
            className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
          >
            <Bot size={13} /> Talk to the CEO <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      {data.needsMigration && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            The daily engine is not set up on this database yet. Run{' '}
            <code className="font-mono">sql/migrations/16_business_routines.sql</code>.
          </span>
        </div>
      )}

      {/* Engine status */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-slate-400" />
            <h2 className="text-sm font-bold text-slate-800">Daily engine</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                routine?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {routine?.enabled ? 'on' : 'off'}
            </span>
          </div>
          {!routine?.enabled && (
            <button
              onClick={switchOn}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Start it
            </button>
          )}
        </div>

        {routine ? (
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Today</dt>
              <dd className="text-sm text-slate-800">
                {run ? `${run.status}` : 'not started yet'}
                {run?.error ? <span className="text-rose-600"> — {run.error}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Spend today</dt>
              <dd className="text-sm text-slate-800">
                {spent} {cap ? `of ${cap}` : ''} credits
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cadence</dt>
              <dd className="text-sm text-slate-800">{routine.cadence} · asks before spending</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Next run</dt>
              <dd className="text-sm text-slate-800">
                {routine.next_run_at ? new Date(routine.next_run_at).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        ) : (
          !data.needsMigration && (
            <p className="mt-2 text-sm text-slate-500">
              Nothing is running daily yet. Start it and tomorrow morning it will plan the day, ask you once
              before spending, and report back in the evening.
            </p>
          )
        )}
      </div>

      {/* Needs you */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold text-slate-800 mb-2">Needs you</h2>
        {data.approvals?.length ? (
          <ul className="space-y-2">
            {data.approvals.map((a: any) => (
              <li key={a.actionId || a.title} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">{a.title}</p>
                {a.description && <p className="text-xs text-slate-500 mt-0.5">{a.description}</p>}
                {a.estimatedCost && (
                  <p className="text-xs font-bold text-slate-700 mt-1">Est: {a.estimatedCost}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-600 flex items-center gap-1.5">
            <Check size={14} /> Nothing waiting on you.
          </p>
        )}
        {data.approvals?.length ? (
          <p className="mt-2 text-xs text-slate-500">
            Approve or change them in the conversation — the agent already has the script and voice loaded.
          </p>
        ) : null}
      </div>
    </div>
  );
}
