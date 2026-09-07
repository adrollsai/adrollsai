'use client'

import React, { useState } from 'react'
import { 
  Plus, Search, Play, Pause, Trash2, Edit3, MessageCircle, 
  Send, CornerDownRight, Check, X, ShieldCheck, Zap
} from 'lucide-react'
import { FacebookIcon } from './suite-header'
import { toast } from 'sonner'

export interface FbCommentRule {
  id: string
  name: string
  sourceType: 'all_ads' | 'page_posts' | 'specific_campaign'
  campaignName?: string
  keywords: string[]
  publicReplies: string[]
  messengerMessage: string
  messengerCtaText: string
  triggerFlowId?: string
  triggerFlowName?: string
  isActive: boolean
  stats: {
    commentsHandled: number
    messengerChats: number
    conversionRate: string
  }
  lastActive: string
}

const DEFAULT_FB_RULES: FbCommentRule[] = [
  {
    id: 'fb_rule_ads',
    name: 'Meta Click-to-Messenger Lead Ads Auto-Responder',
    sourceType: 'all_ads',
    campaignName: 'Luxury Villas Wave City - Meta Ad Set #4',
    keywords: ['PRICE', 'HOW MUCH', 'LOCATION', 'DETAILS', 'INFO'],
    publicReplies: [
      'Thanks for reaching out! We’ve sent full pricing & floor plans directly to your Messenger 💬',
      'Check your Facebook Messenger! Our team just shared the investment brochure 📊'
    ],
    messengerMessage: 'Hi there! 👋 Thank you for commenting on our ad. Here is the official project deck with pricing and installment plans:',
    messengerCtaText: 'Open Full Payment Plan',
    triggerFlowId: 'flow_lead_qualification',
    triggerFlowName: 'WhatsApp Lead Receptionist & Qualification',
    isActive: false, // Default PAUSED
    stats: {
      commentsHandled: 1840,
      messengerChats: 1812,
      conversionRate: '54.2%'
    },
    lastActive: '5 mins ago'
  },
  {
    id: 'fb_rule_page',
    name: 'Facebook Page Posts: Price Inquiries',
    sourceType: 'page_posts',
    keywords: ['BROCHURE', 'COST', 'INTERESTED', 'CALL'],
    publicReplies: [
      'Sent you a private message with the unit breakdown! 🏠',
      'Please check your inbox, we just forwarded the site details!'
    ],
    messengerMessage: 'Hello! Here is the latest project catalogue for our premium commercial and residential towers.',
    messengerCtaText: 'Download Brochure',
    triggerFlowId: 'flow_portal_leads',
    triggerFlowName: 'Instant WhatsApp Speed-to-Lead Follow-up',
    isActive: false, // Default PAUSED
    stats: {
      commentsHandled: 640,
      messengerChats: 632,
      conversionRate: '46.8%'
    },
    lastActive: '32 mins ago'
  }
]

interface FbCommentsViewProps {
  flows: any[]
}

