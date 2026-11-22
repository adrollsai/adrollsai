'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Copy,
  Loader2,
  Phone,
  PhoneForwarded,
  Play,
  RefreshCw,
  Save,
  Smartphone,
  Sparkles,
} from 'lucide-react';

/**
 * INBOUND RECEPTIONIST - the test bench.
 *
 * The outbound demo calls a prospect for you. Inbound is the mirror image: you forward your own
 * phone to a Nobogent DID and the AI answers AS the business. Nothing on this page dials anyone -
 * the carrier leg belongs to the user's phone - so the page's job is to make the two things that
 * can silently break visible BEFORE the call:
 *
 *   1. is the voice engine reachable, and is the speech model actually allowed to run?
 *   2. does the answer webhook return a media stream for THIS DID?
 *
 * Both are shown as facts, not as a green tick that ignores them.
 */

interface Config {
  did: string;
  enabled: boolean;
  voiceName: string;
  language: string;
  greeting: string;
  script: string;
  includeCatalogue: boolean;
  campaignId?: string | null;
}

interface Readiness {
  bridge: { ok: boolean; url: string; detail: string };
  config: { stored: boolean; enabled: boolean; campaignId: string | null };
  canAnswer: boolean;
  blockers: string[];
}

interface Payload {
  config: Config;
  stored: boolean;
  businessName: string | null;
  industry: string | null;
  readiness: Readiness;
  recentCalls: Array<{
    id: string;
    name: string;
    phone: string;
    voice_call_status: string | null;
    voice_call_summary: string | null;
    voice_recording_url: string | null;
    created_at: string | null;
  }>;
  answerUrl: string;
  choices: { voices: string[]; languages: string[] };
  didCandidates: string[];
}

