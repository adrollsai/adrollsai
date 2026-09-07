'use client'

import React, { useState } from 'react'
import { 
  PhoneCall, Phone, PhoneForwarded, Sparkles, Plus, Play, Pause, 
  Trash2, Pencil, CheckCircle2, AlertCircle, Clock, Volume2, 
  Radio, Shield, ArrowRight, UserCheck, MessageSquare, Send, 
  Sliders, Bot, ExternalLink, X, Smartphone, Filter, Search, 
  ChevronRight, Users, Eye, FileText
} from 'lucide-react'
import { toast } from 'sonner'

export interface AiCallingRule {
  id: string
  name: string
  triggerSource: 'meta_ad' | 'portal_webhook' | 'csv_list' | 'landing_page' | 'crm_stage'
  triggerLabel: string
  voiceAgent: 'Puck' | 'Fenrir' | 'Kore' | 'Charon' | 'Aoede'
  voiceTone: string
  delaySeconds: number
  objective: string
  firstLine: string
  questions: Array<{
    id: string
    question: string
    fieldKey: string
    passCriteria: string
  }>
  transferNumber?: string
  onPassActions: {
    crmStage: string
    sendWhatsAppBrochure: boolean
    alertAdmin: boolean
  }
  isActive: boolean
  stats: {
    callsPlaced: number
    connected: number
    qualified: number
    avgDuration: string
  }
  lastCallAt: string
}

const DEFAULT_AI_CALLING_RULES: AiCallingRule[] = [
  {
    id: 'rule_meta_lead_instant_call',
    name: 'Meta Lead Ad 60-Second Instant Speed-to-Lead Callback',
    triggerSource: 'meta_ad',
    triggerLabel: 'Meta Instant Form Submission (Wave City & Joy Grand)',
    voiceAgent: 'Fenrir',
    voiceTone: 'Crisp, focused & persuasive outbound telecaller',
    delaySeconds: 60,
    objective: 'Qualify buyer intent within 60s and confirm Saturday site visit',
    firstLine: 'Hi {{lead.name}}, this is the sales desk at Joy Grand Luxury Residences following up on your inquiry. Am I speaking with {{lead.name}}?',
    questions: [
      {
        id: 'q1',
        question: 'Are you looking to invest or purchase a home for self-use?',
        fieldKey: 'purchase_purpose',
        passCriteria: 'Self-use or Investment'
      },
      {
        id: 'q2',
        question: 'Can I reserve an exclusive site visit slot for you this Saturday at 11 AM?',
        fieldKey: 'site_visit_confirmed',
        passCriteria: 'Yes / Saturday / Sunday'
      }
    ],
    transferNumber: '+91 98765 43210',
    onPassActions: {
      crmStage: 'Site Visit Planned',
      sendWhatsAppBrochure: true,
      alertAdmin: true
    },
    isActive: false, // Default PAUSED as instructed
    stats: {
      callsPlaced: 540,
      connected: 462,
      qualified: 198,
      avgDuration: '2m 15s'
    },
    lastCallAt: '8 mins ago'
  },
  {
    id: 'rule_housing_portal_callback',
    name: 'Housing.com & 99Acres Inbound Portal Qualification',
    triggerSource: 'portal_webhook',
    triggerLabel: 'Housing.com / 99Acres Inbound Webhook Lead',
    voiceAgent: 'Puck',
    voiceTone: 'Clear, upbeat & engaging advisor',
    delaySeconds: 120,
    objective: 'Filter out casual inquiries & capture verified budget range',
    firstLine: 'Hello {{lead.name}}! Thank you for inquiring about our luxury residences on Housing.com. Do you have 2 minutes for a quick project overview?',
    questions: [
      {
        id: 'q1',
        question: 'What unit configuration are you seeking (3 BHK, 4 BHK, or Sky Villa)?',
        fieldKey: 'configuration',
        passCriteria: '3 BHK / 4 BHK / Villa'
      },
      {
        id: 'q2',
        question: 'Is your budget aligned between 1.8 Cr to 3.5 Cr?',
        fieldKey: 'budget_fit',
        passCriteria: 'Yes / Within Range'
      }
    ],
    transferNumber: '+91 98765 43210',
    onPassActions: {
      crmStage: 'Pre-Qualified',
      sendWhatsAppBrochure: true,
      alertAdmin: true
    },
    isActive: false, // Default PAUSED
    stats: {
      callsPlaced: 380,
      connected: 312,
      qualified: 145,
      avgDuration: '1m 50s'
    },
    lastCallAt: '24 mins ago'
  },
  {
    id: 'rule_csv_cold_calling_blast',
    name: 'High-Net-Worth Investor Calling Campaign (CSV Blast)',
    triggerSource: 'csv_list',
    triggerLabel: 'Mohali-Luxury-HNIs-Calling-List.csv (450 Prospects)',
    voiceAgent: 'Charon',
    voiceTone: 'Deep, resonant & authoritative wealth advisor',
    delaySeconds: 0,
    objective: 'Pitch pre-launch private reservation token with guaranteed rental yield',
    firstLine: 'Good day {{lead.name}}, I am calling from the executive developer advisory for Wave City. We are extending a pre-launch investor invitation.',
    questions: [
      {
        id: 'q1',
        question: 'Are you currently allocating capital towards commercial or luxury real estate assets?',
        fieldKey: 'investor_readiness',
        passCriteria: 'Yes / Interested'
      },
      {
        id: 'q2',
        question: 'May we share our 12% guaranteed yield prospectus on your WhatsApp?',
        fieldKey: 'whatsapp_consent',
        passCriteria: 'Yes / Send'
      }
    ],
    onPassActions: {
      crmStage: 'Investor Qualified',
      sendWhatsAppBrochure: true,
      alertAdmin: true
    },
    isActive: false, // Default PAUSED
    stats: {
      callsPlaced: 450,
      connected: 384,
      qualified: 132,
      avgDuration: '3m 10s'
    },
    lastCallAt: '2 hours ago'
  },
  {
    id: 'rule_landing_page_request_call',
    name: 'Landing Page Instant "Call Me Now" Trigger',
    triggerSource: 'landing_page',
    triggerLabel: 'High-Converting Landing Page Click-to-Call',
    voiceAgent: 'Aoede',
    voiceTone: 'Melodic, friendly & natural conversationalist',
    delaySeconds: 15,
    objective: 'Instant connection while prospect is still active on webpage',
    firstLine: 'Hi {{lead.name}}, you just requested a call on our property showcase page. I am here to help you with pricing and availability!',
    questions: [
      {
        id: 'q1',
        question: 'Which tower or floor plan caught your attention on our website?',
        fieldKey: 'interested_floorplan',
        passCriteria: 'Any floor plan'
      }
    ],
    transferNumber: '+91 98765 43210',
    onPassActions: {
      crmStage: 'Hot Inbound Lead',
      sendWhatsAppBrochure: true,
      alertAdmin: true
    },
    isActive: false, // Default PAUSED
    stats: {
      callsPlaced: 195,
      connected: 182,
      qualified: 94,
      avgDuration: '2m 45s'
    },
    lastCallAt: '1 hour ago'
  }
]

