'use client'

import React, { useState } from 'react'
import { 
  MessageSquare, Plus, Search, Filter, Play, Pause, Trash2, Edit3, 
  Sparkles, Check, ArrowRight, CornerDownRight, Zap, CheckCircle2, 
  Send, Bot, Phone, RefreshCw, X, SlidersHorizontal, Smartphone
} from 'lucide-react'
import { InstagramIcon, FacebookIcon } from './suite-header'
import { toast } from 'sonner'

export interface DmAutomationRule {
  id: string
  name: string
  channels: ('whatsapp' | 'instagram' | 'messenger')[]
  matchType: 'contains' | 'exact' | 'starts_with' | 'story_mention' | 'fallback'
  keywords: string[]
  replyText: string
  actionType: 'reply_text' | 'trigger_flow' | 'ai_deepseek'
  triggerFlowId?: string
  triggerFlowName?: string
  buttons?: { label: string; action: string }[]
  isActive: boolean
  triggerCount: number
  deliveryRate: string
  lastTriggered: string
}

const DEFAULT_DM_RULES: DmAutomationRule[] = [
  {
    id: 'dm_welcome',
    name: 'New Conversation Greeting & Menu',
    channels: ['whatsapp', 'instagram', 'messenger'],
    matchType: 'starts_with',
    keywords: ['hi', 'hello', 'hey', 'start', 'namaste'],
    replyText: 'Hello! 👋 Welcome to Nobogent Real Estate Advisory. How can we assist you today?',
    actionType: 'trigger_flow',
    triggerFlowId: 'flow_lead_qualification',
    triggerFlowName: 'WhatsApp Lead Receptionist & Qualification',
    buttons: [
      { label: 'Explore Luxury Projects', action: 'explore' },
      { label: 'Book Site Visit', action: 'visit' },
      { label: 'Talk to Advisor', action: 'talk' }
    ],
    isActive: false, // Default PAUSED
    triggerCount: 1248,
    deliveryRate: '98.6%',
    lastTriggered: '3 mins ago'
  },
  {
    id: 'dm_pricing',
    name: 'Price & Brochure Delivery Auto-DM',
    channels: ['whatsapp', 'instagram'],
    matchType: 'contains',
    keywords: ['price', 'pricing', 'cost', 'rate', 'brochure', 'floor plan'],
    replyText: 'Here is the current unit pricing sheet and PDF brochure for Wave City & Mohali Luxury Enclave. Would you like a 3-bedroom or 4-bedroom layout?',
    actionType: 'trigger_flow',
    triggerFlowId: 'flow_portal_leads',
    triggerFlowName: 'Instant WhatsApp Speed-to-Lead Follow-up',
    buttons: [
      { label: 'Download PDF (8.4MB)', action: 'download' },
      { label: 'View 3D Virtual Tour', action: 'tour' }
    ],
    isActive: false, // Default PAUSED
    triggerCount: 894,
    deliveryRate: '99.2%',
    lastTriggered: '12 mins ago'
  },
  {
    id: 'dm_appointment',
    name: 'Instant Site Visit / Demo Booking',
    channels: ['whatsapp', 'messenger'],
    matchType: 'contains',
    keywords: ['visit', 'demo', 'book', 'appointment', 'schedule', 'consultation'],
    replyText: 'Great! Let me schedule an executive site visit with chauffeured pickup or an online consultation. Which day works best for you?',
    actionType: 'trigger_flow',
    triggerFlowId: 'flow_voice_call',
    triggerFlowName: 'Voice Call Callback & Live Calendar Booking',
    buttons: [
      { label: 'Book Tomorrow (11 AM)', action: 'slot_1' },
      { label: 'Book Weekend (3 PM)', action: 'slot_2' }
    ],
    isActive: false, // Default PAUSED
    triggerCount: 412,
    deliveryRate: '96.5%',
    lastTriggered: '1 hour ago'
  },
  {
    id: 'dm_story_mention',
    name: 'Instagram Story Mention VIP Reward',
    channels: ['instagram'],
    matchType: 'story_mention',
    keywords: ['@mention in story'],
    replyText: 'Thanks so much for the story shoutout! 🌟 As a VIP thank you, here is an exclusive 5% pre-launch reservation token: NOBO-VIP2026.',
    actionType: 'reply_text',
    buttons: [
      { label: 'Claim VIP Pass', action: 'claim' }
    ],
    isActive: false, // Default PAUSED
    triggerCount: 318,
    deliveryRate: '99.4%',
    lastTriggered: '2 hours ago'
  },
  {
    id: 'dm_fallback_ai',
    name: 'Off-Hours DeepSeek v4-flash AI Responder',
    channels: ['whatsapp', 'instagram', 'messenger'],
    matchType: 'fallback',
    keywords: ['[Default Fallback - No Keyword Matched]'],
    replyText: 'Our AI concierge powered by DeepSeek v4-flash is analyzing your query to provide instantaneous property details and answers.',
    actionType: 'ai_deepseek',
    isActive: false, // Default PAUSED
    triggerCount: 672,
    deliveryRate: '97.9%',
    lastTriggered: 'Just now'
  }
]

