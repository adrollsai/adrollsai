'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  PhoneCall,
  Phone,
  Mic,
  Sparkles,
  Building2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User,
  Volume2,
  Play,
  Square,
  RefreshCw,
  Radio,
  Zap,
  Waves,
  BrainCircuit,
  AudioLines,
  Languages,
  ArrowRight,
  Clock,
  Gauge,
  ShieldCheck,
  Wand2,
  TrendingUp,
  MessageSquare,
  CircleDot,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import {
  SUPPORTED_LANGUAGES,
  VOICE_DESIGN_PRESETS,
  TTS_FLASH_MODELS,
  DEFAULT_TTS_FLASH_VOICE_ID,
  DEFAULT_VOICE_DESIGN_DESCRIPTION,
  buildGreetingPreview,
  SCRIPT_STAGES,
  LATENCY_BUDGET,
} from '@/utils/tts-flash-config'

const STATUS_META: Record<string, { label: string; tone: string; dot: string }> = {
  idle: { label: 'Ready', tone: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  calling: { label: 'Dialing', tone: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  in_progress: { label: 'Live on call', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  completed: { label: 'Call complete', tone: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  failed: { label: 'Call failed', tone: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  no_answer: { label: 'No answer', tone: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  queued: { label: 'Queued', tone: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
}

export default function GeminiTtsFlashDemoPage() {
  const supabase = createClient()

  // auth
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')

  // form
  const [prospectName, setProspectName] = useState('Rahul Sharma')
  const [prospectPhone, setProspectPhone] = useState('')
  const [companyName, setCompanyName] = useState('Nobogent Realty')
  const [agentName, setAgentName] = useState('Aanya')
  const [gender, setGender] = useState<'female' | 'male'>('female')
  const [language, setLanguage] = useState('hinglish')
  const [reason, setReason] = useState('3 BHK in Mohali')
  const [instruction, setInstruction] = useState('')
  const [voiceId, setVoiceId] = useState(DEFAULT_TTS_FLASH_VOICE_ID)

  // voice design
  const [designOpen, setDesignOpen] = useState(false)
  const [designDescription, setDesignDescription] = useState(DEFAULT_VOICE_DESIGN_DESCRIPTION)
  const [designName, setDesignName] = useState('Nobo Real Estate Advisor')
  const [designing, setDesigning] = useState(false)
  const [designedVoices, setDesignedVoices] = useState<any[]>([])

  // audition
  const [auditioning, setAuditioning] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // call
  const [placing, setPlacing] = useState(false)
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [callInfo, setCallInfo] = useState<any>(null)
  const [status, setStatus] = useState<any>(null)
  const [bridgeHealth, setBridgeHealth] = useState<any>(null)
  const [recentCalls, setRecentCalls] = useState<any[]>([])
  const [dialLine, setDialLine] = useState<any>(null)
  const pollRef = useRef<any>(null)

  const greeting = buildGreetingPreview({
    name: prospectName.trim() || 'ji',
    company: companyName.trim() || 'Nobogent Realty',
    agent: agentName.trim() || 'Aanya',
    interest: reason.trim() || 'the property you enquired about',
    language,
    gender,
  })

  // ---------- auth + initial loads ----------
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setIsAdmin(false); return }
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, email, business_name')
          .eq('id', user.id)
          .single()
        const ok = profile?.role === 'super_admin' || profile?.email === 'rchopra489@gmail.com'
        setIsAdmin(ok)
        setAdminEmail(profile?.email || user.email || '')
        if (ok) {
          if (profile?.business_name) setCompanyName(profile.business_name)
          loadRecent()
          loadHealth()
          loadVoices()
          loadDialLine()
        }
      } catch (e) {
        setIsAdmin(false)
      } finally {
        setCheckingAuth(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadHealth = async () => {
    try {
      const res = await fetch('/api/voice/tts-flash/status?health=1')
      const json = await res.json()
      setBridgeHealth(json.bridgeHealth || null)
    } catch { setBridgeHealth({ ok: false, error: 'unreachable' }) }
  }

  const loadVoices = async () => {
    try {
      const res = await fetch('/api/voice/tts-flash/voice')
      const json = await res.json()
      if (json.success) setDesignedVoices(json.voices || [])
    } catch { /* ignore */ }
  }

  const loadDialLine = async () => {
    try {
      const res = await fetch('/api/voice/tts-flash/call')
      const json = await res.json()
      setDialLine(json)
    } catch { setDialLine({ ok: false, error: 'unreachable' }) }
  }

  const loadRecent = async () => {
    try {
      const res = await fetch('/api/voice/tts-flash/status')
      const json = await res.json()
      if (json.success) setRecentCalls(json.recentCalls || [])
    } catch { /* ignore */ }
  }

  // ---------- polling ----------
  const pollOnce = useCallback(async (leadId: string) => {
    try {
      const res = await fetch(`/api/voice/tts-flash/status?leadId=${leadId}`)
      const json = await res.json()
      if (json.success) {
        setStatus(json)
        if (['completed', 'failed', 'no_answer'].includes(json.lead?.voice_call_status)) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          loadRecent()
        }
      }
    } catch { /* transient */ }
  }, [])

  useEffect(() => {
    if (!activeLeadId) return
    pollOnce(activeLeadId)
    pollRef.current = setInterval(() => pollOnce(activeLeadId), 2500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeLeadId, pollOnce])

  // ---------- actions ----------
  const auditionVoice = async () => {
    setAuditioning(true)
    try {
      const res = await fetch('/api/voice/tts-flash/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: greeting, voiceId }),
      })
      const json = await res.json()
      if (!res.ok || !json.audio) throw new Error(json.error || 'No audio returned')
      const src = `data:${json.mime || 'audio/wav'};base64,${json.audio}`
      if (audioRef.current) { audioRef.current.pause() }
      const audio = new Audio(src)
      audioRef.current = audio
      await audio.play()
      toast.success(`Designed voice auditioned in ${(json.tookMs / 1000).toFixed(1)}s`)
    } catch (e: any) {
      toast.error(e.message || 'Audition failed')
    } finally {
      setAuditioning(false)
    }
  }

  const createVoice = async () => {
    setDesigning(true)
    try {
      const res = await fetch('/api/voice/tts-flash/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: designDescription, displayName: designName, gender }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Voice design failed')
      setVoiceId(json.voiceId)
      setDesignOpen(false)
      loadVoices()
      toast.success(`New persistent voice created: ${json.voiceId} (${(json.tookMs / 1000).toFixed(0)}s)`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDesigning(false)
    }
  }

  const placeCall = async () => {
    if (!prospectPhone.trim()) { toast.error('Enter the prospect phone number first'); return }
    if (!prospectName.trim()) { toast.error('Enter the prospect name — the AI greets them by name'); return }
    setPlacing(true)
    setStatus(null)
    try {
      const res = await fetch('/api/voice/tts-flash/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectName,
          prospectPhone,
          companyName,
          agentName,
          gender,
          language,
          reason,
          instruction,
          voiceId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to place call')
      setCallInfo(json)
      setActiveLeadId(json.leadId)
      toast.success(json.prewarmed
        ? `Greeting pre-rendered in ${(json.prewarmMs / 1000).toFixed(1)}s — dialing now`
        : 'Dialing now — greeting will be generated live')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPlacing(false)
    }
  }

  // ---------- derived ----------
  const lead = status?.lead
  const callStatus = lead?.voice_call_status || (activeLeadId ? 'calling' : 'idle')
  const statusMeta = STATUS_META[callStatus] || STATUS_META.idle
  const transcript: any[] = Array.isArray(lead?.voice_call_transcript) ? lead.voice_call_transcript : []
  const callJson = status?.callJson
  const isLive = callStatus === 'calling' || callStatus === 'in_progress' || callStatus === 'queued'
  const bridgeOk = bridgeHealth?.ok !== false
  const prewarmReady = status?.prewarm?.ready

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-purple-600" size={32} />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Admin only</h1>
          <p className="text-sm text-slate-500">
            The Gemini TTS-Flash pipeline demo places real outbound calls and is restricted to Nobogent admin accounts.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f7f8fc] pb-28">
      {/* ---------- header ---------- */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/80 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="bg-gradient-to-tr from-violet-600 via-purple-600 to-cyan-500 text-white p-3 rounded-2xl shadow-lg shadow-purple-500/25">
              <AudioLines size={22} />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                Gemini 3.8 Flash TTS — Live Call Pipeline
                <span className="hidden sm:inline text-[10px] bg-gradient-to-r from-violet-600 to-cyan-500 text-white font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  no live api
                </span>
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                {TTS_FLASH_MODELS.tts} voice · {TTS_FLASH_MODELS.asr} STT · {TTS_FLASH_MODELS.llm} brain · Vobiz telephony
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-2 text-[11px] font-bold px-3 py-1.5 rounded-xl border ${bridgeOk ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
              <span className={`w-2 h-2 rounded-full ${bridgeOk ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              Bridge {bridgeOk ? 'online' : 'unreachable'}
            </div>
            <div className="flex items-center gap-2 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-600">
              <span className={`w-2 h-2 rounded-full ${statusMeta.dot}`} />
              {statusMeta.label}
            </div>
            <button
              onClick={() => { loadHealth(); loadRecent(); loadVoices() }}
              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-purple-600 hover:border-purple-200 transition-all"
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* ---------- banner ---------- */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-violet-50 via-white to-cyan-50 border border-purple-200/70 p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="bg-gradient-to-tr from-violet-600 to-cyan-500 text-white p-3 rounded-2xl shadow-md shadow-purple-500/20 flex-shrink-0">
                <Zap size={20} />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900">
                  A real phone call, built from three REST calls — not one WebSocket session
                </h2>
                <p className="text-[11px] sm:text-xs text-slate-600 mt-1 max-w-3xl leading-relaxed">
                  Caller audio is transcribed, answered by a streaming LLM, and spoken by the new Gemini TTS model with a
                  voice designed for this pipeline. The caller can interrupt any time, and the whole loop is engineered to
                  keep first-audio latency near one second. Enter a prospect below and their phone rings.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] bg-white/80 px-3.5 py-1.5 rounded-xl border border-slate-200 flex-shrink-0">
              <Phone size={13} className={dialLine?.ok ? 'text-emerald-600' : 'text-red-500'} />
              <span className="text-slate-500">
                {dialLine?.ok
                  ? <>Calling from <strong className="text-slate-800 font-mono">{dialLine.callerNumber}</strong></>
                  : <span className="text-red-600">{dialLine?.error || 'Resolving dial line…'}</span>}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-white/80 px-3.5 py-1.5 rounded-xl border border-slate-200 flex-shrink-0">
              <User size={13} className="text-purple-600" />
              <span>Admin: <strong className="text-slate-800">{adminEmail}</strong></span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ================= LEFT: setup ================= */}
          <div className="lg:col-span-7 space-y-5">
            {/* prospect */}
            <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                <div className="w-7 h-7 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs">1</div>
                <h3 className="font-bold text-sm text-slate-900">Who is being called</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                    Prospect name *
                  </label>
                  <div className="relative">
                    <input
                      value={prospectName}
                      onChange={e => setProspectName(e.target.value)}
                      placeholder="Rahul Sharma"
                      className="w-full bg-slate-50 border border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl py-2.5 px-3.5 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition-all"
                    />
                    <User className="absolute right-3 top-3 text-slate-400 pointer-events-none" size={15} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                    Phone number *
                  </label>
                  <div className="relative">
                    <input
                      value={prospectPhone}
                      onChange={e => setProspectPhone(e.target.value)}
                      placeholder="98765 43210"
                      inputMode="tel"
                      className="w-full bg-slate-50 border border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl py-2.5 px-3.5 text-sm font-mono font-semibold text-slate-900 placeholder-slate-400 outline-none transition-all"
                    />
                    <Phone className="absolute right-3 top-3 text-slate-400 pointer-events-none" size={15} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                    Company the AI represents
                  </label>
                  <div className="relative">
                    <input
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      placeholder="Nobogent Realty"
                      className="w-full bg-slate-50 border border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl py-2.5 px-3.5 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition-all"
                    />
                    <Building2 className="absolute right-3 top-3 text-slate-400 pointer-events-none" size={15} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                    Agent name
                  </label>
                  <input
                    value={agentName}
                    onChange={e => setAgentName(e.target.value)}
                    placeholder="Aanya"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl py-2.5 px-3.5 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition-all"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                    What did they enquire about
                  </label>
                  <input
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="3 BHK in Mohali"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl py-2.5 px-3.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Real inventory from your workspace is injected into the AI brief automatically.
                  </span>
                </div>
              </div>
            </section>

            {/* language + voice */}
            <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs">2</div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Opening language & designed voice</h3>
                    <p className="text-[10px] text-slate-500 font-medium">The voice mirrors whatever the prospect speaks next</p>
                  </div>
                </div>
                <button
                  onClick={auditionVoice}
                  disabled={auditioning}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-xl transition-all disabled:opacity-60"
                >
                  {auditioning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Audition
                </button>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <User size={13} className="text-slate-400" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Agent gender</span>
                  <span className="text-[9px] text-slate-400 font-medium normal-case">
                    drives Hindi/Punjabi/Marathi grammar and pronouns
                  </span>
                </div>
                <div className="flex gap-2">
                  {(['female', 'male'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => {
                        setGender(g)
                        // Keep the default persona name in step with the gender.
                        if (agentName === 'Aanya' || agentName === 'Kabir' || agentName === 'Meera') {
                          setAgentName(g === 'male' ? 'Kabir' : 'Aanya')
                        }
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                        gender === g
                          ? 'bg-slate-900 text-white border-slate-900 shadow-md'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {g === 'female' ? 'Female' : 'Male'}
                      <span className={`ml-1.5 text-[9px] font-medium ${gender === g ? 'text-slate-300' : 'text-slate-400'}`}>
                        {g === 'female' ? 'bol rahi hoon' : 'bol raha hoon'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Languages size={13} className="text-slate-400" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Opens in</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_LANGUAGES.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setLanguage(l.id)}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                        language === l.id
                          ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-500/20'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-purple-300 hover:text-purple-700'
                      }`}
                    >
                      {l.native}
                      <span className={`ml-1.5 text-[9px] font-medium ${language === l.id ? 'text-purple-100' : 'text-slate-400'}`}>
                        {l.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VOICE_DESIGN_PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setVoiceId(p.id)
                      setGender(p.gender)
                      if (p.agentName) setAgentName(p.agentName)
                    }}
                    className={`text-left p-3 rounded-2xl border transition-all ${
                      voiceId === p.id
                        ? 'bg-purple-50/70 border-purple-500 ring-2 ring-purple-500/15'
                        : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Volume2 size={14} className={voiceId === p.id ? 'text-purple-600' : 'text-slate-400'} />
                      <span className="text-xs font-black text-slate-900">{p.name}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug mt-1 line-clamp-2">{p.description}</p>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{p.gender}</span>
                  </button>
                ))}
                <button
                  onClick={() => setDesignOpen(v => !v)}
                  className="p-3 rounded-2xl border border-dashed border-purple-300 bg-white hover:bg-purple-50/40 transition-all flex items-center justify-center gap-2 text-purple-700 font-bold text-xs"
                >
                  <Wand2 size={14} /> Design a new voice
                </button>
              </div>

              {designedVoices.length > 0 && (
                <div className="pt-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                    Saved voices on this project
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {designedVoices.map(v => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setVoiceId(v.id)
                          if (v.gender === 'male' || v.gender === 'female') setGender(v.gender)
                        }}
                        className={`text-[10px] font-mono px-2 py-1 rounded-lg border transition-all ${
                          voiceId === v.id
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                        title={v.gender ? `${v.gender} · ${v.id}` : v.id}
                      >
                        {v.gender === 'male' ? '♂ ' : v.gender === 'female' ? '♀ ' : ''}
                        {v.name} · {v.id}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {designOpen && (
                <div className="rounded-2xl border border-purple-200 bg-purple-50/40 p-3.5 space-y-2.5">
                  <input
                    value={designName}
                    onChange={e => setDesignName(e.target.value)}
                    placeholder="Voice name"
                    className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs font-semibold outline-none focus:border-purple-500"
                  />
                  <textarea
                    value={designDescription}
                    onChange={e => setDesignDescription(e.target.value)}
                    rows={4}
                    placeholder="Describe age, timbre, accent, energy and languages…"
                    className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-xs leading-relaxed outline-none focus:border-purple-500"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Permanent traits only (age, timbre, accent, polyglot range). Creating a voice takes ~20s and is
                      stored on the project forever.
                    </p>
                    <button
                      onClick={createVoice}
                      disabled={designing}
                      className="flex-shrink-0 flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-[11px] font-bold px-3 py-2 rounded-xl transition-all"
                    >
                      {designing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      {designing ? 'Designing…' : 'Create voice'}
                    </button>
                  </div>
                </div>
              )}

              {instruction && (
                <p className="text-[10px] text-slate-500">{instruction}</p>
              )}
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                  Extra instruction for the AI (optional)
                </label>
                <input
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  placeholder="e.g. mention the pre-launch price of 62 lakh and the corner-unit offer"
                  className="w-full bg-slate-50 border border-slate-200 focus:border-purple-500 focus:bg-white rounded-2xl py-2.5 px-3.5 text-xs text-slate-900 placeholder-slate-400 outline-none transition-all"
                />
              </div>
            </section>

            {/* script preview */}
            <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 shadow-sm space-y-3">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                <div className="w-7 h-7 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs">3</div>
                <h3 className="font-bold text-sm text-slate-900">What the prospect will hear first</h3>
              </div>
              <div className="rounded-2xl bg-slate-900 text-slate-100 p-4 relative overflow-hidden">
                <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_#8b5cf6,_transparent_60%)]" />
                <p className="relative text-sm leading-relaxed font-medium">{greeting}</p>
                <div className="relative flex items-center gap-2 mt-3 text-[10px] text-slate-400 font-mono">
                  <Volume2 size={11} /> pre-rendered during ringback · played ~150ms after pickup
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SCRIPT_STAGES.map(s => (
                  <div key={s.step} className="flex gap-2.5 p-2.5 rounded-xl bg-slate-50/70 border border-slate-100">
                    <div className="w-5 h-5 rounded-lg bg-white border border-slate-200 text-slate-500 text-[10px] font-black flex items-center justify-center flex-shrink-0">
                      {s.step}
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-slate-800">{s.title}</p>
                      <p className="text-[10px] text-slate-500 leading-snug">{s.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* dial */}
            <button
              onClick={placeCall}
              disabled={placing || isLive}
              className="w-full group relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-violet-600 via-purple-600 to-cyan-500 text-white p-5 sm:p-6 shadow-xl shadow-purple-500/25 hover:shadow-purple-500/40 transition-all disabled:opacity-70"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 text-left">
                  <div className="bg-white/15 backdrop-blur p-3 rounded-2xl">
                    {placing || isLive ? <Loader2 size={22} className="animate-spin" /> : <PhoneCall size={22} />}
                  </div>
                  <div>
                    <p className="font-black text-base">
                      {placing ? 'Warming the pipeline…' : isLive ? 'Call in progress…' : 'Place the call'}
                    </p>
                    <p className="text-[11px] text-white/80 font-medium mt-0.5">
                      {placing
                        ? 'Rendering the greeting and warming STT + LLM before dialing'
                        : isLive
                          ? 'Watch the live transcript and latency below'
                          : `${agentName} calls ${prospectName || 'the prospect'} in ${SUPPORTED_LANGUAGES.find(l => l.id === language)?.label}`}
                    </p>
                  </div>
                </div>
                <ArrowRight size={22} className="opacity-70 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          </div>

          {/* ================= RIGHT: live monitor ================= */}
          <div className="lg:col-span-5 space-y-5">
            <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isLive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {isLive ? <Radio size={16} className="animate-pulse" /> : <Mic size={16} />}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Live call</h3>
                    <p className="text-[10px] text-slate-500 font-medium">
                      {lead ? `${lead.name} · ${lead.phone}` : 'No active call'}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg border ${statusMeta.tone}`}>
                  {statusMeta.label}
                </span>
              </div>

              {/* metrics */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <Metric
                  icon={<Gauge size={12} />}
                  label="Greeting"
                  value={status?.prewarm?.ready ? `${(status.prewarm.readyMs / 1000).toFixed(1)}s` : (callJson?.metrics?.greeting_ready_ms ? `${(callJson.metrics.greeting_ready_ms / 1000).toFixed(1)}s` : '—')}
                  hint="pre-render"
                />
                <Metric
                  icon={<Clock size={12} />}
                  label="Avg turn"
                  value={callJson?.metrics?.avg_turn_ms ? `${(callJson.metrics.avg_turn_ms / 1000).toFixed(1)}s` : '—'}
                  hint="STT+LLM+TTS"
                />
                <Metric
                  icon={<MessageSquare size={12} />}
                  label="Turns"
                  value={String(transcript.length || 0)}
                  hint="spoken"
                />
              </div>

              {/* transcript */}
              <div className="mt-3 space-y-2 max-h-[22rem] overflow-y-auto pr-1">
                {transcript.length === 0 && (
                  <div className="text-center py-8">
                    <div className="mx-auto w-11 h-11 rounded-2xl bg-slate-50 text-slate-300 flex items-center justify-center mb-2">
                      <PhoneCall size={20} />
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium">
                      {activeLeadId ? 'Waiting for the call to be answered…' : 'Place a call to see the transcript stream in.'}
                    </p>
                  </div>
                )}
                {transcript.map((t: any, i: number) => (
                  <div key={i} className={`flex ${t.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                      t.role === 'agent'
                        ? 'bg-gradient-to-br from-purple-50 to-cyan-50 border border-purple-100 text-slate-800'
                        : 'bg-slate-900 text-white'
                    }`}>
                      <p className="text-[11px] leading-relaxed font-medium">{t.message}</p>
                      <div className={`flex items-center gap-1.5 mt-1 text-[9px] font-mono ${t.role === 'agent' ? 'text-purple-500' : 'text-slate-400'}`}>
                        {t.role === 'agent' ? <Volume2 size={9} /> : <User size={9} />}
                        {t.role === 'agent' ? agentName : lead?.name || 'Prospect'}
                        {t.latency_ms ? <span className="ml-1 px-1 rounded bg-white/60 text-purple-600">{t.latency_ms}ms</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
                {isLive && transcript.length > 0 && (
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium pl-1">
                    <CircleDot size={10} className="animate-pulse text-emerald-500" /> listening…
                  </div>
                )}
              </div>

              {/* summary */}
              {lead?.voice_call_summary && (
                <div className="mt-3 rounded-2xl bg-sky-50 border border-sky-200 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-sky-700 mb-1">
                    <CheckCircle2 size={11} /> Call summary
                  </div>
                  <p className="text-[11px] text-sky-900 leading-relaxed">{lead.voice_call_summary}</p>
                  {callJson?.outcome && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Chip label={`outcome: ${callJson.outcome}`} />
                      {callJson.sentiment && <Chip label={`sentiment: ${callJson.sentiment}`} />}
                      {callJson.metrics?.duration_sec && <Chip label={`${callJson.metrics.duration_sec}s call`} />}
                    </div>
                  )}
                </div>
              )}

              {callStatus === 'failed' && (
                <div className="mt-3 rounded-2xl bg-red-50 border border-red-200 p-3 flex items-start gap-2">
                  <AlertCircle size={14} className="text-red-600 mt-0.5" />
                  <p className="text-[11px] text-red-800 leading-relaxed">
                    The carrier rejected the call. Check the caller ID number assigned to this account, then retry.
                  </p>
                </div>
              )}

              {/* turn latency timeline */}
              {callJson?.metrics?.turns?.length > 0 && (
                <div className="mt-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1.5">
                    Per-turn latency
                  </span>
                  <div className="space-y-1">
                    {callJson.metrics.turns.map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-slate-600 bg-slate-50 rounded-lg px-2 py-1">
                        <span className="text-slate-400 w-6">#{i + 1}</span>
                        <span className="text-sky-600">stt {t.asr_ms ?? '—'}ms</span>
                        <span className="text-purple-600">llm {t.llm_ttfb_ms ?? '—'}ms</span>
                        <span className="text-emerald-600 ml-auto font-bold">{t.total_ms}ms total</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* pipeline diagram */}
            <section className="bg-slate-900 text-white rounded-[2rem] p-5 sm:p-6 shadow-lg relative overflow-hidden">
              <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top_left,_#8b5cf6,_transparent_55%)]" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <Waves size={15} className="text-cyan-300" />
                  <h3 className="font-bold text-sm">Pipeline on the wire</h3>
                  <span className="ml-auto text-[9px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-2 py-0.5 rounded-full">
                    live
                  </span>
                </div>
                <div className="space-y-1.5">
                  <FlowStep icon={<Phone size={12} />} label="Vobiz media stream" detail="l16 PCM · 16 kHz · bidirectional" tint="text-cyan-300" />
                  <FlowStep icon={<Mic size={12} />} label={`STT · ${TTS_FLASH_MODELS.asr}`} detail="thinkingBudget 0 · trimmed utterance · ~1.5s" tint="text-sky-300" />
                  <FlowStep icon={<BrainCircuit size={12} />} label={`Brain · ${TTS_FLASH_MODELS.llm}`} detail="streaming tokens · clause splitting · ~1.3s to first token" tint="text-violet-300" />
                  <FlowStep icon={<AudioLines size={12} />} label={`TTS · ${TTS_FLASH_MODELS.tts}`} detail="designed voice · 24k→16k · ~1.1s to first audio" tint="text-fuchsia-300" />
                  <FlowStep icon={<Zap size={12} />} label="Latency masking" detail="backchannel filler under 500 ms · barge-in any time" tint="text-amber-300" />
                </div>
                <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
                  Zero Live-API sessions. Every hop is a plain REST call, so the same code path scales horizontally on
                  Cloud Run and every stage can be swapped or A/B tested independently.
                </p>
              </div>
            </section>
          </div>
        </div>

        {/* ---------- latency budget ---------- */}
        <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="w-8 h-8 rounded-xl bg-cyan-100 text-cyan-700 flex items-center justify-center">
              <TrendingUp size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900">Latency budget</h3>
              <p className="text-[10px] text-slate-500 font-medium">
                Where each millisecond goes, and the trick that removes it — the same set of techniques used by
                production voice-agent stacks (streaming ASR, clause-chunked TTS, speculative endpointing, filler masking).
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
            {LATENCY_BUDGET.map(row => (
              <div key={row.stage} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50/70 border border-slate-100">
                <div>
                  <p className="text-[11px] font-bold text-slate-800">{row.stage}</p>
                  <p className="text-[10px] text-slate-500 leading-snug">{row.how}</p>
                </div>
                <span className="text-[10px] font-mono font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg whitespace-nowrap">
                  {row.budget}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- recent ---------- */}
        <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">Recent pipeline calls</h3>
            <button onClick={loadRecent} className="text-[10px] font-bold text-purple-600 hover:text-purple-700 flex items-center gap-1">
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          {recentCalls.length === 0 ? (
            <p className="text-[11px] text-slate-400 py-6 text-center font-medium">No calls placed yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 mt-1">
              {recentCalls.map(c => {
                const meta = STATUS_META[c.voice_call_status] || STATUS_META.idle
                return (
                  <button
                    key={c.id}
                    onClick={() => { setActiveLeadId(c.id); setStatus(null) }}
                    className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-slate-50/70 rounded-xl px-1 transition-all"
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-bold text-slate-800 truncate">{c.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono truncate">
                        {c.phone} · {new Date(c.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-md border ${meta.tone}`}>
                      {meta.label}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-2">
      <div className="flex items-center gap-1 text-slate-400">
        {icon}
        <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-black text-slate-900 mt-0.5 font-mono">{value}</p>
      <p className="text-[9px] text-slate-400">{hint}</p>
    </div>
  )
}

function Chip({ label }: { label: string }) {
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-white border border-sky-200 text-sky-700">
      {label}
    </span>
  )
}

function FlowStep({ icon, label, detail, tint }: { icon: React.ReactNode; label: string; detail: string; tint: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/5 border border-white/10 px-2.5 py-2">
      <div className={`flex-shrink-0 ${tint}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-white truncate">{label}</p>
        <p className="text-[9px] text-slate-400 truncate">{detail}</p>
      </div>
    </div>
  )
}
