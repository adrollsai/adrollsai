'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import { openPhoneDialer } from '@/utils/dialer'
import { 
  BarChart2, 
  Users, 
  MessageCircle, 
  TrendingUp, 
  Sparkles, 
  Clock, 
  ChevronRight, 
  RefreshCw, 
  AlertCircle, 
  ArrowUpRight, 
  Zap, 
  CheckCircle2, 
  XCircle,
  HelpCircle,
  Shield,
  User,
  Sliders,
  DollarSign,
  Phone,
  PhoneOff,
  Filter,
  CheckSquare,
  Building2,
  FileText,
  PhoneCall,
  UserCheck,
  Calendar,
  Search,
  ArrowUpDown,
  ExternalLink,
  X,
  History,
  Send,
  MessageSquare,
  Trophy,
  Medal,
  Award,
  Flame,
  Maximize2,
  Minimize2,
  ArrowLeft,
  ChevronDown
} from 'lucide-react'
import LeadHistoryModal from '@/components/LeadHistoryModal'
import UpdateFollowupModal from '@/components/UpdateFollowupModal'
import LeadScoreBadge from '@/components/LeadScoreBadge'
import { categorizeLeadStage, extractStagesFromProfile, DEFAULT_PIPELINE_STAGES } from '@/utils/pipeline-stages'
import { hasLeadVisited, getLeadFollowupCount, getLeadReopenCount, getLeadLatestRemark, isLeadLastStatusDnp, getLeadNextActionRemark } from '@/utils/lead-helpers'

// Render simple markdown headers, bolding, and lists into JSX
function MarkdownRenderer({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split('\n')
  
  return (
    <div className="space-y-4 text-slate-300 leading-relaxed text-sm">
      {lines.map((line, idx) => {
        if (line.startsWith('###') || line.startsWith('##') || line.startsWith('#')) {
          const title = line.replace(/^#+\s*/, '')
          return (
            <h4 key={idx} className="text-base font-black text-white mt-6 mb-2 flex items-center gap-2">
              <span className="w-1.5 h-4 rounded-full bg-blue-500 inline-block"></span>
              {title}
            </h4>
          )
        }
        
        if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
          const content = line.trim().replace(/^[-\*]\s*/, '')
          const parts = content.split('**')
          return (
            <div key={idx} className="flex items-start gap-2.5 ml-4 my-1.5">
              <span className="text-blue-400 mt-1.5 font-bold text-xs select-none">●</span>
              <p className="flex-1">
                {parts.map((part, pidx) => pidx % 2 === 1 ? <strong key={pidx} className="font-extrabold text-white">{part}</strong> : part)}
              </p>
            </div>
          )
        }

        if (/^\d+\.\s/.test(line.trim())) {
          const content = line.trim().replace(/^\d+\.\s*/, '')
          const parts = content.split('**')
          const num = line.match(/^\d+/)?.[0] || '1'
          return (
            <div key={idx} className="flex items-start gap-2.5 ml-4 my-1.5">
              <span className="bg-blue-500/20 text-blue-300 font-black rounded-md w-5 h-5 text-[10px] flex items-center justify-center border border-blue-500/30 shrink-0 mt-0.5">{num}</span>
              <p className="flex-1">
                {parts.map((part, pidx) => pidx % 2 === 1 ? <strong key={pidx} className="font-extrabold text-white">{part}</strong> : part)}
              </p>
            </div>
          )
        }

        if (line.trim().startsWith('>')) {
          const content = line.trim().replace(/^>\s*/, '').replace(/^\[!.*?\]\s*/, '')
          return (
            <blockquote key={idx} className="border-l-4 border-blue-500 bg-white/5 py-2.5 px-4 rounded-r-xl my-3 text-slate-300 italic">
              {content}
            </blockquote>
          )
        }

        if (line.trim() === '') return null

        const parts = line.split('**')
        return (
          <p key={idx}>
            {parts.map((part, pidx) => pidx % 2 === 1 ? <strong key={pidx} className="font-extrabold text-white">{part}</strong> : part)}
          </p>
        )
      })}
    </div>
  )
}

function getLeadLastAttemptTime(lead: any): number {
  if (!lead) return 0
  let cf = lead.custom_fields
  if (cf && typeof cf === 'string') {
    try { while (typeof cf === 'string') cf = JSON.parse(cf) } catch (e) {}
  }
  const tFollowup = cf?.last_followup_at ? new Date(cf.last_followup_at).getTime() : 0
  const tAction = cf?.last_action_date ? new Date(cf.last_action_date).getTime() : 0
  const tCallInitiated = cf?.last_call_initiated_at ? new Date(cf.last_call_initiated_at).getTime() : 0
  const tLastCall = lead.last_call_at ? new Date(lead.last_call_at).getTime() : 0
  
  let tRemark = 0
  const rawRemark = (cf?.last_followup_remark || cf?.last_remark || lead.last_followup_remark || lead.last_call_remark || '').trim()
  if (rawRemark) {
    const match = rawRemark.match(/(?:Call on\s+|Logged on\s+|\[)?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?)?/i)
    if (match) {
      const [full, d, m, y, h, min, ampm] = match
      let hour = h ? parseInt(h, 10) : 0
      if (ampm) {
        if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12
        if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0
      }
      const parsed = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hour, min ? parseInt(min, 10) : 0)
      if (!isNaN(parsed.getTime())) tRemark = parsed.getTime()
    }
  }

  const lastAttempt = Math.max(tFollowup, tAction, tCallInitiated, tLastCall, tRemark)
  if (lastAttempt > 0 && !isNaN(lastAttempt)) return lastAttempt
  if (lead.updated_at) {
    const tu = new Date(lead.updated_at).getTime()
    if (!isNaN(tu)) return tu
  }
  if (lead.created_at) {
    const tc = new Date(lead.created_at).getTime()
    if (!isNaN(tc)) return tc
  }
  return 0
}

function getLeadNextActionTime(lead: any): number {
  if (!lead) return 0
  let cf = lead.custom_fields
  if (cf && typeof cf === 'string') {
    try { while (typeof cf === 'string') cf = JSON.parse(cf) } catch (e) {}
  }
  const rawNextDate = lead.next_followup || cf?.next_action_date || lead.booked_time
  if (!rawNextDate) return 0
  const t = new Date(rawNextDate).getTime()
  return isNaN(t) ? 0 : t
}

