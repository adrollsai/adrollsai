'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Automation control panel.
 *
 * Everything the "marketing department" does unattended — daily creative, video
 * reel, weekly WhatsApp, AI calling, website — is driven by one policy row.
 * This screen is the only place a tenant needs to go to change their mind.
 */

interface Settings {
  master_enabled: boolean
  daily_creative: boolean
  video_reel: boolean
  weekly_whatsapp: boolean
  ai_calling: boolean
  website_autobuild: boolean
  timezone: string
  creative_hour_local: number
  video_cadence_days: number
  weekly_send_dow: number
  call_window_start: number
  call_window_end: number
  call_max_attempts: number
  bill_automation: boolean
}

interface Status {
  whatsappConnected: boolean
  deliveryNumber: string | null
  googleConnected: boolean
  telephonyConfigured: boolean
}

const FEATURES: Array<{ key: keyof Settings; label: string; hint: string; needs?: keyof Status }> = [
  { key: 'daily_creative', label: 'Daily creative', hint: 'One AI creative per day for your next property in rotation, with WhatsApp copy, sent to your number.' },
  { key: 'video_reel', label: 'Video reel', hint: 'A 30-second vertical commercial for one property, on a cadence you choose.', needs: 'whatsappConnected' },
  { key: 'weekly_whatsapp', label: 'Weekly WhatsApp check-in', hint: 'A weekly template message to leads that have not booked yet.', needs: 'whatsappConnected' },
  { key: 'ai_calling', label: 'AI calling', hint: 'Calls fresh leads that have not booked or answered, on a fixed cadence.', needs: 'telephonyConfigured' },
  { key: 'website_autobuild', label: 'Website', hint: 'Builds and keeps your listing website live, indexed by Google.' },
]

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function hourLabel(h: number) {
  const suffix = h < 12 ? 'AM' : 'PM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:00 ${suffix}`
}