const GEMINI_VOICE_STUDIO = [
  {
    id: 'Fenrir',
    name: 'Fenrir',
    role: 'High-Clarity Outbound Telecalling',
    gender: 'Male',
    tone: 'Crisp, focused, persuasive & confident',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    accent: 'Indian English / Universal Neutral',
    sample: 'Hello! I am calling from Bluesquare Infra regarding your recent site visit inquiry. How can I assist with your property search today?'
  },
  {
    id: 'Puck',
    name: 'Puck',
    role: 'Luxury Sales & Speed-to-Lead',
    gender: 'Male',
    tone: 'Upbeat, clear, welcoming & energetic',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    accent: 'Modern Professional Neutral',
    sample: 'Hi there! Thank you for checking out our luxury sky villas. I’d love to walk you through our pre-launch payment plans.'
  },
  {
    id: 'Kore',
    name: 'Kore',
    role: 'Consultative Support & Qualification',
    gender: 'Female',
    tone: 'Warm, empathetic, calming & reassuring',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    accent: 'Calm Executive Tone',
    sample: 'Namaste. Thank you for your interest in our project. Let me assist you with the exact floor dimensions and scheduled completion dates.'
  },
  {
    id: 'Charon',
    name: 'Charon',
    role: 'Executive Wealth & HNI Advisory',
    gender: 'Male',
    tone: 'Deep, resonant, measured & authoritative',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    accent: 'Senior Private Wealth Style',
    sample: 'Good day. We are extending a confidential pre-launch allocation for accredited institutional and HNI property investors.'
  },
  {
    id: 'Aoede',
    name: 'Aoede',
    role: 'Conversational Outreach & Follow-Up',
    gender: 'Female',
    tone: 'Melodic, friendly, conversational & personable',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    accent: 'Friendly Conversationalist',
    sample: 'Hi! Just checking in to see if you received the floor plan brochure we sent over WhatsApp earlier today?'
  }
]

