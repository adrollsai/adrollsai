'use client'

import React, { useState } from 'react'
import { 
  Plus, Search, Play, Pause, Trash2, Edit3, Heart, MessageCircle, 
  Send, Sparkles, CornerDownRight, Check, X, Eye, ExternalLink,
  Shuffle, ArrowRight, ShieldCheck, Zap
} from 'lucide-react'
import { InstagramIcon } from './suite-header'
import { toast } from 'sonner'

export interface IgCommentRule {
  id: string
  name: string
  postScope: 'all_posts' | 'specific_post'
  postTitle?: string
  postThumbnail?: string
  keywords: string[]
  matchMode: 'contains' | 'any_comment'
  publicReplies: string[]
  dmMessage: string
  dmCtaButton?: { text: string; url?: string; flowId?: string }
  autoLikeComment: boolean
  triggerFlowId?: string
  triggerFlowName?: string
  isActive: boolean
  stats: {
    commentsProcessed: number
    dmsSent: number
    ctr: string
  }
  lastActive: string
}

const DEFAULT_IG_RULES: IgCommentRule[] = [
  {
    id: 'ig_rule_viral_reels',
    name: 'Viral Reels & Posts: Comment "SEND" Lead Magnet',
    postScope: 'all_posts',
    keywords: ['SEND', 'LINK', 'INFO', 'GUIDE', 'BROCHURE'],
    matchMode: 'contains',
    publicReplies: [
      'Just sent you a private DM with all the details! 📩 Check your requests.',
      'Check your DMs right now! 🚀 Let me know if you received it.',
      'Sent you the exclusive brochure & pricing breakdown in DMs! ✨'
    ],
    dmMessage: 'Hey there! 👋 Here is the complete VIP property portfolio & pricing guide you asked for on Instagram. Click below to view the floor plans:',
    dmCtaButton: { text: 'View 3D Floor Plans & Pricing', url: 'https://wavecity.nobogent.io' },
    autoLikeComment: true,
    triggerFlowId: 'flow_lead_qualification',
    triggerFlowName: 'WhatsApp Lead Receptionist & Qualification',
    isActive: false, // Default PAUSED
    stats: {
      commentsProcessed: 3420,
      dmsSent: 3380,
      ctr: '48.2%'
    },
    lastActive: '2 mins ago'
  },
  {
    id: 'ig_rule_wave_city',
    name: 'Penthouse Launch Reel (Mohali & Wave City)',
    postScope: 'specific_post',
    postTitle: 'Reel: Inside the ₹4.5 Cr Sky Villa at Wave City Center',
    keywords: ['PRICE', 'COST', 'LOCATION', 'LAYOUT'],
    matchMode: 'contains',
    publicReplies: [
      'Sent you the complete Sky Villa price list and floor plan in DMs! 🥂',
      'Check your messages! Just DM’d you the private virtual walkthrough 🔑'
    ],
    dmMessage: 'Here is the private brochure for the 4-BHK Sky Villa. Only 6 units remain at pre-launch investor rates.',
    dmCtaButton: { text: 'Download PDF Brochure', url: 'https://brochure.nobogent.io/sky-villa.pdf' },
    autoLikeComment: true,
    triggerFlowId: 'flow_portal_leads',
    triggerFlowName: 'Instant WhatsApp Speed-to-Lead Follow-up',
    isActive: false, // Default PAUSED
    stats: {
      commentsProcessed: 1240,
      dmsSent: 1228,
      ctr: '62.4%'
    },
    lastActive: '14 mins ago'
  },
  {
    id: 'ig_rule_consult',
    name: 'Adviser Consultation Booking',
    postScope: 'all_posts',
    keywords: ['BOOK', 'CONSULT', 'VISIT', 'TALK'],
    matchMode: 'contains',
    publicReplies: [
      'Sent you the VIP calendar link in your inbox! 📅',
      'Check your DMs! Scheduled slots are open this week.'
    ],
    dmMessage: 'We would love to host you for a private site tour or online consultation. Pick a preferred slot on our direct calendar:',
    dmCtaButton: { text: 'Select Date & Time', url: 'https://cal.nobogent.io/advisor' },
    autoLikeComment: true,
    triggerFlowId: 'flow_voice_call',
    triggerFlowName: 'Voice Call Callback & Live Calendar Booking',
    isActive: false,
    stats: {
      commentsProcessed: 540,
      dmsSent: 536,
      ctr: '51.8%'
    },
    lastActive: 'Yesterday'
  }
]

