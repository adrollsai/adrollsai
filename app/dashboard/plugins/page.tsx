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
  ExternalLink,
  Key
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

  // 99acres Webhook State
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

  // Housing.com Webhook State
  const [housingToken, setHousingToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.housingToken) return cached.housingToken
    }
    return null
  })
  const [housingUrl, setHousingUrl] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.housingUrl) return cached.housingUrl
    }
    return null
  })
  const [isGeneratingHousing, setIsGeneratingHousing] = useState(false)

  // Magicbricks Webhook State
  const [magicbricksToken, setMagicbricksToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.magicbricksToken) return cached.magicbricksToken
    }
    return null
  })
  const [magicbricksUrl, setMagicbricksUrl] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.magicbricksUrl) return cached.magicbricksUrl
    }
    return null
  })
  const [magicbricksEndpoint, setMagicbricksEndpoint] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedValue<any>('plugins_cache')
      if (cached?.magicbricksEndpoint) return cached.magicbricksEndpoint
    }
    return null
  })
  const [isGeneratingMagicbricks, setIsGeneratingMagicbricks] = useState(false)
  const [userEmail, setUserEmail] = useState<string>('')

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) { router.push('/'); return }

        setUserId(user.id)
        setUserEmail(user.email || '')

        const { data: authProfile } = await supabase
          .from('profiles')
          .select('role, agency_id, parent_id, business_name')
          .eq('id', user.id)
          .single()

        const currentRole = authProfile?.role || 'admin'

        // Resolve target user
        let tUserId = user.id
        if (currentRole === 'agent' && (authProfile?.agency_id || authProfile?.parent_id)) {
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
          const origin = typeof window !== 'undefined' ? window.location.origin : ''

          // 99acres token
          let token: string | null = null
          let url: string | null = null
          if (profile.webhook_token_99acres) {
            token = profile.webhook_token_99acres
            url = `${origin}/api/webhooks/99acres/${token}`
            setWebhookToken(token)
            setWebhookUrl(url)
          }

          // Housing.com token from badges
          let hToken: string | null = null
          let hUrl: string | null = null
          const badges: string[] = Array.isArray(profile.badges) ? profile.badges : []
          const hBadge = badges.find(b => typeof b === 'string' && b.startsWith('__WEBHOOK_TOKEN_HOUSING__:'))
          if (hBadge) {
            hToken = hBadge.replace('__WEBHOOK_TOKEN_HOUSING__:', '')
            hUrl = `${origin}/api/webhooks/housing/${hToken}`
            setHousingToken(hToken)
            setHousingUrl(hUrl)
          }

          // Magicbricks token from badges
          let mbToken: string | null = null
          let mbUrl: string | null = null
          let mbEndpoint: string | null = null
          const mbBadge = badges.find(b => typeof b === 'string' && b.startsWith('__WEBHOOK_TOKEN_MAGICBRICKS__:'))
          if (mbBadge) {
            mbToken = mbBadge.replace('__WEBHOOK_TOKEN_MAGICBRICKS__:', '')
            mbUrl = `${origin}/api/webhooks/magicbricks/${mbToken}`
            mbEndpoint = `${origin}/api/webhooks/magicbricks`
            setMagicbricksToken(mbToken)
            setMagicbricksUrl(mbUrl)
            setMagicbricksEndpoint(mbEndpoint)
          }

          // Persist to localStorage cache
          setCachedValue('plugins_cache', {
            businessName: profile.business_name || '',
            webhookToken: token,
            webhookUrl: url,
            housingToken: hToken,
            housingUrl: hUrl,
            magicbricksToken: mbToken,
            magicbricksUrl: mbUrl,
            magicbricksEndpoint: mbEndpoint
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

  const handleGenerateWebhook = async (service: '99acres' | 'housing' | 'magicbricks', regenerate = false) => {
    const serviceName = service === 'magicbricks' ? 'Magicbricks' : service === 'housing' ? 'Housing.com' : '99acres'
    if (regenerate && !confirm(`Regenerating will invalidate the old URL and API Key. Any ${serviceName} integration using the old details will stop working. Continue?`)) return

    if (service === 'magicbricks') setIsGeneratingMagicbricks(true)
    else if (service === 'housing') setIsGeneratingHousing(true)
    else setIsGeneratingWebhook(true)

    const effectiveUserId = targetUserId || userId
    try {
      const res = await fetch('/api/plugins/generate-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: effectiveUserId, regenerate, service })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate webhook')

      if (service === 'magicbricks') {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        setMagicbricksToken(data.token)
        setMagicbricksUrl(data.webhookUrl)
        setMagicbricksEndpoint(data.endpointUrl || `${origin}/api/webhooks/magicbricks`)
      } else if (service === 'housing') {
        setHousingToken(data.token)
        setHousingUrl(data.webhookUrl)
      } else {
        setWebhookToken(data.token)
        setWebhookUrl(data.webhookUrl)
      }

      toast.success(regenerate ? `${serviceName} Webhook details regenerated!` : `${serviceName} Webhook details generated!`)
    } catch (err: any) {
      toast.error(err.message || `Failed to generate ${serviceName} webhook URL`)
    } finally {
      if (service === 'magicbricks') setIsGeneratingMagicbricks(false)
      else if (service === 'housing') setIsGeneratingHousing(false)
      else setIsGeneratingWebhook(false)
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
              Connect third-party lead sources directly to your CRM
              {businessName && <span className="text-slate-400"> • {businessName}</span>}
            </p>
          </div>
        </div>

        {/* 99acres Integration Card */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md mb-6">
          <div className="p-6 sm:p-8">
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

            {!webhookToken ? (
              <button
                onClick={() => handleGenerateWebhook('99acres', false)}
                disabled={isGeneratingWebhook}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-slate-900/10"
              >
                {isGeneratingWebhook ? <Loader2 size={18} className="animate-spin" /> : <Link size={18} />}
                {isGeneratingWebhook ? 'Generating...' : 'Generate 99acres Webhook URL'}
              </button>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Your 99acres Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-5 text-xs font-mono text-slate-700 truncate select-all shadow-sm">
                      {webhookUrl}
                    </div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(webhookUrl || ''); toast.success('99acres Webhook URL copied!') }}
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
                      Copy this URL and send it to your 99acres account manager. Once configured, leads will flow directly into your CRM with push notifications.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => handleGenerateWebhook('99acres', true)}
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

        {/* Housing.com Integration Card */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md mb-6">
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-100 to-teal-50 rounded-2xl flex items-center justify-center text-emerald-600 font-black text-lg shadow-sm border border-emerald-200">
                  H
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Housing.com Lead Integration</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Receive real-time buyer & renter leads from Housing.com into your CRM
                  </p>
                </div>
              </div>
              {housingToken && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 shadow-sm">
                  <CheckCircle2 size={14} /> Active
                </span>
              )}
            </div>

            <div className="bg-slate-50/80 rounded-3xl p-5 border border-slate-100 mb-6">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">How it works</h4>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">1</div>
                  <p className="text-sm text-slate-600 font-medium">Generate your unique Housing.com webhook URL below</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</div>
                  <p className="text-sm text-slate-600 font-medium">Provide this webhook URL to your Housing.com relationship manager</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</div>
                  <p className="text-sm text-slate-600 font-medium">All new property inquiries will sync instantly into your Fresh leads pipeline with auto-assignment</p>
                </div>
              </div>
            </div>

            {!housingToken ? (
              <button
                onClick={() => handleGenerateWebhook('housing', false)}
                disabled={isGeneratingHousing}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-emerald-600/10"
              >
                {isGeneratingHousing ? <Loader2 size={18} className="animate-spin" /> : <Link size={18} />}
                {isGeneratingHousing ? 'Generating...' : 'Generate Housing.com Webhook URL'}
              </button>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Your Housing.com Webhook URL</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-5 text-xs font-mono text-slate-700 truncate select-all shadow-sm">
                      {housingUrl}
                    </div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(housingUrl || ''); toast.success('Housing.com Webhook URL copied!') }}
                      className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white p-3.5 rounded-2xl transition-all active:scale-95 shadow-sm"
                      title="Copy URL"
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                </div>

                <div className="bg-emerald-50/70 border border-emerald-100 p-4 rounded-2xl flex items-start gap-3">
                  <Info size={16} className="text-emerald-700 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-emerald-900 font-bold mb-1">Share with Housing.com</p>
                    <p className="text-[11px] text-emerald-800 leading-relaxed font-medium">
                      Send this URL to Housing.com support or your key account manager. When buyers enquire on your listings, their contact details will land instantly in your CRM.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => handleGenerateWebhook('housing', true)}
                    disabled={isGeneratingHousing}
                    className="text-xs text-slate-500 hover:text-red-600 font-bold py-2 flex items-center gap-1.5 transition-colors"
                  >
                    {isGeneratingHousing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Regenerate URL
                  </button>
                  <a
                    href={housingUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-bold py-2 flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink size={12} /> Test Endpoint
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Magicbricks Integration Card */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md mb-6">
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-red-600 to-rose-700 text-white rounded-2xl flex items-center justify-center font-black text-xl shadow-md shadow-red-500/20">
                  MB
                </div>
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Magicbricks Lead Integration</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Receive property buyer & tenant inquiries from Magicbricks into your CRM
                  </p>
                </div>
              </div>
              {magicbricksToken && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 px-3 py-1.5 rounded-full border border-red-100 shadow-sm">
                  <CheckCircle2 size={14} className="text-red-600" /> Active
                </span>
              )}
            </div>

            <div className="bg-slate-50/80 rounded-3xl p-5 border border-slate-100 mb-6">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">How it works</h4>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-red-100 text-red-700 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">1</div>
                  <p className="text-sm text-slate-600 font-medium">Generate your unique Magicbricks Webhook URL and API Key below</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-red-100 text-red-700 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</div>
                  <p className="text-sm text-slate-600 font-medium">Copy the pre-filled Integration Details below and send them to your Magicbricks account manager</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-red-100 text-red-700 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</div>
                  <p className="text-sm text-slate-600 font-medium">All new inquiries will flow directly into your CRM with instant auto-assignment, WhatsApp welcome drip, and push notifications</p>
                </div>
              </div>
            </div>

            {!magicbricksToken ? (
              <button
                onClick={() => handleGenerateWebhook('magicbricks', false)}
                disabled={isGeneratingMagicbricks}
                className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-red-600/15"
              >
                {isGeneratingMagicbricks ? <Loader2 size={18} className="animate-spin" /> : <Link size={18} />}
                {isGeneratingMagicbricks ? 'Generating...' : 'Generate Magicbricks Webhook URL & API Key'}
              </button>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Webhook Endpoint */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Working Endpoint (POST URL)</label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 text-xs font-mono text-slate-700 truncate select-all shadow-sm">
                        {magicbricksEndpoint || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/magicbricks`}
                      </div>
                      <button
                        onClick={() => {
                          const url = magicbricksEndpoint || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/magicbricks`
                          navigator.clipboard.writeText(url)
                          toast.success('Endpoint URL copied!')
                        }}
                        className="shrink-0 bg-red-600 hover:bg-red-700 text-white p-3 rounded-2xl transition-all active:scale-95 shadow-sm"
                        title="Copy Endpoint URL"
                      >
                        <Copy size={15} />
                      </button>
                    </div>
                  </div>

                  {/* API Key */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Your API Key / Token</label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 text-xs font-mono text-slate-700 truncate select-all shadow-sm">
                        {magicbricksToken}
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(magicbricksToken || '')
                          toast.success('API Key copied!')
                        }}
                        className="shrink-0 bg-red-600 hover:bg-red-700 text-white p-3 rounded-2xl transition-all active:scale-95 shadow-sm"
                        title="Copy API Key"
                      >
                        <Key size={15} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Direct URL */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Direct Tokenized Webhook URL (Alternative)</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 text-xs font-mono text-slate-700 truncate select-all shadow-sm">
                      {magicbricksUrl}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(magicbricksUrl || '')
                        toast.success('Direct Webhook URL copied!')
                      }}
                      className="shrink-0 bg-slate-800 hover:bg-slate-900 text-white p-3 rounded-2xl transition-all active:scale-95 shadow-sm"
                      title="Copy Direct URL"
                    >
                      <Copy size={15} />
                    </button>
                  </div>
                </div>

                {/* Pre-filled Magicbricks Support Questionnaire */}
                <div className="bg-gradient-to-br from-red-50/70 to-orange-50/40 border border-red-200/60 rounded-3xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-red-600 text-white flex items-center justify-center font-bold text-[11px]">
                        ✓
                      </div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Magicbricks Integration Details (Copy & Send)
                      </h4>
                    </div>
                    <button
                      onClick={() => {
                        const ep = magicbricksEndpoint || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/magicbricks`
                        const text = `PUSH API Integration for Magicbricks -\n\n1. CET client or not : Non - CET\n\n2. CRM service provider name : Nobogent CRM\n\n3. Confirm Integration type : PUSH/POST\n\n4. Login Id of user's account : ${userEmail || 'infobluesquareinfra@gmail.com'}\n\n5. Working Endpoint : curl --location '${ep}' \\\n--form 'api_key="${magicbricksToken}"' \\\n--form 'name="Magic Bricks Test Lead"' \\\n--form 'mobile="9876543210"' \\\n--form 'isd="91"' \\\n--form 'email="lead@test.com"' \\\n--form 'project="The Builder"' \\\n--form 'msg="Test 2 BHK Need"'\n\n6. API Key : ${magicbricksToken}\n\n7. URL Parameters :\ncurl --location '${ep}' \\\n--form 'api_key="${magicbricksToken}"' \\\n--form 'name="Magic Bricks Test Lead"' \\\n--form 'mobile="9876543210"' \\\n--form 'isd="91"' \\\n--form 'email="lead@test.com"' \\\n--form 'project="The Builder"' \\\n--form 'msg="Test 2 BHK Need"'`
                        navigator.clipboard.writeText(text)
                        toast.success('Magicbricks Integration Template copied! Paste and send to your Magicbricks account rep.')
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                    >
                      <Copy size={13} /> Copy Details
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-600 font-medium mb-3">
                    Your Magicbricks representative sent an integration questionnaire. Click <strong>Copy Details</strong> above and paste it directly into your email or WhatsApp reply:
                  </p>
                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-2xl text-[11px] font-mono leading-relaxed overflow-x-auto select-all whitespace-pre-wrap border border-slate-800">
{`PUSH API Integration for Magicbricks -

1. CET client or not : Non - CET
2. CRM service provider name : Nobogent CRM
3. Confirm Integration type : PUSH/POST
4. Login Id of user's account : ${userEmail || 'infobluesquareinfra@gmail.com'}
5. Working Endpoint : ${magicbricksEndpoint || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/magicbricks`}
6. API Key : ${magicbricksToken}
7. URL Parameters :
curl --location '${magicbricksEndpoint || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/magicbricks`}' \\
--form 'api_key="${magicbricksToken}"' \\
--form 'name="Magic Bricks Test Lead"' \\
--form 'mobile="9876543210"' \\
--form 'isd="91"' \\
--form 'email="lead@test.com"' \\
--form 'project="The Builder"' \\
--form 'msg="Test 2 BHK Need"'`}
                  </pre>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => handleGenerateWebhook('magicbricks', true)}
                    disabled={isGeneratingMagicbricks}
                    className="text-xs text-slate-500 hover:text-red-600 font-bold py-2 flex items-center gap-1.5 transition-colors"
                  >
                    {isGeneratingMagicbricks ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Regenerate Key & URL
                  </button>
                  <a
                    href={magicbricksUrl || (magicbricksToken ? `/api/webhooks/magicbricks?api_key=${magicbricksToken}` : '#')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-red-600 hover:text-red-700 font-bold py-2 flex items-center gap-1.5 transition-colors"
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
                { name: 'Square Yards', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'SY' },
                { name: 'IndiaMART', color: 'bg-indigo-100 text-indigo-600 border-indigo-200', label: 'IM' },
                { name: 'JustDial', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'JD' },
                { name: 'Sulekha', color: 'bg-purple-100 text-purple-600 border-purple-200', label: 'SU' },
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