interface DmAutomationsViewProps {
  flows: any[]
  isCreateModalOpen?: boolean
  setIsCreateModalOpen?: (open: boolean) => void
}

export function DmAutomationsView({ flows }: DmAutomationsViewProps) {
  const [rules, setRules] = useState<DmAutomationRule[]>(DEFAULT_DM_RULES)
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'instagram' | 'messenger'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all')

  // Rule Editor Drawer State
  const [editingRule, setEditingRule] = useState<DmAutomationRule | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  
  // Interactive Simulator State
  const [isSimOpen, setIsSimOpen] = useState(false)
  const [simChannel, setSimChannel] = useState<'instagram' | 'whatsapp' | 'messenger'>('instagram')
  const [simInput, setSimInput] = useState('')
  const [simChat, setSimChat] = useState<Array<{ sender: 'user' | 'bot'; text: string; time: string; ruleMatch?: string; buttons?: string[] }>>([
    {
      sender: 'bot',
      text: 'Send any message or keyword (e.g. "price", "hello", "visit", "@mention") to test your automation rules live!',
      time: 'Just now'
    }
  ])

  const filteredRules = rules.filter(rule => {
    if (channelFilter !== 'all' && !rule.channels.includes(channelFilter)) return false
    if (statusFilter === 'active' && !rule.isActive) return false
    if (statusFilter === 'paused' && rule.isActive) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchName = rule.name.toLowerCase().includes(q)
      const matchKeywords = rule.keywords.some(k => k.toLowerCase().includes(q))
      const matchReply = rule.replyText.toLowerCase().includes(q)
      if (!matchName && !matchKeywords && !matchReply) return false
    }
    return true
  })

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => {
      if (r.id === id) {
        const next = !r.isActive
        toast.success(next ? `"${r.name}" enabled` : `"${r.name}" paused`)
        return { ...r, isActive: next }
      }
      return r
    }))
  }

  const handleDeleteRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
    toast.success('Automation rule deleted')
  }

  const handleCreateNew = () => {
    setEditingRule({
      id: `dm_${Date.now()}`,
      name: 'New DM Automation Rule',
      channels: ['whatsapp', 'instagram'],
      matchType: 'contains',
      keywords: ['inquire', 'info'],
      replyText: 'Thank you for reaching out! Here are the details you requested.',
      actionType: 'reply_text',
      isActive: false, // Default PAUSED
      triggerCount: 0,
      deliveryRate: '100%',
      lastTriggered: 'Never'
    })
    setIsEditorOpen(true)
  }

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRule) return

    setRules(prev => {
      const idx = prev.findIndex(r => r.id === editingRule.id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = editingRule
        return updated
      } else {
        return [editingRule, ...prev]
      }
    })
    setIsEditorOpen(false)
    toast.success('Automation rule saved successfully')
  }

  // Simulator message send
  const handleSendSimMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const text = simInput.trim()
    if (!text) return

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const userMsg = { sender: 'user' as const, text, time: now }
    setSimChat(prev => [...prev, userMsg])
    setSimInput('')

    // Match rule
    const lower = text.toLowerCase()
    let matched = rules.find(r => {
      if (!r.isActive) return false
      if (!r.channels.includes(simChannel)) return false
      if (r.matchType === 'story_mention' && lower.includes('@mention')) return true
      if (r.matchType === 'starts_with') {
        return r.keywords.some(k => lower.startsWith(k.toLowerCase()))
      }
      if (r.matchType === 'exact') {
        return r.keywords.some(k => lower === k.toLowerCase())
      }
      if (r.matchType === 'contains') {
        return r.keywords.some(k => lower.includes(k.toLowerCase()))
      }
      return false
    })

    if (!matched) {
      matched = rules.find(r => r.matchType === 'fallback' && r.isActive)
    }

    setTimeout(() => {
      if (matched) {
        setSimChat(prev => [
          ...prev,
          {
            sender: 'bot',
            text: matched!.replyText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            ruleMatch: matched!.name,
            buttons: matched!.buttons?.map(b => b.label)
          }
        ])
      } else {
        setSimChat(prev => [
          ...prev,
          {
            sender: 'bot',
            text: "No active automation rule matched your keyword. Add a fallback rule or specific keyword in the rule manager.",
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ])
      }
    }, 600)
  }

  return (
    <div className="space-y-6">
      {/* Top Banner / Simulator quick access */}
      <div className="bg-gradient-to-r from-violet-500/10 via-indigo-500/5 to-purple-500/10 border border-violet-200/70 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-md shadow-violet-500/20 shrink-0">
            <MessageSquare size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900">Direct Message & Keyword Auto-Responder</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-700 rounded-full border border-violet-200">
                Omnichannel Trigger
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Instantly trigger automated replies, deliver brochures, or launch full visual flows whenever a user sends specific keywords on Instagram, WhatsApp, or Messenger.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsSimOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white text-violet-700 border border-violet-200 hover:border-violet-300 font-bold text-xs rounded-xl shadow-2xs transition-all cursor-pointer"
          >
            <Smartphone size={15} />
            <span>Test in DM Simulator</span>
          </button>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Plus size={15} />
            <span>New DM Rule</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules, keywords, or responses..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {/* Channel selector */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold text-slate-600">
            {[
              { id: 'all', label: 'All Channels' },
              { id: 'whatsapp', label: 'WhatsApp' },
              { id: 'instagram', label: 'Instagram' },
              { id: 'messenger', label: 'Messenger' }
            ].map(ch => (
              <button
                key={ch.id}
                onClick={() => setChannelFilter(ch.id as any)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  channelFilter === ch.id ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>

          {/* Status selector */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold text-slate-600">
            {[
              { id: 'all', label: 'All' },
              { id: 'active', label: 'Active' },
              { id: 'paused', label: 'Paused' }
            ].map(st => (
              <button
                key={st.id}
                onClick={() => setStatusFilter(st.id as any)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === st.id ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rules Table / Cards */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Automated Keyword Rules ({filteredRules.length})
          </span>
          <span className="text-[11px] text-slate-400 font-medium">
            Runs 24/7 across connected Meta & WhatsApp Business accounts
          </span>
        </div>

        {filteredRules.length === 0 ? (
          <div className="p-12 text-center">
            <MessageSquare size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-700">No automation rules match your filter</p>
            <p className="text-xs text-slate-400 mt-1">Try changing your search query or channel filter</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRules.map(rule => (
              <div
                key={rule.id}
                className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4 group"
              >
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="font-bold text-sm text-slate-900 group-hover:text-violet-700 transition-colors">
                      {rule.name}
                    </h3>
                    
                    {/* Status badge */}
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                      rule.isActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {rule.isActive ? 'Active' : 'Paused'}
                    </span>

                    {/* Channels */}
                    <div className="flex items-center gap-1">
                      {rule.channels.includes('whatsapp') && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 rounded border border-emerald-200" title="WhatsApp">
                          WA
                        </span>
                      )}
                      {rule.channels.includes('instagram') && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-pink-50 text-pink-700 rounded border border-pink-200" title="Instagram DM">
                          IG
                        </span>
                      )}
                      {rule.channels.includes('messenger') && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 rounded border border-blue-200" title="Facebook Messenger">
                          FB
                        </span>
                      )}
                    </div>

                    {/* Match Type */}
                    <span className="text-[10px] font-semibold text-slate-400">
                      Rule: {rule.matchType.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Keywords chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-medium text-slate-400">Keywords:</span>
                    {rule.keywords.map((kw, i) => (
                      <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-mono font-medium border border-slate-200/80">
                        {kw}
                      </span>
                    ))}
                  </div>

                  {/* Reply preview & Visual Flow link */}
                  <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/70 text-xs text-slate-700 space-y-2">
                    <div className="flex items-start gap-2">
                      <CornerDownRight size={14} className="text-violet-600 shrink-0 mt-0.5" />
                      <p className="line-clamp-2 leading-relaxed">{rule.replyText}</p>
                    </div>

                    {rule.actionType === 'trigger_flow' && (
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-700 pt-1 border-t border-slate-200/60">
                        <Zap size={12} className="text-violet-600" />
                        <span>Triggers Flow: {rule.triggerFlowName || 'Visual Flow Pipeline'}</span>
                      </div>
                    )}

                    {rule.buttons && rule.buttons.length > 0 && (
                      <div className="flex items-center gap-1.5 pt-1">
                        {rule.buttons.map((btn, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-white text-slate-700 border border-slate-200 rounded-lg text-[10px] font-semibold">
                            🔘 {btn.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side stats & actions */}
                <div className="flex sm:flex-col lg:flex-row items-center sm:items-end lg:items-center justify-between lg:justify-end gap-3 pt-3 lg:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                  <div className="text-left sm:text-right text-xs">
                    <div className="font-bold text-slate-900">{rule.triggerCount.toLocaleString()} Triggers</div>
                    <div className="text-[10px] text-slate-400">{rule.deliveryRate} Delivery • {rule.lastTriggered}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRule(rule.id)}
                      className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        rule.isActive
                          ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      }`}
                      title={rule.isActive ? 'Pause rule' : 'Activate rule'}
                    >
                      {rule.isActive ? <Pause size={14} /> : <Play size={14} />}
                    </button>

                    <button
                      onClick={() => {
                        setEditingRule(rule)
                        setIsEditorOpen(true)
                      }}
                      className="p-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                      title="Edit rule"
                    >
                      <Edit3 size={14} />
                    </button>

                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete rule"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SIMULATOR MODAL */}
      {isSimOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[640px] animate-in fade-in zoom-in-95 duration-150">
            {/* Simulator Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center font-bold text-xs">
                  <Bot size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-slate-900">Live DM Trigger Simulator</h3>
                  <p className="text-[10px] text-slate-500">Test automation keyword matching live</p>
                </div>
              </div>
              <button
                onClick={() => setIsSimOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Channel Switcher */}
            <div className="px-4 py-2 bg-slate-100/60 border-b border-slate-100 flex items-center justify-between text-xs">
              <span className="text-[11px] font-bold text-slate-500">Simulate Channel:</span>
              <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
                {(['instagram', 'whatsapp', 'messenger'] as const).map(ch => (
                  <button
                    key={ch}
                    onClick={() => setSimChannel(ch)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold capitalize transition-all cursor-pointer ${
                      simChannel === ch ? 'bg-violet-600 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC]">
              {simChat.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                  {msg.ruleMatch && (
                    <span className="text-[9px] font-black tracking-wider uppercase text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full mb-1 border border-violet-200">
                      ⚡ Rule Triggered: {msg.ruleMatch}
                    </span>
                  )}
                  <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-xs shadow-2xs ${
                    msg.sender === 'user'
                      ? 'bg-violet-600 text-white rounded-br-none'
                      : 'bg-white text-slate-800 border border-slate-200/80 rounded-bl-none'
                  }`}>
                    <p className="leading-relaxed">{msg.text}</p>
                    {msg.buttons && msg.buttons.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1.5">
                        {msg.buttons.map((btn, bIdx) => (
                          <button
                            key={bIdx}
                            onClick={() => {
                              setSimInput(btn)
                              handleSendSimMessage()
                            }}
                            className="w-full text-center py-1 px-2 text-[11px] font-bold bg-violet-50 text-violet-700 hover:bg-violet-100 rounded-lg border border-violet-200 transition-colors cursor-pointer"
                          >
                            {btn}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-400 mt-1 px-1">{msg.time}</span>
                </div>
              ))}
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendSimMessage} className="p-3 bg-white border-t border-slate-100 flex items-center gap-2">
              <input
                type="text"
                value={simInput}
                onChange={(e) => setSimInput(e.target.value)}
                placeholder={`Type a test message (e.g. "price", "hello")...`}
                className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
              />
              <button
                type="submit"
                className="p-2 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors cursor-pointer"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* RULE EDITOR DRAWER */}
      {isEditorOpen && editingRule && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 overflow-y-auto flex flex-col animate-in slide-in-from-right duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  {editingRule.id.startsWith('dm_') && editingRule.triggerCount === 0 ? 'Create DM Automation' : 'Edit Automation Rule'}
                </h3>
                <p className="text-xs text-slate-500">Configure trigger conditions and responses</p>
              </div>
              <button
                onClick={() => setIsEditorOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="p-5 space-y-4 flex-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Rule Name
                </label>
                <input
                  type="text"
                  value={editingRule.name}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Channels
                </label>
                <div className="flex items-center gap-2">
                  {[
                    { id: 'whatsapp' as const, label: 'WhatsApp' },
                    { id: 'instagram' as const, label: 'Instagram DM' },
                    { id: 'messenger' as const, label: 'Messenger' }
                  ].map(ch => {
                    const selected = editingRule.channels.includes(ch.id)
                    return (
                      <button
                        type="button"
                        key={ch.id}
                        onClick={() => {
                          const next = selected
                            ? editingRule.channels.filter(c => c !== ch.id)
                            : [...editingRule.channels, ch.id]
                          setEditingRule({ ...editingRule, channels: next.length > 0 ? next : [ch.id] })
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          selected
                            ? 'bg-violet-50 text-violet-700 border-violet-300 ring-1 ring-violet-400/20'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                      >
                        {ch.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Match Condition
                </label>
                <select
                  value={editingRule.matchType}
                  onChange={(e) => setEditingRule({ ...editingRule, matchType: e.target.value as any })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                >
                  <option value="contains">Message Contains Keywords</option>
                  <option value="exact">Message Exactly Matches Keywords</option>
                  <option value="starts_with">Message Starts With</option>
                  <option value="story_mention">User Mentions You in Instagram Story</option>
                  <option value="fallback">Default Fallback (When No Rules Match)</option>
                </select>
              </div>

              {editingRule.matchType !== 'story_mention' && editingRule.matchType !== 'fallback' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Trigger Keywords (Comma separated)
                  </label>
                  <input
                    type="text"
                    value={editingRule.keywords.join(', ')}
                    onChange={(e) => setEditingRule({
                      ...editingRule,
                      keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean)
                    })}
                    placeholder="e.g. price, cost, rate, brochure"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Separate multiple keywords with commas. Case-insensitive matching.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Automated Response Text
                </label>
                <textarea
                  rows={4}
                  value={editingRule.replyText}
                  onChange={(e) => setEditingRule({ ...editingRule, replyText: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  placeholder="Enter the automated message response..."
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Trigger Follow-up Action
                </label>
                <div className="space-y-2">
                  <select
                    value={editingRule.actionType}
                    onChange={(e) => setEditingRule({ ...editingRule, actionType: e.target.value as any })}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  >
                    <option value="reply_text">Only Send Direct Reply</option>
                    <option value="trigger_flow">Launch Visual Automation Flow</option>
                    <option value="ai_deepseek">Route to DeepSeek v4-flash AI Agent</option>
                  </select>

                  {editingRule.actionType === 'trigger_flow' && (
                    <select
                      value={editingRule.triggerFlowId || ''}
                      onChange={(e) => {
                        const f = flows.find(item => item.id === e.target.value)
                        setEditingRule({
                          ...editingRule,
                          triggerFlowId: e.target.value,
                          triggerFlowName: f ? f.name : 'Selected Flow'
                        })
                      }}
                      className="w-full px-3 py-2 text-xs bg-violet-50/50 border border-violet-200 rounded-xl text-violet-800 font-medium"
                    >
                      <option value="">Select a Visual Flow to trigger...</option>
                      {flows.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl shadow-sm transition-all cursor-pointer"
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