export default function AutomationSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/automation/settings', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setSettings(data.settings)
      setStatus({
        whatsappConnected: data.whatsappConnected,
        deliveryNumber: data.deliveryNumber,
        googleConnected: data.googleConnected,
        telephonyConfigured: data.telephonyConfigured,
      })
      setDirty(false)
    } catch (e: any) {
      setMessage({ kind: 'err', text: e?.message || 'Failed to load settings' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))
    setDirty(true)
    setMessage(null)
  }

  async function save() {
    if (!settings) return
    setSaving(true)
    setMessage(null)
    try {
      const payload: Record<string, unknown> = {
        master_enabled: settings.master_enabled,
        daily_creative: settings.daily_creative,
        video_reel: settings.video_reel,
        weekly_whatsapp: settings.weekly_whatsapp,
        ai_calling: settings.ai_calling,
        website_autobuild: settings.website_autobuild,
        timezone: settings.timezone,
        creative_hour_local: settings.creative_hour_local,
        video_cadence_days: settings.video_cadence_days,
        weekly_send_dow: settings.weekly_send_dow,
        call_window_start: settings.call_window_start,
        call_window_end: settings.call_window_end,
        call_max_attempts: settings.call_max_attempts,
        bill_automation: settings.bill_automation,
      }
      const res = await fetch('/api/automation/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setSettings(data.settings)
      setDirty(false)
      setMessage({ kind: 'ok', text: 'Saved. Your workflow will use these settings from the next run.' })
    } catch (e: any) {
      setMessage({ kind: 'err', text: e?.message || 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-slate-300 p-8">Loading automation settings…</div>
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 p-8">
        <p className="text-rose-400 mb-3">{message?.text || 'Could not load settings.'}</p>
        <button onClick={load} className="px-4 py-2 rounded-lg bg-slate-800 text-white">Retry</button>
      </div>
    )
  }

  const off = !settings.master_enabled

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-semibold text-white">Marketing automation</h1>
          <Link href="/dashboard/profile/creation-automation" className="text-sm text-sky-400 hover:underline">
            Product rotation →
          </Link>
        </div>
        <p className="text-sm text-slate-400 mb-8">
          Your department runs by default. Switch off anything you would rather handle yourself.
        </p>

        {/* Master switch */}
        <div className={`rounded-2xl border p-5 mb-6 ${off ? 'border-rose-900/60 bg-rose-950/20' : 'border-emerald-900/60 bg-emerald-950/20'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-white">Run my marketing automatically</p>
              <p className="text-sm text-slate-400 mt-1">
                {off
                  ? 'Everything below is paused. Nothing is generated, sent or called.'
                  : 'Your workflow is live and running on schedule.'}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={settings.master_enabled}
              onClick={() => update('master_enabled', !settings.master_enabled)}
              className={`shrink-0 w-14 h-8 rounded-full transition-colors ${settings.master_enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <span className={`block w-6 h-6 bg-white rounded-full transition-transform ${settings.master_enabled ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {/* Per-feature */}
        <div className={`space-y-3 ${off ? 'opacity-50 pointer-events-none' : ''}`}>
          {FEATURES.map((f) => {
            const on = Boolean(settings[f.key])
            const missing = f.needs && status && !status[f.needs]
            return (
              <div key={f.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{f.label}</p>
                    <p className="text-sm text-slate-400 mt-1">{f.hint}</p>
                    {missing && (
                      <p className="text-xs text-amber-400 mt-2">
                        {f.needs === 'whatsappConnected'
                          ? 'WhatsApp is not connected — this will stay idle until it is.'
                          : 'No phone number assigned — calls cannot be placed yet.'}
                      </p>
                    )}
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    onClick={() => update(f.key, !on as never)}
                    className={`shrink-0 w-14 h-8 rounded-full transition-colors ${on ? 'bg-sky-500' : 'bg-slate-700'}`}
                  >
                    <span className={`block w-6 h-6 bg-white rounded-full transition-transform ${on ? 'translate-x-7' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Schedule */}
        <div className={`mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 ${off ? 'opacity-50 pointer-events-none' : ''}`}>
          <p className="font-medium text-white">Timing</p>

          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-300">Daily creative goes out at</span>
            <select
              value={settings.creative_hour_local}
              onChange={(e) => update('creative_hour_local', Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-300">Video every</span>
            <select
              value={settings.video_cadence_days}
              onChange={(e) => update('video_cadence_days', Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
            >
              {[1, 2, 3, 4, 5, 7, 14].map((d) => (
                <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-300">Weekly check-in on</span>
            <select
              value={settings.weekly_send_dow}
              onChange={(e) => update('weekly_send_dow', Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
            >
              {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>

          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-300">Call between</span>
            <div className="flex items-center gap-2">
              <select
                value={settings.call_window_start}
                onChange={(e) => update('call_window_start', Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
              >
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              <span className="text-slate-500">and</span>
              <select
                value={settings.call_window_end}
                onChange={(e) => update('call_window_end', Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white"
              >
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-300">Maximum call attempts per lead</span>
            <input
              type="number"
              min={1}
              max={60}
              value={settings.call_max_attempts}
              onChange={(e) => update('call_max_attempts', Number(e.target.value))}
              className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-right"
            />
          </label>

          <div className="pt-3 border-t border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-slate-300">Charge credits for generated work</p>
                <p className="text-xs text-slate-500 mt-1">
                  Creative costs 10 credits, video 50 per 15-second clip. Turn off if these are
                  included in your plan. When your balance runs out, generation pauses.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={settings.bill_automation}
                onClick={() => update('bill_automation', !settings.bill_automation)}
                className={`shrink-0 w-14 h-8 rounded-full transition-colors ${settings.bill_automation ? 'bg-sky-500' : 'bg-slate-700'}`}
              >
                <span className={`block w-6 h-6 bg-white rounded-full transition-transform ${settings.bill_automation ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>
        </div>

        {message && (
          <p className={`mt-5 text-sm ${message.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{message.text}</p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && !saving && <span className="text-sm text-slate-400">Unsaved changes</span>}
        </div>
      </div>
    </div>
  )
}
