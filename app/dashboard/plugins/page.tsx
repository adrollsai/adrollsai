'use client'

import { useState, useEffect } from 'react'
import {
  Loader2,
  Copy,
  RefreshCw,
  CheckCircle2,
  Info,
  Link,
  Plug,
  ArrowLeft,
  ExternalLink
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { getCachedValue, setCachedValue } from '@/utils/client-cache'

export default function PluginsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  const [loading, setLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached) return false
    }
    return true
  })
  const [userId, setUserId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [businessName, setBusinessName] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.businessName) return cached.businessName
    }
    return ''
  })

  // 99acres Webhook
  const [webhookToken, setWebhookToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.webhookToken) return cached.webhookToken
    }
    return null
  })
  const [webhookUrl, setWebhookUrl] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.webhookUrl) return cached.webhookUrl
    }
    return null
  })
  const [isGeneratingWebhook, setIsGeneratingWebhook] = useState(false)

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) { router.push('/'); return }

        setUserId(user.id)

        const { data: authProfile } = await supabase
          .from('profiles')
          .select('role, agency_id, parent_id, business_name')
          .eq('id', user.id)
          .single()

        const currentRole = authProfile?.role || 'admin'

        // Resolve target user
        let tUserId = user.id
        if (['admin', 'agent'].includes(currentRole) && (authProfile?.agency_id || authProfile?.parent_id)) {
          tUserId = (authProfile?.agency_id || authProfile?.parent_id) as string
        }
        if (impersonateId && ['super_admin', 'agency', 'admin', 'agent'].includes(currentRole)) {
          if (currentRole === 'super_admin') {
            tUserId = impersonateId
          } else {
            const { data: subAccount } = await supabase
              .from('profiles')
              .select('id')
              .eq('id', impersonateId)
              .eq('agency_id', authProfile?.agency_id || user.id)
              .single()
            if (subAccount) tUserId = impersonateId
          }
        }
        setTargetUserId(tUserId)

        // Fetch target profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', tUserId)
          .single()

        if (profile) {
          setBusinessName(profile.business_name || '')
          let token: string | null = null
          let url: string | null = null
          if (profile.webhook_token_99acres) {
            token = profile.webhook_token_99acres
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            url = `${origin}/api/webhooks/99acres/${profile.webhook_token_99acres}`
            setWebhookToken(token)
            setWebhookUrl(url)
          }
          // Persist to localStorage
          setCachedValue('plugins_cache', {
            businessName: profile.business_name || '',
            webhookToken: token,
            webhookUrl: url
          })
        }
      } catch (err) {
        console.error('Failed to load plugins page:', err)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [router, supabase, impersonateId])

  const handleGenerateWebhook = async (regenerate = false) => {
    if (regenerate && !confirm('Regenerating will invalidate the old URL. Any 99acres integration using the old URL will stop working. Continue?')) return

    setIsGeneratingWebhook(true)
    const effectiveUserId = targetUserId || userId
    try {
      const res = await fetch('/api/plugins/generate-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: effectiveUserId, regenerate })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate webhook')

      setWebhookToken(data.token)
      setWebhookUrl(data.webhookUrl)
      toast.success(regenerate ? 'Webhook URL regenerated!' : 'Webhook URL generated!')
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate webhook URL')
    } finally {
      setIsGeneratingWebhook(false)
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400 gap-4">
      <Loader2 className="animate-spin text-slate-300" size={32} />
      <p className="text-sm font-medium animate-pulse">Loading plugins...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
            className="bg-white p-2.5 rounded-full shadow-sm border border-slate-200 text-slate-500 hover:text-slate-800 hover:shadow-md transition-all active:scale-95"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Plugins & Integrations</h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Connect third-party lead sources to your CRM
              {businessName && <span className="text-slate-400"> • {businessName}</span>}
            </p>
          </div>
        </div>

        {/* 99acres Integration Card */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md mb-6">
          <div className="p-6 sm:p-8">
            {/* Card Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-red-100 to-red-50 rounded-2xl flex items-center justify-center text-red-600 font-black text-lg shadow-sm border border-red-200">
                  99
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-900">99acres Lead Integration</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Receive property leads directly from 99acres into your CRM
                  </p>
                </div>
              </div>
              {webhookToken && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 shadow-sm">
                  <CheckCircle2 size={14} /> Active
                </span>
              )}
            </div>

            {/* How it works */}
            <div className="bg-slate-50/80 rounded-3xl p-5 border border-slate-100 mb-6">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">How it works</h4>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">1</div>
                  <p className="text-sm text-slate-600 font-medium">Generate a unique webhook URL below</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</div>
                  <p className="text-sm text-slate-600 font-medium">Share this URL with your 99acres account manager</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</div>
                  <p className="text-sm text-slate-600 font-medium">All new leads from 99acres will appear automatically in your CRM pipeline</p>
                </div>
              </div>
            </div>

            {/* Webhook URL Section */}
            {!webhookToken ? (
              <button
                onClick={() => handleGenerateWebhook(false)}
                disabled={isGeneratingWebhook}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-slate-900/10"
              >
                {isGeneratingWebhook ? <Loader2 size={18} className="animate-spin" /> : <Link size={18} />}
                {isGeneratingWebhook ? 'Generating...' : 'Generate Webhook URL'}
              </button>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Your Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-5 text-xs font-mono text-slate-700 truncate select-all shadow-sm">
                      {webhookUrl}
                    </div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(webhookUrl || ''); toast.success('Webhook URL copied!') }}
                      className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white p-3.5 rounded-2xl transition-all active:scale-95 shadow-sm"
                      title="Copy URL"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </div>

                <div className="bg-amber-50/60 border border-amber-100/50 p-4 rounded-2xl flex items-start gap-3">
                  <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-amber-800 font-bold mb-1">Share with 99acres</p>
                    <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                      Copy this URL and send it to your 99acres account manager. Once they configure it on their end, all new leads will flow directly into your CRM with push notifications.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => handleGenerateWebhook(true)}
                    disabled={isGeneratingWebhook}
                    className="text-xs text-slate-500 hover:text-red-600 font-bold py-2 flex items-center gap-1.5 transition-colors"
                  >
                    {isGeneratingWebhook ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Regenerate URL
                  </button>
                  <a
                    href={webhookUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-700 font-bold py-2 flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink size={12} /> Test Endpoint
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Coming Soon Plugins */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden">
          <div className="p-6 sm:p-8">
            <h3 className="font-bold text-base text-slate-900 mb-4 flex items-center gap-2">
              <Plug size={18} className="text-slate-400" /> More Integrations
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { name: 'MagicBricks', color: 'bg-blue-100 text-blue-600 border-blue-200', label: 'MB' },
                { name: 'Housing.com', color: 'bg-green-100 text-green-600 border-green-200', label: 'H' },
                { name: 'IndiaMART', color: 'bg-indigo-100 text-indigo-600 border-indigo-200', label: 'IM' },
                { name: 'JustDial', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'JD' },
              ].map(plugin => (
                <div key={plugin.name} className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50/50 border border-slate-100">
                  <div className={`w-10 h-10 ${plugin.color} rounded-xl flex items-center justify-center font-black text-xs border shadow-sm`}>
                    {plugin.label}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-700">{plugin.name}</p>
                    <p className="text-[10px] text-slate-400 font-medium">Coming soon</p>
                  </div>
                  <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-md uppercase tracking-wider">Soon</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
