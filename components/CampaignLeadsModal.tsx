'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { 
  X, Search, Filter, ArrowUpDown, User, Users, Phone, Mail, Clock, 
  MessageSquare, Calendar, ChevronDown, Loader2, ExternalLink, 
  CheckCircle2, AlertCircle, RefreshCw, UserCheck, Shield, ChevronRight,
  TrendingUp, Sparkles, Send, PhoneCall
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import LeadHistoryModal from '@/components/LeadHistoryModal'
import { toast } from 'sonner'

interface CampaignLeadsModalProps {
  isOpen: boolean
  onClose: () => void
  campaign: {
    id: string
    name: string
    status?: string
    objective?: string
    metrics?: {
      spend?: number
      results?: number
      cpl?: number
    }
  } | null
  targetUserId?: string
  team?: any[]
}

const STAGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'New Lead': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  'Contacted': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  'Follow Up': { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
  'Qualified': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  'Site Visit': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  'Site Visit Done': { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  'Negotiation': { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
  'Closed / Won': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  'Won': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  'Lost': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  'Never Picked': { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
  'Unqualified': { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
}

export default function CampaignLeadsModal({
  isOpen,
  onClose,
  campaign,
  targetUserId,
  team: initialTeam = []
}: CampaignLeadsModalProps) {
  const supabase = createClient()

  // State
  const [leads, setLeads] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const PAGE_SIZE = 25

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedStage, setSelectedStage] = useState('ALL')
  const [selectedAgent, setSelectedAgent] = useState('ALL')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'stage'>('newest')

  // Team cache
  const [teamMembers, setTeamMembers] = useState<any[]>(initialTeam)
  const [extraProfiles, setExtraProfiles] = useState<Record<string, string>>({})
  const [assigningLeadId, setAssigningLeadId] = useState<string | null>(null)

  // History modal
  const [selectedHistoryLead, setSelectedHistoryLead] = useState<any | null>(null)

  // Load team members if not provided
  useEffect(() => {
    if (initialTeam && initialTeam.length > 0) {
      setTeamMembers(initialTeam)
      return
    }

    async function loadTeam() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const activeId = targetUserId || user.id
        
        // 1. Fetch via /api/team (bypasses RLS with service role, returns all active staff & agents)
        try {
          const res = await fetch(`/api/team?adminId=${activeId}`)
          const data = await res.json()
          if (data?.team && Array.isArray(data.team) && data.team.length > 0) {
            // Also include admin profile if missing
            const { data: adminProf } = await supabase
              .from('profiles')
              .select('id, business_name, full_name, email, role')
              .eq('id', activeId)
              .single()

            let combined = [...data.team]
            if (adminProf && !combined.some((m: any) => m.id === adminProf.id)) {
              combined.unshift(adminProf)
            }
            setTeamMembers(combined)
            return
          }
        } catch (apiErr) {
          console.warn('API team fetch fallback:', apiErr)
        }

        // 2. Direct Supabase query fallback (Note: profiles table uses contact_number, NOT phone)
        const { data: profile } = await supabase.from('profiles').select('id, parent_id, agency_id, role').eq('id', activeId).single()
        const effectiveAgencyId = profile?.agency_id || profile?.parent_id || activeId
        const { data: members } = await supabase
          .from('profiles')
          .select('id, business_name, full_name, email, role')
          .or(`id.eq.${activeId},agency_id.eq.${effectiveAgencyId},parent_id.eq.${effectiveAgencyId}`)

        if (members && members.length > 0) {
          setTeamMembers(members)
        }
      } catch (err) {
        console.error('Error fetching team for modal:', err)
      }
    }

    if (isOpen) {
      loadTeam()
    }
  }, [isOpen, targetUserId, initialTeam])

  // Team mapping lookup
  const teamMap = useMemo(() => {
    const map = new Map<string, any>()
    teamMembers.forEach(m => {
      map.set(m.id, m)
    })
    return map
  }, [teamMembers])

  // Helper to parse lead custom fields
  const parseLead = useCallback((lead: any) => {
    let cf = lead.custom_fields
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf) } catch (e) { cf = {} }
    } else if (!cf) {
      cf = {}
    }
    return {
      ...lead,
      parsed_custom_fields: cf,
      last_remark: cf?.last_remark || cf?.last_followup_remark || (lead.notes ? lead.notes.slice(0, 100) : null),
      last_followup_at: cf?.last_followup_at || null,
      last_followup_type: cf?.last_followup_type || null,
    }
  }, [])

  // Fetch leads lazily
  const fetchLeads = useCallback(async (pageNum: number, isInitial = false) => {
    if (!campaign) return
    if (isInitial) {
      setLoading(true)
      setPage(0)
    } else {
      setLoadingMore(true)
    }

    try {
      const from = pageNum * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      // Match conditions for this campaign:
      // 1. Direct campaign_id match OR matching form_name / ad_name containing campaign.name
      let query = supabase
        .from('leads')
        .select('id, name, phone, email, status, pipeline_stage, assigned_to, created_at, notes, campaign_id, form_name, ad_name, custom_fields, user_id', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (campaign.id && campaign.name) {
        query = query.or(`campaign_id.eq.${campaign.id},form_name.ilike.%${campaign.name}%,ad_name.ilike.%${campaign.name}%`)
      } else if (campaign.id) {
        query = query.eq('campaign_id', campaign.id)
      } else if (campaign.name) {
        query = query.or(`form_name.ilike.%${campaign.name}%,ad_name.ilike.%${campaign.name}%`)
      }

      // Range for pagination
      query = query.range(from, to)

      const { data, count, error } = await query

      if (error) {
        console.error('Error fetching campaign leads:', error)
        toast.error('Failed to load campaign leads')
        return
      }

      // If direct match returned 0 results, try fallback matching via notes or campaign name
      let finalData = data || []
      let finalCount = count || 0

      if (isInitial && finalData.length === 0 && campaign.name) {
        const { data: fallbackData, count: fallbackCount } = await supabase
          .from('leads')
          .select('id, name, phone, email, status, pipeline_stage, assigned_to, created_at, notes, campaign_id, form_name, ad_name, custom_fields, user_id', { count: 'exact' })
          .ilike('notes', `%${campaign.name}%`)
          .range(from, to)
          .order('created_at', { ascending: false })

        if (fallbackData && fallbackData.length > 0) {
          finalData = fallbackData
          finalCount = fallbackCount || fallbackData.length
        }
      }

      // Automatically detect any assigned_to IDs not currently in teamMembers map
      const missingAssignees = Array.from(new Set(
        finalData
          .map((l: any) => l.assigned_to)
          .filter((id: string | null) => Boolean(id) && !teamMap.has(id!))
      )) as string[]

      if (missingAssignees.length > 0) {
        supabase
          .from('profiles')
          .select('id, business_name, full_name, email')
          .in('id', missingAssignees)
          .then(({ data: missingProfiles }) => {
            if (missingProfiles && missingProfiles.length > 0) {
              const extra: Record<string, string> = {}
              missingProfiles.forEach((p: any) => {
                extra[p.id] = p.business_name || p.full_name || p.email?.split('@')[0] || 'Agent'
              })
              setExtraProfiles(prev => ({ ...prev, ...extra }))
            }
          })
      }

      const parsed = finalData.map(parseLead)

      if (isInitial) {
        setLeads(parsed)
        setTotalCount(finalCount)
      } else {
        setLeads(prev => [...prev, ...parsed])
      }

      setHasMore(finalData.length === PAGE_SIZE && (from + finalData.length) < finalCount)
    } catch (err) {
      console.error('Failed to fetch leads:', err)
      toast.error('Failed to load leads')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [campaign, parseLead, supabase])

  // Reset and load on open
  useEffect(() => {
    if (isOpen && campaign) {
      setSearchQuery('')
      setSelectedStage('ALL')
      setSelectedAgent('ALL')
      setSortBy('newest')
      fetchLeads(0, true)
    } else {
      setLeads([])
      setTotalCount(0)
    }
  }, [isOpen, campaign?.id])

  // Handle Load More
  const handleLoadMore = () => {
    if (!hasMore || loadingMore) return
    const nextPage = page + 1
    setPage(nextPage)
    fetchLeads(nextPage, false)
  }

  // Handle Reassign
  const handleAssignLead = async (leadId: string, newAgentId: string) => {
    setAssigningLeadId(leadId)
    try {
      const assignedVal = newAgentId === 'unassigned' ? null : newAgentId
      const { error } = await supabase
        .from('leads')
        .update({ assigned_to: assignedVal })
        .eq('id', leadId)

      if (error) throw error

      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, assigned_to: assignedVal } : l))
      const agentName = (assignedVal ? teamMap.get(assignedVal) : null)?.business_name || (assignedVal ? 'Selected Agent' : 'Unassigned')
      toast.success(`Assigned to ${agentName}`)
    } catch (err: any) {
      console.error('Assign error:', err)
      toast.error(err.message || 'Failed to update assignment')
    } finally {
      setAssigningLeadId(null)
    }
  }

  // Client-side filtering & sorting of current batch
  const filteredAndSortedLeads = useMemo(() => {
    let result = [...leads]

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(l => 
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.phone && l.phone.includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.notes && l.notes.toLowerCase().includes(q)) ||
        (l.last_remark && l.last_remark.toLowerCase().includes(q))
      )
    }

    // Stage filter
    if (selectedStage !== 'ALL') {
      result = result.filter(l => (l.pipeline_stage || l.status || 'New Lead') === selectedStage)
    }

    // Agent filter
    if (selectedAgent !== 'ALL') {
      if (selectedAgent === 'unassigned') {
        result = result.filter(l => !l.assigned_to)
      } else {
        result = result.filter(l => l.assigned_to === selectedAgent)
      }
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '')
      }
      if (sortBy === 'stage') {
        return (a.pipeline_stage || '').localeCompare(b.pipeline_stage || '')
      }
      return 0
    })

    return result
  }, [leads, searchQuery, selectedStage, selectedAgent, sortBy])

  // Get distinct stages for filter
  const availableStages = useMemo(() => {
    const stages = new Set<string>()
    leads.forEach(l => {
      const s = l.pipeline_stage || l.status
      if (s) stages.add(s)
    })
    return Array.from(stages)
  }, [leads])

  if (!isOpen || !campaign) return null

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
        <div className="bg-white w-full h-full sm:h-[92vh] max-w-6xl rounded-[1.75rem] sm:rounded-[2.25rem] shadow-2xl flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
          
          {/* TOP MODAL HEADER */}
          <div className="px-6 py-5 border-b border-slate-200/80 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
            <div className="flex items-start sm:items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20">
                <Users size={22} className="text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg sm:text-xl font-black text-slate-900 truncate">
                    {campaign.name}
                  </h2>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    campaign.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {campaign.status || 'PAUSED'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 font-medium mt-1">
                  <span className="font-mono text-slate-400">ID: {campaign.id}</span>
                  <span>•</span>
                  <span className="font-semibold text-slate-700">{totalCount} Total Leads Captured</span>
                  {campaign.metrics?.cpl ? (
                    <>
                      <span>•</span>
                      <span className="text-emerald-600 font-bold">₹{campaign.metrics.cpl.toFixed(2)} CPL</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                onClick={() => fetchLeads(0, true)}
                disabled={loading}
                className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 transition-colors shadow-sm disabled:opacity-50"
                title="Refresh leads"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={onClose}
                className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors shadow-sm"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* CONTROLS & FILTER BAR */}
          <div className="px-6 py-3.5 border-b border-slate-100 bg-white flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shrink-0">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by lead name, phone, remark..."
                className="w-full bg-slate-50 border border-slate-200 py-2 pl-10 pr-4 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filters & Sorting */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Pipeline Stage Filter */}
              <div className="relative">
                <select
                  value={selectedStage}
                  onChange={(e) => setSelectedStage(e.target.value)}
                  className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold py-2 pl-3 pr-8 rounded-xl outline-none cursor-pointer transition-colors"
                >
                  <option value="ALL">All Stages ({leads.length})</option>
                  {availableStages.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>

              {/* Agent Filter */}
              <div className="relative">
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold py-2 pl-3 pr-8 rounded-xl outline-none cursor-pointer transition-colors"
                >
                  <option value="ALL">All Assigned</option>
                  <option value="unassigned">Unassigned</option>
                  {teamMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.business_name || m.email?.split('@')[0]}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>

              {/* Sorting */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e: any) => setSortBy(e.target.value)}
                  className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold py-2 pl-3 pr-8 rounded-xl outline-none cursor-pointer transition-colors"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="name">Name (A-Z)</option>
                  <option value="stage">Stage</option>
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* MAIN LEADS LIST / TABLE */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50/40">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
                <Loader2 size={32} className="animate-spin text-blue-500" />
                <p className="text-sm font-semibold text-slate-600">Loading campaign leads from Meta & CRM...</p>
              </div>
            ) : filteredAndSortedLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-3xl border border-dashed border-slate-200 p-8">
                <Users size={44} className="text-slate-300 mb-3" />
                <h3 className="text-base font-bold text-slate-700">No leads found</h3>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  {searchQuery || selectedStage !== 'ALL' || selectedAgent !== 'ALL'
                    ? 'No leads match your current search and filter criteria.'
                    : 'No leads have synced for this campaign yet. Check Meta Leads Center or verify instant form mapping.'}
                </p>
                {(searchQuery || selectedStage !== 'ALL' || selectedAgent !== 'ALL') && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedStage('ALL')
                      setSelectedAgent('ALL')
                    }}
                    className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAndSortedLeads.map((lead) => {
                  const stageStyle = STAGE_COLORS[lead.pipeline_stage || lead.status] || {
                    bg: 'bg-slate-100',
                    text: 'text-slate-700',
                    border: 'border-slate-200'
                  }
                  const assignedMember = teamMap.get(lead.assigned_to)
                  const assignedName = assignedMember 
                    ? (assignedMember.business_name || assignedMember.full_name || assignedMember.email?.split('@')[0])
                    : (lead.assigned_to ? (extraProfiles[lead.assigned_to] || 'Assigned Agent') : null)
                  const cleanPhone = lead.phone ? lead.phone.replace(/\D/g, '') : ''
                  const formattedDate = new Date(lead.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })

                  return (
                    <div
                      key={lead.id}
                      className="bg-white border border-slate-200/80 hover:border-blue-300 rounded-2xl p-4 sm:p-5 shadow-sm transition-all hover:shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      {/* Left: Lead Identity & Contact */}
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm mt-0.5">
                          {lead.name ? lead.name.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                              {lead.name || 'Anonymous Lead'}
                            </h4>
                            <span className={`inline-flex items-center text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${stageStyle.bg} ${stageStyle.text} ${stageStyle.border}`}>
                              {lead.pipeline_stage || lead.status || 'New Lead'}
                            </span>
                            {assignedName ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                <UserCheck size={12} className="text-blue-600" />
                                <span>{assignedName}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                                <User size={12} className="text-slate-400" />
                                <span>Unassigned</span>
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1.5 flex-wrap">
                            {lead.phone && (
                              <a
                                href={`tel:${lead.phone}`}
                                className="flex items-center gap-1 hover:text-blue-600 font-medium transition-colors"
                              >
                                <Phone size={12} className="text-slate-400" />
                                <span>{lead.phone}</span>
                              </a>
                            )}
                            {lead.email && (
                              <a
                                href={`mailto:${lead.email}`}
                                className="flex items-center gap-1 hover:text-blue-600 font-medium transition-colors truncate max-w-[200px]"
                              >
                                <Mail size={12} className="text-slate-400" />
                                <span className="truncate">{lead.email}</span>
                              </a>
                            )}
                            <div className="flex items-center gap-1 text-slate-400 font-medium">
                              <Calendar size={12} />
                              <span>{formattedDate}</span>
                            </div>
                          </div>

                          {/* Last Remark / Followup Note Preview */}
                          {lead.last_remark && (
                            <div className="mt-2.5 text-xs text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100 flex items-start gap-1.5">
                              <MessageSquare size={13} className="text-slate-400 shrink-0 mt-0.5" />
                              <span className="truncate flex-1">
                                <span className="font-semibold text-slate-700">Latest Note: </span>
                                {lead.last_remark}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Assigned Agent, History Trigger, and Actions */}
                      <div className="flex items-center gap-3 shrink-0 flex-wrap justify-between lg:justify-end pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                        {/* Assigned Agent Select */}
                        <div className="flex items-center gap-1.5">
                          <UserCheck size={14} className="text-slate-400 shrink-0" />
                          <div className="relative">
                            <select
                              value={lead.assigned_to || 'unassigned'}
                              onChange={(e) => handleAssignLead(lead.id, e.target.value)}
                              disabled={assigningLeadId === lead.id}
                              className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold py-1.5 pl-2.5 pr-7 rounded-xl outline-none cursor-pointer transition-colors max-w-[150px] truncate"
                              title="Assign to Agent"
                            >
                              <option value="unassigned">Unassigned</option>
                              {teamMembers.map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.business_name || m.full_name || m.email?.split('@')[0]}
                                </option>
                              ))}
                              {lead.assigned_to && !teamMembers.some(m => m.id === lead.assigned_to) && (
                                <option value={lead.assigned_to}>
                                  {extraProfiles[lead.assigned_to] || 'Assigned Agent'}
                                </option>
                              )}
                            </select>
                            {assigningLeadId === lead.id ? (
                              <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />
                            ) : (
                              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            )}
                          </div>
                        </div>

                        {/* History Button */}
                        <button
                          onClick={() => setSelectedHistoryLead(lead)}
                          className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 px-3 py-1.5 rounded-xl transition-colors"
                          title="View lead history & followups"
                        >
                          <Clock size={13} />
                          <span>History</span>
                        </button>

                        {/* Quick WhatsApp Link */}
                        {cleanPhone && (
                          <a
                            href={`https://wa.me/${cleanPhone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-xl transition-colors"
                            title="Chat on WhatsApp"
                          >
                            <Send size={14} />
                          </a>
                        )}

                        {/* Quick Call Link */}
                        {lead.phone && (
                          <a
                            href={`tel:${lead.phone}`}
                            className="p-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl transition-colors"
                            title="Call Lead"
                          >
                            <PhoneCall size={14} />
                          </a>
                        )}

                        {/* View in CRM link */}
                        <a
                          href={`/dashboard/crm?leadId=${lead.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
                          title="Open in CRM"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                    </div>
                  )
                })}

                {/* LAZY LOAD MORE BUTTON */}
                {hasMore && (
                  <div className="pt-4 pb-2 flex justify-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="flex items-center gap-2 px-6 py-2.5 bg-white border border-slate-200 hover:border-blue-400 text-slate-700 font-bold text-xs rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 size={14} className="animate-spin text-blue-600" />
                          <span>Loading more leads...</span>
                        </>
                      ) : (
                        <>
                          <span>Load More Leads ({totalCount - leads.length} remaining)</span>
                          <ChevronDown size={14} />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex items-center justify-between text-xs text-slate-500 font-medium shrink-0">
            <div>
              Showing <span className="font-bold text-slate-800">{filteredAndSortedLeads.length}</span> of{' '}
              <span className="font-bold text-slate-800">{totalCount}</span> total campaign leads
            </div>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors text-xs"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* LEAD HISTORY MODAL */}
      {selectedHistoryLead && (
        <LeadHistoryModal
          isOpen={!!selectedHistoryLead}
          onClose={() => setSelectedHistoryLead(null)}
          lead={selectedHistoryLead}
          teamMembers={teamMembers}
        />
      )}
    </>
  )
}
