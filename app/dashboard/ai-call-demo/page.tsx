'use client'

import { useState, useEffect, useRef } from 'react'
import {
  PhoneCall,
  Phone,
  Mic,
  Sparkles,
  ShieldCheck,
  Building2,
  Calendar,
  Clock,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Bot,
  User,
  Volume2,
  FileText,
  ChevronRight,
  ExternalLink,
  History,
  PhoneOff,
  Flame,
  Award,
  RefreshCw,
  Info
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import { DEMO_VOICE_OPTIONS, DEMO_PROMPT_TEMPLATES, DemoPromptTemplate } from '@/utils/demo-prompts'

export default function AiCallDemoPage() {
  const supabase = createClient()

  // --- Auth / Permissions ---
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')

  // --- Form State ---
  const [selectedTemplateId, setSelectedTemplateId] = useState('real_estate')
  const [selectedVoice, setSelectedVoice] = useState('Aoede')
  const [prospectPhone, setProspectPhone] = useState('')
  const [prospectName, setProspectName] = useState('Rohan Sharma')
  const [businessName, setBusinessName] = useState('Bioque Estates International')
  const [customPrompt, setCustomPrompt] = useState('')

  // --- Call Execution State ---
  const [isCalling, setIsCalling] = useState(false)
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [activeCallStatus, setActiveCallStatus] = useState<string>('idle')
  const [activeCallLead, setActiveCallLead] = useState<any>(null)
  const [activeCallHistory, setActiveCallHistory] = useState<any[]>([])

  // --- History State ---
  const [recentDemoCalls, setRecentDemoCalls] = useState<any[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [callerNumber, setCallerNumber] = useState('+917965480539')

  // Set default prompt on initial template load
  useEffect(() => {
    const defaultTpl = DEMO_PROMPT_TEMPLATES.find(t => t.id === 'real_estate') || DEMO_PROMPT_TEMPLATES[0]
    setCustomPrompt(defaultTpl.prompt)
    setBusinessName(defaultTpl.defaultBusinessName)
    setProspectName(defaultTpl.suggestedProspectName)
  }, [])

  // Check super admin privileges
  useEffect(() => {
    async function checkAdmin() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setIsSuperAdmin(false)
          setCheckingAuth(false)
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, email')
          .eq('id', user.id)
          .single()

        const isSuper = profile?.role === 'super_admin' || profile?.email === 'rchopra489@gmail.com'
        setIsSuperAdmin(isSuper)
        setAdminEmail(profile?.email || user.email || '')
        
        if (isSuper) {
          fetchRecentDemos()
        }
      } catch (err) {
        console.error('Error verifying super admin:', err)
        setIsSuperAdmin(false)
      } finally {
        setCheckingAuth(false)
      }
    }

    checkAdmin()
  }, [])

  // Template switch handler
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const tpl = DEMO_PROMPT_TEMPLATES.find(t => t.id === templateId)
    if (tpl) {
      setCustomPrompt(tpl.prompt)
      setBusinessName(tpl.defaultBusinessName)
      setProspectName(tpl.suggestedProspectName)
    }
  }

  // Reset prompt to current template's default
  const handleResetPrompt = () => {
    const tpl = DEMO_PROMPT_TEMPLATES.find(t => t.id === selectedTemplateId)
    if (tpl) {
      setCustomPrompt(tpl.prompt)
      toast.success('Prompt reset to default template!')
    }
  }

  // Fetch recent demo calls list
  const fetchRecentDemos = async () => {
    try {
      setLoadingRecent(true)
      const res = await fetch('/api/voice/demo-call')
      const json = await res.json()
      if (json.success) {
        setRecentDemoCalls(json.recentDemoCalls || [])
        if (json.bioqueNumber) {
          setCallerNumber(json.bioqueNumber)
        }
      }
    } catch (e) {
      console.error('Error fetching recent demo calls:', e)
    } finally {
      setLoadingRecent(false)
    }
  }

  // Start live demo call
  const handleStartDemoCall = async () => {
    const cleanNumber = prospectPhone.trim().replace(/\D/g, '')
    if (cleanNumber.length < 10) {
      toast.error('Please enter a valid 10-digit mobile number for the prospect.')
      return
    }

    if (!customPrompt || customPrompt.trim().length < 30) {
      toast.error('Prompt instruction is too short. Please provide clear instructions for the AI.')
      return
    }

    const tpl = DEMO_PROMPT_TEMPLATES.find(t => t.id === selectedTemplateId)

    try {
      setIsCalling(true)
      setActiveCallStatus('calling')
      setActiveCallLead(null)
      setActiveCallHistory([])

      toast.info(`Dialing prospect from Bioque Estates line (${callerNumber})...`)

      const res = await fetch('/api/voice/demo-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectPhone,
          prospectName: prospectName.trim() || 'Prospect',
          voiceName: selectedVoice,
          templateId: selectedTemplateId,
          templateTitle: tpl?.title || 'Custom AI Demo',
          businessName: businessName.trim() || 'Nobogent Client',
          customPrompt
        })
      })

      const json = await res.json()

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to initiate demo call.')
      }

      toast.success(json.message || 'Call triggered! Ringing phone now.')
      setActiveLeadId(json.leadId)

    } catch (err: any) {
      console.error('Call launch error:', err)
      toast.error(err.message || 'Failed to trigger demo call.')
      setIsCalling(false)
      setActiveCallStatus('failed')
    }
  }

  // Poller for active demo call status
  useEffect(() => {
    if (!activeLeadId) return

    let isMounted = true
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/voice/demo-call?leadId=${activeLeadId}`)
        const json = await res.json()

        if (!isMounted || !json.success) return

        const lead = json.lead
        setActiveCallLead(lead)
        setActiveCallHistory(json.history || [])
        setActiveCallStatus(lead.voice_call_status || 'calling')

        // Stop polling if call reached terminal status
        const terminalStatuses = ['completed', 'failed', 'no-answer', 'busy', 'cancelled', 'scheduled']
        if (terminalStatuses.includes(lead.voice_call_status)) {
          setIsCalling(false)
          fetchRecentDemos()
          if (lead.voice_call_status === 'completed') {
            toast.success('AI Demo call concluded successfully!')
          }
        }
      } catch (pollErr) {
        console.warn('Status poll warning:', pollErr)
      }
    }, 3000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [activeLeadId])

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-purple-400 mb-4" />
        <p className="text-sm font-medium text-slate-400">Verifying Super Admin Authorization...</p>
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white text-center">
        <div className="w-16 h-16 bg-red-500/20 text-red-400 rounded-3xl flex items-center justify-center mb-5 border border-red-500/30">
          <AlertCircle size={32} />
        </div>
        <h1 className="text-2xl font-black mb-2">Super Admin Access Required</h1>
        <p className="text-slate-400 max-w-md text-sm leading-relaxed mb-6">
          This AI Call Demo test module is strictly reserved for Nobogent Super Admins to conduct live demonstrations for prospects.
        </p>
        <a
          href="/dashboard/profile"
          className="bg-white/10 hover:bg-white/20 text-white font-bold px-6 py-2.5 rounded-2xl text-xs transition-colors"
        >
          Return to Profile
        </a>
      </div>
    )
  }

  const selectedTpl = DEMO_PROMPT_TEMPLATES.find(t => t.id === selectedTemplateId) || DEMO_PROMPT_TEMPLATES[0]

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 font-sans pb-24 selection:bg-purple-500 selection:text-white">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 p-0.5 shadow-lg shadow-purple-500/20">
              <div className="w-full h-full bg-[#090D16] rounded-[14px] flex items-center justify-center text-purple-400">
                <PhoneCall size={24} className="animate-pulse" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">AI Call Demo Studio</h1>
                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/30 text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Super Admin Exclusive
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">
                Live interactive prospect calling engine powered by Gemini 3.1 Flash Live & Vobiz
              </p>
            </div>
          </div>

          {/* Caller Line & Protected Credits Badge */}
          <div className="hidden md:flex items-center gap-3">
            <div className="bg-slate-800/60 border border-slate-700/60 px-4 py-2 rounded-2xl flex items-center gap-3 shadow-inner">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <div className="text-left">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Caller Line (Outbound DID)</div>
                <div className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                  <Phone size={11} className="text-purple-400" />
                  Bioque Estates: <span className="text-purple-300 font-black">{callerNumber}</span>
                </div>
              </div>
            </div>

            <div className="bg-emerald-950/40 border border-emerald-500/30 px-3.5 py-2 rounded-2xl flex items-center gap-2 text-emerald-400 text-xs font-bold">
              <ShieldCheck size={16} />
              <span>0 Credits Deducted</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-8">
        
        {/* Banner Alert: Zero Credits Protection */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-purple-900/40 via-indigo-950/30 to-slate-900/40 border border-purple-500/20 p-5 sm:p-6 backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="bg-purple-500/20 text-purple-400 p-3 rounded-2xl border border-purple-500/30 flex-shrink-0">
                <Sparkles size={24} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Prospect Live Testing Sandbox
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-black px-2 py-0.5 rounded-full uppercase">
                    Zero Bioque Billing
                  </span>
                </h2>
                <p className="text-xs text-slate-300 font-normal mt-0.5 max-w-3xl leading-relaxed">
                  Calls originate from Bioque Estates' verified virtual number (<strong className="text-white">{callerNumber}</strong>) with full bidirectional audio streaming, instant appointment booking, and automated summaries. Credit deduction is safely bypassed for all demo runs.
                </p>
              </div>
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2 flex-shrink-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Admin: <strong className="text-white">{adminEmail}</strong></span>
            </div>
          </div>
        </div>

        {/* 2-Column Grid: Form & Live Call Monitor */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Demo Setup Form (7 Cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Step 1: Prospect Contact Info */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md shadow-xl space-y-5">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
                <div className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-black text-xs">
                  1
                </div>
                <h3 className="font-bold text-sm sm:text-base text-white">Prospect Destination & Identity</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                    Prospect Phone Number *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={prospectPhone}
                      onChange={(e) => setProspectPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-purple-500 rounded-2xl py-3 px-4 text-sm font-mono text-white placeholder-slate-500 outline-none transition-all shadow-inner"
                    />
                    <Phone className="absolute right-3.5 top-3.5 text-slate-500 pointer-events-none" size={16} />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Enter the phone number of the prospect you are demonstrating to.
                  </span>
                </div>

                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                    Prospect Name
                  </label>
                  <input
                    type="text"
                    value={prospectName}
                    onChange={(e) => setProspectName(e.target.value)}
                    placeholder="e.g. Rohan Sharma"
                    className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-purple-500 rounded-2xl py-3 px-4 text-sm font-semibold text-white placeholder-slate-500 outline-none transition-all shadow-inner"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    AI will greet them warmly by this name.
                  </span>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">
                    Demo Business / Client Brand Name
                  </label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Bioque Estates International"
                    className="w-full bg-slate-950/80 border border-slate-700/80 focus:border-purple-500 rounded-2xl py-3 px-4 text-sm font-semibold text-white placeholder-slate-500 outline-none transition-all shadow-inner"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Company name the AI represents during the call.
                  </span>
                </div>
              </div>
            </div>

            {/* Step 2: Voice Model Selection */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-black text-xs">
                    2
                  </div>
                  <div>
                    <h3 className="font-bold text-sm sm:text-base text-white">Voice Selection</h3>
                    <p className="text-[11px] text-slate-400 font-medium">Default: Aoede (warm natural Indian consultative female voice)</p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-xl border border-purple-500/20">
                  {selectedVoice} Active
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {DEMO_VOICE_OPTIONS.map((voice) => {
                  const isSelected = selectedVoice === voice.id
                  return (
                    <button
                      key={voice.id}
                      type="button"
                      onClick={() => setSelectedVoice(voice.id)}
                      className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between ${
                        isSelected
                          ? 'bg-gradient-to-br from-purple-900/50 to-indigo-900/40 border-purple-500 text-white shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/50'
                          : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700 text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-black flex items-center gap-1.5">
                            <Volume2 size={15} className={isSelected ? 'text-purple-400' : 'text-slate-500'} />
                            {voice.name}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider bg-slate-800 text-slate-400">
                            {voice.gender}
                          </span>
                        </div>
                        <div className="text-[10px] text-purple-300 font-bold">
                          {voice.badge}
                        </div>
                        <p className="text-[11px] text-slate-400 leading-snug line-clamp-2 mt-1">
                          {voice.description}
                        </p>
                      </div>

                      {isSelected && (
                        <div className="mt-2.5 flex items-center gap-1 text-[10px] text-purple-300 font-bold">
                          <CheckCircle2 size={12} /> Selected
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 3: Industry Prompt Templates */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-black text-xs">
                    3
                  </div>
                  <div>
                    <h3 className="font-bold text-sm sm:text-base text-white">Select Industry Demo Prompt</h3>
                    <p className="text-[11px] text-slate-400 font-medium">Default: Real Estate Luxury Advisory (Bioque Estates Style)</p>
                  </div>
                </div>
              </div>

              {/* Template Pills / Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {DEMO_PROMPT_TEMPLATES.map((tpl) => {
                  const isSelected = selectedTemplateId === tpl.id
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleTemplateChange(tpl.id)}
                      className={`text-left p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-purple-600 text-white border-purple-500 shadow-md shadow-purple-600/30'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="space-y-1">
                        <span className="text-[9px] font-black uppercase tracking-wider block opacity-75">
                          {tpl.industry}
                        </span>
                        <div className="text-xs font-bold leading-tight line-clamp-2">
                          {tpl.title}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Editable Prompt Textarea */}
              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-slate-300 uppercase tracking-wider text-[10px]">Active Prompt System Instruction</span>
                    <span className="bg-purple-500/20 text-purple-300 text-[9px] font-bold px-2 py-0.5 rounded-full border border-purple-500/30">
                      Hinglish Default • Multilingual Ready
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetPrompt}
                    className="text-slate-400 hover:text-purple-300 flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer"
                  >
                    <RotateCcw size={12} /> Reset to Default
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    rows={12}
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-2xl p-4 text-xs font-mono text-slate-200 leading-relaxed outline-none transition-all shadow-inner resize-y"
                    placeholder="Enter system prompt instruction for the AI voice assistant..."
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                    <CheckCircle2 size={13} /> Appointment Booking & Hangup tools automatically configured
                  </span>
                  <span>{customPrompt.length} chars</span>
                </div>
              </div>

              {/* Trigger Button */}
              <div className="pt-4">
                <button
                  type="button"
                  onClick={handleStartDemoCall}
                  disabled={isCalling}
                  className="w-full bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-black py-4 px-6 rounded-2xl text-base shadow-xl shadow-purple-600/30 flex items-center justify-center gap-3 transition-all cursor-pointer group hover:scale-[1.01]"
                >
                  {isCalling ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      <span>Initiating Demo Call...</span>
                    </>
                  ) : (
                    <>
                      <PhoneCall size={20} className="group-hover:scale-110 transition-transform" />
                      <span>Launch Live AI Call Demo Now</span>
                    </>
                  )}
                </button>
                <div className="text-center mt-2 text-[11px] text-slate-400">
                  Dialing from <strong className="text-white">{callerNumber}</strong> with <strong>Zero Credit Cost</strong>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column: Live Call Monitor & Inspector (5 Cols) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Live Call Status Card */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md shadow-xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                    <Mic size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Live Call Monitor</h3>
                    <p className="text-[11px] text-slate-400 font-medium">Real-time telemetry & audio streaming</p>
                  </div>
                </div>

                {/* Status Indicator Pill */}
                <div>
                  {activeCallStatus === 'calling' && (
                    <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold px-3 py-1 rounded-xl flex items-center gap-1.5 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-amber-400" /> Ringing...
                    </span>
                  )}
                  {activeCallStatus === 'in-progress' && (
                    <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold px-3 py-1 rounded-xl flex items-center gap-1.5 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" /> Connected / Speaking
                    </span>
                  )}
                  {activeCallStatus === 'completed' && (
                    <span className="bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-bold px-3 py-1 rounded-xl flex items-center gap-1.5">
                      <CheckCircle2 size={13} /> Call Completed
                    </span>
                  )}
                  {activeCallStatus === 'failed' && (
                    <span className="bg-red-500/10 text-red-400 border border-red-500/30 text-xs font-bold px-3 py-1 rounded-xl flex items-center gap-1.5">
                      <AlertCircle size={13} /> Call Failed
                    </span>
                  )}
                  {activeCallStatus === 'idle' && (
                    <span className="bg-slate-800 text-slate-400 text-xs font-bold px-3 py-1 rounded-xl">
                      Ready to Dial
                    </span>
                  )}
                </div>
              </div>

              {/* Call Details Display */}
              {activeCallLead ? (
                <div className="space-y-4">
                  {/* Prospect Header */}
                  <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <User size={15} className="text-purple-400" />
                        <span className="text-sm font-bold text-white">{activeCallLead.name}</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-purple-300">{activeCallLead.phone}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">Voice Engine:</span>
                        <span className="font-bold text-slate-300">{activeCallLead.custom_fields?.demo_voice_name || selectedVoice}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Template:</span>
                        <span className="font-bold text-slate-300 truncate block">
                          {activeCallLead.custom_fields?.demo_template_title || selectedTpl.title}
                        </span>
                      </div>
                    </div>

                    {/* Duration & Billing */}
                    {activeCallLead.voice_duration_seconds !== undefined && activeCallLead.voice_duration_seconds !== null && (
                      <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
                        <span className="text-slate-400 flex items-center gap-1">
                          <Clock size={13} /> Duration: <strong className="text-white">{activeCallLead.voice_duration_seconds}s</strong>
                        </span>
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <ShieldCheck size={13} /> 0 Credits (Demo Free)
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Appointment Booking Banner if booked during demo */}
                  {(activeCallLead.status === 'Booked' || activeCallLead.pipeline_stage === 'Appointment Scheduled' || activeCallLead.custom_fields?.appointment_time) && (
                    <div className="bg-gradient-to-r from-emerald-950/60 to-emerald-900/40 border border-emerald-500/40 p-4 rounded-2xl space-y-1.5 animate-in fade-in">
                      <div className="flex items-center gap-2 text-emerald-400 font-black text-xs uppercase tracking-wider">
                        <Calendar size={15} /> Appointment Booked Successfully!
                      </div>
                      <p className="text-xs text-white font-medium">
                        Slot: {activeCallLead.custom_fields?.appointment_time || activeCallLead.appointment_time || 'Confirmed during live demo'}
                      </p>
                      {activeCallLead.custom_fields?.appointment_notes && (
                        <p className="text-[11px] text-emerald-200">
                          Notes: {activeCallLead.custom_fields?.appointment_notes}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Audio Recording Player */}
                  {activeCallLead.voice_recording_url && (
                    <div className="bg-slate-950/80 p-4 rounded-2xl border border-purple-500/30 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-purple-300 flex items-center gap-1.5">
                          <Volume2 size={14} /> Full Call Recording
                        </span>
                        <a
                          href={activeCallLead.voice_recording_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300 flex items-center gap-1 text-[11px] font-bold"
                        >
                          <ExternalLink size={11} /> Open
                        </a>
                      </div>
                      <audio
                        controls
                        src={activeCallLead.voice_recording_url}
                        className="w-full h-9 rounded-lg"
                      />
                    </div>
                  )}

                  {/* AI Generated Call Summary */}
                  {activeCallLead.voice_call_summary && (
                    <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 space-y-2">
                      <span className="text-[10px] uppercase tracking-wider font-black text-purple-400 flex items-center gap-1.5">
                        <Sparkles size={12} /> AI Summary & Sentiment
                      </span>
                      <p className="text-xs text-slate-300 leading-relaxed font-normal whitespace-pre-line">
                        {activeCallLead.voice_call_summary}
                      </p>
                    </div>
                  )}

                  {/* Full Call Transcript Viewer */}
                  {activeCallLead.voice_transcript && (
                    <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 space-y-2 max-h-72 overflow-y-auto">
                      <span className="text-[10px] uppercase tracking-wider font-black text-slate-400 flex items-center gap-1.5">
                        <FileText size={12} /> Conversation Transcript
                      </span>
                      <div className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed bg-slate-950 p-3 rounded-xl border border-slate-900">
                        {activeCallLead.voice_transcript}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 px-4 text-center space-y-3 bg-slate-950/40 rounded-2xl border border-slate-800/40">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800/60 text-slate-500 mx-auto flex items-center justify-center">
                    <Phone size={20} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-300">No Demo Call In Progress</h4>
                    <p className="text-[11px] text-slate-500 max-w-xs mx-auto mt-1">
                      Fill out the prospect's phone number on the left and click "Launch Live AI Call Demo Now" to start testing.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Feature Checklist for Prospects */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-5 backdrop-blur-md shadow-xl space-y-3 text-xs">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block font-bold">
                Prospect Live Demo Checklist
              </span>
              <ul className="space-y-2 text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <span><strong>Hinglish by default:</strong> Speaks natural Indian conversational Hindi + English.</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <span><strong>Multilingual Switch:</strong> Reply in English, Punjabi, or regional language to test live adaptation.</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <span><strong>Live Interruption:</strong> Speak while the AI is talking to demonstrate instant zero-latency pause.</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  <span><strong>Appointment Booking:</strong> Say "Book a meeting tomorrow at 4 PM" to trigger automatic scheduling.</span>
                </li>
              </ul>
            </div>

          </div>

        </div>

        {/* Bottom Section: Past Demo Calls Log Table */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <History size={16} />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-white">Recent Super Admin Demo Calls</h3>
                <p className="text-[11px] text-slate-400 font-medium">History of prospect demo calls triggered from this studio</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchRecentDemos}
              disabled={loadingRecent}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold"
            >
              <RefreshCw size={14} className={loadingRecent ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {recentDemoCalls.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-3">Prospect</th>
                    <th className="py-3 px-3">Industry / Template</th>
                    <th className="py-3 px-3">Voice</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Duration</th>
                    <th className="py-3 px-3">Recording</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {recentDemoCalls.map((lead) => {
                    const isSelected = activeLeadId === lead.id
                    return (
                      <tr
                        key={lead.id}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          isSelected ? 'bg-purple-900/20' : ''
                        }`}
                      >
                        <td className="py-3.5 px-3">
                          <div className="font-bold text-white">{lead.name || 'Prospect'}</div>
                          <div className="font-mono text-[11px] text-slate-400">{lead.phone}</div>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="font-semibold text-slate-300">
                            {lead.custom_fields?.demo_template_title || lead.source || 'AI Call Demo'}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 font-mono text-purple-300">
                          {lead.custom_fields?.demo_voice_name || 'Aoede'}
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`text-[10px] font-bold px-2.5 py-1 rounded-xl uppercase tracking-wider ${
                              lead.voice_call_status === 'completed'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : lead.voice_call_status === 'calling'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : lead.voice_call_status === 'failed'
                                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {lead.voice_call_status || 'Pending'}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 font-mono text-slate-400">
                          {lead.voice_duration_seconds ? `${lead.voice_duration_seconds}s` : '—'}
                        </td>
                        <td className="py-3.5 px-3">
                          {lead.voice_recording_url ? (
                            <a
                              href={lead.voice_recording_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 font-bold"
                            >
                              <Play size={12} /> Play Audio
                            </a>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveLeadId(lead.id)
                              setActiveCallLead(lead)
                              setActiveCallStatus(lead.voice_call_status || 'completed')
                              window.scrollTo({ top: 300, behavior: 'smooth' })
                            }}
                            className="bg-slate-800 hover:bg-purple-600 text-white font-bold px-3 py-1.5 rounded-xl text-[11px] transition-all cursor-pointer"
                          >
                            Inspect Details
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-500 text-xs">
              No previous demo calls found. Launch your first demo call above!
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
