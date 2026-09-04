'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  Sparkles, 
  Plus, 
  Trash2, 
  Loader2, 
  ArrowLeft, 
  Info, 
  CheckCircle2, 
  ListTodo,
  Tag,
  X,
  RotateCcw,
  Layers,
  Link2,
  Edit2,
  Check,
  Search,
  ChevronDown,
  Megaphone,
  CheckCircle,
  HelpCircle
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

interface QualifyingQuestionItem {
  question: string
  options: string[]
}

interface QuestionFlow {
  id?: string
  name: string
  linked_campaign_id?: string | null
  is_active?: boolean
  questions: QualifyingQuestionItem[]
}

interface CampaignOption {
  id: string
  name: string
  status?: string
  objective?: string
}

const REAL_ESTATE_DEFAULT_QUESTIONS: QualifyingQuestionItem[] = [
  {
    question: 'What type of property are you interested in?',
    options: ['Residential', 'Commercial', 'Plots / Land']
  },
  {
    question: 'What is your budget range?',
    options: ['Under ₹50 Lacs', '₹50L - ₹1.5 Cr', 'Above ₹1.5 Cr']
  },
  {
    question: 'What is your purchase timeline?',
    options: ['Immediate (<1 Mo)', '1 - 3 Months', 'Exploring']
  }
]

