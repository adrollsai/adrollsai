'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, MessageSquare, PhoneCall, RefreshCw, ShieldCheck } from 'lucide-react';

/**
 * The flow approvals queue.
 *
 * A flow decides who to contact and what to say; this screen is where a person decides whether it
 * happens. Every row is a real step the scheduler was due to run: real lead, real number, real text
 * or template. Nothing here has been sent yet — that is what the row existing means.
 *
 * Approving sends immediately and reports the provider's answer, because the useful question is
 * never "was it approved?" but "did it go out, and if not, why?".
 */

interface Delivery {
  id: string;
  channel: 'whatsapp' | 'call';
  summary: string;
  toPhone: string | null;
  leadName: string | null;
  leadPhone: string | null;
  body: string | null;
  templateName: string | null;
  flowId: string | null;
  flowStepIndex: number | null;
  trigger: string | null;
  status: string;
  createdAt: string;
  errorMessage: string | null;
}

type Outcome = { tone: 'ok' | 'warn' | 'bad'; message: string };

export function PendingDeliveries() {
  const [rows, setRows] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  /**
   * Rows this person just decided.
   *
   * They leave the pending queue the moment they are decided, and that is the one moment the answer
   * matters most — "approved, but not sent because…" is the sentence somebody needs to read. Keeping
   * them on screen until the page is refreshed is the difference between a screen that reports and a
   * screen where a row simply disappears.
   */
  const [decided, setDecided] = useState<{ delivery: Delivery; outcome: Outcome }[]>([]);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/flows/deliveries?status=${showAll ? 'delivered' : 'pending_approval'}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `The queue could not be read (HTTP ${res.status}).`);
      setRows(json.deliveries ?? []);
    } catch (e: any) {
      setError(String(e?.message || e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (delivery: Delivery, decision: 'approve' | 'reject') => {
      setBusyId(delivery.id);
      try {
        const res = await fetch('/api/flows/deliveries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryId: delivery.id, decision }),
        });
        const json = await res.json();
        if (!res.ok && !json?.status) throw new Error(json?.error || `HTTP ${res.status}`);
        const tone: Outcome['tone'] = json.status === 'delivered' ? 'ok' : json.status === 'blocked' ? 'warn' : json.status === 'rejected' ? 'warn' : 'bad';
        const outcome: Outcome = { tone, message: String(json.message || json.status || 'Done.') };
        setOutcomes((prev) => ({ ...prev, [delivery.id]: outcome }));
        setDecided((prev) => [{ delivery, outcome }, ...prev].slice(0, 8));
        // A decided row leaves the pending list; it stays visible in "Just decided" above, because
        // the reason it did not send is the most useful thing on this screen.
        await load();
      } catch (e: any) {
        setOutcomes((prev) => ({ ...prev, [delivery.id]: { tone: 'bad', message: String(e?.message || e) } }));
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <ShieldCheck className="text-violet-600" size={22} /> Flow approvals
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Steps your flows are due to take. Nothing is sent until you approve it — and approving shows you exactly what the provider said.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            {showAll ? 'Show waiting' : 'Show sent'}
          </button>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {decided.length > 0 && (
        <ul className="mt-5 space-y-2">
          {decided.map(({ delivery, outcome }) => (
            <li
              key={`decided-${delivery.id}`}
              className={`rounded-2xl border p-3 text-xs ${
                outcome.tone === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : outcome.tone === 'warn'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              <p className="font-bold">{delivery.summary}</p>
              <p className="mt-0.5">{outcome.message}</p>
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> Reading the queue…
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <CheckCircle2 className="mx-auto text-emerald-500" size={26} />
          <p className="mt-3 text-sm font-bold text-slate-800">{showAll ? 'Nothing has been sent by a flow yet.' : 'Nothing is waiting for you.'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {showAll
              ? 'Approved steps appear here after they are dispatched.'
              : 'A step appears here when a flow is due to message or call somebody.'}
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((d) => {
            const outcome = outcomes[d.id];
            const busy = busyId === d.id;
            const ChannelIcon = d.channel === 'call' ? PhoneCall : MessageSquare;
            return (
              <li key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                        <ChannelIcon size={14} />
                      </span>
                      <p className="truncate text-sm font-bold text-slate-900">{d.summary}</p>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} /> queued {new Date(d.createdAt).toLocaleString()}
                      </span>
                      {d.trigger && <span>trigger: {d.trigger}</span>}
                      {d.flowStepIndex !== null && <span>step {d.flowStepIndex + 1}</span>}
                      <span className="font-mono text-[10px] text-slate-400">{d.id.slice(0, 8)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      disabled={busy || d.status !== 'pending_approval'}
                      onClick={() => void decide(d, 'reject')}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <Ban size={13} /> Reject
                    </button>
                    <button
                      disabled={busy || d.status !== 'pending_approval'}
                      onClick={() => void decide(d, 'approve')}
                      className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve &amp; send
                    </button>
                  </div>
                </div>

                {d.channel === 'call' ? (
                  <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    <span className="font-bold">The AI will call about:</span> {d.body || 'their enquiry'}
                  </p>
                ) : d.templateName ? (
                  <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                    <span className="font-bold">Template:</span> {d.templateName}
                    <span className="ml-2 text-slate-400">an approved template may be sent at any hour</span>
                  </p>
                ) : (
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{d.body || '(no text)'}</p>
                )}

                {d.status !== 'pending_approval' && (
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{d.status}</p>
                )}
                {d.errorMessage && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {d.errorMessage}
                  </p>
                )}
                {outcome && (
                  <p
                    className={`mt-2 text-xs font-bold ${
                      outcome.tone === 'ok' ? 'text-emerald-600' : outcome.tone === 'warn' ? 'text-amber-600' : 'text-rose-600'
                    }`}
                  >
                    {outcome.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