function parseActionDate(text?: string, fallbackCreatedAt?: string): Date | null {
  if (text) {
    // 1. Bracket notes format: [Followup (Call) - 31/8/2026, 12:10:24 pm] or [Call Not Picked - DNP (31/8/2026...)] or [Remark - 31/8/2026...]
    const bracketMatch = text.match(/\[(?:📝[^-\]]*|⚠️[^-\]]*)\s*-\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})/i)
    if (bracketMatch) {
      const day = parseInt(bracketMatch[1], 10)
      const month = parseInt(bracketMatch[2], 10) - 1
      let year = parseInt(bracketMatch[3], 10)
      if (year < 100) year += 2000
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) return d
    }

    // 2. Workveu historical logs: 'Call on 30/07/2026' or 'Call Not Picked on 30/07/2026' or 'Follow up Date: 30/07/2026'
    const workveuMatch = text.match(/(?:Call on|Call Not Picked on|Follow up Date\s*:)\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})/i)
    if (workveuMatch) {
      const day = parseInt(workveuMatch[1], 10)
      const month = parseInt(workveuMatch[2], 10) - 1
      let year = parseInt(workveuMatch[3], 10)
      if (year < 100) year += 2000
      const d = new Date(year, month, day)
      if (!isNaN(d.getTime())) return d
    }
  }

  if (fallbackCreatedAt) {
    const d = new Date(fallbackCreatedAt)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

export default function AnalyticsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const impersonateId = searchParams.get('impersonate')

  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [duration, setDuration] = useState<'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'all'>('all')
  const [customDate, setCustomDate] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [isDatePickerOpen, setIsDatePickerOpen] = useState<boolean>(false)
  const [dateFilterMode, setDateFilterMode] = useState<'single' | 'range'>('single')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Table Sorting State
  const [sortField, setSortField] = useState<string>('total')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Sub-Tab Navigation
  const [activeTab, setActiveTab] = useState<'analytics' | 'action_mgr' | 'report' | 'lead_mgr' | 'dnp_mgr' | 'team_mgr' | 'leaderboard'>('analytics')
  const [showPending, setShowPending] = useState(true)
  const [showSchedule, setShowSchedule] = useState(true)
  const [showToday, setShowToday] = useState(true)

  const [totalServerCount, setTotalServerCount] = useState<number>(0)

  // Data State — Direct live data from server (No local caching)
  const [leads, setLeads] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [chats, setChats] = useState<any[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [team, setTeam] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)

  // Modals & Interactive Drilldown State
  const [historyLead, setHistoryLead] = useState<any>(null)
  const [followupLead, setFollowupLead] = useState<any>(null)

  const [drilldownModal, setDrilldownModal] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    leads: any[];
    searchFilter: string;
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    leads: [],
    searchFilter: ''
  })
  const [drilldownViewMode, setDrilldownViewMode] = useState<'list' | 'card'>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768 ? 'list' : 'card'
    }
    return 'list'
  })
  const [drilldownSort, setDrilldownSort] = useState<'next_action_asc' | 'next_action_desc' | 'last_attempt_desc' | 'last_attempt_asc' | 'created_desc' | 'created_asc' | 'name_asc'>('next_action_asc')
  const [drilldownIsFullScreen, setDrilldownIsFullScreen] = useState(false)
  const [drilldownStageFilter, setDrilldownStageFilter] = useState<string>('all')
  const [drilldownPage, setDrilldownPage] = useState<number>(1)
  const [drilldownPageSize, setDrilldownPageSize] = useState<number>(25)
  const [fullRemarkModal, setFullRemarkModal] = useState<{ leadName: string; remark: string } | null>(null)

  // Advanced Drilldown Filters (Matching CRM Filters)
  const [drilldownShowFilters, setDrilldownShowFilters] = useState(false)
  const [drilldownAgentFilter, setDrilldownAgentFilter] = useState<string>('ALL')
  const [drilldownNextActionFilter, setDrilldownNextActionFilter] = useState<'ALL' | 'HAS_ACTION' | 'TODAY' | 'OVERDUE' | 'UPCOMING' | 'NO_ACTION'>('ALL')
  const [drilldownNextActionType, setDrilldownNextActionType] = useState<string>('ALL')
  const [drilldownDnpFilter, setDrilldownDnpFilter] = useState<'ALL' | 'DNP_ONLY' | 'DNP_1' | 'DNP_2' | 'DNP_3PLUS' | 'NO_DNP'>('ALL')
  const [drilldownDateRange, setDrilldownDateRange] = useState<string>('ALL')
  const [drilldownDateBasis, setDrilldownDateBasis] = useState<'action' | 'created' | 'any'>('action')
  const [drilldownCustomDate, setDrilldownCustomDate] = useState<string>('')
  const [drilldownStartDate, setDrilldownStartDate] = useState<string>('')
  const [drilldownEndDate, setDrilldownEndDate] = useState<string>('')
  const [drilldownDatePickerOpen, setDrilldownDatePickerOpen] = useState<boolean>(false)
  const [drilldownDateFilterMode, setDrilldownDateFilterMode] = useState<'single' | 'range'>('single')
  const [drilldownCampaign, setDrilldownCampaign] = useState<string>('')
  const [drilldownForm, setDrilldownForm] = useState<string>('')
  const [campaignsList, setCampaignsList] = useState<{ id: string; name: string; meta_campaign_id?: string | null }[]>([])

  // Map of campaign ID / meta_campaign_id -> Official Campaign Name
  const campaignLookupMap = useMemo(() => {
    const map = new Map<string, string>()
    campaignsList.forEach(c => {
      if (c.id && c.name) map.set(String(c.id), c.name)
      if (c.meta_campaign_id && c.name) map.set(String(c.meta_campaign_id), c.name)
    })
    return map
  }, [campaignsList])

  // Action Report Horizontal Scrollbar Refs & Sync Handlers
  const attemptsTableScrollRef = useRef<HTMLDivElement>(null)
  const attemptsTopScrollRef = useRef<HTMLDivElement>(null)
  const attemptsTableRef = useRef<HTMLTableElement>(null)
  const [attemptsTableWidth, setAttemptsTableWidth] = useState<number>(1100)
  const isSyncingAttemptsScroll = useRef<boolean>(false)

  const handleAttemptsTopScroll = () => {
    if (isSyncingAttemptsScroll.current) return
    isSyncingAttemptsScroll.current = true
    if (attemptsTableScrollRef.current && attemptsTopScrollRef.current) {
      attemptsTableScrollRef.current.scrollLeft = attemptsTopScrollRef.current.scrollLeft
    }
    requestAnimationFrame(() => { isSyncingAttemptsScroll.current = false })
  }

  const handleAttemptsTableScroll = () => {
    if (isSyncingAttemptsScroll.current) return
    isSyncingAttemptsScroll.current = true
    if (attemptsTopScrollRef.current && attemptsTableScrollRef.current) {
      attemptsTopScrollRef.current.scrollLeft = attemptsTableScrollRef.current.scrollLeft
    }
    requestAnimationFrame(() => { isSyncingAttemptsScroll.current = false })
  }

  useEffect(() => {
    const updateWidths = () => {
      if (attemptsTableRef.current) {
        setAttemptsTableWidth(attemptsTableRef.current.scrollWidth)
      }
    }
    updateWidths()
    const timer = setTimeout(updateWidths, 150)
    window.addEventListener('resize', updateWidths)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', updateWidths)
    }
  }, [activeTab, leads])

  // Clean resolver for actual Campaign Name across all sources & variations
  const resolveLeadCampaign = useCallback((l: any): string => {
    if (!l) return 'Direct Campaign'

    // 1. Mapped from campaigns table by campaign_id
    if (l.campaign_id && campaignLookupMap.has(String(l.campaign_id))) {
      return campaignLookupMap.get(String(l.campaign_id))!
    }

    // 2. custom_fields / meta_ad_origin
    const cf = l.custom_fields || {}
    if (cf?.meta_ad_origin?.campaign_name && typeof cf.meta_ad_origin.campaign_name === 'string') {
      return cf.meta_ad_origin.campaign_name.trim()
    }
    if (l.campaign_name && typeof l.campaign_name === 'string' && l.campaign_name.trim() && l.campaign_name !== 'null') {
      return l.campaign_name.trim()
    }
    if (cf?.campaign_name && typeof cf.campaign_name === 'string' && cf.campaign_name.trim()) {
      return cf.campaign_name.trim()
    }
    if (cf?.campaign && typeof cf.campaign === 'string' && cf.campaign.trim()) {
      return cf.campaign.trim()
    }

    // 3. Extracted from ad_name: "Campaign Name / Ad Name"
    if (l.ad_name && typeof l.ad_name === 'string') {
      const trimmed = l.ad_name.trim()
      if (trimmed.includes(' / ')) {
        return trimmed.split(' / ')[0].trim()
      }
      if (trimmed && trimmed !== 'null' && trimmed !== 'undefined') {
        return trimmed
      }
    }

    if (l.property?.title) return l.property.title
    if (l.property?.name) return l.property.name

    return 'Direct Campaign'
  }, [campaignLookupMap])

  // Clean resolver for Lead Form or Source (including WhatsApp Qualification Flow names)
  const resolveLeadFormOrSource = useCallback((l: any): string => {
    if (!l) return 'Direct / Organic'
    const cf = l.custom_fields || {}

    // 1. WhatsApp Qualification Flow name
    const qFlow = cf?.qualification_flow_name || (typeof l.form_name === 'string' && l.form_name.startsWith('WhatsApp Flow:') ? l.form_name : null)
    if (qFlow) {
      return String(qFlow).startsWith('WhatsApp Flow:') ? String(qFlow) : `WhatsApp Flow: ${qFlow}`
    }

    // 2. Clean Form Name (skip AI Ad Variation strings)
    if (l.form_name && typeof l.form_name === 'string') {
      const trimmed = l.form_name.trim()
      if (!/^AI Ad Variation/i.test(trimmed) && trimmed !== 'null' && trimmed !== 'undefined') {
        return trimmed
      }
    }

    // 3. Clean Source
    if (l.source && typeof l.source === 'string' && l.source.trim() && l.source !== 'null') {
      return l.source.trim()
    }

    return 'Direct / Organic'
  }, [])

  // Dynamic extraction of unique campaigns and forms from drilldown modal leads (fallback to all leads)
  const modalCampaigns = useMemo(() => {
    if (!drilldownModal.isOpen) return []
    const sourceList = drilldownModal.leads && drilldownModal.leads.length > 0 ? drilldownModal.leads : leads
    const list: string[] = []
    sourceList.forEach((l: any) => {
      const camp = resolveLeadCampaign(l)
      if (camp && typeof camp === 'string' && camp.trim() && camp !== 'null' && camp !== 'undefined') {
        list.push(camp.trim())
      }
    })
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b))
  }, [drilldownModal.isOpen, drilldownModal.leads, leads, resolveLeadCampaign])

  const modalForms = useMemo(() => {
    if (!drilldownModal.isOpen) return []
    const sourceList = drilldownModal.leads && drilldownModal.leads.length > 0 ? drilldownModal.leads : leads
    const list: string[] = []
    sourceList.forEach((l: any) => {
      const fName = resolveLeadFormOrSource(l)
      if (fName && typeof fName === 'string' && fName.trim() && fName !== 'null' && fName !== 'undefined') {
        list.push(fName.trim())
      }
    })
    return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b))
  }, [drilldownModal.isOpen, drilldownModal.leads, leads, resolveLeadFormOrSource])

  // Count active drilldown filters (excluding default values)
  const activeDrilldownFilterCount = useMemo(() => {
    let count = 0
    if (drilldownAgentFilter !== 'ALL') count++
    if (drilldownNextActionFilter !== 'ALL') count++
    if (drilldownNextActionType !== 'ALL') count++
    if (drilldownDnpFilter !== 'ALL') count++
    if (drilldownDateRange !== 'ALL' || !!drilldownCustomDate || (!!drilldownStartDate && !!drilldownEndDate)) count++
    if (drilldownCampaign) count++
    if (drilldownForm) count++
    if (drilldownStageFilter !== 'all') count++
    return count
  }, [drilldownAgentFilter, drilldownNextActionFilter, drilldownNextActionType, drilldownDnpFilter, drilldownDateRange, drilldownCustomDate, drilldownStartDate, drilldownEndDate, drilldownCampaign, drilldownForm, drilldownStageFilter])

  // Reset all drilldown filters to defaults
  const clearAllDrilldownFilters = () => {
    setDrilldownAgentFilter('ALL')
    setDrilldownNextActionFilter('ALL')
    setDrilldownNextActionType('ALL')
    setDrilldownDnpFilter('ALL')
    setDrilldownDateRange('ALL')
    setDrilldownDateBasis('action')
    setDrilldownCustomDate('')
    setDrilldownStartDate('')
    setDrilldownEndDate('')
    setDrilldownCampaign('')
    setDrilldownForm('')
    setDrilldownStageFilter('all')
    setDrilldownDatePickerOpen(false)
    setDrilldownPage(1)
  }

  // Stage counts for active drilldown modal
  const modalStages = useMemo(() => {
    if (!drilldownModal.isOpen || !drilldownModal.leads) return []
    const map = new Map<string, number>()
    drilldownModal.leads.forEach(l => {
      const st = l.pipeline_stage || l.status || 'New Lead'
      map.set(st, (map.get(st) || 0) + 1)
    })
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
  }, [drilldownModal.isOpen, drilldownModal.leads])

  // Clear legacy analytics caches from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('analytics_cache_')) localStorage.removeItem(k)
        })
      } catch (e) {}
    }
  }, [])

  const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, form_name, next_followup, assigned_to, budget, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience, whatsapp_enabled'

  // Fetch Analytics — Direct Supabase parallel queries (no API route middleman)
  const fetchAnalytics = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else if (leads.length === 0) setLoading(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const activeUserId = impersonateId || user.id
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', activeUserId)
        .single()

      if (userProfile) setProfile(userProfile)

      const myRole = userProfile?.role?.toLowerCase() || 'admin'
      const hasParentWorkspace = Boolean(userProfile?.parent_id || (userProfile?.agency_id && myRole !== 'agency'))
      const isTeamUser = myRole === 'agent' || myRole === 'team_member' || hasParentWorkspace

      let targetOwnerId = user.id
      if (impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined' && impersonateId !== user.id) {
        targetOwnerId = impersonateId
      } else if (userProfile?.parent_id) {
        targetOwnerId = userProfile.parent_id
      } else if (userProfile?.agency_id && myRole !== 'agency') {
        targetOwnerId = userProfile.agency_id
      }

      // Get workspace team IDs
      const { data: teamProfiles } = await supabase.from('profiles')
        .select('id')
        .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)
      const workspaceTeamIds = Array.from(new Set((teamProfiles || []).map(p => p.id)))
      if (workspaceTeamIds.length === 0) workspaceTeamIds.push(targetOwnerId)

      // Build filter function
      // If an agent is selected in dropdown, filter by that agent
      // If the current user is an agent / team user and no agent is selected, scope to their own leads
      const activeAgentId = (selectedAgentId && selectedAgentId !== 'all')
        ? selectedAgentId
        : ((myRole === 'agent' || myRole === 'team_member') ? user.id : (isTeamUser && !selectedAgentId ? user.id : null))

      let filterFn: (q: any) => any
      if (activeAgentId && activeAgentId !== 'unassigned') {
        filterFn = (q: any) => q.in('user_id', workspaceTeamIds).or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
      } else if (activeAgentId === 'unassigned') {
        filterFn = (q: any) => q.is('assigned_to', null).in('user_id', workspaceTeamIds)
      } else {
        const workspaceOrConditions = workspaceTeamIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',')
        filterFn = (q: any) => q.or(workspaceOrConditions)
      }

      // Parse custom_fields helper
      const parseLeads = (rawLeads: any[]) => rawLeads.map(lead => {
        let cf = lead.custom_fields
        if (cf && typeof cf === 'string') {
          try { while (typeof cf === 'string') cf = JSON.parse(cf) } catch (e) { cf = {} }
        }
        return { ...lead, custom_fields: cf || {} }
      })

      // Step 1: First 1000 leads + count + campaigns in parallel
      const firstPageQ = filterFn(supabase.from('leads').select(leadFields))
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(0, 999)
      const countQ = filterFn(supabase.from('leads').select('*', { count: 'exact', head: true }))
      const campaignsQ = supabase.from('campaigns').select('id, name, meta_campaign_id').in('user_id', workspaceTeamIds)

      const [firstPageRes, countRes, campaignsRes] = await Promise.all([firstPageQ, countQ, campaignsQ])

      if (campaignsRes?.data) {
        setCampaignsList(campaignsRes.data)
      }

      const totalCount = countRes.count || (firstPageRes.data?.length || 0)
      setTotalServerCount(totalCount)

      const seenLeadMap = new Map()
      parseLeads(firstPageRes.data || []).forEach((l: any) => {
        if (l && l.id && !seenLeadMap.has(l.id)) seenLeadMap.set(l.id, l)
      })

      let allLeads = Array.from(seenLeadMap.values())
      setLeads(allLeads)
      if (!forceRefresh) {
        setLoading(false)
      }

      // Step 2: Fetch remaining lead pages in parallel
      if (totalCount > 1000) {
        const remainingPages = Math.ceil(totalCount / 1000) - 1
        const batchPromises = Array.from({ length: remainingPages }, (_, i) => {
          const pageIdx = i + 1
          return filterFn(supabase.from('leads').select(leadFields))
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(pageIdx * 1000, (pageIdx + 1) * 1000 - 1)
        })

        const batchResults = await Promise.all(batchPromises)
        for (const r of batchResults) {
          if (r.data && r.data.length > 0) {
            parseLeads(r.data).forEach((l: any) => {
              if (l && l.id && !seenLeadMap.has(l.id)) {
                seenLeadMap.set(l.id, l)
              }
            })
          }
        }
        allLeads = Array.from(seenLeadMap.values())
        setLeads(allLeads)
        setTotalServerCount(allLeads.length > totalCount ? allLeads.length : totalCount)
      }

      // Step 3: Fetch team profiles + lead_history in background
      ;(async () => {
        try {
          // Team profiles
          const { data: teamMembers } = await supabase.from('profiles')
            .select('id, email, business_name, full_name, role, created_at')
            .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)
            .order('created_at', { ascending: false })

          // Lead history (for call tracking)
          let historyLeads: any[] = []
          const { count: historyCount } = await supabase.from('lead_history')
            .select('*', { count: 'exact', head: true })
            .in('user_id', workspaceTeamIds)
          
          const historyTotal = historyCount || 0
          if (historyTotal > 0) {
            const historyPages = Math.min(Math.ceil(historyTotal / 1000), 50)
            const historyPromises = Array.from({ length: historyPages }, (_, i) => {
              return supabase.from('lead_history')
                .select('id, lead_id, user_id, action_type, description, created_at')
                .in('user_id', workspaceTeamIds)
                .order('created_at', { ascending: false })
                .range(i * 1000, (i + 1) * 1000 - 1)
            })
            const historyResults = await Promise.all(historyPromises)
            for (const r of historyResults) {
              if (r.data && r.data.length > 0) historyLeads = historyLeads.concat(r.data)
            }
          }

          setHistory(historyLeads)

          // Compute team metrics
          const rawTeam = teamMembers || []
          const isActualCallAction = (h: any) => {
            const type = (h.action_type || '').toUpperCase()
            const desc = (h.description || '').toLowerCase()
            if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT'].includes(type)) return false
            if (desc.includes('facebook ad submission') || desc.includes('reopened from facebook') || desc.includes('bulk transferred') || desc.includes('transferred from')) return false
            if (['CALL_FEEDBACK', 'CALL', 'OUTBOUND_CALL', 'CALL_LOG', 'DNP'].includes(type)) return true
            if (desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) return true
            if (desc.includes('call') || desc.includes('followup') || desc.includes('feedback')) return true
            return false
          }

          const hasMultipleMembers = rawTeam.length > 1
          const teamData = rawTeam.map(member => {
            const memberLeads = allLeads.filter(l => hasMultipleMembers ? (l.assigned_to === member.id) : (l.assigned_to === member.id || l.user_id === member.id || !l.assigned_to))
            const wonLeads = memberLeads.filter(l => ['Won', 'Closed', 'Appointment done', 'Deal/Token'].includes(l.pipeline_stage) || ['Won', 'Closed', 'Appointment done', 'Deal/Token'].includes(l.status)).length
            const qualifiedLeads = memberLeads.filter(l => ['Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Won', 'Negotiation', 'Visit Done'].includes(l.pipeline_stage) || ['Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Won', 'Negotiation', 'Visit Done'].includes(l.status)).length
            const lostLeads = memberLeads.filter(l => ['Lost', 'Unqualified', 'Lost/NI', 'Different Requirement'].includes(l.pipeline_stage) || ['Lost', 'Unqualified', 'Lost/NI', 'Different Requirement'].includes(l.status)).length

            const reqTakenCount = memberLeads.filter(l => l.status === 'Requirement Taken' || l.pipeline_stage === 'Contacted').length
            const visitPlannedCount = memberLeads.filter(l => l.status === 'Visit Planned' || l.pipeline_stage === 'Appointment booked').length
            const visitDoneCount = memberLeads.filter(l => l.status === 'Visit Done' || l.pipeline_stage === 'Appointment done').length
            const revisitDoneCount = memberLeads.filter(l => l.status === 'Revisit Done').length
            const negotiationCount = memberLeads.filter(l => l.status === 'Negotiation' || l.pipeline_stage === 'Qualified').length
            const dealTokenCount = memberLeads.filter(l => l.status === 'Deal/Token' || l.pipeline_stage === 'Closed' || l.pipeline_stage === 'Won').length

            const memberHistory = historyLeads.filter(h => h.user_id === member.id)
            const memberCallCount = memberHistory.filter(isActualCallAction).length
            const memberLeadsDnpCount = memberLeads.filter(l => {
              let cf = l.custom_fields
              if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch(e) {} }
              const stageLower = (l.pipeline_stage || l.status || '').toLowerCase()
              return cf?.last_call_dnp === true || (cf?.dnp_count > 0) || stageLower.includes('dnp') || stageLower === 'never picked'
            }).length

            const totalDnpOnLeads = Math.max(
              memberHistory.filter(h => {
                const desc = (h.description || '').toLowerCase()
                const type = (h.action_type || '').toUpperCase()
                return type === 'DNP' || desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')
              }).length,
              memberLeadsDnpCount
            )

            const conversionRate = memberLeads.length > 0 ? ((wonLeads / memberLeads.length) * 100).toFixed(1) : '0.0'

            return {
              id: member.id,
              email: member.email,
              business_name: member.business_name || member.full_name || member.email,
              role: member.role,
              metrics: {
                leadsCount: memberLeads.length,
                wonCount: wonLeads,
                qualifiedCount: qualifiedLeads,
                lostCount: lostLeads,
                callsCount: memberCallCount,
                dnpCount: totalDnpOnLeads,
                conversionRate,
                reqTakenCount,
                visitPlannedCount,
                visitDoneCount,
                revisitDoneCount,
                negotiationCount,
                dealTokenCount
              }
            }
          })

          setTeam(teamData)
        } catch (bgErr) {
          console.error('[Analytics background fetch error]:', bgErr)
        }
      })()

    } catch (e: any) {
      console.error('[Analytics Fetch Error]:', e)
      toast.error('Connection error: ' + (e.message || String(e)))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [duration, selectedAgentId, customDate, startDate, endDate])

  // Helper to determine whether workspace has multiple team members/agents
  const hasTeamMembers = useMemo(() => {
    return Boolean(team && team.filter(m => m.role === 'agent' || (profile && m.id !== profile.id)).length > 0)
  }, [team, profile])

  // Helper to accurately check if a lead belongs to a sales rep
  const isLeadAssignedToRep = useCallback((l: any, repId: string) => {
    if (repId === 'unassigned') {
      return !l.assigned_to
    }
    if (!hasTeamMembers) {
      return l.assigned_to === repId || l.user_id === repId || !l.assigned_to
    }
    return l.assigned_to === repId
  }, [hasTeamMembers])

  // All sales reps resolved from team profiles AND assigned lead records
  const allSalesReps = useMemo(() => {
    if (team && team.length > 0) {
      const repIdsFromLeads = Array.from(new Set(leads.map(l => l.assigned_to).filter(Boolean)))
      const effectiveOwnerId = profile?.parent_id || profile?.agency_id || profile?.id
      const hasAgents = team.some(m => m.role === 'agent' || m.id !== effectiveOwnerId)

      return [
        ...team
          .filter(member => {
            // In a team workspace, the company/admin account is only listed if it actively has assigned leads
            if (hasAgents && member.id === effectiveOwnerId) {
              return leads.some(l => l.assigned_to === member.id)
            }
            return true
          })
          .map(member => ({
            id: member.id,
            name: member.business_name || member.full_name || member.email || 'Sales Rep',
            email: member.email,
            role: member.role || 'agent'
          })),
        ...repIdsFromLeads
          .filter(id => !team.some(t => t.id === id))
          .map(id => ({ id, name: id === profile?.id ? (profile?.business_name || profile?.full_name || 'You') : `Agent (${id.slice(0, 6)})`, email: '', role: 'agent' }))
      ]
    }

    if (profile?.id) {
      return [{
        id: profile.id,
        name: profile.business_name || profile.full_name || profile.email || 'You',
        email: profile.email,
        role: profile.role || 'agent'
      }]
    }

    return []
  }, [team, leads, profile])

  // --- DATE RANGE CUTOFF HELPER ---
  const dateCutoffs = useMemo(() => {
    const userTz = profile?.timezone || 'Asia/Kolkata'

    const getZonedNowParts = (tz: string) => {
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hour12: false
        })
        const parts = formatter.formatToParts(new Date())
        const map: Record<string, number> = {}
        parts.forEach(p => { if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10) })
        return {
          year: map.year || new Date().getFullYear(),
          month: (map.month || (new Date().getMonth() + 1)) - 1,
          day: map.day || new Date().getDate(),
          hour: map.hour === 24 ? 0 : (map.hour || 0),
          minute: map.minute || 0,
          second: map.second || 0
        }
      } catch (e) {
        const d = new Date()
        return {
          year: d.getFullYear(),
          month: d.getMonth(),
          day: d.getDate(),
          hour: d.getHours(),
          minute: d.getMinutes(),
          second: d.getSeconds()
        }
      }
    }

    const getUtcDateForZonedMidnight = (year: number, month: number, day: number, tz: string, isEnd: boolean = false) => {
      try {
        const h = isEnd ? 23 : 0
        const m = isEnd ? 59 : 0
        const s = isEnd ? 59 : 0
        const ms = isEnd ? 999 : 0

        const d = new Date(Date.UTC(year, month, day, h, m, s, ms))
        const invFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hour12: false
        })
        const targetParts = invFormatter.formatToParts(d)
        const zMap: Record<string, number> = {}
        targetParts.forEach(p => { if (p.type !== 'literal') zMap[p.type] = parseInt(p.value, 10) })
        const zHour = zMap.hour === 24 ? 0 : (zMap.hour || 0)
        const zDate = Date.UTC(zMap.year || year, (zMap.month || (month + 1)) - 1, zMap.day || day, zHour, zMap.minute || 0, zMap.second || 0)
        const diff = zDate - d.getTime()
        return new Date(d.getTime() - diff)
      } catch (e) {
        return new Date(year, month, day, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0)
      }
    }

    const zParts = getZonedNowParts(userTz)
    let startCutoff: Date | null = null
    let endCutoff: Date | null = null

    if (customDate) {
      const [cy, cm, cd] = customDate.split('-').map(Number)
      if (cy && cm && cd) {
        startCutoff = getUtcDateForZonedMidnight(cy, cm - 1, cd, userTz, false)
        endCutoff = getUtcDateForZonedMidnight(cy, cm - 1, cd, userTz, true)
      }
    } else if (startDate) {
      const [sy, sm, sd] = startDate.split('-').map(Number)
      startCutoff = (sy && sm && sd) ? getUtcDateForZonedMidnight(sy, sm - 1, sd, userTz, false) : new Date(startDate)
      if (endDate) {
        const [ey, em, ed] = endDate.split('-').map(Number)
        endCutoff = (ey && em && ed) ? getUtcDateForZonedMidnight(ey, em - 1, ed, userTz, true) : new Date(endDate)
      }
    } else {
      switch (duration) {
        case 'today':
          startCutoff = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, userTz, false)
          endCutoff = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, userTz, true)
          break
        case '7d':
          const p7 = getZonedNowParts(userTz)
          startCutoff = getUtcDateForZonedMidnight(p7.year, p7.month, p7.day - 6, userTz, false)
          endCutoff = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, userTz, true)
          break
        case '30d':
          const p30 = getZonedNowParts(userTz)
          startCutoff = getUtcDateForZonedMidnight(p30.year, p30.month, p30.day - 29, userTz, false)
          endCutoff = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, userTz, true)
          break
        case 'this_month':
          startCutoff = getUtcDateForZonedMidnight(zParts.year, zParts.month, 1, userTz, false)
          endCutoff = getUtcDateForZonedMidnight(zParts.year, zParts.month, zParts.day, userTz, true)
          break
        case 'last_month':
          const lastMonthIndex = zParts.month === 0 ? 11 : zParts.month - 1
          const lastMonthYear = zParts.month === 0 ? zParts.year - 1 : zParts.year
          const lastDayOfPrevMonth = new Date(lastMonthYear, lastMonthIndex + 1, 0).getDate()
          startCutoff = getUtcDateForZonedMidnight(lastMonthYear, lastMonthIndex, 1, userTz, false)
          endCutoff = getUtcDateForZonedMidnight(lastMonthYear, lastMonthIndex, lastDayOfPrevMonth, userTz, true)
          break
        case 'all':
        default:
          startCutoff = null
          endCutoff = null
          break
      }
    }

    const isDateInRange = (rawDate?: any) => {
      if (!startCutoff && !endCutoff) return true
      if (!rawDate) return false
      const dateVal = (typeof rawDate === 'object' && rawDate !== null && !(rawDate instanceof Date))
        ? (rawDate.created_at || rawDate.action_date || rawDate.date || rawDate.last_followup_at || rawDate.last_call_at)
        : rawDate
      if (!dateVal) return false
      const d = new Date(dateVal)
      if (isNaN(d.getTime())) return false
      if (startCutoff && d < startCutoff) return false
      if (endCutoff && d > endCutoff) return false
      return true
    }

    return { startCutoff, endCutoff, isDateInRange }
  }, [duration, customDate, startDate, endDate, profile?.timezone])

  // Filter leads based on selectedAgentId AND selected date range
  const filteredLeads = useMemo(() => {
    let list = leads
    if (selectedAgentId) {
      if (selectedAgentId === 'unassigned') list = list.filter(l => !l.assigned_to)
      else list = list.filter(l => l.assigned_to === selectedAgentId || l.user_id === selectedAgentId)
    }

    if (dateCutoffs.startCutoff || dateCutoffs.endCutoff) {
      list = list.filter(l => {
        let cf = l.custom_fields
        if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
        
        return (
          dateCutoffs.isDateInRange(l.created_at) ||
          dateCutoffs.isDateInRange(l.updated_at) ||
          dateCutoffs.isDateInRange(cf?.last_followup_at) ||
          dateCutoffs.isDateInRange(cf?.last_action_date) ||
          dateCutoffs.isDateInRange(l.last_call_at)
        )
      })
    }

    return list
  }, [leads, selectedAgentId, dateCutoffs])

  const configuredStages = useMemo(() => extractStagesFromProfile(profile), [profile])

  // --- STATS PRE-COMPUTATIONS ---
  const stats = useMemo(() => {
    const isFilteredByDate = !!(dateCutoffs.startCutoff || dateCutoffs.endCutoff)
    const totalLeads = (!selectedAgentId && !isFilteredByDate && duration === 'all' && totalServerCount > filteredLeads.length)
      ? totalServerCount 
      : filteredLeads.length

    const wonLeads = filteredLeads.filter(l => l.pipeline_stage === 'Won' || l.pipeline_stage === 'Closed').length
    const lostLeads = filteredLeads.filter(l => l.pipeline_stage === 'Lost' || l.pipeline_stage === 'Unqualified').length
    const inProgress = totalLeads - wonLeads - lostLeads
    const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0'

    const totalCalls = filteredLeads.filter(l => l.last_call_at || l.last_call_status).length
    
    // Accurate DNP calculation: when date filter is active, count leads with an actual DNP logged during this duration
    const dnpLeadsList = isFilteredByDate
      ? filteredLeads.filter(l => {
          let cf = l.custom_fields
          if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
          const hasDnpInRange = (cf?.last_call_dnp === true && dateCutoffs.isDateInRange(cf?.last_followup_at))
          const hasDnpAction = (l.dnp_count > 0 || cf?.dnp_count > 0) && (
            dateCutoffs.isDateInRange(cf?.last_followup_at) ||
            dateCutoffs.isDateInRange(cf?.last_action_date) ||
            dateCutoffs.isDateInRange(l.last_call_at)
          )
          const notes = l.notes || ''
          const hasNoteDnp = notes.includes('[⚠️') && notes.split(/(?=\[⚠️)/).some((chk: string) => {
            const d = parseActionDate(chk)
            return d && dateCutoffs.isDateInRange(d)
          })
          return Boolean(hasDnpInRange || hasDnpAction || hasNoteDnp)
        })
      : filteredLeads.filter(l => (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0))

    const totalDnp = dnpLeadsList.length

    const reopenedLeadsList = filteredLeads.filter(l => l.reopened_count > 0 || l.custom_fields?.reopened_count > 0)
    const unassignedLeadsList = filteredLeads.filter(l => !l.assigned_to)
    const followUpLeadsList = filteredLeads.filter(l => l.next_action_date || l.custom_fields?.next_action_date)
    const freshLeadsList = filteredLeads.filter(l => categorizeLeadStage(l, configuredStages) === 'fresh')
    const ongoingLeadsList = filteredLeads.filter(l => categorizeLeadStage(l, configuredStages) === 'ongoing')
    const notInterestedLeadsList = filteredLeads.filter(l => categorizeLeadStage(l, configuredStages) === 'not_interested')
    const recentLeadsList = filteredLeads.filter(l => {
      const d = new Date(l.created_at)
      return (Date.now() - d.getTime()) <= 86400000
    })

    // Duplicate phone check
    const phoneMap: Record<string, any[]> = {}
    filteredLeads.forEach(l => {
      const p = l.phone ? l.phone.replace(/\D/g, '').slice(-10) : ''
      if (p && p.length >= 7) {
        if (!phoneMap[p]) phoneMap[p] = []
        if (!phoneMap[p].some(existing => existing.id === l.id)) {
          phoneMap[p].push(l)
        }
      }
    })
    const duplicateLeadsList = Object.values(phoneMap).filter(list => list.length > 1).flat()

    return {
      totalLeads,
      wonLeads,
      lostLeads,
      inProgress,
      conversionRate,
      totalCalls,
      totalDnp,
      dnpLeadsList,
      reopenedCount: reopenedLeadsList.length,
      unassignedCount: unassignedLeadsList.length,
      duplicateCount: duplicateLeadsList.length,
      followUpCount: followUpLeadsList.length,
      reopenedLeadsList,
      unassignedLeadsList,
      duplicateLeadsList,
      followUpLeadsList,
      freshLeadsList,
      ongoingLeadsList,
      notInterestedLeadsList,
      recentLeadsList
    }
  }, [filteredLeads, configuredStages, selectedAgentId, duration, totalServerCount, dateCutoffs])

  // --- EMPLOYEE-WISE LEAD MANAGER MATRIX (WorkVeu Screenshot 2) ---
  const leadManagerMatrix = useMemo(() => {
    const salesReps = [
      ...allSalesReps,
      { id: 'unassigned', name: 'Unassigned', email: '', role: 'system' }
    ]

    const stagesList = [
      { key: 'new', label: 'New Lead' },
      { key: 'ongoing', label: 'Ongoing' },
      { key: 'contacted', label: 'Contacted' },
      { key: 'appointment', label: 'Appointment Booked' },
      { key: 'booked', label: 'Visit Planned' },
      { key: 'done', label: 'Visit Done' },
      { key: 'revisit', label: 'Revisit Done' },
      { key: 'qualified', label: 'Negotiation' },
      { key: 'unqualified', label: 'Lost/NI' },
      { key: 'meeting_planned', label: 'Meeting Planned' },
      { key: 'meeting_done', label: 'Meeting Done' },
      { key: 'dnp', label: 'Never Picked' }
    ]

    let rows = salesReps.map(rep => {
      const repLeads = filteredLeads.filter(l => rep.id === 'unassigned' ? !l.assigned_to : l.assigned_to === rep.id)
      
      const categoryLeads: Record<string, any[]> = {
        new: repLeads.filter(l => l.pipeline_stage === 'New Lead' || l.pipeline_stage === 'New' || l.status === 'New Lead' || l.status === 'New'),
        ongoing: repLeads.filter(l => l.pipeline_stage === 'Ongoing' || l.status === 'Ongoing'),
        contacted: repLeads.filter(l => l.pipeline_stage === 'Contacted' || l.pipeline_stage === 'Requirement Taken' || l.status === 'Contacted' || l.status === 'Requirement Taken'),
        appointment: repLeads.filter(l => l.pipeline_stage === 'Appointment Booked' || l.pipeline_stage === 'Appointment booked'),
        booked: repLeads.filter(l => l.pipeline_stage === 'Visit Planned' || l.status === 'Visit Planned' || ((typeof l.custom_fields === 'object' ? l.custom_fields?.next_action_type : null) === 'Visit')),
        done: repLeads.filter(l => l.pipeline_stage === 'Visit Done' || l.pipeline_stage === 'Appointment done' || l.status === 'Visit Done'),
        revisit: repLeads.filter(l => l.pipeline_stage === 'Revisit Done' || l.custom_fields?.revisit === true),
        qualified: repLeads.filter(l => l.pipeline_stage === 'Negotiation' || l.pipeline_stage === 'Deal/Token' || l.status === 'Negotiation' || l.status === 'Deal/Token'),
        unqualified: repLeads.filter(l => l.pipeline_stage === 'Lost/NI' || l.pipeline_stage === 'Closed' || l.status === 'Lost/NI' || l.pipeline_stage === 'Dealer' || l.pipeline_stage === 'Plan Postponed' || l.pipeline_stage === 'Already Purchased'),
        meeting_planned: repLeads.filter(l => {
          let cf: any = l.custom_fields;
          if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch (e) {}
          }
          const nextAct = (cf?.next_action_type || l.next_action_type || '').toLowerCase();
          const lastAct = (cf?.last_followup_type || l.last_followup_type || '').toLowerCase();
          const st = (l.pipeline_stage || l.status || '').toLowerCase();
          return st.includes('meeting planned') || nextAct.includes('meeting') || nextAct.includes('closing') || nextAct.includes('home') || lastAct.includes('meeting') || lastAct.includes('closing') || lastAct.includes('home');
        }),
        meeting_done: repLeads.filter(l => l.status === 'Meeting Done' || l.pipeline_stage === 'Meeting Done'),
        dnp: repLeads.filter(l => {
          const st = (l.pipeline_stage || l.status || '').toLowerCase()
          return st === 'never picked' || st === 'never_picked'
        }),
        total: repLeads
      }

      const counts: Record<string, number> = {}
      Object.keys(categoryLeads).forEach(k => {
        counts[k] = categoryLeads[k].length
      })

      return { rep, counts, categoryLeads }
    }).filter(r => r.rep.id !== 'unassigned' || r.counts.total > 0)

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      rows = rows.filter(r => r.rep.name.toLowerCase().includes(q))
    }

    // Sort rows dynamically
    rows.sort((a, b) => {
      let valA = sortField === 'name' ? a.rep.name : (a.counts[sortField] || 0)
      let valB = sortField === 'name' ? b.rep.name : (b.counts[sortField] || 0)
      
      if (typeof valA === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB as string) : (valB as string).localeCompare(valA)
      }
      return sortOrder === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number)
    })

    const totals: Record<string, number> = { total: 0 }
    stagesList.forEach(s => totals[s.key] = 0)
    rows.forEach(r => {
      totals.total += r.counts.total
      stagesList.forEach(s => {
        totals[s.key] += r.counts[s.key] || 0
      })
    })

    return { rows, totals, stagesList }
  }, [filteredLeads, allSalesReps, searchQuery, sortField, sortOrder])

  // --- EMPLOYEE-WISE DNP MANAGER MATRIX (WorkVeu Screenshot 1) ---
  const dnpManagerMatrix = useMemo(() => {
    const salesReps = [
      ...allSalesReps,
      { id: 'unassigned', name: 'Unassigned', email: '' }
    ]

    const todayStr = new Date().toISOString().split('T')[0]

    let rows = salesReps.map(rep => {
      const repLeads = leads.filter(l => rep.id === 'unassigned' ? !l.assigned_to : l.assigned_to === rep.id)
      
      const todayDnpLeads = repLeads.filter(l => {
        const dnpCnt = l.dnp_count || l.custom_fields?.dnp_count || 0
        const isToday = l.updated_at && l.updated_at.startsWith(todayStr)
        return dnpCnt > 0 && isToday
      })

      const todayUntouchedLeads = repLeads.filter(l => {
        const isToday = l.created_at && l.created_at.startsWith(todayStr)
        const noCalls = !l.last_call_at && (!l.dnp_count || l.dnp_count === 0)
        return isToday && noCalls
      })

      const pendingOldDnpLeads = repLeads.filter(l => {
        const dnpCnt = l.dnp_count || l.custom_fields?.dnp_count || 0
        const isOld = !l.created_at || !l.created_at.startsWith(todayStr)
        return dnpCnt > 0 && isOld
      })

      const pendingUntouchedLeads = repLeads.filter(l => {
        const isOld = !l.created_at || !l.created_at.startsWith(todayStr)
        const noCalls = !l.last_call_at && (!l.dnp_count || l.dnp_count === 0)
        return isOld && noCalls
      })

      const totalLeadsList = repLeads.filter(l => (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0 || !l.last_call_at))

      return {
        rep,
        todayDnpLeads,
        todayUntouchedLeads,
        pendingOldDnpLeads,
        pendingUntouchedLeads,
        totalLeadsList,
        todayDnp: todayDnpLeads.length,
        todayUntouched: todayUntouchedLeads.length,
        pendingOldDnp: pendingOldDnpLeads.length,
        pendingUntouched: pendingUntouchedLeads.length,
        total: totalLeadsList.length
      }
    }).filter(r => r.rep.id !== 'unassigned' || r.total > 0)

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      rows = rows.filter(r => r.rep.name.toLowerCase().includes(q))
    }

    const totals = {
      todayDnp: rows.reduce((a, b) => a + b.todayDnp, 0),
      todayUntouched: rows.reduce((a, b) => a + b.todayUntouched, 0),
      pendingOldDnp: rows.reduce((a, b) => a + b.pendingOldDnp, 0),
      pendingUntouched: rows.reduce((a, b) => a + b.pendingUntouched, 0),
      total: rows.reduce((a, b) => a + b.total, 0)
    }

    const totalUntouchedLeads = leads.filter(l => !l.last_call_at && (!l.dnp_count || l.dnp_count === 0))
    const totalDnpLeads = leads.filter(l => (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0))

    return { 
      rows, 
      totals, 
      totalUntouchedLeads, 
      totalDnpLeads, 
      totalUntouched: totalUntouchedLeads.length, 
      totalDnp: totalDnpLeads.length 
    }
  }, [leads, allSalesReps, searchQuery])

  const isAdminLike = ['super_admin', 'agency', 'admin', 'client'].includes(profile?.role || 'admin')

  // --- EMPLOYEE-WISE ACTION MANAGER MATRIX (Screenshot 1) ---
  const actionManagerMatrix = useMemo(() => {
    const salesReps = [
      ...allSalesReps,
      { id: 'unassigned', name: 'Unassigned', email: '' }
    ]

    const todayObj = new Date()
    const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`

    const getLocalDateStr = (dateVal: any): string | null => {
      if (!dateVal) return null
      let d: Date | null = null
      if (typeof dateVal === 'string' && dateVal.includes('-') && dateVal.split('-')[0].length === 2) {
        const parts = dateVal.split(' ')
        const dateParts = parts[0].split('-')
        d = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${parts[1] || '00:00'}:00`)
      } else {
        d = new Date(dateVal)
      }
      if (!d || isNaN(d.getTime())) return null
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    const actionTypes = [
      { key: 'Call', label: 'Call' },
      { key: 'Visit', label: 'Visit' },
      { key: 'Revisit', label: 'Revisit' },
      { key: 'Closing Meeting', label: 'Closing Meeting' },
      { key: 'Home Meeting', label: 'Home Meeting' }
    ]

    let rows = allSalesReps.map(rep => {
      const repLeadsRaw = leads.filter(l => isLeadAssignedToRep(l, rep.id))

      // Deduplicate by ID and phone number
      const seenIds = new Set()
      const seenPhones = new Set()
      const repLeads = repLeadsRaw.filter(l => {
        if (seenIds.has(l.id)) return false
        seenIds.add(l.id)
        if (l.phone) {
          const cleanP = l.phone.replace(/\D/g, '').slice(-10)
          if (cleanP.length === 10) {
            if (seenPhones.has(cleanP)) return false
            seenPhones.add(cleanP)
          }
        }
        return true
      })

      const counts: Record<string, { pending: number; schedule: number; today: number; total: number }> = {}
      const typeLeads: Record<string, { pending: any[]; schedule: any[]; today: any[] }> = {}

      actionTypes.forEach(t => {
        counts[t.key] = { pending: 0, schedule: 0, today: 0, total: 0 }
        typeLeads[t.key] = { pending: [], schedule: [], today: [] }
      })

      let totalPending = 0, totalSchedule = 0, totalToday = 0
      const totalPendingLeads: any[] = []
      const totalScheduleLeads: any[] = []
      const totalTodayLeads: any[] = []

      repLeads.forEach(l => {
        let cf: any = l.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) {}
        }

        // Exclude leads that belong to the 'not_interested' or 'trash' sections, or closed/won leads
        const stageCat = categorizeLeadStage(l)
        if (stageCat === 'not_interested' || stageCat === 'trash') return

        const stageLower = (l.pipeline_stage || '').trim().toLowerCase()
        const statusLower = (l.status || '').trim().toLowerCase()
        if (['won', 'closed'].includes(stageLower) || ['won', 'closed'].includes(statusLower)) return

        const lastFollowupDateStr = getLocalDateStr(cf?.last_followup_at || l.last_call_at)
        const nextActionDateStr = getLocalDateStr(l.next_followup || cf?.next_action_date || l.booked_time)

        if (!nextActionDateStr) return

        const rawActType = (cf?.next_action_type || l.next_action_type || '').trim().toLowerCase()
        let actTypeKey = 'Call'
        if (rawActType === 'revisit' || rawActType.includes('revisit')) actTypeKey = 'Revisit'
        else if (rawActType.includes('closing')) actTypeKey = 'Closing Meeting'
        else if (rawActType.includes('home')) actTypeKey = 'Home Meeting'
        else if (rawActType === 'visit' || rawActType === 'site visit') actTypeKey = 'Visit'
        else if (rawActType === 'call' || rawActType.includes('call')) actTypeKey = 'Call'
        else actTypeKey = 'Call'

        const isToday = nextActionDateStr === todayStr
        const isSchedule = nextActionDateStr > todayStr
        
        let isPending = false
        if (nextActionDateStr < todayStr) {
          if (!lastFollowupDateStr || lastFollowupDateStr < nextActionDateStr) {
            isPending = true
          } else if (lastFollowupDateStr === nextActionDateStr) {
            const nextActionTime = new Date(l.next_followup || cf?.next_action_date || l.booked_time).getTime()
            const lastFollowupTime = cf?.last_followup_at ? new Date(cf.last_followup_at).getTime() : (l.last_call_at ? new Date(l.last_call_at).getTime() : 0)
            if (!lastFollowupTime || isNaN(lastFollowupTime) || lastFollowupTime <= (nextActionTime + 60000)) {
              isPending = true
            }
          }
        }

        if (isToday) {
          counts[actTypeKey].today++
          counts[actTypeKey].total++
          typeLeads[actTypeKey].today.push(l)
          totalToday++
          totalTodayLeads.push(l)
        } else if (isSchedule) {
          counts[actTypeKey].schedule++
          counts[actTypeKey].total++
          typeLeads[actTypeKey].schedule.push(l)
          totalSchedule++
          totalScheduleLeads.push(l)
        } else if (isPending) {
          counts[actTypeKey].pending++
          counts[actTypeKey].total++
          typeLeads[actTypeKey].pending.push(l)
          totalPending++
          totalPendingLeads.push(l)
        }
      })

      const repTotals = {
        pending: totalPending,
        schedule: totalSchedule,
        today: totalToday,
        grandTotal: totalPending + totalSchedule + totalToday
      }

      return {
        rep,
        counts,
        typeLeads,
        totals: repTotals,
        totalLeads: {
          pending: totalPendingLeads,
          schedule: totalScheduleLeads,
          today: totalTodayLeads
        }
      }
    }).filter(r => r.rep.id !== 'unassigned' || r.totals.grandTotal > 0)

    // For team members / agents, show ONLY their own stats card!
    if (!isAdminLike && profile?.id) {
      rows = rows.filter(r => r.rep.id === profile.id)
    } else if (selectedAgentId && selectedAgentId !== 'all') {
      rows = rows.filter(r => r.rep.id === selectedAgentId)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      rows = rows.filter(r => r.rep.name.toLowerCase().includes(q))
    }

    return { rows, actionTypes }
  }, [leads, allSalesReps, isAdminLike, profile?.id, selectedAgentId, searchQuery, isLeadAssignedToRep])

  // --- LEADERBOARD COMPUTATIONS (WorkVeu Screenshot 3) ---
  const followupBoardRows = useMemo(() => {
    // Always compute from leads (date-filtered) for consistency across all tabs
    const isActualCallAction = (h: any) => {
      const type = (h.action_type || '').toUpperCase()
      const desc = (h.description || '').toLowerCase()
      if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT'].includes(type)) return false
      if (desc.includes('facebook ad submission') || desc.includes('reopened from facebook') || desc.includes('bulk transferred') || desc.includes('transferred from')) return false
      if (['CALL_FEEDBACK', 'CALL', 'OUTBOUND_CALL', 'CALL_LOG', 'DNP'].includes(type)) return true
      if (desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) return true
      if (desc.includes('call') || desc.includes('followup') || desc.includes('feedback')) return true
      return false
    }

    const reps = allSalesReps

    return reps.map(rep => {
      const repLeads = leads.filter(l => isLeadAssignedToRep(l, rep.id))
      const repLeadIds = new Set(repLeads.map(l => l.id))

      // Count call attempts from history for this rep's leads
      const repHistory = history.filter(h => h.user_id === rep.id || repLeadIds.has(h.lead_id))
      const totalFollowups = repHistory.filter(isActualCallAction).length

      const closingMeetings = repLeads.filter(l => {
        let cf: any = l.custom_fields;
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf); } catch (e) {}
        }
        const lastAct = (cf?.last_followup_type || l.last_followup_type || '').toLowerCase().trim();
        return lastAct === 'closing meeting' || lastAct === 'closing' || lastAct === 'home meeting';
      }).length

      const visits = repLeads.filter(l => {
        let cf: any = l.custom_fields;
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf); } catch (e) {}
        }
        const lastAct = (cf?.last_followup_type || l.last_followup_type || '').toLowerCase().trim();
        return lastAct === 'visit' || lastAct === 'site visit' || lastAct === 'revisit' || lastAct === 're-visit';
      }).length

      const dnp = repLeads.filter(l => {
        let cf: any = l.custom_fields;
        if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
        const stageLower = (l.pipeline_stage || l.status || '').toLowerCase()
        return cf?.last_call_dnp === true || (cf?.dnp_count > 0) || (l.dnp_count > 0) || stageLower.includes('dnp') || stageLower === 'never picked'
      }).length

      const won = repLeads.filter(l => {
        const st = (l.status || l.pipeline_stage || '').toLowerCase()
        return st === 'deal/token' || st === 'closed' || st === 'won'
      }).length
      const conversionRate = repLeads.length > 0 ? ((won / repLeads.length) * 100).toFixed(1) : '0.0'

      return {
        rep,
        repLeads,
        totalFollowups,
        closingMeetings,
        visits,
        dnp,
        conversionRate
      }
    }).sort((a, b) => b.totalFollowups - a.totalFollowups)
  }, [allSalesReps, leads, history, isLeadAssignedToRep])

  const statusBoardRows = useMemo(() => {
    // Always compute from leads for consistency with date filters
    const reps = allSalesReps

    return reps.map(rep => {
      const repLeads = leads.filter(l => isLeadAssignedToRep(l, rep.id))

      const matchStatus = (l: any, ...targets: string[]) => {
        const st = (l.status || l.pipeline_stage || '').toLowerCase()
        return targets.some(t => st === t.toLowerCase())
      }

      const reqTaken = repLeads.filter(l => matchStatus(l, 'Requirement Taken', 'Contacted')).length
      const visitPlanned = repLeads.filter(l => matchStatus(l, 'Visit Planned', 'Appointment booked')).length
      const visitDone = repLeads.filter(l => matchStatus(l, 'Visit Done', 'Appointment done')).length
      const revisitDone = repLeads.filter(l => matchStatus(l, 'Revisit Done')).length
      const negotiation = repLeads.filter(l => matchStatus(l, 'Negotiation', 'Qualified')).length
      const dealToken = repLeads.filter(l => matchStatus(l, 'Deal/Token', 'Closed', 'Won')).length

      return {
        rep,
        repLeads,
        reqTaken,
        visitPlanned,
        visitDone,
        revisitDone,
        negotiation,
        dealToken
      }
    }).sort((a, b) => b.dealToken - a.dealToken || b.negotiation - a.negotiation)
  }, [allSalesReps, leads, isLeadAssignedToRep])

  const sourceBoardRows = useMemo(() => {
    const map: Record<string, any[]> = {}
    leads.forEach(l => {
      let src = l.source || l.channel || 'Direct / Organic'
      if (src.toLowerCase().includes('whatsapp')) src = 'WhatsApp Ad'
      else if (src.toLowerCase().includes('facebook') || src.toLowerCase().includes('meta')) src = 'Facebook Ad'
      else if (src.toLowerCase().includes('reference')) src = 'Reference'
      
      if (!map[src]) map[src] = []
      map[src].push(l)
    })

    return Object.keys(map).map(src => {
      const sourceLeads = map[src]
      const totalLeads = sourceLeads.length
      const won = sourceLeads.filter(l => l.status === 'Deal/Token' || l.pipeline_stage === 'Closed' || l.pipeline_stage === 'Won').length
      const lost = sourceLeads.filter(l => l.status === 'Lost/NI' || l.pipeline_stage === 'Unqualified' || l.pipeline_stage === 'Lost').length
      const ongoing = totalLeads - won - lost

      return {
        source: src,
        sourceLeads,
        totalLeads,
        ongoing,
        won,
        lost
      }
    }).sort((a, b) => b.totalLeads - a.totalLeads)
  }, [leads])

  const campaignBoardRows = useMemo(() => {
    const map: Record<string, any[]> = {}
    leads.forEach(l => {
      const camp = resolveLeadCampaign(l)
      if (!map[camp]) map[camp] = []
      map[camp].push(l)
    })

    return Object.keys(map).map(camp => {
      const campaignLeads = map[camp]
      const totalLeads = campaignLeads.length
      const won = campaignLeads.filter(l => l.status === 'Deal/Token' || l.pipeline_stage === 'Closed' || l.pipeline_stage === 'Won').length
      const lost = campaignLeads.filter(l => l.status === 'Lost/NI' || l.pipeline_stage === 'Unqualified' || l.pipeline_stage === 'Lost').length
      const ongoing = totalLeads - won - lost

      return {
        campaign: camp,
        campaignLeads,
        totalLeads,
        ongoing,
        won,
        lost
      }
    }).sort((a, b) => b.totalLeads - a.totalLeads)
  }, [leads])

  // --- ACTION REPORT COMPUTATIONS (Agent Action Attempts) ---
  const actionReportData = useMemo(() => {
    const { startCutoff, endCutoff, isDateInRange } = dateCutoffs

    const ACTION_TYPES = [
      { key: 'calls', label: 'Call Attempts', icon: '📞', color: 'blue' },
      { key: 'dnp', label: 'DNP (Did Not Pick)', icon: '📵', color: 'rose' },
      { key: 'visits', label: 'Visits', icon: '🏠', color: 'purple' },
      { key: 'revisits', label: 'Re-visits', icon: '🔄', color: 'violet' },
      { key: 'closing_meetings', label: 'Closing Meetings', icon: '💼', color: 'amber' },
      { key: 'home_meetings', label: 'Home Meetings', icon: '🏡', color: 'teal' },
      { key: 'whatsapp', label: 'WhatsApp Followups', icon: '💬', color: 'green' },
    ]

    const classifyAction = (h: any) => {
      const type = (h.action_type || '').toUpperCase()
      const desc = (h.description || '').trim()
      // Exclude purely automated system imports/webhooks
      if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT', 'ASSIGNMENT'].includes(type)) return null
      const descLower = desc.toLowerCase()
      if (descLower.includes('facebook ad submission') || descLower.includes('reopened from facebook') || descLower.includes('bulk transferred') || descLower.includes('transferred from')) return null

      // 1. DNP check
      if (type === 'DNP' || descLower.includes('call not picked - dnp') || descLower.startsWith('[⚠️ call not picked') || descLower.includes('not picked') || descLower.includes('did not pick')) return 'dnp'

      // 2. Explicit Followup Type check from "Followup (Type)"
      // Matches "Followup (Call)", "Followup (Visit)", "Followup (Revisit)", "Followup (Closing Meeting)", "Followup (Home Meeting)", "Followup (WhatsApp)"
      const followupMatch = desc.match(/Followup\s*\(([^)]+)\)/i)
      if (followupMatch) {
        const fType = followupMatch[1].toLowerCase().trim()
        if (fType.includes('dnp') || fType.includes('not picked')) return 'dnp'
        if (fType === 'visit' || fType === 'site visit') return 'visits'
        if (fType === 'revisit' || fType === 're-visit') return 'revisits'
        if (fType === 'closing meeting' || fType === 'closing') return 'closing_meetings'
        if (fType === 'home meeting' || fType === 'home') return 'home_meetings'
        if (fType === 'whatsapp') return 'whatsapp'
        if (fType === 'call') return 'calls'
        return 'calls'
      }

      // 3. Structured action_type checks
      if (type === 'SITE_VISIT') return 'visits'
      if (type === 'REVISIT') return 'revisits'
      if (type === 'MEETING') return 'closing_meetings'
      if (type === 'WHATSAPP') return 'whatsapp'
      if (['CALL', 'CALL_LOG', 'OUTBOUND_CALL', 'CALL_FEEDBACK'].includes(type)) return 'calls'

      // 4. Default for any other manual update
      return 'calls'
    }

    // Build lead lookup for drilldown
    const leadLookup: Record<string, any> = {}
    leads.forEach(l => { leadLookup[l.id] = l })

    const repActionCounts: Record<string, Record<string, number>> = {}
    const repActionLeadIds: Record<string, Record<string, Set<string>>> = {}
    const seenActionKeys = new Set<string>()

    allSalesReps.forEach(r => {
      repActionCounts[r.id] = { calls: 0, dnp: 0, visits: 0, revisits: 0, closing_meetings: 0, home_meetings: 0, whatsapp: 0 }
      repActionLeadIds[r.id] = { calls: new Set(), dnp: new Set(), visits: new Set(), revisits: new Set(), closing_meetings: new Set(), home_meetings: new Set(), whatsapp: new Set() }
    })

    // 1. Process History Entries
    history.forEach(h => {
      const cat = classifyAction(h)
      if (!cat) return
      const effectiveDate = parseActionDate(h.description, h.created_at)
      if (!isDateInRange(effectiveDate)) return

      const targetRepId = h.user_id
      if (targetRepId && repActionCounts[targetRepId]) {
        const dateKey = effectiveDate ? effectiveDate.toISOString().slice(0, 13) : h.id
        const dedupKey = `${h.lead_id || h.id}_${cat}_${dateKey}`
        if (!seenActionKeys.has(dedupKey)) {
          seenActionKeys.add(dedupKey)
          repActionCounts[targetRepId][cat]++
          if (h.lead_id) repActionLeadIds[targetRepId][cat].add(h.lead_id)
        }
      }
    })

    // 2. Process Lead Notes Blocks
    leads.forEach(l => {
      const notes = l.notes || ''
      if (notes.includes('[📝') || notes.includes('[⚠️')) {
        const chunks = notes.split(/(?=\[(?:📝|⚠️))/)
        chunks.forEach((chunk: string) => {
          const effectiveDate = parseActionDate(chunk)
          if (!effectiveDate || !isDateInRange(effectiveDate)) return

          // Extract rep from chunk e.g. "by Harman Bajwa"
          const repMatch = chunk.match(/by\s+([^\]\:\n]+)/i)
          const repName = repMatch ? repMatch[1].trim().toLowerCase() : ''
          const matchedRep = allSalesReps.find(r => {
            const fn = (r.name || '').toLowerCase()
            const em = (r.email || '').toLowerCase()
            return (fn && repName.includes(fn)) || (fn && fn.includes(repName)) || (em && repName.includes(em))
          }) || (l.assigned_to ? allSalesReps.find(r => r.id === l.assigned_to) : null)

          if (!matchedRep) return

          const chunkLower = chunk.toLowerCase()
          const fMatch = chunk.match(/Followup\s*\(([^)]+)\)/i)
          let cat = 'calls'

          if (chunkLower.includes('call not picked') || chunkLower.includes('dnp') || chunkLower.includes('not picked')) {
            cat = 'dnp'
          } else if (fMatch) {
            const fType = fMatch[1].toLowerCase().trim()
            if (fType.includes('dnp') || fType.includes('not picked')) cat = 'dnp'
            else if (fType === 'visit' || fType === 'site visit') cat = 'visits'
            else if (fType === 'revisit' || fType === 're-visit') cat = 'revisits'
            else if (fType === 'closing meeting' || fType === 'closing') cat = 'closing_meetings'
            else if (fType === 'home meeting' || fType === 'home') cat = 'home_meetings'
            else if (fType === 'whatsapp') cat = 'whatsapp'
            else cat = 'calls'
          } else {
            const headerMatch = chunk.match(/^\[([^\]\-]+)/)
            const header = (headerMatch ? headerMatch[1] : '').toLowerCase().trim()
            if (header.includes('not picked') || header.includes('dnp')) cat = 'dnp'
            else if (header === 'site visit' || header === 'visit') cat = 'visits'
            else if (header === 'revisit' || header === 're-visit') cat = 'revisits'
            else if (header === 'closing meeting') cat = 'closing_meetings'
            else if (header === 'home meeting') cat = 'home_meetings'
            else if (header === 'whatsapp') cat = 'whatsapp'
            else cat = 'calls'
          }

          if (repActionCounts[matchedRep.id]) {
            const dateKey = effectiveDate.toISOString().slice(0, 13)
            const dedupKey = `${l.id}_${cat}_${dateKey}`
            if (!seenActionKeys.has(dedupKey)) {
              seenActionKeys.add(dedupKey)
              repActionCounts[matchedRep.id][cat]++
              repActionLeadIds[matchedRep.id][cat].add(l.id)
            }
          }
        })
      }

      // 3. Process Custom Fields Followups Array
      let cf = l.custom_fields
      if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
      if (cf && Array.isArray(cf.followups)) {
        cf.followups.forEach((f: any) => {
          const fDate = f.date ? new Date(f.date) : parseActionDate(f.note)
          if (!fDate || !isDateInRange(fDate)) return

          const repName = (f.rep_name || f.by || '').toLowerCase()
          const matchedRep = allSalesReps.find(r => {
            const fn = (r.name || '').toLowerCase()
            const em = (r.email || '').toLowerCase()
            return (fn && repName.includes(fn)) || (fn && fn.includes(repName)) || (em && repName.includes(em))
          }) || (l.assigned_to ? allSalesReps.find(r => r.id === l.assigned_to) : null)

          if (!matchedRep) return

          let cat = 'calls'
          const fType = (f.followupType || f.type || '').toLowerCase().trim()
          if (fType.includes('dnp') || fType.includes('not picked')) cat = 'dnp'
          else if (fType === 'visit' || fType === 'site visit') cat = 'visits'
          else if (fType === 'revisit' || fType === 're-visit') cat = 'revisits'
          else if (fType === 'closing meeting' || fType === 'closing') cat = 'closing_meetings'
          else if (fType === 'home meeting' || fType === 'home') cat = 'home_meetings'
          else if (fType === 'whatsapp') cat = 'whatsapp'
          else cat = 'calls'

          if (repActionCounts[matchedRep.id]) {
            const dateKey = fDate.toISOString().slice(0, 13)
            const dedupKey = `${l.id}_${cat}_${dateKey}`
            if (!seenActionKeys.has(dedupKey)) {
              seenActionKeys.add(dedupKey)
              repActionCounts[matchedRep.id][cat]++
              repActionLeadIds[matchedRep.id][cat].add(l.id)
            }
          }
        })
      }

      // 4. Process Lead Level Last Followup
      if (cf?.last_followup_at && isDateInRange(cf.last_followup_at)) {
        const repId = l.assigned_to
        if (repId && repActionCounts[repId]) {
          const lType = (cf.last_followup_type || '').toLowerCase().trim()
          let cat = 'calls'
          if (cf.last_call_dnp === true || lType.includes('dnp') || lType.includes('not picked')) cat = 'dnp'
          else if (lType === 'visit' || lType === 'site visit') cat = 'visits'
          else if (lType === 'revisit' || lType === 're-visit') cat = 'revisits'
          else if (lType === 'closing meeting' || lType === 'closing') cat = 'closing_meetings'
          else if (lType === 'home meeting' || lType === 'home') cat = 'home_meetings'
          else if (lType === 'whatsapp') cat = 'whatsapp'
          else cat = 'calls'

          const dateKey = new Date(cf.last_followup_at).toISOString().slice(0, 13)
          const dedupKey = `${l.id}_${cat}_${dateKey}`
          if (!seenActionKeys.has(dedupKey)) {
            seenActionKeys.add(dedupKey)
            repActionCounts[repId][cat]++
            repActionLeadIds[repId][cat].add(l.id)
          }
        }
      }
    })

    let actionAttemptRows = allSalesReps.map(rep => {
      const actionCounts = repActionCounts[rep.id] || { calls: 0, dnp: 0, visits: 0, revisits: 0, closing_meetings: 0, home_meetings: 0, whatsapp: 0 }
      const totalAttempts = Object.values(actionCounts).reduce((s, v) => s + v, 0)

      const actionLeads: Record<string, any[]> = {}
      ACTION_TYPES.forEach(a => {
        const leadIdSet = repActionLeadIds[rep.id]?.[a.key] || new Set()
        actionLeads[a.key] = Array.from(leadIdSet).map(id => leadLookup[id]).filter(Boolean)
      })

      const allRepLeadIds = new Set<string>()
      ACTION_TYPES.forEach(a => {
        repActionLeadIds[rep.id]?.[a.key]?.forEach(id => allRepLeadIds.add(id))
      })
      const repLeads = Array.from(allRepLeadIds).map(id => leadLookup[id]).filter(Boolean)

      return {
        rep,
        actionCounts,
        actionLeads,
        totalAttempts,
        repLeads
      }
    }).sort((a, b) => b.totalAttempts - a.totalAttempts)

    if (!isAdminLike && profile?.id) {
      actionAttemptRows = actionAttemptRows.filter(r => r.rep.id === profile.id)
    } else if (selectedAgentId && selectedAgentId !== 'all') {
      actionAttemptRows = actionAttemptRows.filter(r => r.rep.id === selectedAgentId)
    }

    const actionTotals: Record<string, number> = {}
    const actionTotalLeads: Record<string, any[]> = {}
    ACTION_TYPES.forEach(a => {
      actionTotals[a.key] = actionAttemptRows.reduce((sum, r) => sum + (r.actionCounts[a.key] || 0), 0)
      const allIds = new Set<string>()
      actionAttemptRows.forEach(r => {
        r.actionLeads[a.key]?.forEach((l: any) => { if (l?.id) allIds.add(l.id) })
      })
      actionTotalLeads[a.key] = Array.from(allIds).map(id => leadLookup[id]).filter(Boolean)
    })
    const grandTotalAttempts = actionAttemptRows.reduce((sum, r) => sum + r.totalAttempts, 0)
    const grandTotalLeadIds = new Set<string>()
    actionAttemptRows.forEach(r => {
      r.repLeads?.forEach((l: any) => { if (l?.id) grandTotalLeadIds.add(l.id) })
    })
    const grandTotalLeads = Array.from(grandTotalLeadIds).map(id => leadLookup[id]).filter(Boolean)

    return {
      actionTypes: ACTION_TYPES,
      actionAttemptRows,
      actionTotals,
      actionTotalLeads,
      grandTotalAttempts,
      grandTotalLeads
    }
  }, [leads, allSalesReps, duration, customDate, startDate, endDate, isAdminLike, profile?.id, profile?.timezone, selectedAgentId, history, isLeadAssignedToRep, dateCutoffs])

  // Open interactive drilldown drawer for leads
  const openLeadsDrilldown = (title: string, subtitle: string, leadList: any[], defaultSort?: string) => {
    const isDesktop = typeof window !== 'undefined' ? window.innerWidth >= 768 : true
    setDrilldownViewMode(isDesktop ? 'list' : 'card')
    if (defaultSort) {
      setDrilldownSort(defaultSort as any)
    } else {
      const lower = (title + ' ' + subtitle).toLowerCase()
      if (lower.includes('attempt') || lower.includes('dnp') || lower.includes('never picked') || lower.includes('action log')) {
        setDrilldownSort('last_attempt_desc')
      } else if (lower.includes('schedule') || lower.includes('pending') || lower.includes('today') || lower.includes('follow-up') || lower.includes('call') || lower.includes('visit') || lower.includes('meeting')) {
        setDrilldownSort('next_action_asc')
      } else {
        setDrilldownSort('created_desc')
      }
    }
    const isActionOriented = 
      title.toLowerCase().includes('pending') || 
      title.toLowerCase().includes('schedule') || 
      title.toLowerCase().includes('today') || 
      title.toLowerCase().includes('action') || 
      title.toLowerCase().includes('call') || 
      title.toLowerCase().includes('visit') || 
      title.toLowerCase().includes('meeting') ||
      title.toLowerCase().includes('followup');
    setDrilldownDateBasis(isActionOriented ? 'action' : 'created')
    setDrilldownStageFilter('all')
    setDrilldownAgentFilter('ALL')
    setDrilldownNextActionFilter('ALL')
    setDrilldownNextActionType('ALL')
    setDrilldownDnpFilter('ALL')
    setDrilldownDateRange('ALL')
    setDrilldownCustomDate('')
    setDrilldownStartDate('')
    setDrilldownEndDate('')
    setDrilldownCampaign('')
    setDrilldownForm('')
    setDrilldownShowFilters(false)
    setDrilldownDatePickerOpen(false)
    setDrilldownPage(1)
    setDrilldownModal({
      isOpen: true,
      title,
      subtitle,
      leads: leadList,
      searchFilter: ''
    })
  }

  // Handle Header Table Sorting Toggle
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 pt-6 pb-32">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-3 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-wider">SALES ANALYTICS</span>
            {selectedAgentId && (
              <span className="px-3 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                <User size={10} /> Rep: {allSalesReps.find(t => t.id === selectedAgentId)?.name || 'Filtered'}
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <span>Hi, {profile?.business_name || profile?.full_name || 'Sales Director'}</span>
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">Filter, sort, and drilldown into live sales metrics & employee matrices.</p>
        </div>

        {/* CONTROLS & EMPLOYEE FILTER DROPDOWN */}
        <div className="flex items-center flex-wrap gap-2.5">
          
          {/* Employee Filter Select — hidden for agents who should only see their own data */}
          {profile?.role && ['agent', 'team_member'].includes(profile.role.toLowerCase()) ? (
            <div className="relative">
              <div className="bg-white border border-slate-300 text-slate-900 text-xs font-black rounded-2xl pl-9 pr-4 py-2 shadow-xs">
                👤 {profile.business_name || profile.full_name || 'My Leads'} ({leads.length} leads)
              </div>
              <User size={14} className="absolute left-3 top-2.5 text-blue-600 pointer-events-none" />
            </div>
          ) : (
            <div className="relative">
              <select
                value={selectedAgentId || ''}
                onChange={(e) => setSelectedAgentId(e.target.value || null)}
                className="appearance-none bg-white border border-slate-300 text-slate-900 text-xs font-black rounded-2xl pl-9 pr-8 py-2 hover:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-xs cursor-pointer"
              >
                <option value="">👥 All Sales Reps ({allSalesReps.length})</option>
                <option value="unassigned">⚠️ Unassigned Leads ({leads.filter(l => !l.assigned_to).length})</option>
                {allSalesReps.map(rep => (
                  <option key={rep.id} value={rep.id}>
                    👤 {rep.name} ({leads.filter(l => isLeadAssignedToRep(l, rep.id)).length} leads)
                  </option>
                ))}
              </select>
              <User size={14} className="absolute left-3 top-2.5 text-blue-600 pointer-events-none" />
            </div>
          )}

          {/* Duration Selector */}
          <div className="bg-slate-100 border border-slate-200 p-1 rounded-2xl flex items-center shadow-inner overflow-x-auto">
            {(['today', '7d', '30d', 'this_month', 'last_month', 'all'] as const).map((d) => (
              <button
                key={d}
                onClick={() => {
                  setCustomDate('')
                  setStartDate('')
                  setEndDate('')
                  setDuration(d)
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${duration === d && !customDate && !startDate ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {d === 'today' ? 'Today' : d === '7d' ? '7 Days' : d === '30d' ? '30 Days' : d === 'this_month' ? 'This Month' : d === 'last_month' ? 'Last Month' : 'All Time'}
              </button>
            ))}
          </div>

          {/* Custom Date / Range Picker Button */}
          <div className="relative">
            <button
              onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
              className={`px-3 py-2 rounded-2xl text-xs font-black flex items-center gap-1.5 transition-all border shadow-xs cursor-pointer ${
                (customDate || (startDate && endDate))
                  ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                  : 'bg-white border-slate-300 text-slate-700 hover:border-blue-500'
              }`}
            >
              <Calendar size={14} className={(customDate || (startDate && endDate)) ? 'text-white' : 'text-blue-600'} />
              <span>
                {customDate
                  ? `Date: ${customDate}`
                  : (startDate && endDate)
                  ? `${startDate} → ${endDate}`
                  : 'Custom Date'}
              </span>
            </button>

            {/* Date Picker Popover */}
            {isDatePickerOpen && (
              <>
                <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-40 sm:hidden" onClick={() => setIsDatePickerOpen(false)} />
                <div className="fixed inset-x-4 top-24 z-50 bg-white border border-slate-200 rounded-2xl p-4 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:w-72">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Calendar size={14} className="text-blue-600" /> Filter by Date
                  </span>
                  <button onClick={() => setIsDatePickerOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                    <X size={15} />
                  </button>
                </div>

                {/* Mode Switcher */}
                <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => { setDateFilterMode('single'); setStartDate(''); setEndDate(''); }}
                    className={`py-1 rounded-lg transition-all cursor-pointer ${dateFilterMode === 'single' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500'}`}
                  >
                    Single Date
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDateFilterMode('range'); setCustomDate(''); }}
                    className={`py-1 rounded-lg transition-all cursor-pointer ${dateFilterMode === 'range' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500'}`}
                  >
                    Date Range
                  </button>
                </div>

                {dateFilterMode === 'single' ? (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 block">Select Specific Date:</label>
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => {
                        setCustomDate(e.target.value)
                        setStartDate('')
                        setEndDate('')
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Start Date:</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => {
                          setStartDate(e.target.value)
                          setCustomDate('')
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-0.5">End Date:</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => {
                          setEndDate(e.target.value)
                          setCustomDate('')
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomDate('')
                      setStartDate('')
                      setEndDate('')
                      setIsDatePickerOpen(false)
                    }}
                    className="text-xs font-extrabold text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    Clear Filter
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDatePickerOpen(false)}
                    className="bg-blue-600 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-sm hover:bg-blue-500 cursor-pointer"
                  >
                    Apply Filter
                  </button>
                </div>
              </div>
              </>
            )}
          </div>

          {/* Sync / Refresh Button */}
          <button 
            onClick={() => fetchAnalytics(true)} 
            disabled={refreshing}
            className="p-2.5 bg-white text-slate-700 rounded-2xl border border-slate-200 hover:bg-slate-50 shadow-xs flex items-center justify-center transition-all disabled:opacity-50"
            title="Refresh Analytics Data"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin text-blue-600' : ''} />
          </button>
        </div>
      </div>

      {/* SUB-NAVIGATION TAB BAR (Project Mgr & Action Mgr removed) */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar">
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeTab === 'analytics' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <BarChart2 size={16} />
            <span>Analytics Dashboard</span>
          </button>

          <button
            onClick={() => setActiveTab('action_mgr')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeTab === 'action_mgr' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <CheckSquare size={16} />
            <span>Action Manager</span>
          </button>

          <button
            onClick={() => setActiveTab('report')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeTab === 'report' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <FileText size={16} />
            <span>Action Report</span>
          </button>

          <button
            onClick={() => setActiveTab('lead_mgr')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeTab === 'lead_mgr' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Users size={16} />
            <span>Lead Mgr</span>
          </button>

          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeTab === 'leaderboard' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Trophy size={16} className={activeTab === 'leaderboard' ? 'text-amber-300' : 'text-amber-500'} />
            <span>Leaderboard</span>
          </button>
        </div>

        {/* Search Input for Matrix Tables */}
        {activeTab === 'lead_mgr' && (
          <div className="relative shrink-0 w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search rep name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 text-xs text-slate-900 font-bold rounded-xl pl-9 pr-3 py-1.5 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          <span className="text-xs font-extrabold">Loading interactive metrics...</span>
        </div>
      ) : (
        <>
          {/* TAB 1: ANALYTICS DASHBOARD */}
          {activeTab === 'analytics' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* TOP INTERACTIVE KPI CARDS */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                
                {/* Total Leads */}
                <div 
                  onClick={() => openLeadsDrilldown('Total Leads', `All ${stats.totalLeads} active leads`, filteredLeads)}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1 cursor-pointer hover:border-blue-500 hover:shadow-md transition-all group"
                >
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Total Leads</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-slate-900 group-hover:text-blue-600">{stats.totalLeads}</span>
                    <div className="p-2 rounded-xl bg-blue-50 text-blue-600 group-hover:scale-110 transition-transform">
                      <Users size={16} />
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-blue-600 flex items-center gap-1">Click to view list &rarr;</span>
                </div>

                {/* Reopened */}
                <div 
                  onClick={() => openLeadsDrilldown('Reopened Leads', `Leads reopened >2 times`, stats.reopenedLeadsList)}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1 cursor-pointer hover:border-rose-500 hover:shadow-md transition-all group"
                >
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Reopened (⏰³)</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-rose-600">{stats.reopenedCount}</span>
                    <div className="p-2 rounded-xl bg-rose-50 text-rose-600 group-hover:scale-110 transition-transform">
                      <Clock size={16} />
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-rose-600 flex items-center gap-1">Click to view list &rarr;</span>
                </div>

                {/* Follow-up */}
                <div 
                  onClick={() => openLeadsDrilldown('Follow-up Scheduled', `Leads with next action dates`, stats.followUpLeadsList)}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1 cursor-pointer hover:border-amber-500 hover:shadow-md transition-all group"
                >
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Follow-up</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-amber-600">{stats.followUpCount}</span>
                    <div className="p-2 rounded-xl bg-amber-50 text-amber-600 group-hover:scale-110 transition-transform">
                      <RefreshCw size={16} />
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">Click to view list &rarr;</span>
                </div>

                {/* Duplicate */}
                <div 
                  onClick={() => openLeadsDrilldown('Duplicate Contacts', `Leads sharing duplicate phone numbers`, stats.duplicateLeadsList)}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1 cursor-pointer hover:border-purple-500 hover:shadow-md transition-all group"
                >
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Duplicate</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-purple-600">{stats.duplicateCount}</span>
                    <div className="p-2 rounded-xl bg-purple-50 text-purple-600 group-hover:scale-110 transition-transform">
                      <AlertCircle size={16} />
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-purple-600 flex items-center gap-1">Click to view list &rarr;</span>
                </div>

                {/* Unassigned Leads */}
                <div 
                  onClick={() => openLeadsDrilldown('Unassigned Leads', `Leads waiting for sales rep assignment`, stats.unassignedLeadsList)}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1 cursor-pointer hover:border-slate-500 hover:shadow-md transition-all group"
                >
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Unassigned</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-slate-900">{stats.unassignedCount}</span>
                    <div className="p-2 rounded-xl bg-slate-100 text-slate-600 group-hover:scale-110 transition-transform">
                      <Users size={16} />
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">Click to view list &rarr;</span>
                </div>

                {/* DNP Count */}
                <div 
                  onClick={() => openLeadsDrilldown('DNP / Didn\'t Pick', `Leads with DNP attempt in selected duration (${stats.totalDnp})`, stats.dnpLeadsList)}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1 cursor-pointer hover:border-rose-500 hover:shadow-md transition-all group"
                >
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">DNP Count</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-rose-600">{stats.totalDnp}</span>
                    <div className="p-2 rounded-xl bg-rose-50 text-rose-600 group-hover:scale-110 transition-transform">
                      <PhoneOff size={16} />
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-rose-600 flex items-center gap-1">Click to view list &rarr;</span>
                </div>

              </div>

              {/* TASKS BREAKDOWN & FRESH LEADS SECTION */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Stage Distribution Panel */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                    <div>
                      <h3 className="font-extrabold text-base text-slate-900">Pipeline Stage Distribution</h3>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">Click any stage or bucket to filter & inspect leads</p>
                    </div>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">Interactive</span>
                  </div>

                  {/* Summary Category Pills: Fresh / Ongoing / Not Interested */}
                  <div className="grid grid-cols-3 gap-2 pb-1">
                    <button
                      type="button"
                      onClick={() => openLeadsDrilldown('Fresh Leads', `Fresh & New incoming leads (${stats.freshLeadsList.length})`, stats.freshLeadsList)}
                      className="p-2.5 bg-blue-50/70 hover:bg-blue-100/90 border border-blue-200/80 rounded-2xl text-left transition-colors cursor-pointer"
                    >
                      <span className="text-[10px] font-extrabold uppercase text-blue-700 block">Fresh Leads</span>
                      <span className="text-lg font-black text-blue-950">{stats.freshLeadsList.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openLeadsDrilldown('Ongoing Leads', `Active ongoing pipeline leads (${stats.ongoingLeadsList.length})`, stats.ongoingLeadsList)}
                      className="p-2.5 bg-cyan-50/70 hover:bg-cyan-100/90 border border-cyan-200/80 rounded-2xl text-left transition-colors cursor-pointer"
                    >
                      <span className="text-[10px] font-extrabold uppercase text-cyan-700 block">Ongoing</span>
                      <span className="text-lg font-black text-cyan-950">{stats.ongoingLeadsList.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openLeadsDrilldown('Not Interested', `Lost / Inactive / Dealer leads (${stats.notInterestedLeadsList.length})`, stats.notInterestedLeadsList)}
                      className="p-2.5 bg-rose-50/70 hover:bg-rose-100/90 border border-rose-200/80 rounded-2xl text-left transition-colors cursor-pointer"
                    >
                      <span className="text-[10px] font-extrabold uppercase text-rose-700 block">Not Interested</span>
                      <span className="text-lg font-black text-rose-950">{stats.notInterestedLeadsList.length}</span>
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                    {configuredStages.map((stageCfg) => {
                      const stageName = stageCfg.name;
                      const stageLeads = filteredLeads.filter(l => {
                        const raw = (l.pipeline_stage || l.status || '').trim();
                        if (stageName.toLowerCase() === 'new lead') {
                          return raw.toLowerCase() === 'new lead' || raw.toLowerCase() === 'new' || !raw;
                        }
                        return raw.toLowerCase() === stageName.toLowerCase();
                      });
                      
                      const dotColor = stageCfg.category === 'fresh'
                        ? 'bg-blue-500'
                        : stageCfg.category === 'not_interested'
                        ? 'bg-rose-500'
                        : stageCfg.category === 'trash'
                        ? 'bg-slate-400'
                        : 'bg-indigo-500';

                      return (
                        <div 
                          key={stageCfg.id || stageName}
                          onClick={() => openLeadsDrilldown(stageName, `${stageLeads.length} leads in stage: ${stageName}`, stageLeads)}
                          className="flex justify-between items-center p-2.5 bg-slate-50 rounded-2xl text-xs font-bold text-slate-700 hover:bg-blue-50 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`}></span>
                            <span>{stageName}</span>
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">({stageCfg.category})</span>
                          </div>
                          <span className="font-black text-slate-900 bg-white px-2.5 py-0.5 rounded-xl border border-slate-200 shadow-2xs">{stageLeads.length}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Fresh & Recent Inflow Panel */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                    <h3 className="font-extrabold text-base text-slate-900">Fresh & Ongoing Inflow</h3>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">Interactive</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div 
                      onClick={() => openLeadsDrilldown('Fresh Leads (New)', `Untouched fresh incoming leads (${stats.freshLeadsList.length})`, stats.freshLeadsList)}
                      className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-1 cursor-pointer hover:bg-emerald-100/60 transition-colors"
                    >
                      <span className="text-[10px] font-black text-emerald-800 uppercase tracking-wider block">Fresh Leads</span>
                      <span className="text-2xl font-black text-emerald-950">{stats.freshLeadsList.length}</span>
                      <span className="text-[11px] font-bold text-emerald-700 block mt-1">Click to view &rarr;</span>
                    </div>

                    <div 
                      onClick={() => openLeadsDrilldown('Ongoing Leads', `Active leads currently in ongoing stages (${stats.ongoingLeadsList.length})`, stats.ongoingLeadsList)}
                      className="p-4 bg-cyan-50/60 border border-cyan-200 rounded-2xl space-y-1 cursor-pointer hover:bg-cyan-100/60 transition-colors"
                    >
                      <span className="text-[10px] font-black text-cyan-800 uppercase tracking-wider block">Ongoing Leads</span>
                      <span className="text-2xl font-black text-cyan-950">{stats.ongoingLeadsList.length}</span>
                      <span className="text-[11px] font-bold text-cyan-700 block mt-1">Click to view &rarr;</span>
                    </div>

                    <div 
                      onClick={() => openLeadsDrilldown('Recent Leads (<= 1 Day)', 'Leads created within last 24 hours', stats.recentLeadsList)}
                      className="col-span-2 p-4 bg-amber-50/60 border border-amber-200 rounded-2xl space-y-1 cursor-pointer hover:bg-amber-100/60 transition-colors"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-amber-800 uppercase tracking-wider block">Created &lt;= 1 Day</span>
                        <span className="text-[11px] font-bold text-amber-700">Click to view &rarr;</span>
                      </div>
                      <span className="text-2xl font-black text-amber-950">{stats.recentLeadsList.length}</span>
                    </div>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB: ACTION MANAGER (Screenshot 1 Request) */}
          {activeTab === 'action_mgr' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              
              {/* Controls Header: User Selector & Filter Options */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">User</span>
                  {isAdminLike ? (
                    <select
                      value={selectedAgentId || 'all'}
                      onChange={(e) => setSelectedAgentId(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-900 text-sm font-extrabold rounded-2xl px-4 py-2 outline-none hover:bg-slate-100 cursor-pointer transition-all shadow-xs"
                    >
                      <option value="all">Me / All Team Members</option>
                      {allSalesReps.map(rep => (
                        <option key={rep.id} value={rep.id}>{rep.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="bg-slate-100 border border-slate-200 text-slate-900 text-sm font-extrabold rounded-2xl px-4 py-2 flex items-center gap-2">
                      <User size={14} className="text-blue-600" />
                      <span>{profile?.full_name || profile?.business_name || 'Me'}</span>
                    </div>
                  )}
                </div>

                {/* Filter Checkboxes (Pending, Schedule, Today) */}
                <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-xs self-start md:self-auto font-extrabold text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-amber-700 hover:text-amber-800">
                    <input 
                      type="checkbox" 
                      checked={showPending} 
                      onChange={e => setShowPending(e.target.checked)} 
                      className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 cursor-pointer"
                    />
                    <span>Pending</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-purple-700 hover:text-purple-800">
                    <input 
                      type="checkbox" 
                      checked={showSchedule} 
                      onChange={e => setShowSchedule(e.target.checked)} 
                      className="rounded text-purple-600 focus:ring-purple-400 w-4 h-4 cursor-pointer"
                    />
                    <span>Schedule</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-emerald-700 hover:text-emerald-800">
                    <input 
                      type="checkbox" 
                      checked={showToday} 
                      onChange={e => setShowToday(e.target.checked)} 
                      className="rounded text-emerald-600 focus:ring-emerald-400 w-4 h-4 cursor-pointer"
                    />
                    <span>Today</span>
                  </label>
                </div>
              </div>

              {/* Employee Cards Grid (Matching Screenshot from Previous CRM) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {actionManagerMatrix.rows.map(row => (
                  <div key={row.rep.id} className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                    
                    <div>
                      <div className="mb-4 pb-3 border-b border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Emp Name</span>
                        <h4 className="text-lg font-black text-slate-900 mt-0.5">{row.rep.name}</h4>
                      </div>

                      <div className="space-y-1 text-sm">
                        {/* Table Header */}
                        <div className="grid grid-cols-4 items-center py-1.5 px-3 text-xs font-black text-slate-400 border-b border-slate-100">
                          <span className="col-span-1">Type</span>
                          <div className="col-span-3 grid grid-cols-3 text-center font-extrabold">
                            {showPending && <span className="text-amber-600 font-black">P</span>}
                            {showSchedule && <span className="text-purple-600 font-black">S</span>}
                            {showToday && <span className="text-emerald-600 font-black">T</span>}
                          </div>
                        </div>

                        {/* Action Type Rows */}
                        {actionManagerMatrix.actionTypes.map(t => {
                          const c = row.counts[t.key]
                          const leadsGroup = row.typeLeads[t.key]
                          return (
                            <div key={t.key} className="grid grid-cols-4 items-center py-2.5 px-3 rounded-xl hover:bg-slate-50 transition-all border-b border-slate-50">
                              <span className="col-span-1 text-xs font-bold text-slate-700 truncate" title={t.label}>{t.label}</span>
                              <div className="col-span-3 grid grid-cols-3 text-center text-xs font-black">
                                {showPending && (
                                  <span 
                                    onClick={() => c.pending > 0 && openLeadsDrilldown(`${row.rep.name} - Pending ${t.label}`, `Pending ${t.label} Actions (${c.pending})`, leadsGroup.pending)} 
                                    className={`py-1 rounded-md transition-all ${c.pending > 0 ? 'text-amber-600 font-extrabold cursor-pointer hover:bg-amber-100 hover:scale-110' : 'text-slate-300 font-normal'}`}
                                  >
                                    {c.pending}
                                  </span>
                                )}
                                {showSchedule && (
                                  <span 
                                    onClick={() => c.schedule > 0 && openLeadsDrilldown(`${row.rep.name} - Scheduled ${t.label}`, `Scheduled ${t.label} Actions (${c.schedule})`, leadsGroup.schedule)} 
                                    className={`py-1 rounded-md transition-all ${c.schedule > 0 ? 'text-purple-600 font-extrabold cursor-pointer hover:bg-purple-100 hover:scale-110' : 'text-slate-300 font-normal'}`}
                                  >
                                    {c.schedule}
                                  </span>
                                )}
                                {showToday && (
                                  <span 
                                    onClick={() => c.today > 0 && openLeadsDrilldown(`${row.rep.name} - Today ${t.label}`, `Today's ${t.label} Actions (${c.today})`, leadsGroup.today)} 
                                    className={`py-1 rounded-md transition-all ${c.today > 0 ? 'text-emerald-600 font-extrabold cursor-pointer hover:bg-emerald-100 hover:scale-110' : 'text-slate-300 font-normal'}`}
                                  >
                                    {c.today}
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Total Row */}
                    <div className="grid grid-cols-4 items-center py-3 px-4 rounded-2xl bg-slate-50 border border-slate-200/80 font-black text-slate-900 mt-5">
                      <span className="col-span-1 text-xs uppercase font-black tracking-wider text-slate-800">Total</span>
                      <div className="col-span-3 grid grid-cols-3 text-center text-sm font-black">
                        {showPending && (
                          <span 
                            onClick={() => row.totals.pending > 0 && openLeadsDrilldown(`${row.rep.name} - All Pending Actions`, `Total ${row.totals.pending} Pending Actions`, row.totalLeads.pending)}
                            className={`py-0.5 rounded-md ${row.totals.pending > 0 ? 'text-amber-600 cursor-pointer hover:bg-amber-100' : 'text-slate-400'}`}
                          >
                            {row.totals.pending}
                          </span>
                        )}
                        {showSchedule && (
                          <span 
                            onClick={() => row.totals.schedule > 0 && openLeadsDrilldown(`${row.rep.name} - All Scheduled Actions`, `Total ${row.totals.schedule} Scheduled Actions`, row.totalLeads.schedule)}
                            className={`py-0.5 rounded-md ${row.totals.schedule > 0 ? 'text-purple-600 cursor-pointer hover:bg-purple-100' : 'text-slate-400'}`}
                          >
                            {row.totals.schedule}
                          </span>
                        )}
                        {showToday && (
                          <span 
                            onClick={() => row.totals.today > 0 && openLeadsDrilldown(`${row.rep.name} - All Today Actions`, `Total ${row.totals.today} Today Actions`, row.totalLeads.today)}
                            className={`py-0.5 rounded-md ${row.totals.today > 0 ? 'text-emerald-600 cursor-pointer hover:bg-emerald-100' : 'text-slate-400'}`}
                          >
                            {row.totals.today}
                          </span>
                        )}
                      </div>
                    </div>

                  </div>
                ))}
              </div>

            </div>
          )}

          {/* TAB: ACTION REPORT (Attempted Actions Report by Date & Rep) */}
          {activeTab === 'report' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Header Banner */}
              <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-6 rounded-3xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-blue-500/30 text-blue-200 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">ATTEMPTED ACTIONS REPORT</span>
                    <span className="text-slate-300 text-xs font-semibold">Filter by Date & Sales Rep</span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black">Agent Action Attempt Analytics</h2>
                  <p className="text-xs text-blue-200/80 mt-0.5">Track calls, site visits, meetings, and DNPs attempted by each sales rep.</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-200 bg-white/10 px-3 py-1.5 rounded-xl backdrop-blur-md border border-white/10">
                    Range: {duration === 'all' ? 'All Time' : duration.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Agent Action Attempts Matrix */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-black text-slate-900">Agent Action Attempts</h3>
                    <p className="text-xs text-slate-500">Total action attempts punched by each sales rep (calls, DNPs, visits, revisits, closing meetings, home meetings, WhatsApp) — click numbers to view leads list</p>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-200">
                    {actionReportData.grandTotalAttempts} Total Attempts
                  </span>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                  {actionReportData.actionTypes.map(at => {
                    const total = actionReportData.actionTotals[at.key] || 0
                    const colorMap: Record<string, string> = {
                      blue: 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-600 hover:text-white',
                      rose: 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-600 hover:text-white',
                      purple: 'text-purple-700 bg-purple-50 border-purple-200 hover:bg-purple-600 hover:text-white',
                      violet: 'text-violet-700 bg-violet-50 border-violet-200 hover:bg-violet-600 hover:text-white',
                      amber: 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-600 hover:text-white',
                      teal: 'text-teal-700 bg-teal-50 border-teal-200 hover:bg-teal-600 hover:text-white',
                      green: 'text-green-700 bg-green-50 border-green-200 hover:bg-green-600 hover:text-white',
                    }
                    return (
                      <button
                        key={at.key}
                        type="button"
                        onClick={() => total > 0 && openLeadsDrilldown(`${at.label}`, `${total} total ${at.label.toLowerCase()} across all agents`, actionReportData.actionTotalLeads[at.key] || [])}
                        className={`p-3 rounded-2xl border transition-all cursor-pointer text-left ${colorMap[at.color] || colorMap.blue}`}
                      >
                        <p className="text-[10px] font-black uppercase tracking-wider">{at.icon} {at.label}</p>
                        <p className="text-xl font-black mt-1">{total}</p>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => actionReportData.grandTotalAttempts > 0 && openLeadsDrilldown('All Action Attempts', `Total ${actionReportData.grandTotalAttempts} action attempts across all agents`, actionReportData.grandTotalLeads)}
                    className="p-3 rounded-2xl border transition-all cursor-pointer text-left text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-600 hover:text-white"
                  >
                    <p className="text-[10px] font-black uppercase tracking-wider">⚡ Total Attempts</p>
                    <p className="text-xl font-black mt-1">{actionReportData.grandTotalAttempts}</p>
                  </button>
                </div>

                {/* TOP HORIZONTAL SCROLLBAR (SYNCS WITH TABLE) */}
                <div 
                  ref={attemptsTopScrollRef} 
                  onScroll={handleAttemptsTopScroll}
                  className="hidden sm:block overflow-x-auto custom-scrollbar h-2 bg-slate-100/90 rounded-full border border-slate-200/80 shadow-inner mx-6 my-2"
                  title="Drag to scroll table horizontally"
                >
                  <div style={{ width: `${attemptsTableWidth}px`, height: '4px' }} />
                </div>

                <div 
                  ref={attemptsTableScrollRef} 
                  onScroll={handleAttemptsTableScroll}
                  className="overflow-x-auto"
                >
                  <table ref={attemptsTableRef} className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-3.5 px-5 sticky left-0 bg-slate-50 z-10 shadow-xs">Sales Rep</th>
                        {actionReportData.actionTypes.map(at => (
                          <th key={at.key} className="py-3.5 px-3 text-center">{at.icon} {at.label}</th>
                        ))}
                        <th className="py-3.5 px-5 text-center font-black text-slate-900 bg-slate-100">Total Attempts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {actionReportData.actionAttemptRows.map(row => (
                        <tr key={row.rep.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-5 sticky left-0 bg-white z-10 shadow-xs">
                            <div className="font-extrabold text-slate-900">{row.rep.name}</div>
                            <div className="text-[10px] text-slate-400">{row.rep.email || row.rep.role}</div>
                          </td>
                          {actionReportData.actionTypes.map(at => {
                            const count = row.actionCounts[at.key] || 0
                            const actionColorMap: Record<string, string> = {
                              blue: 'bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white',
                              rose: 'bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white',
                              purple: 'bg-purple-50 text-purple-700 hover:bg-purple-600 hover:text-white',
                              violet: 'bg-violet-50 text-violet-700 hover:bg-violet-600 hover:text-white',
                              amber: 'bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white',
                              teal: 'bg-teal-50 text-teal-700 hover:bg-teal-600 hover:text-white',
                              green: 'bg-green-50 text-green-700 hover:bg-green-600 hover:text-white',
                            }
                            return (
                              <td key={at.key} className="py-3.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => count > 0 && openLeadsDrilldown(`${row.rep.name} - ${at.label}`, `${count} ${at.label.toLowerCase()} by ${row.rep.name}`, row.actionLeads[at.key] || [])}
                                  className={`px-2.5 py-1 rounded-xl font-black text-xs transition-all ${count > 0 ? `${actionColorMap[at.color] || actionColorMap.blue} cursor-pointer hover:shadow-xs` : 'bg-slate-50 text-slate-300 cursor-default'}`}
                                >
                                  {count}
                                </button>
                              </td>
                            )
                          })}
                          <td className="py-3.5 px-5 text-center bg-slate-50/60">
                            <button
                              type="button"
                              onClick={() => row.totalAttempts > 0 && openLeadsDrilldown(`${row.rep.name} - All Action Attempts`, `Total ${row.totalAttempts} action attempts by ${row.rep.name}`, row.repLeads)}
                              className={`px-3 py-1.5 rounded-xl font-black text-xs transition-all ${row.totalAttempts > 0 ? 'bg-slate-900 text-white hover:bg-blue-600 cursor-pointer hover:shadow-xs' : 'bg-slate-50 text-slate-300 cursor-default'}`}
                            >
                              {row.totalAttempts}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100/90 border-t-2 border-slate-300 text-xs font-black text-slate-900">
                        <td className="py-3.5 px-5 uppercase tracking-wider sticky left-0 bg-slate-100 z-10 shadow-xs">TOTAL</td>
                        {actionReportData.actionTypes.map(at => {
                          const total = actionReportData.actionTotals[at.key] || 0
                          return (
                            <td
                              key={at.key}
                              onClick={() => total > 0 && openLeadsDrilldown(`All Agents - ${at.label}`, `Total ${total} ${at.label.toLowerCase()} across all agents`, actionReportData.actionTotalLeads[at.key] || [])}
                              className="py-3.5 px-3 text-center cursor-pointer hover:bg-slate-200 transition-colors font-bold"
                            >
                              {total}
                            </td>
                          )
                        })}
                        <td
                          onClick={() => actionReportData.grandTotalAttempts > 0 && openLeadsDrilldown('All Action Attempts', `Total ${actionReportData.grandTotalAttempts} action attempts across all agents`, actionReportData.grandTotalLeads)}
                          className="py-3.5 px-5 text-center font-black text-sm bg-slate-200/80 cursor-pointer hover:bg-slate-300 transition-colors"
                        >
                          {actionReportData.grandTotalAttempts}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LEAD MGR (WorkVeu Screenshot 2 Interactive Employee Matrix) */}
          {activeTab === 'lead_mgr' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Filter Bar & Sort Info */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-500">Matrix Filter:</span>
                  <span className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold">
                    {selectedAgentId ? `Rep: ${allSalesReps.find(r => r.id === selectedAgentId)?.name}` : 'All Sales Reps'}
                  </span>
                  <span className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold">Created On: {duration}</span>
                </div>
                <div className="text-xs text-slate-500 font-medium">
                  Click any table header to <strong>sort</strong> • Click any number cell to <strong>drilldown leads</strong>
                </div>
              </div>

              {/* EMPLOYEE-WISE LEAD MATRIX TABLE */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[1000px]">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider select-none">
                        <th 
                          onClick={() => handleSort('name')}
                          className="p-3.5 pl-6 cursor-pointer hover:text-blue-600"
                        >
                          <div className="flex items-center gap-1">
                            <span>Name</span>
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                        {leadManagerMatrix.stagesList.map(s => (
                          <th 
                            key={s.key} 
                            onClick={() => handleSort(s.key)}
                            className="p-3.5 text-center cursor-pointer hover:text-blue-600"
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span>{s.label}</span>
                              <ArrowUpDown size={12} />
                            </div>
                          </th>
                        ))}
                        <th 
                          onClick={() => handleSort('total')}
                          className="p-3.5 text-center bg-emerald-100/60 text-emerald-950 pr-6 cursor-pointer hover:text-blue-600"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span>Total</span>
                            <ArrowUpDown size={12} />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-bold">
                      {leadManagerMatrix.rows.map(({ rep, counts, categoryLeads }) => (
                        <tr key={rep.id} className="hover:bg-blue-50/40 transition-colors">
                          <td className="p-3.5 pl-6 font-extrabold text-slate-900 flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black flex items-center justify-center border border-blue-300 shrink-0">
                              {rep.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="truncate max-w-[140px]">{rep.name}</span>
                          </td>
                          {leadManagerMatrix.stagesList.map(s => {
                            const cnt = counts[s.key] || 0
                            const cellLeads = categoryLeads[s.key] || []
                            return (
                              <td 
                                key={s.key} 
                                onClick={() => {
                                  if (cnt > 0) {
                                    openLeadsDrilldown(
                                      `${rep.name} - ${s.label}`,
                                      `${cnt} leads assigned to ${rep.name} in stage: ${s.label}`,
                                      cellLeads
                                    )
                                  }
                                }}
                                className={`p-3.5 text-center transition-colors ${
                                  cnt > 0 
                                    ? 'text-blue-600 font-extrabold cursor-pointer hover:bg-blue-100 hover:scale-105' 
                                    : 'text-slate-400 font-normal cursor-default'
                                }`}
                              >
                                {cnt}
                              </td>
                            )
                          })}
                          <td 
                            onClick={() => {
                              if (counts.total > 0) {
                                openLeadsDrilldown(
                                  `${rep.name} - Total Assigned Leads`,
                                  `All ${counts.total} leads assigned to ${rep.name}`,
                                  categoryLeads.total || []
                                )
                              }
                            }}
                            className="p-3.5 text-center font-black text-slate-900 bg-emerald-50/50 pr-6 text-sm cursor-pointer hover:bg-emerald-100 transition-colors"
                          >
                            {counts.total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-emerald-100/80 border-t-2 border-emerald-300 text-xs font-black text-emerald-950">
                        <td className="p-3.5 pl-6 uppercase tracking-wider">TOTAL</td>
                        {leadManagerMatrix.stagesList.map(s => (
                          <td 
                            key={s.key} 
                            onClick={() => {
                              const totalStageLeads = leads.filter(l => {
                                if (s.key === 'new') return l.pipeline_stage === 'New Lead' || l.pipeline_stage === 'New' || l.status === 'New Lead' || l.status === 'New'
                                if (s.key === 'contacted') return l.pipeline_stage === 'Contacted' || l.pipeline_stage === 'Requirement Taken' || l.status === 'Contacted' || l.status === 'Requirement Taken'
                                if (s.key === 'booked') return l.pipeline_stage === 'Visit Planned' || l.status === 'Visit Planned'
                                if (s.key === 'done') return l.pipeline_stage === 'Visit Done' || l.status === 'Visit Done'
                                if (s.key === 'revisit') return l.pipeline_stage === 'Revisit Done' || l.status === 'Revisit Done'
                                if (s.key === 'qualified') return l.pipeline_stage === 'Negotiation' || l.pipeline_stage === 'Deal/Token' || l.status === 'Negotiation' || l.status === 'Deal/Token'
                                if (s.key === 'unqualified') return l.pipeline_stage === 'Lost/NI' || l.pipeline_stage === 'Closed' || l.status === 'Lost/NI' || l.pipeline_stage === 'Dealer' || l.pipeline_stage === 'Plan Postponed' || l.pipeline_stage === 'Already Purchased'
                                if (s.key === 'meeting_planned') {
                                  let cf: any = l.custom_fields;
                                  if (typeof cf === 'string') {
                                    try { cf = JSON.parse(cf); } catch (e) {}
                                  }
                                  const nextAct = (cf?.next_action_type || l.next_action_type || '').toLowerCase();
                                  const lastAct = (cf?.last_followup_type || l.last_followup_type || '').toLowerCase();
                                  const st = (l.pipeline_stage || l.status || '').toLowerCase();
                                  return st.includes('meeting planned') || nextAct.includes('meeting') || nextAct.includes('closing') || nextAct.includes('home') || lastAct.includes('meeting') || lastAct.includes('closing') || lastAct.includes('home');
                                }
                                if (s.key === 'meeting_done') return l.pipeline_stage === 'Meeting Done' || l.status === 'Meeting Done'
                                if (s.key === 'dnp') return l.dnp_count > 0 || l.custom_fields?.dnp_count > 0
                                return false
                              })
                              openLeadsDrilldown(`All Sales Reps - ${s.label}`, `Total ${totalStageLeads.length} leads across all reps`, totalStageLeads)
                            }}
                            className="p-3.5 text-center cursor-pointer hover:bg-emerald-200"
                          >
                            {leadManagerMatrix.totals[s.key]}
                          </td>
                        ))}
                        <td 
                          onClick={() => openLeadsDrilldown('All Workspace Leads', `Total ${leadManagerMatrix.totals.total} workspace leads`, leads)}
                          className="p-3.5 text-center pr-6 text-base cursor-pointer hover:bg-emerald-200"
                        >
                          {leadManagerMatrix.totals.total}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

            </div>
          )}



          {/* TAB 5: LEADERBOARD TAB (WorkVeu Screenshot 3) */}
          {activeTab === 'leaderboard' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              
              {/* Header Banner */}
              <div className="p-6 bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 rounded-3xl text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="w-6 h-6 text-amber-400" />
                    <h2 className="text-xl font-black text-white">Sales & Lead Performance Leaderboard</h2>
                  </div>
                  <p className="text-xs text-slate-300">
                    Real-time rankings across sales representatives, lead action stages, traffic acquisition channels, and ad campaigns.
                  </p>
                </div>
                <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 text-xs font-bold shrink-0">
                  <Flame className="w-4 h-4 text-amber-400" />
                  <span>Ranked by Activity & Conversion</span>
                </div>
              </div>

              {/* Grid Layout: Top 2 Boards (Followup Board & Lead Status Board) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 1. Followup Board (Blue Header) */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-sky-500 px-6 py-3.5 flex items-center justify-between text-white font-black text-sm">
                    <div className="flex items-center gap-2">
                      <Trophy size={16} className="text-amber-300" />
                      <span>Followup Board</span>
                    </div>
                    <button onClick={() => fetchAnalytics(true)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                      <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-600 uppercase text-[10px]">
                        <tr>
                          <th className="py-3 px-4 w-12 text-center">Rank</th>
                          <th className="py-3 px-4">User Name</th>
                          <th className="py-3 px-4 text-center">Total Followups</th>
                          <th className="py-3 px-4 text-center">Closing Meetings</th>
                          <th className="py-3 px-4 text-center">Visits+Revisits</th>
                          <th className="py-3 px-4 text-center">DNP</th>
                          <th className="py-3 px-4 text-center">Conv. %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                        {followupBoardRows.map((row, idx) => (
                          <tr 
                            key={row.rep.id} 
                            onClick={() => openLeadsDrilldown(`${row.rep.name} - Followup Activity`, 'Assigned followup leads', row.repLeads)}
                            className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4 text-center font-black">
                              {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                            </td>
                            <td className="py-3 px-4 font-black text-blue-600">{row.rep.name}</td>
                            <td className="py-3 px-4 text-center font-extrabold text-slate-900">{row.totalFollowups}</td>
                            <td className="py-3 px-4 text-center">{row.closingMeetings}</td>
                            <td className="py-3 px-4 text-center">{row.visits}</td>
                            <td className="py-3 px-4 text-center text-rose-600">{row.dnp}</td>
                            <td className="py-3 px-4 text-center font-black text-emerald-600">{row.conversionRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. Lead Status Board (Green Header) */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-emerald-500 px-6 py-3.5 flex items-center justify-between text-white font-black text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-100" />
                      <span>Lead Status Board</span>
                    </div>
                    <button onClick={() => fetchAnalytics(true)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                      <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-600 uppercase text-[10px]">
                        <tr>
                          <th className="py-3 px-4 w-12 text-center">Rank</th>
                          <th className="py-3 px-4">User Name</th>
                          <th className="py-3 px-4 text-center">Req Taken</th>
                          <th className="py-3 px-4 text-center">Visit Planned</th>
                          <th className="py-3 px-4 text-center">Visit Done</th>
                          <th className="py-3 px-4 text-center">Negotiation</th>
                          <th className="py-3 px-4 text-center">Deal/Token</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                        {statusBoardRows.map((row, idx) => (
                          <tr 
                            key={row.rep.id} 
                            onClick={() => openLeadsDrilldown(`${row.rep.name} - Stage Progression`, 'Leads by status stage', row.repLeads)}
                            className="hover:bg-emerald-50/50 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4 text-center font-black">
                              {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                            </td>
                            <td className="py-3 px-4 font-black text-emerald-700">{row.rep.name}</td>
                            <td className="py-3 px-4 text-center">{row.reqTaken}</td>
                            <td className="py-3 px-4 text-center text-amber-600">{row.visitPlanned}</td>
                            <td className="py-3 px-4 text-center font-bold text-blue-600">{row.visitDone}</td>
                            <td className="py-3 px-4 text-center text-purple-600">{row.negotiation}</td>
                            <td className="py-3 px-4 text-center font-black text-emerald-600">{row.dealToken}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

              {/* Grid Layout: Bottom 2 Boards (Source Board & Source Detail Board) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 3. Source Board (Pink Header) */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-rose-500 px-6 py-3.5 flex items-center justify-between text-white font-black text-sm">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={16} className="text-rose-100" />
                      <span>Source Board</span>
                    </div>
                    <button onClick={() => fetchAnalytics(true)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                      <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-600 uppercase text-[10px]">
                        <tr>
                          <th className="py-3 px-4 w-12 text-center">Rank</th>
                          <th className="py-3 px-4">Source</th>
                          <th className="py-3 px-4 text-center">Total Leads</th>
                          <th className="py-3 px-4 text-center">Ongoing</th>
                          <th className="py-3 px-4 text-center">Deal/Token</th>
                          <th className="py-3 px-4 text-center">Lost/NI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                        {sourceBoardRows.map((row, idx) => (
                          <tr 
                            key={row.source} 
                            onClick={() => openLeadsDrilldown(`Source: ${row.source}`, 'Leads from source', row.sourceLeads)}
                            className="hover:bg-rose-50/50 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4 text-center font-black">
                              {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                            </td>
                            <td className="py-3 px-4 font-black text-rose-600">{row.source}</td>
                            <td className="py-3 px-4 text-center font-black text-slate-900">{row.totalLeads}</td>
                            <td className="py-3 px-4 text-center text-blue-600">{row.ongoing}</td>
                            <td className="py-3 px-4 text-center font-black text-emerald-600">{row.won}</td>
                            <td className="py-3 px-4 text-center text-slate-400">{row.lost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 4. Source Detail (Campaign / Project Board) (Pink Header) */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-rose-500 px-6 py-3.5 flex items-center justify-between text-white font-black text-sm">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-rose-100" />
                      <span>Source Detail (Campaign / Project)</span>
                    </div>
                    <button onClick={() => fetchAnalytics(true)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                      <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-600 uppercase text-[10px]">
                        <tr>
                          <th className="py-3 px-4 w-12 text-center">Rank</th>
                          <th className="py-3 px-4">Campaign / Project</th>
                          <th className="py-3 px-4 text-center">Total Leads</th>
                          <th className="py-3 px-4 text-center">Ongoing</th>
                          <th className="py-3 px-4 text-center">Deal/Token</th>
                          <th className="py-3 px-4 text-center">Lost/NI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-bold text-slate-800">
                        {campaignBoardRows.map((row, idx) => (
                          <tr 
                            key={row.campaign} 
                            onClick={() => openLeadsDrilldown(`Campaign: ${row.campaign}`, 'Leads from campaign', row.campaignLeads)}
                            className="hover:bg-rose-50/50 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4 text-center font-black">
                              {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                            </td>
                            <td className="py-3 px-4 font-black text-slate-900 truncate max-w-[180px]" title={row.campaign}>{row.campaign}</td>
                            <td className="py-3 px-4 text-center font-black text-slate-900">{row.totalLeads}</td>
                            <td className="py-3 px-4 text-center text-blue-600">{row.ongoing}</td>
                            <td className="py-3 px-4 text-center font-black text-emerald-600">{row.won}</td>
                            <td className="py-3 px-4 text-center text-slate-400">{row.lost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>

            </div>
          )}

        </>
      )}

      {/* CLICK-TO-DRILLDOWN LEADS DRAWER MODAL */}
      {drilldownModal.isOpen && (
        <div className={`fixed inset-0 z-[99999] ${drilldownIsFullScreen ? 'bg-slate-900/90 flex flex-col p-0' : 'bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6 animate-in fade-in duration-150'}`}>
          <div className={`bg-white flex flex-col overflow-hidden transition-all duration-150 ${drilldownIsFullScreen ? 'w-screen h-screen rounded-none border-none shadow-none max-w-none max-h-none' : 'rounded-3xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[88vh]'}`}>
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
              <div className="flex items-center gap-3">
                {drilldownIsFullScreen && (
                  <button
                    onClick={() => setDrilldownIsFullScreen(false)}
                    className="p-2 rounded-xl bg-slate-200/70 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                    title="Exit Full View"
                  >
                    <ArrowLeft size={18} />
                  </button>
                )}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-extrabold text-slate-900">{drilldownModal.title}</h3>
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-black">
                      {drilldownModal.leads.length} Leads
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">{drilldownModal.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDrilldownIsFullScreen(prev => !prev)}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                  title={drilldownIsFullScreen ? "Restore Normal Window" : "Expand to Full CRM View"}
                >
                  {drilldownIsFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  <span>{drilldownIsFullScreen ? 'Exit Full View' : 'Full CRM View'}</span>
                </button>
                <button
                  onClick={() => {
                    setDrilldownIsFullScreen(false)
                    setDrilldownModal(prev => ({ ...prev, isOpen: false }))
                  }}
                  className="p-2 rounded-xl bg-slate-200/60 text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Search Bar, Filter Button, Stage Filter Pills & View Mode Toggle */}
            <div className="p-3 sm:p-4 border-b border-slate-100 bg-white space-y-2.5 shrink-0">
              <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
                <div className="relative flex-1 w-full">
                  <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter leads by name, phone, stage, notes..."
                    value={drilldownModal.searchFilter}
                    onChange={(e) => {
                      setDrilldownPage(1)
                      setDrilldownModal(prev => ({ ...prev, searchFilter: e.target.value }))
                    }}
                    className="w-full bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 rounded-xl pl-9 pr-8 py-2 focus:ring-2 focus:ring-blue-500/20"
                  />
                  {drilldownModal.searchFilter && (
                    <button
                      onClick={() => {
                        setDrilldownPage(1)
                        setDrilldownModal(prev => ({ ...prev, searchFilter: '' }))
                      }}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                      title="Clear search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end flex-wrap">
                  {/* Filters Toggle Button (with active count badge) */}
                  <button
                    onClick={() => setDrilldownShowFilters(prev => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1.5 shrink-0 cursor-pointer ${
                      drilldownShowFilters || activeDrilldownFilterCount > 0
                        ? 'bg-slate-800 text-white border-slate-800 shadow-xs font-black'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                    title="Toggle CRM Filters"
                  >
                    <Filter size={13} />
                    <span>Filters</span>
                    {activeDrilldownFilterCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-blue-500 text-white text-[10px] font-black leading-none">
                        {activeDrilldownFilterCount}
                      </span>
                    )}
                  </button>

                  {/* Sort Selector Dropdown */}
                  <div className="flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-bold shrink-0">
                    <ArrowUpDown size={13} className="text-slate-500 shrink-0" />
                    <select
                      value={drilldownSort}
                      onChange={(e) => {
                        setDrilldownPage(1)
                        setDrilldownSort(e.target.value as any)
                      }}
                      className="bg-transparent border-none text-slate-800 text-xs font-black focus:ring-0 cursor-pointer outline-none pr-1"
                      title="Sort Leads"
                    >
                      <option value="next_action_asc">📅 Next Action (Earliest First)</option>
                      <option value="next_action_desc">📅 Next Action (Latest First)</option>
                      <option value="last_attempt_desc">⏱️ Last Attempt (Newest First)</option>
                      <option value="last_attempt_asc">⏱️ Last Attempt (Oldest First)</option>
                      <option value="created_desc">✨ Created Date (Newest First)</option>
                      <option value="created_asc">✨ Created Date (Oldest First)</option>
                      <option value="name_asc">🔤 Name (A-Z)</option>
                    </select>
                  </div>

                  {/* Page Size Selector */}
                  <div className="flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-bold shrink-0">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">Show:</span>
                    <select
                      value={drilldownPageSize}
                      onChange={(e) => {
                        setDrilldownPageSize(Number(e.target.value))
                        setDrilldownPage(1)
                      }}
                      className="bg-transparent border-none text-blue-700 text-xs font-black focus:ring-0 cursor-pointer outline-none"
                      title="Rows per page"
                    >
                      <option value={25}>25 / page</option>
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                      <option value={200}>200 / page</option>
                    </select>
                  </div>

                  {/* View Mode Toggle: Compact List vs Cards */}
                  <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 text-xs font-bold shrink-0">
                    <button
                      onClick={() => setDrilldownViewMode('list')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${drilldownViewMode === 'list' ? 'bg-blue-600 text-white shadow-xs font-extrabold' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      <span>📋 List</span>
                    </button>
                    <button
                      onClick={() => setDrilldownViewMode('card')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${drilldownViewMode === 'card' ? 'bg-blue-600 text-white shadow-xs font-extrabold' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      <span>📇 Cards</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* EXPANDABLE ADVANCED CRM FILTERS DRAWER */}
              {drilldownShowFilters && (
                <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3 sm:p-4 space-y-3 animate-in slide-in-from-top-2 duration-150">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                    {/* 1. Assigned Agent */}
                    <div className="relative flex-1">
                      <label className="block text-[9px] font-black text-slate-500 uppercase mb-1 flex items-center gap-1">
                        <User size={10} className="text-blue-600" />
                        <span>Assigned Agent</span>
                      </label>
                      <div className="relative">
                        <select
                          value={drilldownAgentFilter}
                          onChange={(e) => {
                            setDrilldownAgentFilter(e.target.value)
                            setDrilldownPage(1)
                          }}
                          className={`w-full appearance-none rounded-xl text-xs font-bold py-2 pl-3 pr-8 outline-none border transition-all cursor-pointer truncate ${
                            drilldownAgentFilter !== 'ALL' ? 'bg-indigo-50/80 border-indigo-300 text-indigo-950 font-black' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <option value="ALL">All Team Members ({allSalesReps.length})</option>
                          <option value="UNASSIGNED">⚠️ Unassigned Only</option>
                          {allSalesReps.map(rep => (
                            <option key={rep.id} value={rep.id}>👤 {rep.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* 2. Next Action Schedule Timing */}
                    <div className="relative flex-1">
                      <label className="block text-[9px] font-black text-purple-600 uppercase mb-1 flex items-center gap-1">
                        <Clock size={10} />
                        <span>Action Schedule</span>
                      </label>
                      <div className="relative">
                        <select
                          value={drilldownNextActionFilter}
                          onChange={(e) => {
                            setDrilldownNextActionFilter(e.target.value as any)
                            setDrilldownPage(1)
                          }}
                          className={`w-full appearance-none rounded-xl text-xs font-bold py-2 pl-3 pr-8 outline-none border transition-all cursor-pointer truncate ${
                            drilldownNextActionFilter !== 'ALL' ? 'bg-purple-100/90 border-purple-400 text-purple-950 font-black' : 'bg-purple-50/50 border-purple-200/80 text-purple-900 hover:bg-purple-100/40'
                          }`}
                        >
                          <option value="ALL">All Next Actions</option>
                          <option value="TODAY">📅 Due Today</option>
                          <option value="OVERDUE">⚠️ Overdue Actions</option>
                          <option value="UPCOMING">⚡ Upcoming / Future</option>
                          <option value="HAS_ACTION">🔔 Any Scheduled Action</option>
                          <option value="NO_ACTION">❌ No Action Scheduled</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* 3. Action Type */}
                    <div className="relative flex-1">
                      <label className="block text-[9px] font-black text-purple-600 uppercase mb-1">Action Type</label>
                      <div className="relative">
                        <select
                          value={drilldownNextActionType}
                          onChange={(e) => {
                            setDrilldownNextActionType(e.target.value)
                            setDrilldownPage(1)
                          }}
                          className={`w-full appearance-none rounded-xl text-xs font-bold py-2 pl-3 pr-8 outline-none border transition-all cursor-pointer truncate ${
                            drilldownNextActionType !== 'ALL' ? 'bg-purple-100/90 border-purple-400 text-purple-950 font-black' : 'bg-purple-50/50 border-purple-200/80 text-purple-900 hover:bg-purple-100/40'
                          }`}
                        >
                          <option value="ALL">All Action Types</option>
                          <option value="Call">📞 Call</option>
                          <option value="Visit">🏠 Visit</option>
                          <option value="Revisit">🔄 Revisit</option>
                          <option value="Closing Meeting">💼 Closing Meeting</option>
                          <option value="Home Meeting">🏡 Home Meeting</option>
                          <option value="WhatsApp">💬 WhatsApp</option>
                          <option value="Email">✉️ Email</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* 4. DNP Status */}
                    <div className="relative flex-1">
                      <label className="block text-[9px] font-black text-rose-600 uppercase mb-1 flex items-center gap-1">
                        <PhoneOff size={10} />
                        <span>DNP Status</span>
                      </label>
                      <div className="relative">
                        <select
                          value={drilldownDnpFilter}
                          onChange={(e) => {
                            setDrilldownDnpFilter(e.target.value as any)
                            setDrilldownPage(1)
                          }}
                          className={`w-full appearance-none rounded-xl text-xs font-bold py-2 pl-3 pr-8 outline-none border transition-all cursor-pointer truncate ${
                            drilldownDnpFilter !== 'ALL' ? 'bg-rose-100/90 border-rose-400 text-rose-950 font-black' : 'bg-rose-50/50 border-rose-200/80 text-rose-900 hover:bg-rose-100/40'
                          }`}
                        >
                          <option value="ALL">All Leads (No DNP Filter)</option>
                          <option value="DNP_ONLY">🔥 DNP Only (&gt; 0)</option>
                          <option value="DNP_1">DNP 1</option>
                          <option value="DNP_2">DNP 2</option>
                          <option value="DNP_3PLUS">DNP 3+ (Retry Queue)</option>
                          <option value="NO_DNP">No DNP (0)</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* 5. Date Preset with Basis Switcher */}
                    <div className="relative flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[9px] font-black text-slate-500 uppercase flex items-center gap-1">
                          <Calendar size={10} />
                          <span>Date ({drilldownDateBasis === 'action' ? 'Action Date' : drilldownDateBasis === 'created' ? 'Lead Created' : 'Any Date'})</span>
                        </label>
                        <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg text-[9px] font-black">
                          <button
                            type="button"
                            onClick={() => { setDrilldownDateBasis('action'); setDrilldownPage(1); }}
                            className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${drilldownDateBasis === 'action' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                            title="Filter by Next Action / Schedule Date"
                          >
                            Action
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDrilldownDateBasis('created'); setDrilldownPage(1); }}
                            className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${drilldownDateBasis === 'created' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                            title="Filter by Lead Creation Date"
                          >
                            Created
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDrilldownDateBasis('any'); setDrilldownPage(1); }}
                            className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${drilldownDateBasis === 'any' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
                            title="Match Either Action Date or Created Date"
                          >
                            Any
                          </button>
                        </div>
                      </div>
                      <div className="relative">
                        <select
                          value={drilldownDateRange}
                          onChange={(e) => {
                            setDrilldownDateRange(e.target.value)
                            setDrilldownPage(1)
                          }}
                          className={`w-full appearance-none rounded-xl text-xs font-bold py-2 pl-3 pr-8 outline-none border transition-all cursor-pointer truncate ${
                            drilldownDateRange !== 'ALL' ? 'bg-blue-50/80 border-blue-300 text-blue-950 font-black' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <option value="ALL">All Time</option>
                          <option value="TODAY">Today</option>
                          <option value="YESTERDAY">Yesterday</option>
                          <option value="7D">Last 7 Days</option>
                          <option value="30D">Last 30 Days</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* 6. Custom Date / Range Popover */}
                    <div className="relative flex-1">
                      <label className="block text-[9px] font-black text-blue-600 uppercase mb-1">Custom Date / Range</label>
                      <button
                        type="button"
                        onClick={() => setDrilldownDatePickerOpen(prev => !prev)}
                        className={`w-full py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all border shadow-xs cursor-pointer ${
                          (drilldownCustomDate || (drilldownStartDate && drilldownEndDate))
                            ? 'bg-blue-600 border-blue-600 text-white shadow-xs font-black'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-blue-400'
                        }`}
                      >
                        <span className="truncate">
                          {drilldownCustomDate
                            ? `Date: ${drilldownCustomDate}`
                            : (drilldownStartDate && drilldownEndDate)
                            ? `${drilldownStartDate} → ${drilldownEndDate}`
                            : 'Pick Custom Date'}
                        </span>
                        <Calendar size={12} className={(drilldownCustomDate || (drilldownStartDate && drilldownEndDate)) ? 'text-white' : 'text-blue-600'} />
                      </button>

                      {drilldownDatePickerOpen && (
                        <>
                          <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-50 sm:hidden" onClick={() => setDrilldownDatePickerOpen(false)} />
                          <div className="fixed inset-x-4 top-24 z-50 bg-white border border-slate-200 rounded-2xl p-4 shadow-2xl space-y-3 sm:absolute sm:inset-auto sm:right-0 sm:top-14 sm:w-72">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                              <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                                <Calendar size={14} className="text-blue-600" /> Filter Leads by Date
                              </span>
                              <button type="button" onClick={() => setDrilldownDatePickerOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                                <X size={15} />
                              </button>
                            </div>

                            <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-bold">
                              <button
                                type="button"
                                onClick={() => { setDrilldownDateFilterMode('single'); setDrilldownStartDate(''); setDrilldownEndDate(''); setDrilldownPage(1); }}
                                className={`py-1 rounded-lg transition-all cursor-pointer ${drilldownDateFilterMode === 'single' ? 'bg-white text-blue-700 shadow-xs font-black' : 'text-slate-500'}`}
                              >
                                Single Date
                              </button>
                              <button
                                type="button"
                                onClick={() => { setDrilldownDateFilterMode('range'); setDrilldownCustomDate(''); setDrilldownPage(1); }}
                                className={`py-1 rounded-lg transition-all cursor-pointer ${drilldownDateFilterMode === 'range' ? 'bg-white text-blue-700 shadow-xs font-black' : 'text-slate-500'}`}
                              >
                                Date Range
                              </button>
                            </div>

                            {drilldownDateFilterMode === 'single' ? (
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 block">Select Specific Date:</label>
                                <input
                                  type="date"
                                  value={drilldownCustomDate}
                                  onChange={(e) => {
                                    setDrilldownCustomDate(e.target.value)
                                    setDrilldownStartDate('')
                                    setDrilldownEndDate('')
                                    setDrilldownPage(1)
                                  }}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                                />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Start Date:</label>
                                  <input
                                    type="date"
                                    value={drilldownStartDate}
                                    onChange={(e) => {
                                      setDrilldownStartDate(e.target.value)
                                      setDrilldownCustomDate('')
                                      setDrilldownPage(1)
                                    }}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">End Date:</label>
                                  <input
                                    type="date"
                                    value={drilldownEndDate}
                                    onChange={(e) => {
                                      setDrilldownEndDate(e.target.value)
                                      setDrilldownCustomDate('')
                                      setDrilldownPage(1)
                                    }}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                                  />
                                </div>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => {
                                  setDrilldownCustomDate('')
                                  setDrilldownStartDate('')
                                  setDrilldownEndDate('')
                                  setDrilldownDatePickerOpen(false)
                                  setDrilldownPage(1)
                                }}
                                className="text-xs font-extrabold text-slate-400 hover:text-slate-600 cursor-pointer"
                              >
                                Clear Filter
                              </button>
                              <button
                                type="button"
                                onClick={() => setDrilldownDatePickerOpen(false)}
                                className="bg-blue-600 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-sm hover:bg-blue-500 cursor-pointer"
                              >
                                Apply Filter
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* 7. Campaign Filter */}
                    <div className="relative flex-1">
                      <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">Campaign</label>
                      <div className="relative">
                        <select
                          value={drilldownCampaign}
                          onChange={(e) => {
                            setDrilldownCampaign(e.target.value)
                            setDrilldownPage(1)
                          }}
                          className={`w-full appearance-none rounded-xl text-xs font-bold py-2 pl-3 pr-8 outline-none border transition-all cursor-pointer truncate ${
                            drilldownCampaign ? 'bg-blue-50/80 border-blue-300 text-blue-950 font-black' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <option value="">All Campaigns ({modalCampaigns.length})</option>
                          {modalCampaigns.map((camp, idx) => (
                            <option key={idx} value={camp}>{camp}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    {/* 8. Lead Form / Source Filter */}
                    <div className="relative flex-1">
                      <label className="block text-[9px] font-black text-purple-600 uppercase mb-1">Lead Form / Source</label>
                      <div className="relative">
                        <select
                          value={drilldownForm}
                          onChange={(e) => {
                            setDrilldownForm(e.target.value)
                            setDrilldownPage(1)
                          }}
                          className={`w-full appearance-none rounded-xl text-xs font-bold py-2 pl-3 pr-8 outline-none border transition-all cursor-pointer truncate ${
                            drilldownForm ? 'bg-purple-50/80 border-purple-300 text-purple-950 font-black' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <option value="">All Forms / Sources ({modalForms.length})</option>
                          {modalForms.map((f, idx) => (
                            <option key={idx} value={f}>{f}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none" />
                      </div>
                    </div>
                  </div>

                  {/* Drawer Footer Actions */}
                  {activeDrilldownFilterCount > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                      <span className="text-[11px] font-extrabold text-slate-500">
                        {activeDrilldownFilterCount} filter{activeDrilldownFilterCount > 1 ? 's' : ''} applied
                      </span>
                      <button
                        type="button"
                        onClick={clearAllDrilldownFilters}
                        className="text-xs font-black text-red-500 hover:text-red-700 hover:underline cursor-pointer"
                      >
                        Clear All Filters
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ACTIVE FILTER CHIPS (Visible even when filter drawer is collapsed) */}
              {activeDrilldownFilterCount > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar pt-0.5 flex-wrap">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mr-0.5">Active Filters:</span>
                  
                  {drilldownAgentFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200">
                      <span>Agent: {drilldownAgentFilter === 'UNASSIGNED' ? 'Unassigned' : (allSalesReps.find(r => r.id === drilldownAgentFilter)?.name || drilldownAgentFilter)}</span>
                      <button onClick={() => { setDrilldownAgentFilter('ALL'); setDrilldownPage(1); }} className="hover:text-indigo-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownNextActionFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-purple-50 text-purple-800 border border-purple-200">
                      <span>Schedule: {drilldownNextActionFilter}</span>
                      <button onClick={() => { setDrilldownNextActionFilter('ALL'); setDrilldownPage(1); }} className="hover:text-purple-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownNextActionType !== 'ALL' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-purple-50 text-purple-800 border border-purple-200">
                      <span>Type: {drilldownNextActionType}</span>
                      <button onClick={() => { setDrilldownNextActionType('ALL'); setDrilldownPage(1); }} className="hover:text-purple-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownDnpFilter !== 'ALL' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-rose-50 text-rose-800 border border-rose-200">
                      <span>DNP: {drilldownDnpFilter}</span>
                      <button onClick={() => { setDrilldownDnpFilter('ALL'); setDrilldownPage(1); }} className="hover:text-rose-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownCustomDate && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-50 text-blue-800 border border-blue-200">
                      <span>Date ({drilldownDateBasis === 'action' ? 'Action' : drilldownDateBasis === 'created' ? 'Created' : 'Any'}): {drilldownCustomDate}</span>
                      <button onClick={() => { setDrilldownCustomDate(''); setDrilldownPage(1); }} className="hover:text-blue-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownStartDate && drilldownEndDate && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-50 text-blue-800 border border-blue-200">
                      <span>Date ({drilldownDateBasis === 'action' ? 'Action' : drilldownDateBasis === 'created' ? 'Created' : 'Any'}): {drilldownStartDate} → {drilldownEndDate}</span>
                      <button onClick={() => { setDrilldownStartDate(''); setDrilldownEndDate(''); setDrilldownPage(1); }} className="hover:text-blue-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {!drilldownCustomDate && (!drilldownStartDate || !drilldownEndDate) && drilldownDateRange !== 'ALL' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-50 text-blue-800 border border-blue-200">
                      <span>Date ({drilldownDateBasis === 'action' ? 'Action' : drilldownDateBasis === 'created' ? 'Created' : 'Any'}): {drilldownDateRange}</span>
                      <button onClick={() => { setDrilldownDateRange('ALL'); setDrilldownPage(1); }} className="hover:text-blue-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownCampaign && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-50 text-blue-800 border border-blue-200">
                      <span>Campaign: {drilldownCampaign}</span>
                      <button onClick={() => { setDrilldownCampaign(''); setDrilldownPage(1); }} className="hover:text-blue-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownForm && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-purple-50 text-purple-800 border border-purple-200">
                      <span>Form: {drilldownForm}</span>
                      <button onClick={() => { setDrilldownForm(''); setDrilldownPage(1); }} className="hover:text-purple-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  {drilldownStageFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-slate-200 text-slate-800 border border-slate-300">
                      <span>Stage: {drilldownStageFilter}</span>
                      <button onClick={() => { setDrilldownStageFilter('all'); setDrilldownPage(1); }} className="hover:text-slate-950 p-0.5 cursor-pointer"><X size={11} /></button>
                    </span>
                  )}

                  <button
                    onClick={clearAllDrilldownFilters}
                    className="text-xs font-black text-red-500 hover:text-red-700 hover:underline px-2 py-0.5 cursor-pointer"
                  >
                    Reset all
                  </button>
                </div>
              )}

              {/* Stage Filter Pills */}
              {modalStages.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar pt-1 border-t border-slate-100">
                  <button
                    onClick={() => {
                      setDrilldownStageFilter('all')
                      setDrilldownPage(1)
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all shrink-0 cursor-pointer ${
                      drilldownStageFilter === 'all'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    All ({drilldownModal.leads.length})
                  </button>
                  {modalStages.map(st => (
                    <button
                      key={st.name}
                      onClick={() => {
                        setDrilldownStageFilter(st.name)
                        setDrilldownPage(1)
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all shrink-0 cursor-pointer ${
                        drilldownStageFilter.toLowerCase() === st.name.toLowerCase()
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {st.name} ({st.count})
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Leads List */}
            {(() => {
              const filtered = drilldownModal.leads.filter(l => {
                // 1. Stage filter
                if (drilldownStageFilter !== 'all') {
                  const st = (l.pipeline_stage || l.status || 'New Lead').toLowerCase()
                  if (st !== drilldownStageFilter.toLowerCase()) return false
                }

                // 2. Search query filter
                if (drilldownModal.searchFilter.trim()) {
                  const q = drilldownModal.searchFilter.toLowerCase().trim()
                  const nameMatch = (l.name || '').toLowerCase().includes(q)
                  const phoneMatch = (l.phone || '').includes(q)
                  const emailMatch = (l.email || '').toLowerCase().includes(q)
                  const stageMatch = (l.pipeline_stage || '').toLowerCase().includes(q)
                  const statusMatch = (l.status || '').toLowerCase().includes(q)
                  const notesMatch = (l.notes || '').toLowerCase().includes(q)
                  const campMatch = (l.campaign_name || l.ad_name || '').toLowerCase().includes(q)
                  const formMatch = (l.form_name || l.source || '').toLowerCase().includes(q)
                  if (!nameMatch && !phoneMatch && !emailMatch && !stageMatch && !statusMatch && !notesMatch && !campMatch && !formMatch) {
                    return false
                  }
                }

                // 3. Assigned Agent Filter
                if (drilldownAgentFilter !== 'ALL') {
                  if (drilldownAgentFilter === 'UNASSIGNED') {
                    if (l.assigned_to) return false
                  } else {
                    if (!isLeadAssignedToRep(l, drilldownAgentFilter)) return false
                  }
                }

                // 4. Date Preset Filter (Action Date vs Lead Created Date)
                const getLeadDatesForBasis = (leadItem: any, basis: 'action' | 'created' | 'any'): Date[] => {
                  const dates: Date[] = []
                  let cfItem: any = leadItem.custom_fields
                  if (typeof cfItem === 'string') { try { cfItem = JSON.parse(cfItem) } catch (e) {} }

                  if (basis === 'action' || basis === 'any') {
                    const rawAction = leadItem.next_followup || cfItem?.next_action_date || leadItem.booked_time || cfItem?.last_followup_at || cfItem?.last_action_date
                    if (rawAction) {
                      const d = new Date(rawAction)
                      if (!isNaN(d.getTime())) dates.push(d)
                    }
                  }

                  if (basis === 'created' || basis === 'any') {
                    const rawCreated = leadItem.facebook_created_at || leadItem.created_at
                    if (rawCreated) {
                      const d = new Date(rawCreated)
                      if (!isNaN(d.getTime())) dates.push(d)
                    }
                  }

                  return dates
                }

                const hasCustomDate = !!drilldownCustomDate || (!!drilldownStartDate && !!drilldownEndDate)
                if (!hasCustomDate && drilldownDateRange !== 'ALL') {
                  const targetDates = getLeadDatesForBasis(l, drilldownDateBasis)
                  if (targetDates.length === 0) return false

                  const now = new Date()
                  const matchesPreset = targetDates.some(leadDate => {
                    if (drilldownDateRange === 'TODAY') {
                      return leadDate.getFullYear() === now.getFullYear() &&
                             leadDate.getMonth() === now.getMonth() &&
                             leadDate.getDate() === now.getDate()
                    } else if (drilldownDateRange === 'YESTERDAY') {
                      const yest = new Date(now)
                      yest.setDate(now.getDate() - 1)
                      return leadDate.getFullYear() === yest.getFullYear() &&
                             leadDate.getMonth() === yest.getMonth() &&
                             leadDate.getDate() === yest.getDate()
                    } else if (drilldownDateRange === '7D') {
                      const limit = new Date(now)
                      limit.setDate(now.getDate() - 7)
                      return leadDate >= limit
                    } else if (drilldownDateRange === '30D') {
                      const limit = new Date(now)
                      limit.setDate(now.getDate() - 30)
                      return leadDate >= limit
                    }
                    return true
                  })

                  if (!matchesPreset) return false
                }

                // 5. Custom Date / Range Filter
                if (drilldownCustomDate) {
                  const targetDates = getLeadDatesForBasis(l, drilldownDateBasis)
                  if (targetDates.length === 0) return false
                  const [tY, tM, tD] = drilldownCustomDate.split('-').map(Number)
                  const matchesCustom = targetDates.some(leadDate => 
                    leadDate.getFullYear() === tY &&
                    (leadDate.getMonth() + 1) === tM &&
                    leadDate.getDate() === tD
                  )
                  if (!matchesCustom) return false
                } else if (drilldownStartDate && drilldownEndDate) {
                  const targetDates = getLeadDatesForBasis(l, drilldownDateBasis)
                  if (targetDates.length === 0) return false
                  const [sY, sM, sD] = drilldownStartDate.split('-').map(Number)
                  const [eY, eM, eD] = drilldownEndDate.split('-').map(Number)
                  const start = new Date(sY, sM - 1, sD, 0, 0, 0, 0)
                  const end = new Date(eY, eM - 1, eD, 23, 59, 59, 999)
                  const matchesRange = targetDates.some(leadDate => leadDate >= start && leadDate <= end)
                  if (!matchesRange) return false
                }

                // 6. DNP Filter
                if (drilldownDnpFilter !== 'ALL') {
                  let cf: any = l.custom_fields
                  if (typeof cf === 'string') {
                    try { cf = JSON.parse(cf) } catch (e) {}
                  }
                  const count = l.dnp_count || cf?.dnp_count || 0
                  if (drilldownDnpFilter === 'DNP_ONLY' && count <= 0) return false
                  if (drilldownDnpFilter === 'DNP_1' && count !== 1) return false
                  if (drilldownDnpFilter === 'DNP_2' && count !== 2) return false
                  if (drilldownDnpFilter === 'DNP_3PLUS' && count < 3) return false
                  if (drilldownDnpFilter === 'NO_DNP' && count > 0) return false
                }

                // 7. Next Action Timing & Type Filter
                let cf: any = l.custom_fields
                if (typeof cf === 'string') {
                  try { cf = JSON.parse(cf) } catch (e) {}
                }
                const actionDateStr = l.next_action_date || l.next_followup || cf?.next_action_date || l.booked_time
                const hasActionDate = !!actionDateStr

                if (drilldownNextActionFilter !== 'ALL') {
                  let isPast = false
                  let isToday = false
                  let isFuture = false

                  if (hasActionDate) {
                    const actionDateObj = new Date(actionDateStr)
                    if (!isNaN(actionDateObj.getTime())) {
                      const now = new Date()
                      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

                      if (actionDateObj < startOfToday) {
                        isPast = true
                      } else if (actionDateObj >= startOfToday && actionDateObj <= endOfToday) {
                        isToday = true
                      } else {
                        isFuture = true
                      }
                    }
                  }

                  if (drilldownNextActionFilter === 'HAS_ACTION' && !hasActionDate) return false
                  if (drilldownNextActionFilter === 'TODAY' && (!hasActionDate || !isToday)) return false
                  if (drilldownNextActionFilter === 'OVERDUE' && (!hasActionDate || !isPast)) return false
                  if (drilldownNextActionFilter === 'UPCOMING' && (!hasActionDate || !isFuture)) return false
                  if (drilldownNextActionFilter === 'NO_ACTION' && hasActionDate) return false
                }

                if (drilldownNextActionType !== 'ALL') {
                  const rawActType = (cf?.next_action_type || l.next_action_type || l.last_followup_type || 'Call').trim().toLowerCase()
                  let actType = 'Call'
                  if (rawActType === 'revisit' || rawActType.includes('revisit')) actType = 'Revisit'
                  else if (rawActType.includes('closing')) actType = 'Closing Meeting'
                  else if (rawActType.includes('home')) actType = 'Home Meeting'
                  else if (rawActType === 'visit' || rawActType.includes('visit') || rawActType.includes('site')) actType = 'Visit'
                  else if (rawActType.includes('whatsapp')) actType = 'WhatsApp'
                  else if (rawActType.includes('email')) actType = 'Email'
                  else if (rawActType.includes('call')) actType = 'Call'
                  else actType = 'Call'

                  if (actType.toLowerCase() !== drilldownNextActionType.toLowerCase()) return false
                }

                // 8. Campaign Filter
                if (drilldownCampaign) {
                  const campTarget = drilldownCampaign.toLowerCase().trim()
                  const campName = resolveLeadCampaign(l).toLowerCase().trim()
                  if (campName !== campTarget && !campName.includes(campTarget)) return false
                }

                // 9. Lead Form / Source Filter
                if (drilldownForm) {
                  const formTarget = drilldownForm.toLowerCase().trim()
                  const formName = resolveLeadFormOrSource(l).toLowerCase().trim()
                  if (formName !== formTarget && !formName.includes(formTarget)) return false
                }

                return true
              })

              const sortedFiltered = [...filtered].sort((a, b) => {
                if (drilldownSort === 'next_action_asc') {
                  const tA = getLeadNextActionTime(a) || Infinity
                  const tB = getLeadNextActionTime(b) || Infinity
                  return tA - tB
                }
                if (drilldownSort === 'next_action_desc') {
                  const tA = getLeadNextActionTime(a) || 0
                  const tB = getLeadNextActionTime(b) || 0
                  return tB - tA
                }
                if (drilldownSort === 'last_attempt_desc') {
                  const tA = getLeadLastAttemptTime(a)
                  const tB = getLeadLastAttemptTime(b)
                  return tB - tA
                }
                if (drilldownSort === 'last_attempt_asc') {
                  const tA = getLeadLastAttemptTime(a) || Infinity
                  const tB = getLeadLastAttemptTime(b) || Infinity
                  return tA - tB
                }
                if (drilldownSort === 'created_desc') {
                  const tA = new Date(a.created_at || 0).getTime()
                  const tB = new Date(b.created_at || 0).getTime()
                  return tB - tA
                }
                if (drilldownSort === 'created_asc') {
                  const tA = new Date(a.created_at || 0).getTime()
                  const tB = new Date(b.created_at || 0).getTime()
                  return tA - tB
                }
                if (drilldownSort === 'name_asc') {
                  return (a.name || '').localeCompare(b.name || '')
                }
                return 0
              })

              const totalFilteredCount = sortedFiltered.length
              const totalPages = Math.max(1, Math.ceil(totalFilteredCount / drilldownPageSize))
              const safePage = Math.min(Math.max(1, drilldownPage), totalPages)
              const startIndex = (safePage - 1) * drilldownPageSize
              const endIndex = Math.min(startIndex + drilldownPageSize, totalFilteredCount)
              const paginatedLeads = sortedFiltered.slice(startIndex, endIndex)

              // Build smart page numbers array
              const getPageNumbers = () => {
                if (totalPages <= 7) {
                  return Array.from({ length: totalPages }, (_, i) => i + 1)
                }
                if (safePage <= 4) {
                  return [1, 2, 3, 4, 5, '...', totalPages]
                }
                if (safePage >= totalPages - 3) {
                  return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
                }
                return [1, '...', safePage - 1, safePage, safePage + 1, '...', totalPages]
              }

              return (
                <>
                  {/* Top Pagination Summary Bar */}
                  <div className="px-4 sm:px-6 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600 shrink-0">
                    <div>
                      {totalFilteredCount > 0 ? (
                        <span>Showing <strong className="text-slate-900">{startIndex + 1}–{endIndex}</strong> of <strong className="text-blue-600">{totalFilteredCount.toLocaleString()}</strong> leads</span>
                      ) : (
                        <span>0 leads found</span>
                      )}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setDrilldownPage(prev => Math.max(1, prev - 1))}
                          disabled={safePage === 1}
                          className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-extrabold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          ◀ Prev
                        </button>
                        <span className="px-2 font-black text-slate-800">
                          {safePage} / {totalPages}
                        </span>
                        <button
                          onClick={() => setDrilldownPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={safePage === totalPages}
                          className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-extrabold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                          Next ▶
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Modal Leads List Body */}
                  <div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar flex-1 space-y-2">
                    {totalFilteredCount === 0 ? (
                      <div className="text-center py-12 text-slate-400">
                        <Users size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="text-xs font-extrabold text-slate-600">
                          {activeDrilldownFilterCount > 0 ? 'No leads match the selected filters.' : 'No active leads found for this view.'}
                        </p>
                        {activeDrilldownFilterCount > 0 && (
                          <button
                            type="button"
                            onClick={clearAllDrilldownFilters}
                            className="mt-3 px-3.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-black hover:bg-blue-100 transition-colors cursor-pointer shadow-2xs inline-flex items-center gap-1.5"
                          >
                            <span>Reset All Filters</span>
                          </button>
                        )}
                      </div>
                    ) : drilldownViewMode === 'list' ? (
                      /* COMPACT LIST VIEW WITH LAST REMARKS GLIMPSE */
                      <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-white shadow-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase tracking-wider select-none">
                              <th 
                                className="py-3 px-3 cursor-pointer hover:bg-slate-200/70 transition-colors"
                                onClick={() => setDrilldownSort(prev => prev === 'name_asc' ? 'created_desc' : 'name_asc')}
                                title="Click to sort by Name"
                              >
                                <div className="flex items-center gap-1">
                                  <span>Lead & Contact</span>
                                  {drilldownSort === 'name_asc' && <span className="text-blue-600 font-extrabold">▲</span>}
                                </div>
                              </th>
                              <th className="py-3 px-3">Stage / Rep</th>
                              <th 
                                className="py-3 px-3 min-w-[220px] cursor-pointer hover:bg-slate-200/70 transition-colors"
                                onClick={() => setDrilldownSort(prev => prev === 'last_attempt_desc' ? 'last_attempt_asc' : 'last_attempt_desc')}
                                title="Click to sort by Last Attempt / Remark Date"
                              >
                                <div className="flex items-center gap-1">
                                  <span>Last Remark / Notes</span>
                                  {drilldownSort === 'last_attempt_desc' && <span className="text-blue-600 font-extrabold">▼</span>}
                                  {drilldownSort === 'last_attempt_asc' && <span className="text-blue-600 font-extrabold">▲</span>}
                                </div>
                              </th>
                              <th 
                                className="py-3 px-3 cursor-pointer hover:bg-slate-200/70 transition-colors"
                                onClick={() => setDrilldownSort(prev => prev === 'next_action_asc' ? 'next_action_desc' : 'next_action_asc')}
                                title="Click to sort by Next Action Date"
                              >
                                <div className="flex items-center gap-1">
                                  <span>Next Action</span>
                                  {drilldownSort === 'next_action_asc' && <span className="text-blue-600 font-extrabold">▲</span>}
                                  {drilldownSort === 'next_action_desc' && <span className="text-blue-600 font-extrabold">▼</span>}
                                </div>
                              </th>
                              <th className="py-3 px-3 text-right">Quick Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-xs">
                            {paginatedLeads.map((lead: any) => {
                      const assignedRep = allSalesReps.find(r => r.id === lead.assigned_to)?.name || 'Unassigned'
                              let cf: any = lead.custom_fields
                              if (typeof cf === 'string') {
                                try { cf = JSON.parse(cf) } catch (e) {}
                              }

                              const { remark: lastRemark, formattedTime: formattedRemarkTime } = getLeadLatestRemark(lead)
                              const isVisited = hasLeadVisited(lead)
                              const followupCount = getLeadFollowupCount(lead)
                              const reopenCount = getLeadReopenCount(lead)

                              const rawNextDate = lead.next_followup || cf?.next_action_date || lead.booked_time
                              const nextActionType = (cf?.next_action_type || lead.next_action_type || 'Call').trim()
                              const nextActionRemark = getLeadNextActionRemark(lead)

                              let nextActionFormatted = ''
                              if (rawNextDate) {
                                try {
                                  const d = new Date(rawNextDate)
                                  if (!isNaN(d.getTime())) {
                                    nextActionFormatted = d.toLocaleString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: true
                                    })
                                  }
                                } catch (e) {}
                              }

                              return (
                                <tr key={lead.id} className="hover:bg-blue-50/40 transition-colors group">
                                  <td className="py-2.5 px-3">
                                    <div 
                                      onClick={() => router.push(`/dashboard/crm/${lead.id}`)}
                                      className="font-extrabold text-slate-900 text-xs hover:text-blue-600 cursor-pointer transition-colors flex items-center gap-1.5 flex-wrap"
                                      title="Open Lead Details"
                                    >
                                      <span>{lead.name || 'Unknown Prospect'}</span>
                                      {isLeadLastStatusDnp(lead) && (
                                        <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-rose-100 text-rose-800 border border-rose-300 shrink-0 inline-flex items-center gap-0.5 shadow-2xs">
                                          <PhoneOff size={9} /> DNP
                                        </span>
                                      )}
                                      {isVisited && (
                                        <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0 inline-flex items-center gap-0.5 shadow-2xs">
                                          <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                                          Visited
                                        </span>
                                      )}
                                      {reopenCount > 0 && (
                                        <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-purple-100 text-purple-800 border border-purple-300 shrink-0 inline-flex items-center gap-0.5 shadow-2xs" title={`Lead was reopened from Meta Ads (${reopenCount}x)`}>
                                          🔄 Reopened {reopenCount > 1 ? `(${reopenCount}x)` : ''}
                                        </span>
                                      )}
                                      <span className="px-1.5 py-0.2 text-[9px] font-extrabold rounded bg-blue-50 text-blue-700 border border-blue-200/80 shrink-0 inline-flex items-center gap-0.5" title={`Total followups taken: ${followupCount}`}>
                                        💬 {followupCount} {followupCount === 1 ? 'Followup' : 'Followups'}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                                      <span className="truncate max-w-[200px]" title={lead.phone || 'No phone'}>📞 {lead.phone || 'No phone'}</span>
                                    </div>
                                  </td>

                                  <td className="py-2.5 px-3">
                                    <div className="flex flex-col gap-1 items-start">
                                      <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-black text-[10px]">
                                        {lead.pipeline_stage || lead.status || 'New'}
                                      </span>
                                      <span className="text-[10px] text-slate-500 font-bold truncate max-w-[110px]">
                                        Rep: {assignedRep}
                                      </span>
                                    </div>
                                  </td>

                                  <td className="py-2.5 px-3">
                                    {lastRemark ? (
                                      <div className="bg-amber-50 border border-amber-200/80 p-2 rounded-xl text-[11px] text-amber-950 font-medium leading-tight max-w-[320px]">
                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                          <span className="font-extrabold text-amber-800 text-[9px] uppercase tracking-wider">Last Remark</span>
                                          {formattedRemarkTime && (
                                            <span className="text-[10px] font-bold text-amber-700/90 flex items-center gap-0.5 bg-amber-100/60 px-1.5 py-0.2 rounded">
                                              <Clock size={9} /> {formattedRemarkTime}
                                            </span>
                                          )}
                                        </div>
                                        <span className="line-clamp-2 italic">{lastRemark}</span>
                                      </div>
                                    ) : (
                                      <span className="text-slate-400 text-[11px] italic">No remarks recorded</span>
                                    )}
                                  </td>

                                  <td className="py-2.5 px-3">
                                    {nextActionFormatted ? (
                                      <div className="text-[11px] font-bold text-slate-800 space-y-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-black text-[10px] w-fit">
                                            {nextActionType}
                                          </span>
                                          <span>{nextActionFormatted}</span>
                                        </div>
                                        {nextActionRemark && (
                                          <div className="bg-indigo-50/90 border border-indigo-200/90 px-2 py-1 rounded-lg text-[10.5px] text-indigo-950 font-semibold leading-tight max-w-[210px] shadow-2xs" title={nextActionRemark}>
                                            <div className="flex items-center gap-1 text-[9px] font-black uppercase text-indigo-700 tracking-wider mb-0.5">
                                              <span>💬 Next Remark</span>
                                            </div>
                                            <span className="italic line-clamp-2">{nextActionRemark}</span>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-slate-400 text-[11px] italic">—</span>
                                    )}
                                  </td>

                                  <td className="py-2.5 px-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => router.push(`/dashboard/crm/${lead.id}`)}
                                        className="px-2.5 py-1 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-slate-700 hover:text-blue-700 rounded-lg text-[11px] font-black shadow-xs flex items-center gap-1 cursor-pointer transition-colors"
                                        title="Open Lead in Full Page View"
                                      >
                                        <ExternalLink size={12} className="text-blue-600" />
                                        <span>Full View</span>
                                      </button>

                                      <button
                                        onClick={() => setHistoryLead(lead)}
                                        className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg text-[11px] font-black hover:bg-slate-100 shadow-xs flex items-center gap-1 cursor-pointer"
                                        title="View History"
                                      >
                                        <History size={12} className="text-blue-600" />
                                        <span>History</span>
                                      </button>

                                      <button
                                        onClick={() => setFollowupLead(lead)}
                                        className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700 shadow-xs flex items-center gap-1 cursor-pointer"
                                        title="Record Followup"
                                      >
                                        <RefreshCw size={12} />
                                        <span>Followup</span>
                                      </button>

                                      <a
                                        href={`https://wa.me/${(lead.phone || '').replace(/\D/g, '')}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                                        title="WhatsApp"
                                      >
                                        <MessageSquare size={13} />
                                      </a>

                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openPhoneDialer(lead.phone);
                                        }}
                                        className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer"
                                        title="Call"
                                      >
                                        <Phone size={13} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* CARD VIEW */
                      paginatedLeads.map((lead: any) => {
                        const assignedRep = allSalesReps.find(r => r.id === lead.assigned_to)?.name || 'Unassigned'

                        let cf: any = lead.custom_fields
                        if (typeof cf === 'string') {
                          try { cf = JSON.parse(cf) } catch (e) {}
                        }

                        const { remark: lastRemark, formattedTime: formattedRemarkTime } = getLeadLatestRemark(lead)
                        const isVisited = hasLeadVisited(lead)
                        const followupCount = getLeadFollowupCount(lead)
                        const reopenCount = getLeadReopenCount(lead)

                        const rawNextDate = lead.next_followup || cf?.next_action_date || lead.booked_time
                        const nextActionType = (cf?.next_action_type || lead.next_action_type || 'Call').trim()
                        const nextActionRemark = getLeadNextActionRemark(lead)

                        let nextActionFormatted = ''
                        if (rawNextDate) {
                          try {
                            const d = new Date(rawNextDate)
                            if (!isNaN(d.getTime())) {
                              nextActionFormatted = d.toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true
                              })
                            }
                          } catch (e) {}
                        }

                        return (
                          <div key={lead.id} className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl flex flex-col justify-between gap-3 hover:bg-blue-50/30 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 
                                    onClick={() => router.push(`/dashboard/crm/${lead.id}`)}
                                    className="font-extrabold text-sm text-slate-900 hover:text-blue-600 cursor-pointer transition-colors"
                                    title="Open Lead Details"
                                  >
                                    {lead.name || 'Unknown Prospect'}
                                  </h4>
                                  <LeadScoreBadge lead={lead} size="sm" showDetails />
                                  {isLeadLastStatusDnp(lead) && (
                                    <span className="px-2 py-0.5 text-[10px] font-black rounded-md bg-rose-100 text-rose-800 border border-rose-300 shrink-0 inline-flex items-center gap-1 shadow-2xs">
                                      <PhoneOff size={10} /> DNP
                                    </span>
                                  )}
                                  {isVisited && (
                                    <span className="px-2 py-0.5 text-[10px] font-black rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0 inline-flex items-center gap-1 shadow-2xs">
                                      <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                                      Visited
                                    </span>
                                  )}
                                  {reopenCount > 0 && (
                                    <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 font-extrabold text-[10px] border border-purple-300 inline-flex items-center gap-1 shadow-2xs" title={`Lead was reopened from Meta Ads (${reopenCount}x)`}>
                                      🔄 Reopened {reopenCount > 1 ? `(${reopenCount}x)` : ''}
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-extrabold text-[10px] border border-blue-200/80 inline-flex items-center gap-1" title={`Total followups taken: ${followupCount}`}>
                                    💬 {followupCount} {followupCount === 1 ? 'Followup' : 'Followups'}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-extrabold text-[10px]">
                                    {lead.pipeline_stage || 'New'}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-bold text-[10px]">
                                    Rep: {assignedRep}
                                  </span>
                                </div>
                                <p className="text-xs font-bold text-slate-600 flex items-center gap-2">
                                  <span>📞 {lead.phone || 'No phone'}</span>
                                  {lead.ad_name && <span className="text-slate-400">• 📢 {lead.ad_name}</span>}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                <button
                                  onClick={() => router.push(`/dashboard/crm/${lead.id}`)}
                                  className="px-3 py-1.5 bg-slate-50 hover:bg-blue-50 border border-slate-300 hover:border-blue-300 text-slate-700 hover:text-blue-700 rounded-xl text-xs font-black shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                                  title="Open Lead in Full Page View"
                                >
                                  <ExternalLink size={13} className="text-blue-600" />
                                  <span>Full View</span>
                                </button>

                                <button
                                  onClick={() => setHistoryLead(lead)}
                                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-black hover:bg-slate-100 shadow-xs flex items-center gap-1 cursor-pointer"
                                >
                                  <History size={13} className="text-blue-600" />
                                  <span>History</span>
                                </button>

                                <button
                                  onClick={() => setFollowupLead(lead)}
                                  className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-xs flex items-center gap-1"
                                >
                                  <RefreshCw size={13} />
                                  <span>Followup</span>
                                </button>

                                <a
                                  href={`https://wa.me/${(lead.phone || '').replace(/\D/g, '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"
                                  title="WhatsApp Chat"
                                >
                                  <MessageSquare size={14} />
                                </a>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openPhoneDialer(lead.phone);
                                  }}
                                  className="p-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors shadow-xs flex items-center justify-center cursor-pointer"
                                  title="Direct Call"
                                >
                                  <Phone size={18} />
                                </button>
                              </div>
                            </div>

                            {(lastRemark || nextActionFormatted) && (
                              <div className="pt-2 border-t border-slate-200/60 space-y-1.5">
                                {lastRemark && (
                                  <div className="bg-amber-50/80 border border-amber-200/80 p-2.5 rounded-xl text-xs text-amber-950 font-medium leading-relaxed">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className="font-extrabold text-amber-800 uppercase text-[10px] tracking-wider">Last Followup Remark:</span>
                                      {formattedRemarkTime && (
                                        <span className="text-[11px] font-bold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded-md flex items-center gap-1">
                                          <Clock size={11} /> {formattedRemarkTime}
                                        </span>
                                      )}
                                    </div>
                                    <span className="whitespace-pre-wrap">{lastRemark}</span>
                                  </div>
                                )}

                                {nextActionFormatted && (
                                  <div className="bg-blue-50/80 border border-blue-200/80 p-2.5 rounded-xl text-xs text-blue-950 font-medium leading-relaxed flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                                    <div>
                                      <span className="font-extrabold text-blue-800 uppercase text-[10px] tracking-wider inline mr-2">🗓️ Next Action ({nextActionType}):</span>
                                      <span className="font-bold text-slate-800">{nextActionFormatted}</span>
                                    </div>
                                    {nextActionRemark && (
                                      <div className="bg-indigo-50/90 border border-indigo-200/90 px-2.5 py-1 rounded-lg text-indigo-950 text-[11px] font-semibold flex items-center gap-1.5 mt-1 sm:mt-0 max-w-full shadow-2xs">
                                        <span className="font-extrabold text-indigo-700 shrink-0">💬 Remark:</span>
                                        <span className="italic truncate">{nextActionRemark}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>

                  {/* Modal Footer with Full Pagination Controls */}
                  <div className="p-3 sm:p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2 text-xs text-slate-600 font-bold">
                      <span>Page <strong className="text-slate-900">{safePage}</strong> of <strong className="text-slate-900">{totalPages}</strong></span>
                      <span className="text-slate-300">|</span>
                      <span>{totalFilteredCount.toLocaleString()} total matching leads</span>
                    </div>

                    {/* Pagination Numbers & Buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap justify-center">
                      <button
                        onClick={() => setDrilldownPage(1)}
                        disabled={safePage === 1}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                        title="First Page"
                      >
                        ⏮ First
                      </button>
                      <button
                        onClick={() => setDrilldownPage(prev => Math.max(1, prev - 1))}
                        disabled={safePage === 1}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                        title="Previous Page"
                      >
                        ◀ Prev
                      </button>

                      {getPageNumbers().map((p, pIdx) => (
                        typeof p === 'number' ? (
                          <button
                            key={pIdx}
                            onClick={() => setDrilldownPage(p)}
                            className={`w-8 h-8 rounded-xl text-xs font-black transition-all cursor-pointer ${
                              safePage === p
                                ? 'bg-blue-600 text-white shadow-sm scale-105'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {p}
                          </button>
                        ) : (
                          <span key={pIdx} className="px-1 text-slate-400 font-black text-xs">...</span>
                        )
                      ))}

                      <button
                        onClick={() => setDrilldownPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={safePage === totalPages}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                        title="Next Page"
                      >
                        Next ▶
                      </button>
                      <button
                        onClick={() => setDrilldownPage(totalPages)}
                        disabled={safePage === totalPages}
                        className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                        title="Last Page"
                      >
                        Last ⏭
                      </button>

                      <button
                        onClick={() => {
                          setDrilldownIsFullScreen(false)
                          setDrilldownModal(prev => ({ ...prev, isOpen: false }))
                        }}
                        className="ml-3 px-4 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-800 cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </>
              )
            })()}

          </div>
        </div>
      )}

      {/* LEAD HISTORY TIMELINE MODAL */}
      <LeadHistoryModal
        isOpen={!!historyLead}
        lead={historyLead}
        onClose={() => setHistoryLead(null)}
        viewerRole={profile?.role}
        teamMembers={allSalesReps}
      />

      {/* UPDATE FOLLOWUP MODAL */}
      <UpdateFollowupModal
        isOpen={!!followupLead}
        lead={followupLead}
        onClose={() => setFollowupLead(null)}
        onSuccess={(updatedFields) => {
          if (followupLead) {
            const updatedId = followupLead.id
            if (updatedFields) {
              const mergedUpdatedLead = { 
                ...followupLead, 
                ...updatedFields, 
                custom_fields: { 
                  ...(typeof followupLead.custom_fields === 'object' ? followupLead.custom_fields : {}), 
                  ...(updatedFields.custom_fields || {}) 
                } 
              }

              // 1. Update master leads list
              setLeads(prev => prev.map((l: any) => l.id === updatedId ? mergedUpdatedLead : l))

              // 2. Dynamically evaluate if the lead still belongs in the open drilldown modal
              setDrilldownModal(prev => {
                // Helper to check if updated lead still satisfies the drilldown bucket
                const shouldLeadStay = (l: any, title: string, subtitle: string): boolean => {
                  const tLower = (title + ' ' + subtitle).toLowerCase()

                  let cf: any = l.custom_fields
                  if (typeof cf === 'string') {
                    try { cf = JSON.parse(cf) } catch (e) {}
                  }

                  const stageLower = (l.pipeline_stage || l.status || '').trim().toLowerCase()
                  const isLostOrWon = ['won', 'closed', 'dealer', 'lost/ni', 'lost', 'plan postponed', 'already purchased', 'different requirement', 'unqualified'].includes(stageLower) ||
                    stageLower.includes('not interested') || stageLower.includes('lost') || stageLower.includes('junk') || stageLower.includes('dealer')

                  // In Action Manager (Today, Pending, Scheduled), Lost or Won leads must not remain
                  if (isLostOrWon && (tLower.includes('today') || tLower.includes('pending') || tLower.includes('schedule') || tLower.includes('action manager'))) {
                    return false
                  }

                  let todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
                  if (profile?.timezone) {
                    try {
                      todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
                    } catch (e) {}
                  }

                  const getLocalDateStr = (dateVal: any): string | null => {
                    if (!dateVal) return null
                    let d: Date | null = null
                    if (typeof dateVal === 'string' && dateVal.includes('-') && dateVal.split('-')[0].length === 2) {
                      const parts = dateVal.split(' ')
                      const dateParts = parts[0].split('-')
                      d = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${parts[1] || '00:00'}:00`)
                    } else {
                      d = new Date(dateVal)
                    }
                    if (!d || isNaN(d.getTime())) return null
                    if (profile?.timezone) {
                      try {
                        return new Intl.DateTimeFormat('en-CA', { timeZone: profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
                      } catch (e) {}
                    }
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                  }

                  const nextActionDateStr = getLocalDateStr(l.next_followup || cf?.next_action_date || l.booked_time)

                  // 1. TODAY ACTIONS: must have next action date strictly equal to today
                  if (tLower.includes('today')) {
                    if (!nextActionDateStr || nextActionDateStr !== todayStr) {
                      return false
                    }
                  }

                  // 2. PENDING ACTIONS: must have overdue next action date in the past
                  if (tLower.includes('pending')) {
                    if (!nextActionDateStr || nextActionDateStr >= todayStr) {
                      return false
                    }
                  }

                  // 3. SCHEDULED ACTIONS: must have future next action date
                  if (tLower.includes('schedule') && (tLower.includes('action') || tLower.includes('scheduled'))) {
                    if (!nextActionDateStr || nextActionDateStr <= todayStr) {
                      return false
                    }
                  }

                  // 4. ACTION TYPE SPECIFICITY (e.g. Today Call vs Today Visit)
                  const rawActType = (cf?.next_action_type || l.next_action_type || '').trim().toLowerCase()
                  let actTypeKey = 'Call'
                  if (rawActType === 'revisit' || rawActType.includes('revisit')) actTypeKey = 'Revisit'
                  else if (rawActType.includes('closing')) actTypeKey = 'Closing Meeting'
                  else if (rawActType.includes('home')) actTypeKey = 'Home Meeting'
                  else if (rawActType === 'visit' || rawActType === 'site visit') actTypeKey = 'Visit'
                  else actTypeKey = 'Call'

                  if (tLower.includes('today call') || tLower.includes('pending call') || tLower.includes('scheduled call')) {
                    if (actTypeKey !== 'Call') return false
                  } else if (tLower.includes('today visit') || tLower.includes('pending visit') || tLower.includes('scheduled visit')) {
                    if (actTypeKey !== 'Visit') return false
                  } else if (tLower.includes('today revisit') || tLower.includes('pending revisit') || tLower.includes('scheduled revisit')) {
                    if (actTypeKey !== 'Revisit') return false
                  } else if (tLower.includes('today closing meeting') || tLower.includes('pending closing meeting') || tLower.includes('scheduled closing meeting')) {
                    if (actTypeKey !== 'Closing Meeting') return false
                  } else if (tLower.includes('today home meeting') || tLower.includes('pending home meeting') || tLower.includes('scheduled home meeting')) {
                    if (actTypeKey !== 'Home Meeting') return false
                  }

                  // 5. STAGE SPECIFIC DRILLDOWNS
                  if (tLower.includes('visit planned') && !tLower.includes('matrix')) {
                    if (l.pipeline_stage !== 'Visit Planned') return false
                  } else if (tLower.includes('visit done')) {
                    if (l.pipeline_stage !== 'Visit Done') return false
                  } else if (tLower.includes('meeting planned')) {
                    if (l.pipeline_stage !== 'Meeting Planned') return false
                  } else if (tLower.includes('meeting done')) {
                    if (l.pipeline_stage !== 'Meeting Done') return false
                  }

                  return true
                }

                const stillBelongs = shouldLeadStay(mergedUpdatedLead, prev.title, prev.subtitle)

                let nextLeads: any[] = []
                if (stillBelongs) {
                  // Lead still satisfies current drilldown: update in place
                  nextLeads = prev.leads.map((l: any) => l.id === updatedId ? mergedUpdatedLead : l)
                  toast.success('Follow-up updated successfully')
                } else {
                  // Lead was rescheduled (e.g. from Today to future date) or moved out: remove immediately!
                  nextLeads = prev.leads.filter((l: any) => l.id !== updatedId)

                  const tLower = (prev.title + ' ' + prev.subtitle).toLowerCase()
                  if (tLower.includes('today')) {
                    toast.success('Follow-up updated: Lead moved from Today Actions to Scheduled Actions')
                  } else if (tLower.includes('pending')) {
                    toast.success('Pending follow-up completed: Lead moved to Scheduled Actions')
                  } else {
                    toast.success('Lead updated and moved out of this view')
                  }
                }

                const newTotalPages = Math.ceil(nextLeads.length / drilldownPageSize) || 1
                setDrilldownPage(prevPage => Math.max(1, Math.min(prevPage, newTotalPages)))

                return {
                  ...prev,
                  leads: nextLeads
                }
              })
            } else {
              fetchAnalytics(false)
            }
          }
          setFollowupLead(null)
        }}
      />

      {/* FULL LAST REMARK MODAL */}
      {fullRemarkModal && (
        <div className="fixed inset-0 z-[999999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={() => setFullRemarkModal(null)}>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-blue-100 text-blue-700 font-bold">📝</span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Last Remark</h3>
                  <p className="text-xs font-semibold text-slate-500">{fullRemarkModal.leadName}</p>
                </div>
              </div>
              <button
                onClick={() => setFullRemarkModal(null)}
                className="p-2 rounded-xl bg-slate-200/60 text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl">
                <p className="text-sm font-medium text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {fullRemarkModal.remark}
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button
                onClick={() => setFullRemarkModal(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all shadow-sm cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