export function FbCommentsView({ flows }: FbCommentsViewProps) {
  const [rules, setRules] = useState<FbCommentRule[]>(DEFAULT_FB_RULES)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all')
  const [editingRule, setEditingRule] = useState<FbCommentRule | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  const filteredRules = rules.filter(r => {
    if (statusFilter === 'active' && !r.isActive) return false
    if (statusFilter === 'paused' && r.isActive) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchName = r.name.toLowerCase().includes(q)
      const matchKeywords = r.keywords.some(k => k.toLowerCase().includes(q))
      if (!matchName && !matchKeywords) return false
    }
    return true
  })

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => {
      if (r.id === id) {
        const next = !r.isActive
        toast.success(next ? `Facebook rule "${r.name}" enabled` : `Facebook rule "${r.name}" paused`)
        return { ...r, isActive: next }
      }
      return r
    }))
  }

  const handleDelete = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
    toast.success('Facebook comment rule deleted')
  }

  const handleCreateNew = () => {
    setEditingRule({
      id: `fb_${Date.now()}`,
      name: 'New Facebook Comment Automation',
      sourceType: 'all_ads',
      keywords: ['PRICE', 'INFO'],
      publicReplies: [
        'Thanks for commenting! Sent details to your Messenger 💬'
      ],
      messengerMessage: 'Hi! Here are the details you requested on Facebook:',
      messengerCtaText: 'View Details',
      isActive: false, // Default PAUSED
      stats: { commentsHandled: 0, messengerChats: 0, conversionRate: '0%' },
      lastActive: 'Never'
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
    toast.success('Facebook automation rule saved')
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-cyan-500/10 border border-blue-200/80 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
            <FacebookIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900">Facebook Page & Ad Comment Automations</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700 rounded-full border border-blue-200">
                Meta Marketing API
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Automatically reply to Facebook Page posts and Click-to-Messenger ads comments, instantly dropping a private Messenger prompt to capture verified phone numbers and emails.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Plus size={15} />
            <span>New FB Comment Rule</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="relative w-full max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Facebook rules or ad sets..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-semibold text-slate-600">
            {[
              { id: 'all', label: 'All Rules' },
              { id: 'active', label: 'Active' },
              { id: 'paused', label: 'Paused' }
            ].map(st => (
              <button
                key={st.id}
                onClick={() => setStatusFilter(st.id as any)}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === st.id ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rules List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Facebook Comment Rules ({filteredRules.length})
          </span>
          <span className="text-xs text-slate-500 font-medium">
            Synchronized with Facebook Graph API webhooks
          </span>
        </div>

        {filteredRules.length === 0 ? (
          <div className="p-12 text-center">
            <FacebookIcon className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-700">No Facebook rules found</p>
            <p className="text-xs text-slate-400 mt-1">Create your first FB comment automation rule</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRules.map(rule => (
              <div
                key={rule.id}
                className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4 group"
              >
                <div className="space-y-2.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors">
                      {rule.name}
                    </h3>
                    
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                      rule.isActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {rule.isActive ? 'Active' : 'Paused'}
                    </span>

                    <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 rounded-md border border-blue-200">
                      {rule.sourceType === 'all_ads' ? 'All Active Meta Ads' : 'Page Posts'}
                    </span>
                  </div>

                  {rule.campaignName && (
                    <div className="text-xs text-slate-500 font-medium">
                      Campaign: {rule.campaignName}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-medium text-slate-400">Keywords:</span>
                    {rule.keywords.map((kw, i) => (
                      <span key={i} className="px-2 py-0.5 bg-blue-50/70 text-blue-700 rounded-md text-[11px] font-mono font-bold border border-blue-200/80">
                        "{kw}"
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                        Public Facebook Reply
                      </span>
                      <p className="text-slate-700 italic text-[11px] line-clamp-2">
                        "{rule.publicReplies[0]}"
                      </p>
                    </div>

                    <div className="p-3 bg-blue-50/40 rounded-xl border border-blue-200/60">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block mb-1">
                        Private Messenger Dispatch
                      </span>
                      <p className="text-slate-700 text-[11px] line-clamp-2">
                        {rule.messengerMessage}
                      </p>
                      {rule.triggerFlowName && (
                        <div className="mt-1 text-[10px] font-bold text-violet-700 flex items-center gap-1">
                          <Zap size={11} /> Triggers: {rule.triggerFlowName}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex sm:flex-col lg:flex-row items-center sm:items-end lg:items-center justify-between lg:justify-end gap-3 pt-3 lg:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                  <div className="text-left sm:text-right text-xs">
                    <div className="font-bold text-slate-900">{rule.stats.commentsHandled.toLocaleString()} Processed</div>
                    <div className="text-[10px] text-slate-500 font-medium">
                      {rule.stats.messengerChats.toLocaleString()} Chats • <span className="text-emerald-600 font-bold">{rule.stats.conversionRate} Conv</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{rule.lastActive}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleRule(rule.id)}
                      className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        rule.isActive
                          ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      }`}
                      title={rule.isActive ? 'Pause' : 'Activate'}
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
                      onClick={() => handleDelete(rule.id)}
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

      {/* EDIT DRAWER */}
      {isEditorOpen && editingRule && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl border-l border-slate-200 overflow-y-auto flex flex-col animate-in slide-in-from-right duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-sm text-slate-900">Configure Facebook Comment Rule</h3>
              <button
                onClick={() => setIsEditorOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
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
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Trigger Keywords (Comma separated)
                </label>
                <input
                  type="text"
                  value={editingRule.keywords.join(', ')}
                  onChange={(e) => setEditingRule({
                    ...editingRule,
                    keywords: e.target.value.split(',').map(k => k.trim().toUpperCase()).filter(Boolean)
                  })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Public Reply Message
                </label>
                <input
                  type="text"
                  value={editingRule.publicReplies[0] || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, publicReplies: [e.target.value] })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Private Messenger Message
                </label>
                <textarea
                  rows={3}
                  value={editingRule.messengerMessage}
                  onChange={(e) => setEditingRule({ ...editingRule, messengerMessage: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Trigger Visual Automation Flow
                </label>
                <select
                  value={editingRule.triggerFlowId || ''}
                  onChange={(e) => {
                    const f = flows.find(item => item.id === e.target.value)
                    setEditingRule({
                      ...editingRule,
                      triggerFlowId: e.target.value,
                      triggerFlowName: f ? f.name : ''
                    })
                  }}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">None (Messenger DM only)</option>
                  {flows.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm cursor-pointer"
                >
                  Save Facebook Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
