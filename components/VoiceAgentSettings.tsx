'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { 
  Phone, 
  Loader2, 
  HelpCircle, 
  ArrowLeft, 
  Save, 
  ShieldCheck, 
  Settings, 
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Play
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

interface VoiceAgentSettingsProps {
  userId: string
  onBack: () => void
}

export default function VoiceAgentSettings({ userId, onBack }: VoiceAgentSettingsProps) {
  const supabase = createClient()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saasMode, setSaasMode] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  
  const [settings, setSettings] = useState({
    elevenlabs_api_key: '',
    elevenlabs_agent_id: '',
    voice_twilio_sid: '',
    voice_twilio_token: '',
    voice_twilio_number: '',
    auto_call_new_leads: false,
    voice_provider: 'gemini',
    voice_name: 'Aoede'
  })

  const [connected, setConnected] = useState(false)
  const [sources, setSources] = useState<string[]>(['Facebook', 'Manual', 'CSV Import', '99acres'])
  const [pipelineStages, setPipelineStages] = useState<string[]>(['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified'])
  const [metaCampaigns, setMetaCampaigns] = useState<string[]>([])
  const [csvAudiences, setCsvAudiences] = useState<string[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'connection' | 'campaigns'>('connection')
  const [activeCallLead, setActiveCallLead] = useState<any>(null)
  const [allLeads, setAllLeads] = useState<any[]>([])

  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedMetaCampaigns, setSelectedMetaCampaigns] = useState<string[]>([])
  const [selectedCsvAudiences, setSelectedCsvAudiences] = useState<string[]>([])
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [targetAudienceType, setTargetAudienceType] = useState<'all' | 'custom'>('all')

  const [metaCampaignSearchQuery, setMetaCampaignSearchQuery] = useState('')
  const [csvAudienceSearchQuery, setCsvAudienceSearchQuery] = useState('')

  const [campaignForm, setCampaignForm] = useState({
    name: '',
    filterType: 'all', // 'all', 'source', 'stage'
    filterValue: '',
    facebookCampaign: '',
    customPrompt: '',
    voiceName: 'Aoede',
    greeting: ''
  })

  const fetchCampaignsAndFilters = async () => {
    if (!userId) return
    try {
      // 1. Fetch campaigns
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const campsRes = await fetch(`/api/voice/campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
      const campsData = await campsRes.json()
      if (campsData.success && campsData.campaigns) {
        setCampaigns(campsData.campaigns)
      }

      // 1.5 Fetch campaigns from Meta campaigns API
      let metaApiCampaignNames: string[] = []
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        const metaRes = await fetch(`/api/meta-ads/campaigns${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
        const metaData = await metaRes.json()
        if (metaData.campaigns) {
          metaApiCampaignNames = metaData.campaigns.map((c: any) => c.name).filter(Boolean)
        }
      } catch (err) {
        console.error("[META API CAMPAIGNS FETCH ERROR]", err)
      }

      // 2. Fetch unique sources, stages, Facebook campaigns, and CSV audiences from leads
      const { data: leads, error: leadsErr } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', userId)

      if (!leadsErr && leads) {
        setAllLeads(leads)
        // Collect unique sources and add defaults
        const uniqueSources = Array.from(new Set(leads.map(l => l.source).filter(Boolean))) as string[]
        const defaultSources = ['Facebook', 'Manual', 'CSV Import', '99acres']
        const allSources = Array.from(new Set([...defaultSources, ...uniqueSources]))

        // Collect unique stages and add defaults
        const uniqueStages = Array.from(new Set(leads.map(l => l.pipeline_stage).filter(Boolean))) as string[]
        const defaultStages = ['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified']
        const allStages = Array.from(new Set([...defaultStages, ...uniqueStages]))

        // Extract Facebook campaigns (campaign_name or ad_name) from leads
        const fbCampaignsFromLeads = Array.from(new Set(
          leads
            .filter(l => l.source?.toLowerCase() === 'facebook')
            .map(l => l.campaign_name || l.ad_name)
            .filter(Boolean)
        )) as string[]

        // Merge both API campaigns and dynamic lead campaigns
        const fbCampaigns = Array.from(new Set([...metaApiCampaignNames, ...fbCampaignsFromLeads]))

        // Extract CSV audiences
        const csvAuds = Array.from(new Set(leads.map(l => l.csv_audience).filter(Boolean))) as string[]

        setSources(allSources)
        setPipelineStages(allStages)
        setMetaCampaigns(fbCampaigns)
        setCsvAudiences(csvAuds)
      }

      // 3. Fetch active call in progress
      const { data: activeCallLeads } = await supabase
        .from('leads')
        .select('id, name, phone, voice_campaign_id')
        .eq('user_id', userId)
        .eq('voice_call_status', 'calling')
        .limit(1)

      if (activeCallLeads && activeCallLeads.length > 0) {
        setActiveCallLead(activeCallLeads[0])
      } else {
        setActiveCallLead(null)
      }
    } catch (err) {
      console.error('[CAMPAIGN DETAILS FETCH]', err)
    }
  }

  const playVoicePreview = (voiceName: string) => {
    if (typeof window === 'undefined') return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    const audioUrl = `/voices/${voiceName.toLowerCase()}.wav`;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.play().catch(err => {
      console.error('[PLAY PREVIEW ERROR]', err);
      toast.error(`Failed to play preview for ${voiceName}`);
    });
  };

  const [subscriptionStatus, setSubscriptionStatus] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [oldVoiceNumber, setOldVoiceNumber] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)

  const isSubscriptionActive = useMemo(() => {
    const status = subscriptionStatus.toLowerCase()
    const whitelistedEmails = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com']
    if (whitelistedEmails.includes(userEmail.toLowerCase())) {
      return true
    }
    return ['active', 'trialing', 'pro', 'growth'].includes(status)
  }, [subscriptionStatus, userEmail])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      // 1. Fetch DB settings
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error

      let phoneNum = ''
      if (data) {
        phoneNum = data.voice_twilio_number || ''
        setUserEmail(data.email || '')
        setSubscriptionStatus(data.subscription_status || '')
        setOldVoiceNumber(data.old_voice_twilio_number || '')
        setSettings({
          elevenlabs_api_key: data.elevenlabs_api_key || '',
          elevenlabs_agent_id: data.elevenlabs_agent_id || '',
          voice_twilio_sid: data.voice_twilio_sid || '',
          voice_twilio_token: data.voice_twilio_token || '',
          voice_twilio_number: phoneNum,
          auto_call_new_leads: !!data.auto_call_new_leads,
          voice_provider: data.voice_provider || 'gemini',
          voice_name: data.voice_name || 'Aoede'
        })
        setConnected(!!(data.voice_twilio_sid || phoneNum))
      }

      // 2. Fetch server SaaS status
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const res = await fetch(`/api/voice/settings${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
      const resData = await res.json()
      if (resData.success) {
        setSaasMode(resData.saasMode)
        if (resData.saasMode && resData.voiceNumber) {
          setSettings(prev => ({ ...prev, voice_twilio_number: resData.voiceNumber }))
          setConnected(true)
        }
      }
    } catch (err: any) {
      console.error('[VOICE SETTINGS] Fetch Error:', err)
      toast.error('Failed to load voice agent settings.')
    } finally {
      setLoading(false)
    }
  }

  const handleProvisionNumber = async () => {
    setProvisioning(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      const res = await fetch(`/api/voice/provision${impersonateId ? `?impersonate=${impersonateId}` : ''}`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`Calling number assigned successfully: ${data.phoneNumber}! 🎙️`)
        setSettings(prev => ({ ...prev, voice_twilio_number: data.phoneNumber }))
        setConnected(true)
        setOldVoiceNumber('')
      } else {
        toast.error(data.error || 'Failed to provision calling number.')
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred.')
    } finally {
      setProvisioning(false)
    }
  }

  const handleDisconnectNumber = async () => {
    if (!confirm("Are you sure you want to disconnect your voice calling line? This will release the phone number.")) return
    setDisconnecting(true)
    try {
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      
      const res = await fetch(`/api/voice/provision${impersonateId ? `?impersonate=${impersonateId}` : ''}`, { 
        method: 'DELETE'
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Voice line disconnected successfully! 🎙️')
        setSettings(prev => ({ 
          ...prev, 
          voice_twilio_number: '',
          voice_twilio_sid: '',
          voice_twilio_token: ''
        }))
        setConnected(false)
        setOldVoiceNumber('')
      } else {
        toast.error(data.error || 'Failed to disconnect voice line.')
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred while disconnecting.')
    } finally {
      setDisconnecting(false)
    }
  }

  useEffect(() => {
    if (userId) {
      fetchSettings()
    }
  }, [userId])

  useEffect(() => {
    let interval: any = null
    if (userId && activeTab === 'campaigns') {
      fetchCampaignsAndFilters()
      interval = setInterval(() => {
        fetchCampaignsAndFilters()
      }, 4000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [userId, activeTab])

  const filteredMetaCampaigns = useMemo(() => {
    if (!metaCampaignSearchQuery.trim()) return metaCampaigns;
    return metaCampaigns.filter(c => c.toLowerCase().includes(metaCampaignSearchQuery.toLowerCase()));
  }, [metaCampaigns, metaCampaignSearchQuery]);

  const filteredCsvAudiences = useMemo(() => {
    if (!csvAudienceSearchQuery.trim()) return csvAudiences;
    return csvAudiences.filter(a => a.toLowerCase().includes(csvAudienceSearchQuery.toLowerCase()));
  }, [csvAudiences, csvAudienceSearchQuery]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updateData: any = {
        voice_twilio_number: settings.voice_twilio_number.trim() || null,
        auto_call_new_leads: settings.auto_call_new_leads,
        voice_provider: settings.voice_provider,
        voice_name: settings.voice_name
      }

      if (!saasMode) {
        updateData.voice_twilio_sid = settings.voice_twilio_sid.trim() || null
        updateData.voice_twilio_token = settings.voice_twilio_token.trim() || null
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId)

      if (error) throw error

      toast.success('Voice agent settings saved successfully! 🎙️')
      const isCustomConnected = !!(settings.voice_twilio_sid || settings.voice_twilio_number);
      setConnected(isCustomConnected)
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-slate-300" size={32} />
        <p className="text-sm font-medium animate-pulse">Syncing Voice Agent settings...</p>
      </div>
    )
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 mb-6 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors uppercase tracking-wider bg-white px-4 py-2.5 rounded-full shadow-sm border border-slate-200"
      >
        <ArrowLeft size={14} /> Back to Settings
      </button>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 bg-slate-100 p-1 rounded-full max-w-md border border-slate-200/50">
        <button
          onClick={() => setActiveTab('connection')}
          className={`flex-1 py-2.5 px-4 rounded-full text-xs font-black transition-all cursor-pointer ${activeTab === 'connection' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Connection Settings
        </button>
        <button
          onClick={() => {
            setActiveTab('campaigns');
            fetchCampaignsAndFilters();
          }}
          className={`flex-1 py-2.5 px-4 rounded-full text-xs font-black transition-all cursor-pointer ${activeTab === 'campaigns' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Voice Call Campaigns
        </button>
      </div>

      {activeTab === 'connection' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          
          {/* Left Column: Status and Info */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-center gap-4 mb-6">
                <div className={`p-3.5 rounded-2xl flex items-center justify-center shadow-sm ${connected ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                  <Phone size={24} />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-950">Voice Calling</h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-medium leading-normal">
                    Connect Twilio to automate voice qualification
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-indigo-50/40 border border-indigo-100 rounded-3xl p-4 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-indigo-100/50">
                    <span className="text-[10px] text-indigo-800 font-bold uppercase tracking-wider">Status</span>
                    <span className={`text-xs font-black flex items-center gap-1 ${connected && isSubscriptionActive ? 'text-indigo-600' : !isSubscriptionActive ? 'text-amber-600' : 'text-slate-400'}`}>
                      ● {connected && isSubscriptionActive ? 'Connected' : !isSubscriptionActive ? 'Subscription Inactive' : 'Offline'}
                    </span>
                  </div>
                  {settings.voice_twilio_number && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Caller ID</span>
                      <span className="font-bold text-slate-700">{settings.voice_twilio_number}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* India Regulatory Guide Banner */}
            <div className="bg-amber-50/75 border border-amber-200 rounded-[2rem] p-6 shadow-sm">
              <h4 className="font-extrabold text-sm text-amber-900 flex items-center gap-2 mb-2">
                <HelpCircle size={16} className="text-amber-700" /> Calling in India Guide
              </h4>
              <p className="text-[11px] text-amber-950 leading-relaxed font-semibold opacity-90">
                TRAI strictly regulates automated/outbound local calls. Avoid account blocking by doing the following:
              </p>
              <ul className="space-y-2 mt-2 text-[10px] text-amber-900 font-bold list-decimal pl-4">
                <li>Do not use ordinary 10-digit numbers for cold promo calls.</li>
                <li>Verify your existing mobile/landline number via <strong>Twilio Console &gt; Verified Caller IDs</strong>.</li>
                <li>Or map an Indian SIP Trunking provider (Tata, Airtel, Jio) to Twilio to place calls from your local business DID.</li>
              </ul>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm">
              <h3 className="font-extrabold text-base text-slate-900 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
                <Settings size={18} className="text-slate-500" /> Voice Agent Connection Settings
              </h3>

              <form onSubmit={handleSave} className="space-y-5">

                {saasMode ? (
                  /* SaaS Platform Managed Mode UI */
                  <div className="space-y-5">
                    <div className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-5 sm:p-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-indigo-100 text-indigo-700 p-2.5 rounded-2xl">
                          <Phone size={20} />
                        </div>
                        <div>
                          <h4 className="text-sm font-extrabold text-slate-900">Virtual calling Line</h4>
                          <p className="text-[10px] text-slate-500 font-medium mt-0.5">Assigned platform-wide virtual outbound number to place calls to your leads</p>
                        </div>
                      </div>

                      {settings.voice_twilio_number && isSubscriptionActive ? (
                        <div className="bg-white border border-slate-200/80 p-4.5 rounded-2xl flex items-center justify-between shadow-sm">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Outbound Caller ID</span>
                            <span className="text-sm font-bold text-slate-800 mt-1">{settings.voice_twilio_number}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="bg-emerald-50 text-emerald-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                              ● Active
                            </span>
                            <button
                              type="button"
                              onClick={handleDisconnectNumber}
                              disabled={disconnecting}
                              className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider transition-all active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer"
                              title="Disconnect voice line and release number"
                            >
                              {disconnecting ? <Loader2 size={12} className="animate-spin" /> : 'Disconnect'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border border-slate-200/80 p-6 rounded-2xl text-center space-y-4 shadow-sm">
                          <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                            {!isSubscriptionActive 
                              ? `Your subscription is inactive. Please ensure you have an active subscription and reconnect your voice line to automate outbound calling.`
                              : oldVoiceNumber 
                                ? `Your previous voice line (${oldVoiceNumber}) was disconnected. Reconnect now to reclaim it or provision a new number.`
                                : `You do not have an active outbound calling number assigned yet. Provision a virtual calling line instantly to get started.`
                            }
                          </p>
                          <button
                            type="button"
                            onClick={handleProvisionNumber}
                            disabled={provisioning}
                            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black px-6 py-3 rounded-full shadow-sm hover:shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto"
                          >
                            {provisioning ? (
                              <>
                                <Loader2 size={14} className="animate-spin text-white" /> Connecting Line...
                              </>
                            ) : (
                              <>
                                <Sparkles size={14} /> 
                                {!isSubscriptionActive || oldVoiceNumber ? 'Reconnect Voice Line' : 'Provision Virtual Outbound Number'}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Provider Config Details */}
                    <div className="bg-emerald-50/40 border border-emerald-100/50 rounded-2xl p-4 space-y-2 animate-in fade-in duration-200">
                      <h4 className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                        <Sparkles size={14} className="text-emerald-600" /> Voice Agent Config
                      </h4>
                      <p className="text-[11px] text-emerald-800 leading-relaxed font-medium">
                        Using our low-latency multimodal voice stream for natural bidirectional voice conversations. 
                        No additional configuration is required here. The voice agent will run using your master Generative AI credentials on the WebSocket bridge.
                      </p>
                    </div>

                    <hr className="border-slate-100 my-2" />

                    {/* Twilio Settings */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                        <ShieldCheck size={14} className="text-emerald-500" /> Twilio Phone settings
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Account SID</label>
                          <input 
                            type="text" 
                            value={settings.voice_twilio_sid}
                            onChange={(e) => setSettings({ ...settings, voice_twilio_sid: e.target.value })}
                            placeholder="AC..."
                            className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-mono outline-none focus:border-blue-400 transition-all"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Auth Token</label>
                          <input 
                            type="password" 
                            value={settings.voice_twilio_token}
                            onChange={(e) => setSettings({ ...settings, voice_twilio_token: e.target.value })}
                            placeholder="token..."
                            className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-mono outline-none focus:border-blue-400 transition-all"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Outbound Caller Number (Twilio / Verified Caller ID)</label>
                        <input 
                          type="text" 
                          value={settings.voice_twilio_number}
                          onChange={(e) => setSettings({ ...settings, voice_twilio_number: e.target.value })}
                          placeholder="e.g. +91XXXXXXXXXX"
                          className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition-all"
                        />
                        <span className="text-[9px] text-slate-400 block ml-1 font-semibold leading-normal">Must include international prefix (e.g. +91 for India).</span>
                      </div>
                    </div>
                  </>
                )}

                <hr className="border-slate-100 my-2" />

                {/* Automation Toggle */}
                <div className="flex justify-between items-center bg-indigo-50/30 border border-indigo-100/50 rounded-2xl p-4">
                  <div>
                    <h4 className="text-xs font-extrabold text-slate-900">Auto Call New Leads</h4>
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5">Triggers outbound agent dialer immediately when a new lead lands in CRM</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, auto_call_new_leads: !settings.auto_call_new_leads })}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {settings.auto_call_new_leads ? (
                      <ToggleRight className="w-10 h-10 text-indigo-600 cursor-pointer" />
                    ) : (
                      <ToggleLeft className="w-10 h-10 text-slate-300 cursor-pointer" />
                    )}
                  </button>
                </div>

                {/* Default Voice Selection and Previews */}
                <div className="space-y-4 border border-slate-100 bg-slate-50/30 p-4 rounded-2xl">
                  <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-indigo-600" /> Default Voice Agent Tone
                  </h4>
                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                    Choose the voice tone used universally for triggered calls (when new leads land in CRM, when dismissing flagged questions, or when manually dialing).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Select Voice</label>
                      <select 
                        value={settings.voice_name}
                        onChange={(e) => setSettings({ ...settings, voice_name: e.target.value })}
                        className="w-full bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all cursor-pointer shadow-xs"
                      >
                        <option value="Aoede">Aoede (Warm Female)</option>
                        <option value="Kore">Kore (Young Female)</option>
                        <option value="Charon">Charon (Warm Male)</option>
                        <option value="Fenrir">Fenrir (Deep Male)</option>
                        <option value="Puck">Puck (Energetic Male)</option>
                      </select>
                    </div>
                    <div className="flex flex-col justify-end space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Voice Preview</label>
                      <button
                        type="button"
                        onClick={() => playVoicePreview(settings.voice_name)}
                        className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xs cursor-pointer"
                      >
                        <Play size={12} fill="currentColor" /> Play Voice Sample
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-3.5 bg-slate-950 hover:bg-slate-900 text-white rounded-full text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-white" /> Saving Settings...
                      </>
                    ) : (
                      <>
                        <Save size={14} /> Save Configuration
                      </>
                    )}
                  </button>
                  {connected && !saasMode && (
                    <button
                      type="button"
                      onClick={handleDisconnectNumber}
                      disabled={disconnecting}
                      className="py-3.5 px-6 border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 rounded-full text-xs font-black shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                      {disconnecting ? <Loader2 size={14} className="animate-spin" /> : 'Disconnect'}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Create Campaign Form */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <h3 className="font-extrabold text-base text-slate-900 mb-4 pb-3 border-b border-slate-100 flex items-center gap-2">
              <Sparkles size={18} className="text-indigo-500" /> New Calling Campaign
            </h3>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!campaignForm.name.trim()) return toast.error("Please enter a campaign name");
              
              setSaving(true);
              try {
                // Create campaign via backend API to bypass RLS impersonation restrictions
                const urlParams = new URLSearchParams(window.location.search);
                const impersonateId = urlParams.get('impersonate');
                const res = await fetch(`/api/voice/campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: campaignForm.name,
                    audience_filter: {
                      sources: targetAudienceType === 'all' ? [] : selectedSources,
                      meta_campaigns: targetAudienceType === 'all' ? [] : selectedMetaCampaigns,
                      csv_audiences: targetAudienceType === 'all' ? [] : selectedCsvAudiences,
                      pipeline_stages: targetAudienceType === 'all' ? [] : selectedStages,
                      voice_name: campaignForm.voiceName,
                      greeting: campaignForm.greeting.trim() || null
                    },
                    custom_prompt: campaignForm.customPrompt
                  })
                });
                const resData = await res.json();

                if (!resData.success) throw new Error(resData.error || "Failed to create campaign");

                toast.success("Campaign created as draft!");
                setCampaignForm({ name: '', filterType: 'all', filterValue: '', facebookCampaign: '', customPrompt: '', voiceName: 'Aoede', greeting: '' });
                setSelectedSources([]);
                setSelectedMetaCampaigns([]);
                setSelectedCsvAudiences([]);
                setSelectedStages([]);
                setTargetAudienceType('all');
                fetchCampaignsAndFilters();
              } catch (err: any) {
                toast.error("Failed to create campaign: " + err.message);
              } finally {
                setSaving(false);
              }
            }} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Campaign Name</label>
                <input 
                  type="text" 
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  placeholder="e.g. July Follow-up Pitch"
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Target Audience Type</label>
                <select 
                  value={targetAudienceType}
                  onChange={(e) => setTargetAudienceType(e.target.value as 'all' | 'custom')}
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all cursor-pointer"
                >
                  <option value="all">All Contacts / Leads (No Filters)</option>
                  <option value="custom">Custom Multi-Filter Audience</option>
                </select>
              </div>

              {targetAudienceType === 'custom' && (
                <div className="space-y-4 border border-slate-100 bg-slate-50/50 p-4 rounded-2xl animate-in fade-in duration-200">
                  <span className="block text-[10px] font-black text-slate-400 uppercase border-b border-slate-100 pb-1.5">Configure Target Filters</span>
                  
                  {/* Lead Sources Checkboxes */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase block ml-1">1. Lead Sources</label>
                    <div className="grid grid-cols-2 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                      {sources.map(src => {
                        const isChecked = selectedSources.includes(src);
                        return (
                          <label key={src} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedSources(selectedSources.filter(s => s !== src));
                                } else {
                                  setSelectedSources([...selectedSources, src]);
                                }
                              }}
                              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                            />
                            {src}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Meta Campaigns Checkboxes (if any exist) */}
                  {metaCampaigns.length > 0 && (
                    <div className="space-y-1.5 animate-in fade-in duration-200">
                      <label className="text-[10px] font-black text-slate-500 uppercase block ml-1 flex items-center justify-between">
                        <span>2. Meta Ads Campaigns</span>
                        <span className="text-[8px] text-slate-400 font-bold lowercase">Found: {filteredMetaCampaigns.length} / {metaCampaigns.length}</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="Search Meta Campaigns..." 
                        value={metaCampaignSearchQuery} 
                        onChange={(e) => setMetaCampaignSearchQuery(e.target.value)} 
                        className="w-full bg-white border border-slate-200/80 py-1.5 px-3 rounded-xl text-[11px] font-semibold outline-none focus:border-indigo-400 transition-all shadow-xs"
                      />
                      <div className="grid grid-cols-1 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                        {filteredMetaCampaigns.map(camp => {
                          const isChecked = selectedMetaCampaigns.includes(camp);
                          return (
                            <label key={camp} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans truncate" title={camp}>
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedMetaCampaigns(selectedMetaCampaigns.filter(c => c !== camp));
                                  } else {
                                    setSelectedMetaCampaigns([...selectedMetaCampaigns, camp]);
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                              />
                              <span className="truncate">{camp}</span>
                            </label>
                          )
                        })}
                        {filteredMetaCampaigns.length === 0 && (
                          <div className="text-[10px] text-slate-400 font-semibold italic text-center py-2">No campaigns found</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* CSV Audiences Checkboxes (if any exist) */}
                  {csvAudiences.length > 0 && (
                    <div className="space-y-1.5 animate-in fade-in duration-200">
                      <label className="text-[10px] font-black text-slate-500 uppercase block ml-1 flex items-center justify-between">
                        <span>3. CSV Uploaded Audiences</span>
                        <span className="text-[8px] text-slate-400 font-bold lowercase">Found: {filteredCsvAudiences.length} / {csvAudiences.length}</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="Search CSV Audiences..." 
                        value={csvAudienceSearchQuery} 
                        onChange={(e) => setCsvAudienceSearchQuery(e.target.value)} 
                        className="w-full bg-white border border-slate-200/80 py-1.5 px-3 rounded-xl text-[11px] font-semibold outline-none focus:border-indigo-400 transition-all shadow-xs"
                      />
                      <div className="grid grid-cols-1 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                        {filteredCsvAudiences.map(aud => {
                          const isChecked = selectedCsvAudiences.includes(aud);
                          return (
                            <label key={aud} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans truncate" title={aud}>
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedCsvAudiences(selectedCsvAudiences.filter(a => a !== aud));
                                  } else {
                                    setSelectedCsvAudiences([...selectedCsvAudiences, aud]);
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                              />
                              <span className="truncate">{aud}</span>
                            </label>
                          )
                        })}
                        {filteredCsvAudiences.length === 0 && (
                          <div className="text-[10px] text-slate-400 font-semibold italic text-center py-2">No audiences found</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pipeline Stages Checkboxes */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase block ml-1">4. Pipeline Stages</label>
                    <div className="grid grid-cols-2 gap-2 bg-white p-3 rounded-xl border border-slate-200/60 max-h-28 overflow-y-auto">
                      {pipelineStages.map(stg => {
                        const isChecked = selectedStages.includes(stg);
                        return (
                          <label key={stg} className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none font-sans">
                            <input 
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedStages(selectedStages.filter(s => s !== stg));
                                } else {
                                  setSelectedStages([...selectedStages, stg]);
                                }
                              }}
                              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                            />
                            {stg}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase block ml-1 flex items-center justify-between">
                    <span>Voice Agent Tone</span>
                    <button
                      type="button"
                      onClick={() => playVoicePreview(campaignForm.voiceName)}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer active:scale-95 transition-all"
                    >
                      <Play size={10} fill="currentColor" /> Play Sample
                    </button>
                  </label>
                  <select 
                    value={campaignForm.voiceName}
                    onChange={(e) => setCampaignForm({ ...campaignForm, voiceName: e.target.value })}
                    className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all cursor-pointer"
                  >
                    <option value="Aoede">Aoede (Warm Female)</option>
                    <option value="Kore">Kore (Young Female)</option>
                    <option value="Charon">Charon (Warm Male)</option>
                    <option value="Fenrir">Fenrir (Deep Male)</option>
                    <option value="Puck">Puck (Energetic Male)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase block ml-1 flex items-center justify-between">
                    <span>Welcome Greeting</span>
                    <span className="text-[8px] text-slate-400 font-bold lowercase">Use {`{name}`} for lead</span>
                  </label>
                  <input 
                    type="text"
                    value={campaignForm.greeting}
                    onChange={(e) => setCampaignForm({ ...campaignForm, greeting: e.target.value })}
                    placeholder="e.g. Hi {name} ji, kaise ho aap?"
                    className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-bold outline-none focus:border-indigo-400 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase block ml-1 flex items-center justify-between">
                  <span>Custom Conversation Context & Pitch</span>
                  <span className="text-[8px] text-indigo-500 font-bold lowercase">Overrides Default Business Name & Info</span>
                </label>
                <textarea 
                  value={campaignForm.customPrompt}
                  onChange={(e) => setCampaignForm({ ...campaignForm, customPrompt: e.target.value })}
                  placeholder="e.g. You are an agent selling apartments. Do NOT mention any company name. Greet friendly in Hinglish. Try to schedule a walkthrough visit."
                  rows={4}
                  className="w-full bg-slate-50 focus:bg-white border border-slate-200 py-2.5 px-4 rounded-xl text-xs font-medium outline-none focus:border-indigo-400 transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-xs font-black shadow-sm transition-all cursor-pointer"
              >
                Create Campaign Draft
              </button>
            </form>
          </div>

          {/* Past Campaigns */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <h3 className="font-extrabold text-base text-slate-900 mb-4 pb-3 border-b border-slate-100 flex items-center gap-2">
              <Phone size={18} className="text-indigo-500" /> Active & Past Campaigns
            </h3>

            {campaigns.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-xs font-semibold">
                No campaigns created yet. Build a draft above to get started.
              </div>
            ) : (
              <div className="space-y-3.5 max-h-[500px] overflow-y-auto pr-1">
                {campaigns.map((c) => {
                  const filter = c.audience_filter || {};
                  const getAudienceLabel = () => {
                    const parts: string[] = []
                    if (!filter.sources && !filter.pipeline_stages && !filter.meta_campaigns && !filter.csv_audiences) {
                      return 'All Leads'
                    }
                    if (filter.sources && filter.sources.length > 0) parts.push(`Sources: ${filter.sources.join(', ')}`)
                    if (filter.meta_campaigns && filter.meta_campaigns.length > 0) parts.push(`Campaigns: ${filter.meta_campaigns.join(', ')}`)
                    if (filter.csv_audiences && filter.csv_audiences.length > 0) parts.push(`CSV: ${filter.csv_audiences.join(', ')}`)
                    if (filter.pipeline_stages && filter.pipeline_stages.length > 0) parts.push(`Stages: ${filter.pipeline_stages.join(', ')}`)
                    return parts.length > 0 ? parts.join(' | ') : 'All Leads'
                  }

                  const campaignLeads = allLeads.filter(l => l.voice_campaign_id === c.id)
                  const totalLeads = c.stats ? c.stats.total : campaignLeads.length
                  const completedLeads = c.stats ? c.stats.spoke : campaignLeads.filter(l => l.voice_call_status === 'completed').length
                  const failedLeads = c.stats ? c.stats.unreachable : campaignLeads.filter(l => ['failed', 'failed_max_retries'].includes(l.voice_call_status)).length
                  const callingLeads = c.stats ? c.stats.dialing : campaignLeads.filter(l => l.voice_call_status === 'calling').length
                  const pendingLeads = c.stats ? c.stats.queue : totalLeads - (completedLeads + failedLeads + callingLeads)
                  const progressPercent = totalLeads > 0 ? Math.round(((completedLeads + failedLeads) / totalLeads) * 100) : 0

                  return (
                    <div key={c.id} className="p-4 bg-slate-50 border border-slate-150 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-sans">
                      <div className="w-full sm:max-w-md lg:max-w-lg">
                        <h4 className="text-sm font-extrabold text-slate-800">{c.name}</h4>
                        <div className="flex flex-wrap gap-2 mt-1.5 text-[9px] font-bold">
                          <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded uppercase max-w-xs truncate inline-block" title={getAudienceLabel()}>
                            Audience: {getAudienceLabel()}
                          </span>
                          <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded uppercase">
                            🎙️ Voice: {filter.voice_name || 'Aoede'}
                          </span>
                          {filter.greeting && (
                            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded uppercase truncate max-w-xs" title={filter.greeting}>
                              💬 Greeting: "{filter.greeting}"
                            </span>
                          )}
                          <span className="text-slate-400 px-1 py-0.5">
                            Created: {new Date(c.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {c.custom_prompt && (
                          <div className="mt-2 bg-white/50 p-2 rounded-lg border border-slate-200/50 text-[10px] text-slate-500 italic max-w-md line-clamp-2">
                            "{c.custom_prompt}"
                          </div>
                        )}

                        {/* Progress and Statistics Dashboard */}
                        {totalLeads > 0 && (
                          <div className="mt-3.5 space-y-2 border-t border-slate-100 pt-3">
                            {/* Progress bar */}
                            <div className="space-y-1">
                              <div className="flex justify-between items-center text-[10px] font-extrabold text-slate-500">
                                <span>PROGRESS: {progressPercent}%</span>
                                <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[8px]">{completedLeads + failedLeads} / {totalLeads} CALLED</span>
                              </div>
                              <div className="w-full bg-slate-200/80 h-2 rounded-full overflow-hidden shadow-inner">
                                <div 
                                  className="bg-indigo-600 h-full rounded-full transition-all duration-700 ease-out-back" 
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                            </div>

                            {/* Outcome tags */}
                            <div className="flex flex-wrap gap-1.5 text-[9px] font-extrabold">
                              <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-100/80 flex items-center gap-1">
                                ✅ Spoke: {completedLeads}
                              </span>
                              <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md border border-rose-100/80 flex items-center gap-1">
                                ❌ Unreachable: {failedLeads}
                              </span>
                              {callingLeads > 0 && (
                                <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md border border-indigo-150 animate-pulse flex items-center gap-1">
                                  📞 Dialing: {callingLeads}
                                </span>
                              )}
                              {pendingLeads > 0 && (
                                <span className="bg-slate-150/40 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200/40 flex items-center gap-1">
                                  ⏳ Queue: {pendingLeads}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {c.status === 'running' && activeCallLead && activeCallLead.voice_campaign_id === c.id ? (
                          <div className="mt-2.5 bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex items-center justify-between animate-pulse max-w-md shadow-xs">
                            <span className="text-[10px] text-amber-800 font-bold flex items-center gap-1.5">
                              📞 Call in progress with <span className="underline">{activeCallLead.name}</span>
                            </span>
                            <span className="bg-amber-100 text-amber-700 text-[8px] font-black uppercase px-1.5 py-0.5 rounded">Dialing</span>
                          </div>
                        ) : c.status === 'running' && (
                          <div className="mt-2.5 bg-slate-100/40 border border-slate-200/20 rounded-xl p-2 text-[9px] text-slate-500 font-semibold italic max-w-md">
                            Preparing next sequential call...
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${
                          c.status === 'running' 
                            ? 'bg-amber-50 text-amber-600 border-amber-200' 
                            : c.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {c.status}
                        </span>

                        {c.status === 'draft' && (
                          <button
                            onClick={async () => {
                              const proceed = confirm(`Launch campaign "${c.name}"? This will place phone calls to all matching leads in the database.`);
                              if (!proceed) return;
                              
                              try {
                                toast.loading(`Starting campaign "${c.name}"...`);
                                const urlParams = new URLSearchParams(window.location.search)
                                const impersonateId = urlParams.get('impersonate')
                                const res = await fetch(`/api/voice/campaign/start${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ campaignId: c.id })
                                });
                                const resData = await res.json();
                                toast.dismiss();
                                
                                if (resData.success) {
                                  toast.success(`Campaign launched! Initiated calls to ${resData.totalLeads} leads. 🎙️`);
                                  fetchCampaignsAndFilters();
                                } else {
                                  toast.error(resData.error || "Failed to start campaign");
                                }
                              } catch (err: any) {
                                toast.dismiss();
                                toast.error("Error starting campaign: " + err.message);
                              }
                            }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black px-3.5 py-1.5 rounded-full shadow-xs active:scale-95 transition-all cursor-pointer"
                          >
                            Launch Call
                          </button>
                        )}

                        {c.status === 'running' && (
                          <button
                            onClick={async () => {
                              const proceed = confirm(`Pause campaign "${c.name}"? No further sequential calls will be placed.`);
                              if (!proceed) return;

                              try {
                                toast.loading(`Pausing campaign "${c.name}"...`);
                                const urlParams = new URLSearchParams(window.location.search)
                                const impersonateId = urlParams.get('impersonate')
                                const res = await fetch(`/api/voice/campaign${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ campaignId: c.id, status: 'paused' })
                                });
                                const resData = await res.json();
                                toast.dismiss();

                                if (resData.success) {
                                  toast.success(`Campaign paused!`);
                                  fetchCampaignsAndFilters();
                                } else {
                                  toast.error(resData.error || "Failed to pause campaign");
                                }
                              } catch (err: any) {
                                toast.dismiss();
                                toast.error("Error pausing campaign: " + err.message);
                              }
                            }}
                            className="bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black px-3.5 py-1.5 rounded-full shadow-xs active:scale-95 transition-all cursor-pointer"
                          >
                            Pause Call
                          </button>
                        )}

                        {c.status === 'paused' && (
                          <button
                            onClick={async () => {
                              const proceed = confirm(`Resume campaign "${c.name}"?`);
                              if (!proceed) return;

                              try {
                                toast.loading(`Resuming campaign "${c.name}"...`);
                                const urlParams = new URLSearchParams(window.location.search)
                                const impersonateId = urlParams.get('impersonate')
                                const res = await fetch(`/api/voice/campaign/start${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ campaignId: c.id })
                                });
                                const resData = await res.json();
                                toast.dismiss();

                                if (resData.success) {
                                  toast.success(`Campaign resumed!`);
                                  fetchCampaignsAndFilters();
                                } else {
                                  toast.error(resData.error || "Failed to resume campaign");
                                }
                              } catch (err: any) {
                                toast.dismiss();
                                toast.error("Error resuming campaign: " + err.message);
                              }
                            }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black px-3.5 py-1.5 rounded-full shadow-xs active:scale-95 transition-all cursor-pointer"
                          >
                            Resume Call
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