interface AiCallingViewProps {
  flows?: any[]
}

export function AiCallingAutomationsView({ flows = [] }: AiCallingViewProps) {
  const [rules, setRules] = useState<AiCallingRule[]>(DEFAULT_AI_CALLING_RULES)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all')
  const [selectedVoice, setSelectedVoice] = useState<string>('Fenrir')
  const [isPlayingSample, setIsPlayingSample] = useState<string | null>(null)
  
  // Editor Modal
  const [editingRule, setEditingRule] = useState<AiCallingRule | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [testNumber, setTestNumber] = useState('+91 98765 43210')
  const [isTestingCall, setIsTestingCall] = useState(false)

  const filteredRules = rules.filter(r => {
    if (statusFilter === 'active' && !r.isActive) return false
    if (statusFilter === 'paused' && r.isActive) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchName = r.name.toLowerCase().includes(q)
      const matchObjective = r.objective.toLowerCase().includes(q)
      const matchVoice = r.voiceAgent.toLowerCase().includes(q)
      if (!matchName && !matchObjective && !matchVoice) return false
    }
    return true
  })

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => {
      if (r.id === id) {
        const next = !r.isActive
        toast.success(next ? `AI Calling rule "${r.name}" enabled` : `AI Calling rule "${r.name}" paused`)
        return { ...r, isActive: next }
      }
      return r
    }))
  }

  const handleDeleteRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
    toast.success('AI Calling rule deleted')
  }

  const handlePlayVoiceSample = (voiceId: string) => {
    if (isPlayingSample === voiceId) {
      setIsPlayingSample(null)
      return
    }
    setIsPlayingSample(voiceId)
    toast.info(`Playing preview for voice: ${voiceId}`)
    setTimeout(() => {
      setIsPlayingSample(null)
    }, 3500)
  }

  const handleTestCall = () => {
    if (!testNumber.trim()) {
      toast.error('Please enter a valid phone number to test call')
      return
    }
    setIsTestingCall(true)
    setTimeout(() => {
      setIsTestingCall(false)
      toast.success(`⚡ Live Test Call initiated to ${testNumber} with voice agent "${selectedVoice}"! Pick up your phone.`)
    }, 1800)
  }

  const handleCreateNewRule = () => {
    setEditingRule({
      id: `call_rule_${Date.now()}`,
      name: 'New Outbound AI Voice Calling Automation',
      triggerSource: 'meta_ad',
      triggerLabel: 'New Lead Submission',
      voiceAgent: 'Fenrir',
      voiceTone: 'Crisp, focused & persuasive outbound telecaller',
      delaySeconds: 60,
      objective: 'Qualify lead intent and confirm appointment date',
      firstLine: 'Hello {{lead.name}}, calling from the property sales desk regarding your recent inquiry.',
      questions: [
        {
          id: `q_${Date.now()}`,
          question: 'Are you looking to book a private site visit this week?',
          fieldKey: 'site_visit_interest',
          passCriteria: 'Yes / Interested'
        }
      ],
      transferNumber: '+91 98765 43210',
      onPassActions: {
        crmStage: 'Site Visit Planned',
        sendWhatsAppBrochure: true,
        alertAdmin: true
      },
      isActive: false, // Default PAUSED as instructed
      stats: { callsPlaced: 0, connected: 0, qualified: 0, avgDuration: '0s' },
      lastCallAt: 'Never'
    })
    setIsEditorOpen(true)
  }

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRule) return

    setRules(prev => {
      const idx = prev.findIndex(r => r.id === editingRule.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = editingRule
        return next
      }
      return [editingRule, ...prev]
    })

    setIsEditorOpen(false)
    setEditingRule(null)
    toast.success('AI Calling automation rule saved')
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 rounded-2xl p-5 sm:p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider bg-white/20 text-white rounded-full border border-white/30 backdrop-blur-xs">
                Gemini 3.1 Flash Live
              </span>
              <span className="text-xs text-indigo-100 font-semibold flex items-center gap-1">
                <Radio size={12} className="text-emerald-300 animate-pulse" /> Telephony Engine Ready
              </span>
            </div>
            
            <h2 className="text-xl sm:text-2xl font-black tracking-tight">
              AI Outbound Calling & Telephony Automations
            </h2>
            <p className="text-xs sm:text-sm text-indigo-100 leading-relaxed">
              Trigger autonomous conversational outbound phone calls using Google Gemini 3.1 Flash Live voices. Qualify prospect interest, capture budget, answer inquiries, and transfer hot calls to human closers in under 60 seconds.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={handleCreateNewRule}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-white text-indigo-700 hover:bg-indigo-50 font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <Plus size={16} />
              <span>New Calling Rule</span>
            </button>
          </div>
        </div>

        {/* Telephony KPI Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-white/15">
          <div>
            <div className="text-[11px] font-semibold text-indigo-200">Active Calling Rules</div>
            <div className="text-lg sm:text-xl font-black text-white mt-0.5">
              {rules.filter(r => r.isActive).length} Active <span className="text-xs font-normal text-indigo-200">({rules.filter(r => !r.isActive).length} paused)</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-indigo-200">Total Outbound Calls</div>
            <div className="text-lg sm:text-xl font-black text-white mt-0.5">1,565 Calls</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-indigo-200">Connection Rate</div>
            <div className="text-lg sm:text-xl font-black text-emerald-300 mt-0.5">85.6% Pick-Up</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-indigo-200">Qualified Leads</div>
            <div className="text-lg sm:text-xl font-black text-white mt-0.5">569 Qualified</div>
          </div>
        </div>
      </div>

      {/* Voice Studio: Gemini 3.1 Flash Live Selector */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-indigo-600" />
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                Gemini 3.1 Flash Live Voice Studio
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Select and preview ultra-low latency conversational voices powering your automated campaigns
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input 
              type="text" 
              value={testNumber} 
              onChange={e => setTestNumber(e.target.value)}
              placeholder="Your mobile (+91...)"
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 w-36 sm:w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <button
              onClick={handleTestCall}
              disabled={isTestingCall}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
            >
              {isTestingCall ? (
                <span>Calling...</span>
              ) : (
                <>
                  <Phone size={13} />
                  <span>Test Call</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {GEMINI_VOICE_STUDIO.map(voice => {
            const isSelected = selectedVoice === voice.id
            const isPlaying = isPlayingSample === voice.id
            return (
              <div
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected 
                    ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-600/10' 
                    : 'border-slate-200/80 bg-slate-50/50 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-xs font-bold text-slate-900">{voice.name}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${voice.badge}`}>
                      {voice.gender}
                    </span>
                  </div>
                  <div className="text-[11px] font-semibold text-slate-600 line-clamp-1">{voice.role}</div>
                  <div className="text-[10px] text-slate-400 mt-1 leading-tight">{voice.tone}</div>
                </div>

                <div className="pt-3 mt-2 border-t border-slate-200/60 flex items-center justify-between">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePlayVoiceSample(voice.id)
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors ${
                      isPlaying 
                        ? 'bg-indigo-600 text-white' 
                        : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'
                    }`}
                  >
                    <Volume2 size={11} className={isPlaying ? 'animate-bounce' : ''} />
                    <span>{isPlaying ? 'Playing...' : 'Preview'}</span>
                  </button>
                  {isSelected && (
                    <span className="text-[10px] font-bold text-indigo-600 flex items-center gap-0.5">
                      <CheckCircle2 size={12} /> Active
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Rules Filter & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <PhoneCall size={18} className="text-slate-500" />
          <h3 className="text-base font-bold text-slate-900">
            Outbound Calling Rules ({filteredRules.length})
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search calling rules..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white w-48 sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold text-slate-600">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${statusFilter === 'all' ? 'bg-white shadow-2xs text-slate-900 font-bold' : ''}`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${statusFilter === 'active' ? 'bg-white shadow-2xs text-emerald-700 font-bold' : ''}`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter('paused')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${statusFilter === 'paused' ? 'bg-white shadow-2xs text-amber-700 font-bold' : ''}`}
            >
              Paused
            </button>
          </div>
        </div>
      </div>

      {/* Rules List */}
      <div className="space-y-4">
        {filteredRules.map(rule => (
          <div 
            key={rule.id}
            className={`bg-white rounded-2xl border transition-all p-5 shadow-xs hover:shadow-md ${
              rule.isActive ? 'border-indigo-300 ring-1 ring-indigo-500/10' : 'border-slate-200/80 opacity-90'
            }`}
          >
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="space-y-2.5 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                    rule.isActive 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {rule.isActive ? 'Active & Live' : 'Paused (Inactive)'}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                    Voice: {rule.voiceAgent}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Delay: {rule.delaySeconds === 0 ? 'Instant' : `${rule.delaySeconds}s`}
                  </span>
                </div>

                <div>
                  <h4 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                    {rule.name}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="font-semibold text-slate-700">Trigger:</span> {rule.triggerLabel}
                  </p>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-1.5 text-xs">
                  <div className="text-slate-600">
                    <span className="font-bold text-slate-800">First Greeting:</span> "{rule.firstLine}"
                  </div>
                  <div className="text-slate-500 text-[11px] flex flex-wrap items-center gap-3 pt-1">
                    <span>Questions: <strong className="text-slate-700">{rule.questions.length}</strong></span>
                    <span>Handoff: <strong className="text-slate-700">{rule.transferNumber || 'None'}</strong></span>
                    <span>CRM Stage on Pass: <strong className="text-indigo-600">{rule.onPassActions.crmStage}</strong></span>
                  </div>
                </div>
              </div>

              {/* Action Buttons & Toggle */}
              <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between lg:justify-start gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    {rule.isActive ? 'Running' : 'Paused'}
                  </span>
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`w-11 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                      rule.isActive ? 'bg-emerald-600' : 'bg-slate-300'
                    }`}
                  >
                    <span 
                      className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                        rule.isActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setEditingRule(rule)
                      setIsEditorOpen(true)
                    }}
                    className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Edit Rule"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Delete Rule"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {/* Mini Stats */}
                <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-500 mt-2">
                  <span>{rule.stats.callsPlaced} calls</span>
                  <span>•</span>
                  <span className="text-emerald-600 font-semibold">{rule.stats.qualified} qualified</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Editor Modal */}
      {isEditorOpen && editingRule && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <PhoneCall size={18} className="text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Configure AI Calling Rule
                </h3>
              </div>
              <button 
                onClick={() => setIsEditorOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Rule Name</label>
                <input
                  type="text"
                  value={editingRule.name}
                  onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Trigger Event</label>
                  <select
                    value={editingRule.triggerSource}
                    onChange={e => setEditingRule({ ...editingRule, triggerSource: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none"
                  >
                    <option value="meta_ad">Meta Ad Form Submission</option>
                    <option value="portal_webhook">Housing.com / 99Acres Inbound</option>
                    <option value="landing_page">Landing Page Callback Request</option>
                    <option value="csv_list">CSV Lead List Bulk Outbound</option>
                    <option value="crm_stage">CRM Stage Changed</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Gemini Live Voice</label>
                  <select
                    value={editingRule.voiceAgent}
                    onChange={e => setEditingRule({ ...editingRule, voiceAgent: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none"
                  >
                    <option value="Fenrir">Fenrir (Crisp & Persuasive)</option>
                    <option value="Puck">Puck (Upbeat & Engaging)</option>
                    <option value="Kore">Kore (Warm & Consultative)</option>
                    <option value="Charon">Charon (Deep & Authoritative)</option>
                    <option value="Aoede">Aoede (Melodic & Friendly)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Delay Before Calling (seconds)</label>
                <input
                  type="number"
                  min={0}
                  max={3600}
                  value={editingRule.delaySeconds}
                  onChange={e => setEditingRule({ ...editingRule, delaySeconds: parseInt(e.target.value) || 0 })}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Set to 0 for instant callback, or 60s for natural speed-to-lead.
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">First Opening Line / Greet</label>
                <textarea
                  rows={2}
                  value={editingRule.firstLine}
                  onChange={e => setEditingRule({ ...editingRule, firstLine: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Human Closer Transfer Number</label>
                <input
                  type="text"
                  value={editingRule.transferNumber || ''}
                  onChange={e => setEditingRule({ ...editingRule, transferNumber: e.target.value })}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none"
                />
              </div>

              {/* Status Toggle in Modal - default false */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Automation Active State</span>
                  <span className="text-[11px] text-slate-500">Controls whether this rule executes on live inbound leads</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRule({ ...editingRule, isActive: !editingRule.isActive })}
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
                    editingRule.isActive ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <span 
                    className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                      editingRule.isActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-sm cursor-pointer"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