export default function QualifyingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [qualifyingEnabled, setQualifyingEnabled] = useState(true)
  
  // Flows management
  const [flows, setFlows] = useState<QuestionFlow[]>([])
  const [activeFlowIndex, setActiveFlowIndex] = useState<number>(0)
  
  // New question & option inputs for current active flow
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newOptionInputs, setNewOptionInputs] = useState<Record<number, string>>({})
  
  // New Flow creation modal/inline state
  const [isCreatingFlow, setIsCreatingFlow] = useState(false)
  const [newFlowName, setNewFlowName] = useState('')
  const [newFlowCampaignId, setNewFlowCampaignId] = useState('')

  // Campaigns list & searchable dropdown state
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [isCampaignDropdownOpen, setIsCampaignDropdownOpen] = useState(false)
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('')
  const [isCustomCampaignInput, setIsCustomCampaignInput] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string>('admin')

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsCampaignDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    async function loadData() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/')
          return
        }

        let targetUserId = user.id
        
        const { data: authProfile } = await supabase
          .from('profiles')
          .select('role, agency_id, parent_id')
          .eq('id', user.id)
          .single()
        
        const currentRole = authProfile?.role || 'admin'
        setUserRole(currentRole)

        if (impersonateId && ['super_admin', 'agency'].includes(currentRole)) {
          targetUserId = impersonateId
        }

        setUserId(targetUserId)

        // 1. Fetch Profile status
        const { data: profile } = await supabase
          .from('profiles')
          .select('qualifying_enabled, qualifying_questions')
          .eq('id', targetUserId)
          .single()

        if (profile) {
          setQualifyingEnabled(profile.qualifying_enabled !== false)
        }

        // 2. Fetch all Question Flows from database
        const { data: dbFlows, error: flowsErr } = await supabase
          .from('whatsapp_question_flows')
          .select('*')
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: true })

        if (!flowsErr && dbFlows && dbFlows.length > 0) {
          const formattedFlows: QuestionFlow[] = dbFlows.map((df: any) => ({
            id: df.id,
            name: df.name,
            linked_campaign_id: df.linked_campaign_id,
            is_active: df.is_active,
            questions: Array.isArray(df.questions) ? df.questions : REAL_ESTATE_DEFAULT_QUESTIONS
          }))
          setFlows(formattedFlows)
        } else {
          // Initialize default Real Estate Flow if none exists
          const defaultFlow: QuestionFlow = {
            name: 'General Real Estate Flow',
            linked_campaign_id: null,
            is_active: true,
            questions: REAL_ESTATE_DEFAULT_QUESTIONS
          }
          setFlows([defaultFlow])
        }

        // 3. Fetch running Meta campaigns + leads campaigns in background
        loadCampaignsList(targetUserId)
      } catch (err) {
        console.error("Failed to load qualification settings:", err)
        toast.error("Failed to load settings")
      } finally {
        setLoading(false)
      }
    }

    async function loadCampaignsList(targetUserId: string) {
      setLoadingCampaigns(true)
      try {
        const campaignMap = new Map<string, CampaignOption>()

        // A. Meta API Campaigns
        try {
          const res = await fetch(`/api/meta-ads/campaigns${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
          if (res.ok) {
            const data = await res.json()
            if (data?.campaigns && Array.isArray(data.campaigns)) {
              data.campaigns.forEach((c: any) => {
                if (c.id) {
                  campaignMap.set(c.id, {
                    id: String(c.id),
                    name: c.name || `Campaign ${c.id}`,
                    status: c.status || 'ACTIVE',
                    objective: c.objective || ''
                  })
                }
              })
            }
          }
        } catch (apiErr) {
          console.warn("Meta campaigns API fetch error:", apiErr)
        }

        // B. CRM Leads distinct campaigns
        try {
          const { data: leadCamps } = await supabase
            .from('leads')
            .select('campaign_id, ad_name')
            .eq('user_id', targetUserId)
            .not('campaign_id', 'is', null)
            .limit(100)

          if (leadCamps) {
            leadCamps.forEach((lc: any) => {
              if (lc.campaign_id && !campaignMap.has(lc.campaign_id)) {
                campaignMap.set(lc.campaign_id, {
                  id: String(lc.campaign_id),
                  name: lc.ad_name ? `Ad: ${lc.ad_name}` : `Campaign ${lc.campaign_id}`,
                  status: 'CRM'
                })
              }
            })
          }
        } catch (crmErr) {
          console.warn("CRM leads campaign fetch error:", crmErr)
        }

        // C. Voice Campaigns
        try {
          const { data: voiceCamps } = await supabase
            .from('voice_campaigns')
            .select('id, name, status')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false })
            .limit(100)

          if (voiceCamps) {
            voiceCamps.forEach((vc: any) => {
              if (vc.id) {
                campaignMap.set(vc.id, {
                  id: String(vc.id),
                  name: `🎙️ Voice: ${vc.name || 'Campaign'}`,
                  status: vc.status ? vc.status.toUpperCase() : 'VOICE'
                })
              }
            })
          }
        } catch (voiceErr) {
          console.warn("Voice campaigns fetch error:", voiceErr)
        }

        setCampaigns(Array.from(campaignMap.values()))
      } catch (err) {
        console.error("Error loading campaigns list:", err)
      } finally {
        setLoadingCampaigns(false)
      }
    }

    loadData()
  }, [impersonateId])

  const currentFlow = flows[activeFlowIndex] || flows[0] || {
    name: 'General Flow',
    questions: REAL_ESTATE_DEFAULT_QUESTIONS
  }

  const isCurrentFlowDefault = !currentFlow.linked_campaign_id || currentFlow.linked_campaign_id === '' || currentFlow.linked_campaign_id === 'null'

  const selectedCampaignName = (() => {
    if (isCurrentFlowDefault) return 'None (Default Fallback Flow)'
    const matched = campaigns.find(c => c.id === currentFlow.linked_campaign_id)
    if (matched) return matched.name
    return `Campaign ID: ${currentFlow.linked_campaign_id}`
  })()

  const filteredCampaigns = campaigns.filter(c => 
    c.name.toLowerCase().includes(campaignSearchQuery.toLowerCase()) ||
    c.id.toLowerCase().includes(campaignSearchQuery.toLowerCase())
  )

  const handleSelectCampaign = (campId: string | null) => {
    const updated = [...flows]
    updated[activeFlowIndex].linked_campaign_id = campId || null
    setFlows(updated)
    setIsCampaignDropdownOpen(false)
    setCampaignSearchQuery('')
    setIsCustomCampaignInput(false)
  }

  const handleSaveAll = async () => {
    if (!userId) return
    setIsSaving(true)

    try {
      // 1. Save global toggle in profile
      await supabase
        .from('profiles')
        .update({
          qualifying_enabled: qualifyingEnabled,
          qualifying_questions: currentFlow.questions
        })
        .eq('id', userId)

      // 2. Save flows to whatsapp_question_flows table
      for (const flow of flows) {
        if (flow.id) {
          await supabase
            .from('whatsapp_question_flows')
            .update({
              name: flow.name,
              linked_campaign_id: flow.linked_campaign_id || null,
              is_active: flow.is_active || false,
              questions: flow.questions
            })
            .eq('id', flow.id)
            .eq('user_id', userId)
        } else {
          const { data: created } = await supabase
            .from('whatsapp_question_flows')
            .insert({
              user_id: userId,
              name: flow.name,
              linked_campaign_id: flow.linked_campaign_id || null,
              is_active: flow.is_active || false,
              questions: flow.questions
            })
            .select('id')
            .single()
          
          if (created) flow.id = created.id
        }
      }

      toast.success("Qualification Flows & Questions saved successfully!")
    } catch (err) {
      console.error("Failed to save settings:", err)
      toast.error("Failed to save settings")
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateNewFlow = () => {
    if (!newFlowName.trim()) return
    const newFlow: QuestionFlow = {
      name: newFlowName.trim(),
      linked_campaign_id: newFlowCampaignId.trim() || null,
      is_active: false,
      questions: [
        { question: 'What type of property are you interested in?', options: ['Residential', 'Commercial', 'Plots'] },
        { question: 'What is your budget range?', options: ['Under ₹50L', '₹50L - ₹1.5 Cr', 'Above ₹1.5 Cr'] },
        { question: 'What is your purchase timeline?', options: ['Immediate', '1 - 3 Months', 'Exploring'] }
      ]
    }
    const updated = [...flows, newFlow]
    setFlows(updated)
    setActiveFlowIndex(updated.length - 1)
    setNewFlowName('')
    setNewFlowCampaignId('')
    setIsCreatingFlow(false)
    toast.success(`Created "${newFlow.name}" flow!`)
  }

  const handleDeleteFlow = async (idx: number) => {
    if (flows.length <= 1) {
      toast.error("You must have at least one qualification flow.")
      return
    }
    const flowToDelete = flows[idx]
    if (flowToDelete.id && userId) {
      await supabase
        .from('whatsapp_question_flows')
        .delete()
        .eq('id', flowToDelete.id)
        .eq('user_id', userId)
    }
    const updated = flows.filter((_, i) => i !== idx)
    setFlows(updated)
    setActiveFlowIndex(Math.max(0, idx - 1))
    toast.success("Flow removed.")
  }

  const handleAddQuestion = () => {
    if (!newQuestionText.trim()) return
    const updated = [...flows]
    updated[activeFlowIndex].questions.push({ question: newQuestionText.trim(), options: [] })
    setFlows(updated)
    setNewQuestionText('')
  }

  const handleRemoveQuestion = (qIdx: number) => {
    const updated = [...flows]
    updated[activeFlowIndex].questions = updated[activeFlowIndex].questions.filter((_, i) => i !== qIdx)
    setFlows(updated)
  }

  const handleUpdateQuestionText = (qIdx: number, text: string) => {
    const updated = [...flows]
    updated[activeFlowIndex].questions[qIdx].question = text
    setFlows(updated)
  }

  const handleAddOption = (qIdx: number) => {
    const optText = (newOptionInputs[qIdx] || '').trim()
    if (!optText) return
    const updated = [...flows]
    if (!updated[activeFlowIndex].questions[qIdx].options.includes(optText)) {
      updated[activeFlowIndex].questions[qIdx].options.push(optText)
    }
    setFlows(updated)
    setNewOptionInputs({ ...newOptionInputs, [qIdx]: '' })
  }

  const handleRemoveOption = (qIdx: number, optIdx: number) => {
    const updated = [...flows]
    updated[activeFlowIndex].questions[qIdx].options = updated[activeFlowIndex].questions[qIdx].options.filter((_, i) => i !== optIdx)
    setFlows(updated)
  }

  const handleResetToRealEstate = () => {
    const updated = [...flows]
    updated[activeFlowIndex].questions = REAL_ESTATE_DEFAULT_QUESTIONS
    setFlows(updated)
    toast.success("Loaded Real Estate Template questions & options!")
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 pb-48 sm:pb-56">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
          className="p-2.5 hover:bg-slate-100 rounded-full transition-colors active:scale-95 shrink-0 border border-slate-200"
        >
          <ArrowLeft size={16} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">Campaign Qualification Flows & Questions</h1>
          <p className="text-xs text-slate-500 font-medium">Create and link different qualification question flows to your active ad campaigns or use as default fallback.</p>
        </div>
      </div>

      {/* Fallback info card */}
      <div className="mb-6 p-4 rounded-2xl bg-blue-50/70 border border-blue-200/80 flex items-start gap-3">
        <HelpCircle size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-950">
          <span className="font-bold">How Default & Campaign Flows Work:</span> Any flow set with <span className="font-bold bg-white px-2 py-0.5 rounded-md border border-blue-200 text-blue-700">None (Default Fallback Flow)</span> will automatically run for all general, direct, and unlinked campaign leads. When a lead arrives from a specific Meta Ad Campaign linked below, that campaign's custom questions and budget tiers will run instead.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Flows List & Campaign Link */}
        <div className="md:col-span-1 space-y-6">
          {/* Flows Selector Panel */}
          <div className="bg-white rounded-[2rem] border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Layers size={18} />
                </div>
                <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Qualification Flows</h3>
              </div>
              {userRole !== 'agent' && (
                <button
                  type="button"
                  onClick={() => setIsCreatingFlow(true)}
                  className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-all active:scale-95 flex items-center gap-1"
                >
                  <Plus size={12} /> New Flow
                </button>
              )}
            </div>

            {/* Create Flow Form */}
            {isCreatingFlow && (
              <div className="bg-blue-50/60 p-3.5 rounded-2xl border border-blue-200/80 space-y-2 animate-in fade-in">
                <p className="text-[11px] font-bold text-blue-900">Create Campaign Flow</p>
                <input
                  type="text"
                  placeholder="Flow Name (e.g. ₹1 Cr Luxury Villa Ad)"
                  value={newFlowName}
                  onChange={(e) => setNewFlowName(e.target.value)}
                  className="w-full bg-white text-xs py-1.5 px-3 rounded-xl border border-slate-200 outline-none"
                />
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCreateNewFlow}
                    className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-lg hover:bg-blue-700 active:scale-95"
                  >
                    Save Flow
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingFlow(false)}
                    className="bg-slate-200 text-slate-700 text-xs font-bold px-3 py-1 rounded-lg hover:bg-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Flows Tabs / List */}
            <div className="space-y-2">
              {flows.map((fl, idx) => {
                const isDefault = !fl.linked_campaign_id || fl.linked_campaign_id === '' || fl.linked_campaign_id === 'null'
                const matchedCamp = campaigns.find(c => c.id === fl.linked_campaign_id)
                const label = isDefault ? '🌟 Default Fallback Flow' : (matchedCamp ? `🔗 ${matchedCamp.name}` : `🔗 Campaign: ${fl.linked_campaign_id}`)

                return (
                  <div
                    key={idx}
                    onClick={() => setActiveFlowIndex(idx)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                      activeFlowIndex === idx
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/70'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-xs truncate">{fl.name}</p>
                      <p className={`text-[10px] font-medium truncate ${activeFlowIndex === idx ? 'text-blue-100' : 'text-slate-500'}`}>
                        {label}
                      </p>
                    </div>
                    {flows.length > 1 && userRole !== 'agent' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteFlow(idx)
                        }}
                        className={`p-1.5 rounded-lg transition-colors active:scale-90 ${
                          activeFlowIndex === idx ? 'text-white/80 hover:text-white hover:bg-blue-700' : 'text-slate-400 hover:text-red-500'
                        }`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Flow Settings & Searchable Campaign Link */}
          <div className="bg-white rounded-[2rem] border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <Link2 size={18} />
              </div>
              <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Flow Campaign Link</h3>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Flow Name</label>
                <input
                  type="text"
                  value={currentFlow.name}
                  onChange={(e) => {
                    const updated = [...flows]
                    updated[activeFlowIndex].name = e.target.value
                    setFlows(updated)
                  }}
                  disabled={userRole === 'agent'}
                  className="w-full bg-slate-50 font-bold text-xs text-slate-800 py-2.5 px-3 rounded-xl border border-slate-200 outline-none focus:border-blue-400"
                />
              </div>

              {/* Searchable Campaign Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Link to Meta Campaign
                </label>

                {!isCustomCampaignInput ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setIsCampaignDropdownOpen(!isCampaignDropdownOpen)}
                      disabled={userRole === 'agent'}
                      className="w-full bg-slate-50 hover:bg-slate-100/80 text-left text-xs font-semibold text-slate-800 py-2.5 px-3 rounded-xl border border-slate-200 flex items-center justify-between transition-all"
                    >
                      <span className="truncate pr-2 flex items-center gap-1.5">
                        {isCurrentFlowDefault ? (
                          <span className="text-blue-700 font-bold">🌟 None (Default Fallback Flow)</span>
                        ) : (
                          <span className="text-slate-800 font-bold">🔗 {selectedCampaignName}</span>
                        )}
                      </span>
                      <ChevronDown size={14} className="text-slate-400 shrink-0" />
                    </button>

                    {isCampaignDropdownOpen && (
                      <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 space-y-1.5 animate-in fade-in max-h-72 flex flex-col">
                        {/* Search Input */}
                        <div className="relative">
                          <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Search campaigns by name or ID..."
                            value={campaignSearchQuery}
                            onChange={(e) => setCampaignSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 rounded-xl border border-slate-200 outline-none focus:border-blue-400"
                            autoFocus
                          />
                        </div>

                        {/* List */}
                        <div className="overflow-y-auto space-y-1 pr-1 flex-1">
                          {/* Option 1: Default / None */}
                          <div
                            onClick={() => handleSelectCampaign(null)}
                            className={`p-2.5 rounded-xl cursor-pointer text-xs font-semibold flex items-center justify-between transition-colors ${
                              isCurrentFlowDefault ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div>
                              <p className="font-bold flex items-center gap-1">🌟 None (Default Fallback Flow)</p>
                              <p className="text-[10px] text-slate-400">Runs when no specific campaign matches</p>
                            </div>
                            {isCurrentFlowDefault && <Check size={14} className="text-blue-600 shrink-0" />}
                          </div>

                          {/* Campaigns List */}
                          {filteredCampaigns.map((c) => {
                            const isSelected = currentFlow.linked_campaign_id === c.id
                            return (
                              <div
                                key={c.id}
                                onClick={() => handleSelectCampaign(c.id)}
                                className={`p-2.5 rounded-xl cursor-pointer text-xs flex items-center justify-between transition-colors ${
                                  isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
                                }`}
                              >
                                <div className="min-w-0 pr-2">
                                  <p className="font-bold truncate">{c.name}</p>
                                  <p className="text-[10px] text-slate-400 font-mono truncate">ID: {c.id} {c.status ? `• ${c.status}` : ''}</p>
                                </div>
                                {isSelected && <Check size={14} className="text-blue-600 shrink-0" />}
                              </div>
                            )
                          })}

                          {filteredCampaigns.length === 0 && (
                            <p className="text-[11px] text-slate-400 text-center py-2 italic">
                              {loadingCampaigns ? 'Loading campaigns...' : 'No matching campaigns found'}
                            </p>
                          )}
                        </div>

                        {/* Custom ID toggle */}
                        <div className="pt-1.5 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomCampaignInput(true)
                              setIsCampaignDropdownOpen(false)
                            }}
                            className="w-full text-left text-[11px] font-bold text-blue-600 hover:text-blue-700 p-1.5 rounded-lg hover:bg-blue-50 flex items-center gap-1"
                          >
                            <Edit2 size={11} /> Enter Manual Campaign ID
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={currentFlow.linked_campaign_id || ''}
                      onChange={(e) => {
                        const updated = [...flows]
                        updated[activeFlowIndex].linked_campaign_id = e.target.value
                        setFlows(updated)
                      }}
                      placeholder="e.g. 120210493829012"
                      disabled={userRole === 'agent'}
                      className="w-full bg-slate-50 text-xs text-slate-800 py-2.5 px-3 rounded-xl border border-slate-200 outline-none focus:border-blue-400 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setIsCustomCampaignInput(false)}
                      className="text-[10px] font-bold text-slate-500 hover:text-slate-700 underline"
                    >
                      ← Back to Campaign Dropdown
                    </button>
                  </div>
                )}

                <p className="text-[10px] text-slate-400 mt-1">
                  {isCurrentFlowDefault 
                    ? '🌟 Default Flow will run for all unlinked campaigns & organic leads.' 
                    : `Leads from this campaign will specifically be asked this flow's questions.`}
                </p>
              </div>

              <div className="pt-2">
                <label className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100/50 rounded-xl border border-slate-200 transition-colors cursor-pointer">
                  <span className="text-xs font-bold text-slate-700">Enable AI Qualification</span>
                  <div className="relative inline-flex items-center">
                    <input 
                      type="checkbox" 
                      checked={qualifyingEnabled} 
                      onChange={(e) => setQualifyingEnabled(e.target.checked)}
                      disabled={userRole === 'agent'}
                      className="sr-only peer" 
                    />
                    <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100">
              <button
                onClick={handleSaveAll}
                disabled={isSaving || userRole === 'agent'}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-3.5 px-5 rounded-full transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 shadow-md"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                {isSaving ? 'Saving...' : 'Save All Flows & Questions'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Questions & Multiple-Choice Options for Selected Flow */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-[2rem] border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                  <ListTodo size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-slate-800">{currentFlow.name}</h3>
                    {isCurrentFlowDefault && (
                      <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded-full">
                        DEFAULT FLOW
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                    {isCurrentFlowDefault ? 'Runs for all general & unlinked leads' : `Linked to: ${selectedCampaignName}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResetToRealEstate}
                className="text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl transition-all active:scale-95 shrink-0 flex items-center gap-1.5"
              >
                <RotateCcw size={12} /> Reset Template
              </button>
            </div>

            {/* Questions List */}
            <div className="space-y-4 mb-6">
              {currentFlow.questions.length === 0 ? (
                <div className="text-center py-10 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <p className="text-xs text-slate-400 italic font-medium">No questions added yet. Add a question below.</p>
                </div>
              ) : (
                currentFlow.questions.map((q, qIdx) => (
                  <div key={qIdx} className="bg-slate-50/70 p-5 rounded-2xl border border-slate-200/80 space-y-3.5">
                    {/* Question Row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                          {qIdx + 1}
                        </span>
                        <input
                          type="text"
                          value={q.question}
                          onChange={(e) => handleUpdateQuestionText(qIdx, e.target.value)}
                          disabled={userRole === 'agent'}
                          placeholder={`Question #${qIdx + 1}`}
                          className="w-full bg-white font-bold text-xs text-slate-800 py-2.5 px-3 rounded-xl border border-slate-200 focus:border-blue-400 outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={userRole === 'agent'}
                        onClick={() => handleRemoveQuestion(qIdx)}
                        className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-white transition-colors active:scale-90 shrink-0"
                        title="Delete Question"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    {/* Options Chips */}
                    <div className="pl-8 space-y-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Tag size={10} /> Multiple-Choice Choices:
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        {q.options.map((opt, optIdx) => (
                          <span 
                            key={optIdx} 
                            className="inline-flex items-center gap-1.5 bg-white text-blue-700 border border-blue-200 text-xs font-semibold px-3 py-1.5 rounded-xl shadow-xs"
                          >
                            {opt}
                            {userRole !== 'agent' && (
                              <button
                                type="button"
                                onClick={() => handleRemoveOption(qIdx, optIdx)}
                                className="hover:text-red-500 rounded-full p-0.5 transition-colors"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>

                      {/* Add Option Input */}
                      {userRole !== 'agent' && (
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            value={newOptionInputs[qIdx] || ''}
                            onChange={(e) => setNewOptionInputs({ ...newOptionInputs, [qIdx]: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleAddOption(qIdx)
                              }
                            }}
                            placeholder="Add choice (e.g. 2 BHK, ₹1 Cr - ₹1.5 Cr)"
                            className="bg-white text-xs py-2 px-3 rounded-xl border border-slate-200 focus:border-blue-400 outline-none w-56"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddOption(qIdx)}
                            className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-xl transition-all active:scale-95 flex items-center gap-1"
                          >
                            <Plus size={12} /> Add Choice
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add New Question Row */}
            {userRole !== 'agent' && (
              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddQuestion()
                    }
                  }}
                  placeholder="Type new question text..."
                  className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-4 rounded-2xl text-slate-800 text-xs font-semibold outline-none border border-slate-200 focus:border-blue-400 transition-all shadow-xs"
                />
                <button
                  type="button"
                  onClick={handleAddQuestion}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-6 py-3.5 rounded-2xl shadow-md transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
                >
                  <Plus size={14} /> Add Question
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
