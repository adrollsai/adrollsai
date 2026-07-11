'use client'

import { useState, useEffect } from 'react'
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
  ToggleRight
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

interface VoiceAgentSettingsProps {
  userId: string
  onBack: () => void
}

export default function VoiceAgentSettings({ userId, onBack }: VoiceAgentSettingsProps) {
  const supabase = createClient()
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
    voice_provider: 'gemini'
  })

  const [connected, setConnected] = useState(false)

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
        setSettings({
          elevenlabs_api_key: data.elevenlabs_api_key || '',
          elevenlabs_agent_id: data.elevenlabs_agent_id || '',
          voice_twilio_sid: data.voice_twilio_sid || '',
          voice_twilio_token: data.voice_twilio_token || '',
          voice_twilio_number: phoneNum,
          auto_call_new_leads: !!data.auto_call_new_leads,
          voice_provider: data.voice_provider || 'gemini'
        })
        setConnected(!!(data.voice_twilio_sid || phoneNum))
      }

      // 2. Fetch server SaaS status
      const res = await fetch('/api/voice/settings')
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
      const res = await fetch('/api/voice/provision', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success(`Calling number assigned successfully: ${data.phoneNumber}! 🎙️`)
        setSettings(prev => ({ ...prev, voice_twilio_number: data.phoneNumber }))
        setConnected(true)
      } else {
        toast.error(data.error || 'Failed to provision calling number.')
      }
    } catch (err: any) {
      toast.error(err.message || 'An error occurred.')
    } finally {
      setProvisioning(false)
    }
  }

  useEffect(() => {
    if (userId) fetchSettings()
  }, [userId])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updateData: any = {
        voice_twilio_number: settings.voice_twilio_number.trim() || null,
        auto_call_new_leads: settings.auto_call_new_leads,
        voice_provider: settings.voice_provider
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
                  <span className={`text-xs font-black flex items-center gap-1 ${connected ? 'text-indigo-600' : 'text-slate-400'}`}>
                    ● {connected ? 'Connected' : 'Offline'}
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

                    {settings.voice_twilio_number ? (
                      <div className="bg-white border border-slate-200/80 p-4.5 rounded-2xl flex items-center justify-between shadow-sm">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Outbound Caller ID</span>
                          <span className="text-sm font-bold text-slate-800 mt-1">{settings.voice_twilio_number}</span>
                        </div>
                        <span className="bg-emerald-50 text-emerald-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1">
                          ● Active
                        </span>
                      </div>
                    ) : (
                      <div className="bg-white border border-slate-200/80 p-6 rounded-2xl text-center space-y-4 shadow-sm">
                        <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                          You do not have an active outbound calling number assigned yet. Provision a virtual calling line instantly to get started.
                        </p>
                        <button
                          type="button"
                          onClick={handleProvisionNumber}
                          disabled={provisioning}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black px-6 py-3 rounded-full shadow-sm hover:shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto"
                        >
                          {provisioning ? (
                            <>
                              <Loader2 size={14} className="animate-spin text-white" /> Provisioning Line...
                            </>
                          ) : (
                            <>
                              <Sparkles size={14} /> Provision Virtual Outbound Number
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

              <button
                type="submit"
                disabled={saving}
                className="w-full py-3.5 bg-slate-950 hover:bg-slate-900 text-white rounded-full text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
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
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