const pretty = (n: string) => {
  const d = n.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 6)} ${d.slice(6)}`;
  return n;
};

export default function InboundDemoPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [copied, setCopied] = useState('');

  const load = useCallback(async (probe = false) => {
    const res = await fetch(`/api/inbound/line${probe ? '?probe=1' : ''}`, { cache: 'no-store' });
    const json = await res.json();
    if (!res.ok) {
      setNotice({ kind: 'err', text: json?.error || 'Could not load the line' });
      setLoading(false);
      return;
    }
    setData(json);
    setForm((prev) => prev ?? json.config);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Watch for the call while the owner is on the phone.
   *
   * The outbound demo had a live view because you watch it happen on your screen. Inbound happens on
   * a phone in the owner's hand, so without this the page looks dead during the only minute it
   * matters. Polls the caller list only - never the form - so an unsaved edit is never clobbered.
   */
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/inbound/line', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        setData((d) => (d ? { ...d, recentCalls: json.recentCalls, readiness: json.readiness } : d));
      } catch {
        /* a dropped poll is not worth surfacing */
      }
    }, 6000);
    return () => clearInterval(id);
  }, []);

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setNotice({ kind: 'warn', text: 'Copy failed - select the text and copy it manually.' });
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/inbound/line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ...form }),
      });
      const json = await res.json();
      if (!res.ok) setNotice({ kind: 'err', text: json?.error || 'Could not save' });
      else {
        setNotice({ kind: json.campaignError ? 'warn' : 'ok', text: json.message });
        setData((d) => (d ? { ...d, config: json.config, stored: true, readiness: json.readiness } : d));
        setForm(json.config);
      }
    } finally {
      setSaving(false);
    }
  };

  const probe = async () => {
    setProbing(true);
    setNotice(null);
    try {
      await load(true);
      setNotice({ kind: 'ok', text: 'Checked the voice engine and the speech model.' });
    } finally {
      setProbing(false);
    }
  };

  const runWebhookTest = async () => {
    setTesting(true);
    setTestResult(null);
    setNotice(null);
    try {
      const res = await fetch('/api/inbound/line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'simulate' }),
      });
      const json = await res.json();
      if (!res.ok) setNotice({ kind: 'err', text: json?.error || 'The webhook test failed' });
      else {
        setTestResult(json);
        setNotice({ kind: json.ok ? 'ok' : 'warn', text: json.message });
      }
    } finally {
      setTesting(false);
    }
  };

  const did = form?.did || data?.config.did || '';
  const forwardCode = useMemo(() => {
    const digits = did.replace(/\D/g, '');
    return { unconditional: `*21*${digits}#`, conditional: `**21*${digits}#`, cancel: '##21#' };
  }, [did]);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-3 text-slate-500">
        <Loader2 className="animate-spin" size={18} /> Loading the inbound line...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-indigo-500">
            <PhoneForwarded size={14} /> Inbound receptionist
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">Answer your own phone with AI</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Turn on call forwarding from your personal number to the Nobogent number below. When someone
            rings your phone, the AI answers as {data?.businessName || 'your business'} — greeting them,
            answering from your catalogue, and taking a callback.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={probe}
            disabled={probing}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2"
          >
            {probing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Re-check readiness
          </button>
          <Link
            href="/dashboard/crm"
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2"
          >
            Inbound calls in CRM <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${
            notice.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : notice.kind === 'warn'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {notice.kind === 'ok' ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* ---- the number */}
      <section className="rounded-[1.75rem] bg-gradient-to-tr from-indigo-600 to-violet-600 p-6 sm:p-8 text-white shadow-lg shadow-indigo-500/20">
        <div className="text-[11px] font-black uppercase tracking-widest text-white/70">Your Nobogent inbound number</div>
        <div className="flex flex-wrap items-center gap-4 mt-2">
          <div className="text-3xl sm:text-4xl font-black tracking-tight">{pretty(did)}</div>
          <button
            onClick={() => copy(did.replace(/\D/g, ''), 'did')}
            className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-bold flex items-center gap-2"
          >
            {copied === 'did' ? <Check size={14} /> : <Copy size={14} />} {copied === 'did' ? 'Copied' : 'Copy number'}
          </button>
        </div>
        <p className="text-xs text-white/70 mt-3 max-w-2xl">
          <strong className="text-white">You do not need call forwarding to test this.</strong> Dial the number
          above from any other phone: the receptionist answers exactly as it would for a forwarded call — the
          forwarding hop is only how your own line gets here. Forwarding is worth turning on afterwards, once
          you have heard it work.
        </p>
        <p className="text-xs text-white/60 mt-2 max-w-2xl">
          Turning forwarding off later: dial {forwardCode.cancel}. The page watches for the call and the caller
          appears below within a few seconds of you hanging up.
        </p>
      </section>

      {/* ---- readiness */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">Can it answer right now?</h2>
          <span
            className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${
              data?.readiness.canAnswer ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {data?.readiness.canAnswer ? 'Ready' : 'Blocked'}
          </span>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="font-bold text-slate-700">Voice engine</div>
            <div className={data?.readiness.bridge.ok ? 'text-emerald-600' : 'text-red-600'}>
              {data?.readiness.bridge.ok ? 'reachable' : 'unreachable'} — {data?.readiness.bridge.detail}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 break-all">{data?.readiness.bridge.url}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="font-bold text-slate-700">Script prepared</div>
            <div className={data?.readiness.config.campaignId ? 'text-emerald-600' : 'text-amber-600'}>
              {data?.readiness.config.campaignId ? 'yes, linked to the line' : 'not yet — press Save'}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              {data?.readiness.config.stored ? 'customisation saved' : 'running on built-in defaults'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="font-bold text-slate-700">Answer webhook</div>
            <div className="text-slate-500 break-all">{data?.answerUrl}</div>
            <button
              onClick={() => copy(data?.answerUrl || '', 'url')}
              className="text-[10px] font-bold text-indigo-600 mt-1 inline-flex items-center gap-1"
            >
              {copied === 'url' ? <Check size={11} /> : <Clipboard size={11} />} copy for the Vobiz console
            </button>
          </div>
        </div>

        {!!data?.readiness.blockers.length && (
          <ul className="mt-3 space-y-1.5">
            {data.readiness.blockers.map((b, i) => (
              <li key={i} className="text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {b}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={runWebhookTest}
            disabled={testing}
            className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-2 hover:bg-slate-800 disabled:opacity-60"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Test the answer webhook
          </button>
          <span className="text-[11px] text-slate-400 self-center">
            Posts the same request Vobiz sends on a real forwarded call and shows what came back. No phone involved.
          </span>
        </div>

        {testResult && (
          <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
            <div className="grid sm:grid-cols-4 gap-2 p-3 bg-slate-50 text-[11px]">
              <div>
                <div className="text-slate-400 font-bold uppercase text-[9px]">Stream</div>
                <div className={testResult.routed.hasStream ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                  {testResult.routed.hasStream ? 'returned' : testResult.routed.hasHangup ? 'hangup' : 'none'}
                </div>
              </div>
              <div>
                <div className="text-slate-400 font-bold uppercase text-[9px]">Inbound flag</div>
                <div className="font-bold text-slate-700">{testResult.routed.inboundFlag ? 'true' : 'missing'}</div>
              </div>
              <div>
                <div className="text-slate-400 font-bold uppercase text-[9px]">Voice</div>
                <div className="font-bold text-slate-700">{testResult.routed.voice || '—'}</div>
              </div>
              <div>
                <div className="text-slate-400 font-bold uppercase text-[9px]">Campaign</div>
                <div className="font-bold text-slate-700">{testResult.routed.campaignId ? 'linked' : 'none'}</div>
              </div>
            </div>
            <pre className="text-[10px] leading-relaxed bg-slate-900 text-slate-100 p-3 overflow-x-auto max-h-56">
              {testResult.xml}
            </pre>
            {testResult.probeLeadCleanedUp && (
              <div className="px-3 py-2 text-[10px] text-slate-400 bg-slate-50">
                The probe caller was cleaned out of the CRM again.
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---- forwarding instructions */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5">
        <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Smartphone size={15} /> Turn forwarding on
        </h2>
        <div className="grid sm:grid-cols-2 gap-4 mt-3 text-xs">
          <div className="rounded-xl border border-slate-100 p-3">
            <div className="font-bold text-slate-800 mb-1">Dial these from your own phone</div>
            <ul className="space-y-2">
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Forward all calls</span>
                <button onClick={() => copy(forwardCode.unconditional, 'u1')} className="font-mono font-bold text-indigo-600">
                  {forwardCode.unconditional} {copied === 'u1' ? '✓' : ''}
                </button>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Only when busy / unanswered</span>
                <button onClick={() => copy(forwardCode.conditional, 'u2')} className="font-mono font-bold text-indigo-600">
                  {forwardCode.conditional} {copied === 'u2' ? '✓' : ''}
                </button>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Turn forwarding off</span>
                <button onClick={() => copy(forwardCode.cancel, 'u3')} className="font-mono font-bold text-slate-700">
                  {forwardCode.cancel} {copied === 'u3' ? '✓' : ''}
                </button>
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-100 p-3">
            <div className="font-bold text-slate-800 mb-1">Or in the phone's settings</div>
            <ul className="space-y-1.5 text-slate-500 list-disc pl-4">
              <li>iPhone: Settings → Phone → Call Forwarding → on → enter the number.</li>
              <li>Android: Phone app → Settings → Calls → Call forwarding → All incoming calls.</li>
              <li>Airplane mode or a second phone is the quickest way to confirm the AI answers.</li>
            </ul>
            <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              One-time setup on our side: the number above must be pointed at the answer webhook in the Vobiz
              console (Application → answer URL, method POST). If a forwarded call rings once and then goes
              silent, that routing is what is missing.
            </div>
          </div>
        </div>
      </section>

      {/* ---- the receptionist, customised */}
      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Sparkles size={15} /> The receptionist
          </h2>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input
              type="checkbox"
              checked={!!form?.enabled}
              onChange={(e) => setForm((f) => (f ? { ...f, enabled: e.target.checked } : f))}
              className="accent-indigo-600"
            />
            Line active
          </label>
        </div>

        {form && (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Voice</span>
                <select
                  value={form.voiceName}
                  onChange={(e) => setForm({ ...form, voiceName: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
                >
                  {(data?.choices.voices || []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Language</span>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
                >
                  {(data?.choices.languages || []).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Number</span>
                <select
                  value={form.did}
                  onChange={(e) => setForm({ ...form, did: e.target.value })}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold"
                >
                  {(data?.didCandidates || [form.did]).map((n) => (
                    <option key={n} value={n}>
                      {pretty(n)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Greeting — spoken first, word for word
              </span>
              <textarea
                value={form.greeting}
                onChange={(e) => setForm({ ...form, greeting: e.target.value })}
                rows={2}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-xs"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Receptionist script — what to ask, what never to promise
              </span>
              <textarea
                value={form.script}
                onChange={(e) => setForm({ ...form, script: e.target.value })}
                rows={7}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
              />
            </label>

            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                checked={!!form.includeCatalogue}
                onChange={(e) => setForm({ ...form, includeCatalogue: e.target.checked })}
                className="accent-indigo-600"
              />
              Read my catalogue back to callers (attached to the script automatically)
            </label>

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-wide flex items-center gap-2 hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save receptionist
              </button>
              <span className="text-[11px] text-slate-400">
                Saving re-derives the script the voice engine reads, so the next call uses it.
              </span>
            </div>
          </>
        )}
      </section>

      {/* ---- recent inbound calls */}
      <section className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Phone size={15} /> Recent inbound calls
          </h2>
          <span className="text-[11px] text-slate-400">{data?.recentCalls.length || 0} callers</span>
        </div>
        {!data?.recentCalls.length ? (
          <div className="px-5 py-8 text-center text-xs text-slate-400">
            No inbound calls yet. Forward your phone and dial it from another number — the caller appears here
            as a CRM lead with the transcript and recording.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="text-left px-5 py-2 font-black">Caller</th>
                <th className="text-left px-3 py-2 font-black">Status</th>
                <th className="text-left px-3 py-2 font-black">What they said</th>
                <th className="text-left px-3 py-2 font-black">Recording</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCalls.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-5 py-2.5">
                    <div className="font-bold text-slate-800">{c.name}</div>
                    <div className="text-slate-400">{c.phone}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{c.voice_call_status || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-600 max-w-md">
                    {c.voice_call_summary ? String(c.voice_call_summary).slice(0, 160) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.voice_recording_url ? (
                      <a href={c.voice_recording_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-bold">
                        listen
                      </a>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