interface IgCommentsViewProps {
  flows: any[]
}

export function IgCommentsView({ flows }: IgCommentsViewProps) {
  const [rules, setRules] = useState<IgCommentRule[]>(DEFAULT_IG_RULES)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all')

  // Editor Modal State
  const [editingRule, setEditingRule] = useState<IgCommentRule | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [newReplyInput, setNewReplyInput] = useState('')

  // Preview Modal State
  const [previewRule, setPreviewRule] = useState<IgCommentRule | null>(null)

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
        toast.success(next ? `Rule "${r.name}" activated` : `Rule "${r.name}" paused`)
        return { ...r, isActive: next }
      }
      return r
    }))
  }

  const handleDeleteRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
    toast.success('Instagram comment rule deleted')
  }

  const handleCreateNew = () => {
    setEditingRule({
      id: `ig_${Date.now()}`,
      name: 'New Instagram Comment-to-DM Rule',
      postScope: 'all_posts',
      keywords: ['SEND', 'LINK'],
      matchMode: 'contains',
      publicReplies: [
        'Check your DMs! 📩 Sent you the details.',
        'Sent you a private message with everything you need! 🚀'
      ],
      dmMessage: 'Hello! Thanks for commenting on our Instagram post. Here are the exclusive details:',
      dmCtaButton: { text: 'View Details', url: 'https://nobogent.io' },
      autoLikeComment: true,
      isActive: false, // Default PAUSED
      stats: { commentsProcessed: 0, dmsSent: 0, ctr: '0%' },
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
    toast.success('Instagram comment automation saved')
  }

  const handleAddReplyVariation = () => {
    if (!newReplyInput.trim() || !editingRule) return
    setEditingRule({
      ...editingRule,
      publicReplies: [...editingRule.publicReplies, newReplyInput.trim()]
    })
    setNewReplyInput('')
  }

  const handleRemoveReplyVariation = (idx: number) => {
    if (!editingRule) return
    setEditingRule({
      ...editingRule,
      publicReplies: editingRule.publicReplies.filter((_, i) => i !== idx)
    })
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gradient-to-r from-pink-500/10 via-purple-500/5 to-rose-500/10 border border-pink-200/80 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 text-white flex items-center justify-center shadow-md shadow-pink-500/20 shrink-0">
            <InstagramIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900">Instagram Comment-to-DM Automations</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-pink-100 text-pink-700 rounded-full border border-pink-200">
                Official Meta Graph API
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Turn viral Instagram comments into qualified direct message leads. Automatically replies to comments with anti-spam rotation and slides into DMs with instant brochures or visual flows.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
          >
            <Plus size={15} />
            <span>New IG Comment Rule</span>
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
            placeholder="Search Instagram comment rules or keywords..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500"
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
            Instagram Comment Rules ({filteredRules.length})
          </span>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <ShieldCheck size={14} className="text-emerald-600" />
            <span>Anti-spam public reply rotation enabled</span>
          </div>
        </div>

        {filteredRules.length === 0 ? (
          <div className="p-12 text-center">
            <InstagramIcon className="w-10 h-10 mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-700">No Instagram comment rules found</p>
            <p className="text-xs text-slate-400 mt-1">Create your first comment-to-DM automation</p>
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
                    <h3 className="font-bold text-sm text-slate-900 group-hover:text-pink-600 transition-colors">
                      {rule.name}
                    </h3>
                    
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                      rule.isActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {rule.isActive ? 'Active' : 'Paused'}
                    </span>

                    <span className="px-2 py-0.5 text-[10px] font-bold bg-pink-50 text-pink-700 rounded-md border border-pink-200">
                      {rule.postScope === 'all_posts' ? 'All Reels & Posts' : 'Specific Post'}
                    </span>

                    {rule.autoLikeComment && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                        <Heart size={10} className="fill-rose-500 text-rose-500" /> Auto-Likes Comment
                      </span>
                    )}
                  </div>

                  {rule.postTitle && (
                    <div className="text-xs text-slate-500 font-medium italic">
                      🎯 Targeted: "{rule.postTitle}"
                    </div>
                  )}

                  {/* Keywords */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-medium text-slate-400">Trigger Keywords:</span>
                    {rule.keywords.map((kw, i) => (
                      <span key={i} className="px-2 py-0.5 bg-pink-50/70 text-pink-700 rounded-md text-[11px] font-mono font-bold border border-pink-200/80">
                        "{kw}"
                      </span>
                    ))}
                  </div>

                  {/* Reply Rotation & DM Delivery preview */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {/* Public Reply */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                          <Shuffle size={12} className="text-violet-500" /> Public Auto-Reply ({rule.publicReplies.length} variants)
                        </span>
                      </div>
                      <p className="text-slate-700 italic text-[11px] line-clamp-2">
                        "{rule.publicReplies[0]}"
                      </p>
                    </div>

                    {/* Private DM */}
                    <div className="p-3 bg-pink-50/40 rounded-xl border border-pink-200/60">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-pink-700 flex items-center gap-1">
                          <Send size={12} className="text-pink-600" /> Private Instagram DM
                        </span>
                        {rule.triggerFlowName && (
                          <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.2 rounded">
                            Triggers Visual Flow
                          </span>
                        )}
                      </div>
                      <p className="text-slate-700 text-[11px] line-clamp-2">
                        {rule.dmMessage}
                      </p>
                      {rule.dmCtaButton && (
                        <div className="mt-1.5 text-[10px] font-bold text-pink-700 flex items-center gap-1">
                          <span>Button:</span>
                          <span className="px-1.5 py-0.5 bg-white border border-pink-200 rounded">
                            {rule.dmCtaButton.text}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right stats & actions */}
                <div className="flex sm:flex-col lg:flex-row items-center sm:items-end lg:items-center justify-between lg:justify-end gap-3 pt-3 lg:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                  <div className="text-left sm:text-right text-xs">
                    <div className="font-bold text-slate-900">{rule.stats.commentsProcessed.toLocaleString()} Comments</div>
                    <div className="text-[10px] text-slate-500 font-medium">
                      {rule.stats.dmsSent.toLocaleString()} DMs Sent • <span className="text-emerald-600 font-bold">{rule.stats.ctr} CTR</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{rule.lastActive}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreviewRule(rule)}
                      className="p-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                      title="Preview Instagram Mock"
                    >
                      <Eye size={14} />
                    </button>

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

      {/* PREVIEW MODAL */}
      {previewRule && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <InstagramIcon className="w-5 h-5 text-pink-600" />
                <h3 className="font-bold text-xs text-slate-900">Instagram Comment & DM Preview</h3>
              </div>
              <button
                onClick={() => setPreviewRule(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 bg-[#FAFAFA]">
              {/* Post Mock */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-0.5">
                    <div className="w-full h-full bg-white rounded-full flex items-center justify-center font-bold text-[10px] text-slate-800">
                      NB
                    </div>
                  </div>
                  <div>
                    <span className="font-bold text-xs text-slate-900 block">nobogent.advisory</span>
                    <span className="text-[10px] text-slate-400">Wave City Center, Mohali</span>
                  </div>
                </div>

                <div className="bg-slate-100 rounded-xl h-36 flex items-center justify-center text-slate-400 text-xs font-medium">
                  [Instagram Reel / Post Media]
                </div>

                {/* Simulated Comment by User */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-start gap-2 text-xs">
                    <span className="font-bold text-slate-900">investor_rahul</span>
                    <span className="text-slate-800 bg-pink-50 px-1.5 py-0.5 rounded font-mono font-bold text-[11px] text-pink-700">
                      SEND
                    </span>
                    <Heart size={12} className="ml-auto text-rose-500 fill-rose-500 mt-1" />
                  </div>

                  {/* Public Reply by Bot */}
                  <div className="ml-4 pl-3 border-l-2 border-pink-300 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-900">
                      <span>nobogent.advisory</span>
                      <span className="text-[9px] font-semibold text-pink-600 bg-pink-50 px-1 rounded">Author</span>
                    </div>
                    <p className="text-xs text-slate-700">
                      {previewRule.publicReplies[0]}
                    </p>
                  </div>
                </div>
              </div>

              {/* Simulated Private DM Notification */}
              <div className="bg-white rounded-2xl border-2 border-pink-200 p-4 space-y-2.5 shadow-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-pink-600 text-white flex items-center justify-center font-bold text-[9px]">
                      DM
                    </div>
                    <span className="text-xs font-bold text-slate-900">Direct Message Dropped</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Just now</span>
                </div>

                <p className="text-xs text-slate-700 leading-relaxed">
                  {previewRule.dmMessage}
                </p>

                {previewRule.dmCtaButton && (
                  <button className="w-full py-2 bg-gradient-to-r from-pink-600 to-rose-600 text-white font-bold text-xs rounded-xl shadow-xs">
                    {previewRule.dmCtaButton.text} →
                  </button>
                )}
              </div>
            </div>
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
                  {editingRule.id.startsWith('ig_') && editingRule.stats.commentsProcessed === 0 ? 'New Instagram Comment Rule' : 'Edit IG Rule'}
                </h3>
                <p className="text-xs text-slate-500">Configure comment triggers, anti-spam public replies & private DM</p>
              </div>
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
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Target Instagram Posts
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingRule({ ...editingRule, postScope: 'all_posts' })}
                    className={`p-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      editingRule.postScope === 'all_posts'
                        ? 'bg-pink-50 text-pink-700 border-pink-300 ring-1 ring-pink-400/20'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    All Reels & Posts
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingRule({ ...editingRule, postScope: 'specific_post' })}
                    className={`p-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      editingRule.postScope === 'specific_post'
                        ? 'bg-pink-50 text-pink-700 border-pink-300 ring-1 ring-pink-400/20'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    Specific Post / Reel
                  </button>
                </div>
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
                  placeholder="e.g. SEND, PRICE, LINK, GUIDE"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                  required
                />
              </div>

              {/* Public replies rotation */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Public Reply Variations (Anti-Spam Rotation)
                  </label>
                  <span className="text-[10px] text-slate-400">{editingRule.publicReplies.length} variants</span>
                </div>
                <div className="space-y-2">
                  {editingRule.publicReplies.map((reply, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={reply}
                        onChange={(e) => {
                          const updated = [...editingRule.publicReplies]
                          updated[idx] = e.target.value
                          setEditingRule({ ...editingRule, publicReplies: updated })
                        }}
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                      />
                      {editingRule.publicReplies.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveReplyVariation(idx)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newReplyInput}
                      onChange={(e) => setNewReplyInput(e.target.value)}
                      placeholder="Add another friendly reply variant..."
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                    />
                    <button
                      type="button"
                      onClick={handleAddReplyVariation}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Private DM */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Private Instagram DM Message
                </label>
                <textarea
                  rows={3}
                  value={editingRule.dmMessage}
                  onChange={(e) => setEditingRule({ ...editingRule, dmMessage: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Attach Visual Automation Flow (Optional)
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
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/20"
                >
                  <option value="">None (Send DM directly)</option>
                  {flows.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="autoLike"
                  checked={editingRule.autoLikeComment}
                  onChange={(e) => setEditingRule({ ...editingRule, autoLikeComment: e.target.checked })}
                  className="rounded text-pink-600 focus:ring-pink-500"
                />
                <label htmlFor="autoLike" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Automatically like the user's comment
                </label>
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
                  className="px-5 py-2 text-xs font-bold bg-pink-600 hover:bg-pink-700 text-white rounded-xl shadow-sm transition-all cursor-pointer"
                >
                  Save Instagram Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
