'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
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
  ArrowLeft
} from 'lucide-react'
import LeadHistoryModal from '@/components/LeadHistoryModal'
import UpdateFollowupModal from '@/components/UpdateFollowupModal'
import LeadScoreBadge from '@/components/LeadScoreBadge'
import { categorizeLeadStage, extractStagesFromProfile, DEFAULT_PIPELINE_STAGES } from '@/utils/pipeline-stages'

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

export default function AnalyticsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
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
      const isTeamUser = myRole === 'agent' || myRole === 'team_member'

      let targetOwnerId = user.id
      if (impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined' && impersonateId !== user.id) {
        targetOwnerId = impersonateId
      } else if (isTeamUser && (userProfile?.parent_id || userProfile?.agency_id)) {
        targetOwnerId = userProfile.parent_id || userProfile.agency_id || user.id
      }

      // Get workspace team IDs
      const { data: teamProfiles } = await supabase.from('profiles')
        .select('id')
        .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`)
      const workspaceTeamIds = Array.from(new Set((teamProfiles || []).map(p => p.id)))
      if (workspaceTeamIds.length === 0) workspaceTeamIds.push(targetOwnerId)

      // Build filter function
      const activeAgentId = (!isTeamUser && selectedAgentId && selectedAgentId !== 'all') ? selectedAgentId : (isTeamUser ? user.id : null)

      let filterFn: (q: any) => any
      if (isTeamUser && activeAgentId) {
        filterFn = (q: any) => q.in('user_id', workspaceTeamIds).or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
      } else if (activeAgentId && activeAgentId !== 'unassigned') {
        filterFn = (q: any) => q.in('user_id', workspaceTeamIds).or(`assigned_to.eq.${activeAgentId},user_id.eq.${activeAgentId}`)
      } else if (activeAgentId === 'unassigned') {
        filterFn = (q: any) => q.is('assigned_to', null).in('user_id', workspaceTeamIds)
      } else {
        filterFn = (q: any) => q.in('user_id', workspaceTeamIds)
      }

      // Parse custom_fields helper
      const parseLeads = (rawLeads: any[]) => rawLeads.map(lead => {
        let cf = lead.custom_fields
        if (cf && typeof cf === 'string') {
          try { while (typeof cf === 'string') cf = JSON.parse(cf) } catch (e) { cf = {} }
        }
        return { ...lead, custom_fields: cf || {} }
      })

      // Step 1: First 1000 leads + count in parallel
      const firstPageQ = filterFn(supabase.from('leads').select(leadFields))
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(0, 999)
      const countQ = filterFn(supabase.from('leads').select('*', { count: 'exact', head: true }))

      const [firstPageRes, countRes] = await Promise.all([firstPageQ, countQ])

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

          const teamData = rawTeam.map(member => {
            const memberLeads = allLeads.filter(l => l.assigned_to === member.id || l.user_id === member.id)
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
              const notesLower = (l.notes || '').toLowerCase()
              const stageLower = (l.pipeline_stage || l.status || '').toLowerCase()
              return cf?.last_call_dnp === true || (cf?.dnp_count > 0) || notesLower.includes('dnp') || stageLower.includes('dnp')
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

  // All sales reps resolved from team profiles AND assigned lead records
  const allSalesReps = useMemo(() => {
    if (team && team.length > 0) {
      const repIdsFromLeads = Array.from(new Set(leads.map(l => l.assigned_to).filter(Boolean)))
      return [
        ...team.map(member => ({
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
    const totalDnp = filteredLeads.reduce((acc, l) => acc + (l.dnp_count || l.custom_fields?.dnp_count || 0), 0)

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
        dnp: repLeads.filter(l => (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0)),
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
      const repLeadsRaw = leads.filter(l => rep.id === 'unassigned' ? (!l.assigned_to && !l.user_id) : (l.assigned_to === rep.id || l.user_id === rep.id))

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
  }, [leads, allSalesReps, isAdminLike, profile?.id, selectedAgentId, searchQuery])

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

    const reps = (team && team.length > 0)
      ? team.map(member => ({
          id: member.id,
          name: member.business_name || member.full_name || member.email || 'Sales Rep',
          email: member.email,
          role: member.role || 'agent'
        }))
      : allSalesReps

    return reps.map(rep => {
      const repLeads = leads.filter(l => l.assigned_to === rep.id || l.user_id === rep.id)
      const repLeadIds = new Set(repLeads.map(l => l.id))

      // Count call attempts from history for this rep's leads
      const repHistory = history.filter(h => h.user_id === rep.id || repLeadIds.has(h.lead_id))
      const totalFollowups = repHistory.filter(isActualCallAction).length

      const closingMeetings = repLeads.filter(l => {
        let cf: any = l.custom_fields;
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf); } catch (e) {}
        }
        const nextAct = (cf?.next_action_type || l.next_action_type || '').toLowerCase();
        const lastAct = (cf?.last_followup_type || l.last_followup_type || '').toLowerCase();
        const st = (l.pipeline_stage || l.status || '').toLowerCase();
        return st.includes('meeting') || st.includes('negotiation') || nextAct.includes('meeting') || nextAct.includes('closing') || nextAct.includes('home') || lastAct.includes('meeting') || lastAct.includes('closing') || lastAct.includes('home');
      }).length

      // Include both Visit Done AND Revisit Done
      const visits = repLeads.filter(l => {
        const st = (l.status || l.pipeline_stage || '').toLowerCase()
        return st === 'visit done' || st === 'revisit done' || st === 'appointment done'
      }).length

      const dnp = repLeads.filter(l => {
        let cf: any = l.custom_fields;
        if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }
        const notesLower = (l.notes || '').toLowerCase()
        const stageLower = (l.pipeline_stage || l.status || '').toLowerCase()
        return cf?.last_call_dnp === true || (cf?.dnp_count > 0) || (l.dnp_count > 0) || notesLower.includes('dnp') || stageLower.includes('dnp')
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
  }, [team, allSalesReps, leads, history])

  const statusBoardRows = useMemo(() => {
    // Always compute from leads for consistency with date filters
    const reps = (team && team.length > 0)
      ? team.map(member => ({
          id: member.id,
          name: member.business_name || member.full_name || member.email || 'Sales Rep',
          email: member.email,
          role: member.role || 'agent'
        }))
      : allSalesReps

    return reps.map(rep => {
      const repLeads = leads.filter(l => l.assigned_to === rep.id || l.user_id === rep.id)

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
  }, [team, allSalesReps, leads])

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
      const camp = l.campaign_name || l.ad_name || l.property?.title || l.property?.name || 'Direct Campaign'
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

  // --- ACTION REPORT COMPUTATIONS (CRM Stages Matrix) ---
  const actionReportData = useMemo(() => {
    const { startCutoff, endCutoff, isDateInRange } = dateCutoffs

    const REPORT_STAGES = [
      { key: 'New Lead', label: 'New Lead', badge: 'bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white' },
      { key: 'Requirement Taken', label: 'Requirement Taken', badge: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white' },
      { key: 'Visit Planned', label: 'Visit Planned', badge: 'bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white' },
      { key: 'Visit Done', label: 'Visit Done', badge: 'bg-purple-50 text-purple-700 hover:bg-purple-600 hover:text-white' },
      { key: 'Revisit Done', label: 'Revisit Done', badge: 'bg-violet-50 text-violet-700 hover:bg-violet-600 hover:text-white' },
      { key: 'Meeting Planned', label: 'Meeting Planned', badge: 'bg-teal-50 text-teal-700 hover:bg-teal-600 hover:text-white' },
      { key: 'Meeting Done', label: 'Meeting Done', badge: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white' },
      { key: 'Negotiation', label: 'Negotiation', badge: 'bg-cyan-50 text-cyan-700 hover:bg-cyan-600 hover:text-white' },
      { key: 'Deal/Token', label: 'Deal/Token', badge: 'bg-green-50 text-green-700 hover:bg-green-600 hover:text-white' },
      { key: 'Never Picked', label: 'Never Picked', badge: 'bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white' },
      { key: 'Lost/NI', label: 'Lost/NI', badge: 'bg-slate-100 text-slate-700 hover:bg-slate-600 hover:text-white' },
      { key: 'Plan Postponed', label: 'Plan Postponed', badge: 'bg-orange-50 text-orange-700 hover:bg-orange-600 hover:text-white' },
      { key: 'Already Purchased', label: 'Already Purchased', badge: 'bg-gray-100 text-gray-700 hover:bg-gray-600 hover:text-white' },
      { key: 'Dealer', label: 'Dealer', badge: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-600 hover:text-white' }
    ]

    const matchStage = (l: any, stageKey: string) => {
      const st = (l.pipeline_stage || l.status || 'New Lead').trim().toLowerCase()
      const target = stageKey.toLowerCase()

      if (target === 'new lead') return st === 'new lead' || st === 'new'
      if (target === 'requirement taken') return st === 'requirement taken' || st === 'contacted'
      if (target === 'visit planned') return st === 'visit planned' || st === 'appointment booked'
      if (target === 'visit done') return st === 'visit done' || st === 'appointment done'
      if (target === 'revisit done') return st === 'revisit done'
      if (target === 'meeting planned') return st === 'meeting planned'
      if (target === 'meeting done') return st === 'meeting done'
      if (target === 'negotiation') return st === 'negotiation'
      if (target === 'deal/token') return st === 'deal/token' || st === 'won' || st === 'closed'
      if (target === 'never picked') return st === 'never picked' || st === 'dnp' || (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0)
      if (target === 'lost/ni') return st === 'lost/ni' || st === 'lost' || st === 'not interested' || st === 'unqualified'
      if (target === 'plan postponed') return st === 'plan postponed'
      if (target === 'already purchased') return st === 'already purchased'
      if (target === 'dealer') return st === 'dealer'
      return st === target
    }

    let rows = allSalesReps.map(rep => {
      const repLeads = leads.filter(l => rep.id === 'unassigned' ? (!l.assigned_to && !l.user_id) : (l.assigned_to === rep.id || l.user_id === rep.id))

      const filteredRepLeads = repLeads.filter(l => {
        if (!startCutoff && !endCutoff) return true
        let cf = l.custom_fields
        if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
        return isDateInRange(cf?.last_followup_at) || isDateInRange(cf?.last_action_date) || isDateInRange(l.last_call_at) || isDateInRange(l.created_at)
      })

      const stageLeads: Record<string, any[]> = {}
      const stageCounts: Record<string, number> = {}

      REPORT_STAGES.forEach(s => {
        const matching = filteredRepLeads.filter(l => matchStage(l, s.key))
        stageLeads[s.key] = matching
        stageCounts[s.key] = matching.length
      })

      return {
        rep,
        stageLeads,
        stageCounts,
        total: filteredRepLeads.length,
        repLeads: filteredRepLeads
      }
    }).sort((a, b) => b.total - a.total)

    if (!isAdminLike && profile?.id) {
      rows = rows.filter(r => r.rep.id === profile.id)
    } else if (selectedAgentId && selectedAgentId !== 'all') {
      rows = rows.filter(r => r.rep.id === selectedAgentId)
    }

    const stageTotals: Record<string, number> = {}
    const stageTotalLeads: Record<string, any[]> = {}
    REPORT_STAGES.forEach(s => {
      stageTotals[s.key] = rows.reduce((sum, r) => sum + (r.stageCounts[s.key] || 0), 0)
      stageTotalLeads[s.key] = rows.flatMap(r => r.stageLeads[s.key] || [])
    })

    const grandTotal = rows.reduce((sum, r) => sum + r.total, 0)
    const grandTotalLeads = rows.flatMap(r => r.repLeads || [])

    // --- Agent Action Attempt Totals from lead_history ---
    const ACTION_TYPES = [
      { key: 'calls', label: 'Call Attempts', icon: '📞', color: 'blue' },
      { key: 'site_visits', label: 'Site Visit Attempts', icon: '🏠', color: 'purple' },
      { key: 'whatsapp', label: 'WhatsApp Followups', icon: '💬', color: 'green' },
      { key: 'meetings', label: 'Meeting Attempts', icon: '🤝', color: 'teal' },
      { key: 'dnp', label: 'DNP (Did Not Pick)', icon: '📵', color: 'rose' },
    ]

    const parseActionDate = (text?: string, fallbackCreatedAt?: string) => {
      if (text) {
        // 1. Bracket notes format: [Followup (Call) - 31/8/2026, 12:10:24 pm] or [Call Not Picked - DNP (31/8/2026...)]
        const bracketMatch = text.match(/\[(?:📝\s*Followup[^\-\]]*|⚠️\s*Call Not Picked[^\-\]]*)\s*-\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})/i)
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

    const classifyAction = (h: any) => {
      const type = (h.action_type || '').toUpperCase()
      const desc = (h.description || '').toLowerCase()
      // Exclude purely automated system imports/webhooks
      if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT', 'ASSIGNMENT'].includes(type)) return null
      if (desc.includes('facebook ad submission') || desc.includes('reopened from facebook') || desc.includes('bulk transferred') || desc.includes('transferred from')) return null

      if (type === 'DNP' || desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) return 'dnp'
      if (type === 'SITE_VISIT' || desc.includes('site visit') || desc.includes('visit done') || desc.includes('revisit') || desc.includes('visit planned') || desc.includes('moved to visit')) return 'site_visits'
      if (type === 'MEETING' || desc.includes('meeting') || desc.includes('moved to meeting')) return 'meetings'
      if (type === 'WHATSAPP' || desc.includes('whatsapp') || desc.includes('message sent')) return 'whatsapp'
      
      // Every manual note, stage update, followup or call counts as a call/followup attempt
      return 'calls'
    }

    // Build lead lookup for drilldown
    const leadLookup: Record<string, any> = {}
    leads.forEach(l => { leadLookup[l.id] = l })

    const repActionCounts: Record<string, Record<string, number>> = {}
    const repActionLeadIds: Record<string, Record<string, Set<string>>> = {}
    const seenActionKeys = new Set<string>()

    allSalesReps.forEach(r => {
      repActionCounts[r.id] = { calls: 0, site_visits: 0, whatsapp: 0, meetings: 0, dnp: 0 }
      repActionLeadIds[r.id] = { calls: new Set(), site_visits: new Set(), whatsapp: new Set(), meetings: new Set(), dnp: new Set() }
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

    // 2. Process Lead Notes Blocks (to guarantee zero missed followups)
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

          const lowerChunk = chunk.toLowerCase()
          let cat = 'calls'
          if (lowerChunk.includes('dnp') || lowerChunk.includes('not picked') || lowerChunk.includes('did not pick')) cat = 'dnp'
          else if (lowerChunk.includes('site visit') || lowerChunk.includes('visit done') || lowerChunk.includes('revisit')) cat = 'site_visits'
          else if (lowerChunk.includes('meeting')) cat = 'meetings'
          else if (lowerChunk.includes('whatsapp')) cat = 'whatsapp'

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
          const fType = (f.type || f.stage || '').toLowerCase()
          if (fType.includes('dnp') || fType.includes('not picked')) cat = 'dnp'
          else if (fType.includes('visit')) cat = 'site_visits'
          else if (fType.includes('meeting')) cat = 'meetings'
          else if (fType.includes('whatsapp')) cat = 'whatsapp'

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
    })

    const actionAttemptRows = rows.map(row => {
      const actionCounts = repActionCounts[row.rep.id] || { calls: 0, site_visits: 0, whatsapp: 0, meetings: 0, dnp: 0 }
      const totalAttempts = Object.values(actionCounts).reduce((s, v) => s + v, 0)

      const actionLeads: Record<string, any[]> = {}
      ACTION_TYPES.forEach(a => {
        const leadIdSet = repActionLeadIds[row.rep.id]?.[a.key] || new Set()
        actionLeads[a.key] = Array.from(leadIdSet).map(id => leadLookup[id]).filter(Boolean)
      })

      return {
        rep: row.rep,
        actionCounts,
        actionLeads,
        totalAttempts,
        repLeads: row.repLeads
      }
    }).sort((a, b) => b.totalAttempts - a.totalAttempts)

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

    return {
      stages: REPORT_STAGES,
      rows,
      stageTotals,
      stageTotalLeads,
      grandTotal,
      grandTotalLeads,
      // Action attempt data
      actionTypes: ACTION_TYPES,
      actionAttemptRows,
      actionTotals,
      actionTotalLeads,
      grandTotalAttempts
    }
  }, [leads, allSalesReps, duration, customDate, startDate, endDate, isAdminLike, profile?.id, profile?.timezone, selectedAgentId, history])

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
    setDrilldownStageFilter('all')
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
                    👤 {rep.name} ({leads.filter(l => l.assigned_to === rep.id || l.user_id === rep.id).length} leads)
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
                  onClick={() => openLeadsDrilldown('DNP / Didn\'t Pick', `Leads with DNP count > 0`, filteredLeads.filter(l => (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0)))}
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

              {/* Summary KPI Cards for CRM Stages */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('All Workspace Leads', `All ${actionReportData.grandTotal} leads across workspace`, actionReportData.grandTotalLeads)}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-blue-600 transition-colors">Total Leads</p>
                  <p className="text-xl font-black text-slate-900 mt-2">{actionReportData.grandTotal}</p>
                </button>

                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('Visit Planned Leads', `All ${actionReportData.stageTotals['Visit Planned'] || 0} Visit Planned leads`, actionReportData.stageTotalLeads['Visit Planned'] || [])}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-amber-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-amber-600 transition-colors">Visit Planned</p>
                  <p className="text-xl font-black text-amber-600 mt-2">{actionReportData.stageTotals['Visit Planned'] || 0}</p>
                </button>

                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('Visit Done Leads', `All ${actionReportData.stageTotals['Visit Done'] || 0} Visit Done leads`, actionReportData.stageTotalLeads['Visit Done'] || [])}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-purple-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-purple-600 transition-colors">Visit Done</p>
                  <p className="text-xl font-black text-purple-600 mt-2">{actionReportData.stageTotals['Visit Done'] || 0}</p>
                </button>

                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('Revisit Done Leads', `All ${actionReportData.stageTotals['Revisit Done'] || 0} Revisit Done leads`, actionReportData.stageTotalLeads['Revisit Done'] || [])}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-violet-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-violet-600 transition-colors">Revisit Done</p>
                  <p className="text-xl font-black text-violet-600 mt-2">{actionReportData.stageTotals['Revisit Done'] || 0}</p>
                </button>

                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('Meeting Planned Leads', `All ${actionReportData.stageTotals['Meeting Planned'] || 0} Meeting Planned leads`, actionReportData.stageTotalLeads['Meeting Planned'] || [])}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-teal-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-teal-600 transition-colors">Meeting Planned</p>
                  <p className="text-xl font-black text-teal-600 mt-2">{actionReportData.stageTotals['Meeting Planned'] || 0}</p>
                </button>

                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('Meeting Done Leads', `All ${actionReportData.stageTotals['Meeting Done'] || 0} Meeting Done leads`, actionReportData.stageTotalLeads['Meeting Done'] || [])}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-emerald-600 transition-colors">Meeting Done</p>
                  <p className="text-xl font-black text-emerald-600 mt-2">{actionReportData.stageTotals['Meeting Done'] || 0}</p>
                </button>

                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('Negotiation & Deal Leads', `All ${(actionReportData.stageTotals['Negotiation'] || 0) + (actionReportData.stageTotals['Deal/Token'] || 0)} Negotiation & Deal leads`, [...(actionReportData.stageTotalLeads['Negotiation'] || []), ...(actionReportData.stageTotalLeads['Deal/Token'] || [])])}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-green-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-green-600 transition-colors">Negotiation / Deal</p>
                  <p className="text-xl font-black text-green-600 mt-2">{(actionReportData.stageTotals['Negotiation'] || 0) + (actionReportData.stageTotals['Deal/Token'] || 0)}</p>
                </button>

                <button
                  type="button"
                  onClick={() => openLeadsDrilldown('Never Picked (DNP)', `All ${actionReportData.stageTotals['Never Picked'] || 0} Never Picked leads`, actionReportData.stageTotalLeads['Never Picked'] || [])}
                  className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-rose-500 hover:shadow-md transition-all flex flex-col justify-between text-left cursor-pointer group"
                >
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider group-hover:text-rose-600 transition-colors">Never Picked (DNP)</p>
                  <p className="text-xl font-black text-rose-600 mt-2">{actionReportData.stageTotals['Never Picked'] || 0}</p>
                </button>
              </div>

              {/* Table: Agent CRM Stages Matrix */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-black text-slate-900">Agent CRM Pipeline Stage Breakdown</h3>
                    <p className="text-xs text-slate-500">Live breakdown of leads across all CRM stages per sales rep (click numbers to view leads list)</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-3.5 px-5 sticky left-0 bg-slate-50 z-10 shadow-xs">Sales Rep</th>
                        {actionReportData.stages.map(s => (
                          <th key={s.key} className="py-3.5 px-3 text-center">{s.label}</th>
                        ))}
                        <th className="py-3.5 px-5 text-center font-black text-slate-900 bg-slate-100">Total Leads</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {actionReportData.rows.map(row => (
                        <tr key={row.rep.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-5 sticky left-0 bg-white z-10 shadow-xs">
                            <div className="font-extrabold text-slate-900">{row.rep.name}</div>
                            <div className="text-[10px] text-slate-400">{row.rep.email || row.rep.role}</div>
                          </td>
                          {actionReportData.stages.map(s => {
                            const count = row.stageCounts[s.key] || 0
                            return (
                              <td key={s.key} className="py-3.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => count > 0 && openLeadsDrilldown(`${row.rep.name} - ${s.label}`, `Total ${count} leads in ${s.label}`, row.stageLeads[s.key] || [])}
                                  className={`px-2.5 py-1 rounded-xl font-black text-xs transition-all ${count > 0 ? `${s.badge} cursor-pointer hover:shadow-xs` : 'bg-slate-50 text-slate-300 cursor-default'}`}
                                >
                                  {count}
                                </button>
                              </td>
                            )
                          })}
                          <td className="py-3.5 px-5 text-center bg-slate-50/60">
                            <button
                              type="button"
                              onClick={() => row.total > 0 && openLeadsDrilldown(`${row.rep.name} - All Assigned Leads`, `Total leads: ${row.total}`, row.repLeads)}
                              className={`px-3 py-1.5 rounded-xl font-black text-xs transition-all ${row.total > 0 ? 'bg-slate-900 text-white hover:bg-blue-600 cursor-pointer hover:shadow-xs' : 'bg-slate-50 text-slate-300 cursor-default'}`}
                            >
                              {row.total}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100/90 border-t-2 border-slate-300 text-xs font-black text-slate-900">
                        <td className="py-3.5 px-5 uppercase tracking-wider sticky left-0 bg-slate-100 z-10 shadow-xs">TOTAL</td>
                        {actionReportData.stages.map(s => {
                          const total = actionReportData.stageTotals[s.key] || 0
                          return (
                            <td 
                              key={s.key}
                              onClick={() => total > 0 && openLeadsDrilldown(`All Sales Reps - ${s.label}`, `Total ${total} leads in ${s.label}`, actionReportData.stageTotalLeads[s.key] || [])}
                              className="py-3.5 px-3 text-center cursor-pointer hover:bg-slate-200 transition-colors"
                            >
                              {total}
                            </td>
                          )
                        })}
                        <td 
                          onClick={() => actionReportData.grandTotal > 0 && openLeadsDrilldown('All Workspace Leads', `Total ${actionReportData.grandTotal} leads across all reps`, actionReportData.grandTotalLeads)}
                          className="py-3.5 px-5 text-center font-black text-sm bg-slate-200/80 cursor-pointer hover:bg-slate-300 transition-colors"
                        >
                          {actionReportData.grandTotal}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Agent Action Attempts Matrix */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-black text-slate-900">Agent Action Attempts</h3>
                    <p className="text-xs text-slate-500">Total action attempts by each sales rep (calls, visits, meetings, WhatsApp, DNP) — click numbers to view leads list</p>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-200">
                    {actionReportData.grandTotalAttempts} Total Attempts
                  </span>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                  {actionReportData.actionTypes.map(at => {
                    const total = actionReportData.actionTotals[at.key] || 0
                    const colorMap: Record<string, string> = {
                      blue: 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-600 hover:text-white',
                      purple: 'text-purple-700 bg-purple-50 border-purple-200 hover:bg-purple-600 hover:text-white',
                      green: 'text-green-700 bg-green-50 border-green-200 hover:bg-green-600 hover:text-white',
                      teal: 'text-teal-700 bg-teal-50 border-teal-200 hover:bg-teal-600 hover:text-white',
                      rose: 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-600 hover:text-white',
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
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap">
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
                          </td>
                          {actionReportData.actionTypes.map(at => {
                            const count = row.actionCounts[at.key] || 0
                            const actionColorMap: Record<string, string> = {
                              blue: 'bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white',
                              purple: 'bg-purple-50 text-purple-700 hover:bg-purple-600 hover:text-white',
                              green: 'bg-green-50 text-green-700 hover:bg-green-600 hover:text-white',
                              teal: 'bg-teal-50 text-teal-700 hover:bg-teal-600 hover:text-white',
                              rose: 'bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white',
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
                              onClick={() => row.totalAttempts > 0 && openLeadsDrilldown(`${row.rep.name} - All Action Attempts`, `Total ${row.totalAttempts} action attempts`, row.repLeads)}
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
                              className="py-3.5 px-3 text-center cursor-pointer hover:bg-slate-200 transition-colors"
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

            {/* Modal Search Bar, Stage Filter Pills & View Mode Toggle */}
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
                    className="w-full bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 rounded-xl pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end flex-wrap">
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
                if (drilldownStageFilter !== 'all') {
                  const st = (l.pipeline_stage || l.status || 'New Lead').toLowerCase()
                  if (st !== drilldownStageFilter.toLowerCase()) return false
                }
                if (!drilldownModal.searchFilter.trim()) return true
                const q = drilldownModal.searchFilter.toLowerCase().trim()
                return (
                  (l.name || '').toLowerCase().includes(q) ||
                  (l.phone || '').includes(q) ||
                  (l.pipeline_stage || '').toLowerCase().includes(q) ||
                  (l.status || '').toLowerCase().includes(q)
                )
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
                        <p className="text-xs font-extrabold">No active leads found for this view.</p>
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

                              // Robust Remark and Timestamp extraction
                              let rawRemark = (cf?.last_followup_remark || cf?.last_remark || lead.last_followup_remark || lead.last_call_remark || '').trim()
                              if (!rawRemark && lead.notes && typeof lead.notes === 'string' && lead.notes.trim()) {
                                let cleaned = lead.notes.trim()
                                if (cleaned.includes('[Last Remarks]:')) {
                                  rawRemark = cleaned.split('[Last Remarks]:')[1]?.split(/\[Followups Taken\]:|\[Next Action\]:|\[Opening Remarks\]:/i)[0]?.trim() || cleaned
                                } else {
                                  const entries = cleaned.split(/\n\n+|---+|\n(?=\[\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/)
                                  for (let i = entries.length - 1; i >= 0; i--) {
                                    const entry = entries[i].trim()
                                    if (entry && !entry.toLowerCase().startsWith('[opening remarks]') && !entry.toLowerCase().startsWith('advertisment') && !entry.toLowerCase().startsWith('[followups taken]')) {
                                      rawRemark = entry.includes(']:') ? entry.split(']:').slice(1).join(']:').trim() : entry
                                      break
                                    }
                                  }
                                }
                              }
                              if (!rawRemark && lead.summary) rawRemark = lead.summary.trim()

                              let lastRemarkTime: string | null = null
                              let cleanRemark = rawRemark

                              if (cf?.last_followup_at) lastRemarkTime = cf.last_followup_at
                              else if (cf?.last_action_date) lastRemarkTime = cf.last_action_date
                              else if (lead.last_call_at) lastRemarkTime = lead.last_call_at

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
                                  if (!isNaN(parsed.getTime())) {
                                    if (!lastRemarkTime) lastRemarkTime = parsed.toISOString()
                                    cleanRemark = rawRemark.replace(/(?:Call on\s+|Logged on\s+|\[)?\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}(?:[,\s]+\d{1,2}:\d{2}(?::\d{2})?\s*[ap]m)?\]?\s*[:-]?\s*/gi, '').trim()
                                  }
                                }
                              }

                              if (!lastRemarkTime && lead.updated_at && cleanRemark) lastRemarkTime = lead.updated_at
                              if (!lastRemarkTime && lead.created_at && cleanRemark) lastRemarkTime = lead.created_at

                              let formattedRemarkTime = ''
                              if (lastRemarkTime) {
                                try {
                                  const rd = new Date(lastRemarkTime)
                                  if (!isNaN(rd.getTime())) {
                                    formattedRemarkTime = rd.toLocaleString('en-IN', {
                                      day: '2-digit',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: true
                                    })
                                  }
                                } catch (e) {}
                              }
                              const lastRemark = cleanRemark

                              const rawNextDate = lead.next_followup || cf?.next_action_date || lead.booked_time
                              const nextActionType = (cf?.next_action_type || lead.next_action_type || 'Call').trim()

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

                              const stageLower = (lead.pipeline_stage || lead.status || '').toLowerCase()
                              const isVisited = cf?.has_visited === true || cf?.visited === true || (!stageLower.includes('planned') && !stageLower.includes('scheduled') && (stageLower.includes('visit done') || stageLower === 'visited' || stageLower.includes('revisit done') || stageLower.includes('appointment done') || stageLower.includes('site visit done')))

                              return (
                                <tr key={lead.id} className="hover:bg-blue-50/40 transition-colors group">
                                  <td className="py-2.5 px-3">
                                    <div 
                                      onClick={() => router.push(`/dashboard/crm/${lead.id}`)}
                                      className="font-extrabold text-slate-900 text-xs hover:text-blue-600 cursor-pointer transition-colors flex items-center gap-1.5 flex-wrap"
                                      title="Open Lead Details"
                                    >
                                      <span>{lead.name || 'Unknown Prospect'}</span>
                                      {isVisited && (
                                        <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0 inline-flex items-center gap-0.5">
                                          <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                                          Visited
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                                      <span>📞 {lead.phone || 'No phone'}</span>
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
                                      <div className="text-[11px] font-bold text-slate-800">
                                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-black text-[10px] block mb-0.5 w-fit">
                                          {nextActionType}
                                        </span>
                                        <span>{nextActionFormatted}</span>
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

                                      <a
                                        href={`tel:${lead.phone}`}
                                        className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                                        title="Call"
                                      >
                                        <Phone size={13} />
                                      </a>
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

                        let cleanRemark = ''
                        let lastRemarkTime: string | null = null

                        if (lead.notes && typeof lead.notes === 'string' && lead.notes.trim()) {
                          const topEntry = lead.notes.trim().split(/\n\n+/)[0]?.trim()
                          if (topEntry) {
                            if (topEntry.startsWith('[') && topEntry.includes(']:')) {
                              const headerEndIdx = topEntry.indexOf(']:')
                              const header = topEntry.slice(1, headerEndIdx)
                              const body = topEntry.slice(headerEndIdx + 2).trim()

                              const timeMatch = header.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?)?/i)
                              if (timeMatch) {
                                const [_, d, m, y, h, min, ampm] = timeMatch
                                let hour = h ? parseInt(h, 10) : 0
                                if (ampm) {
                                  if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12
                                  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0
                                }
                                const parsed = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), hour, min ? parseInt(min, 10) : 0)
                                if (!isNaN(parsed.getTime())) {
                                  lastRemarkTime = parsed.toISOString()
                                }
                              }

                              let formattedBody = body
                              if (formattedBody.startsWith('Stage:')) {
                                const dotIdx = formattedBody.indexOf('.')
                                if (dotIdx !== -1) formattedBody = formattedBody.slice(dotIdx + 1).trim()
                              }
                              if (formattedBody.startsWith('Status:')) {
                                const dotIdx = formattedBody.indexOf('.')
                                if (dotIdx !== -1) formattedBody = formattedBody.slice(dotIdx + 1).trim()
                              }
                              if (formattedBody.includes('Remarks:')) {
                                const remIdx = formattedBody.indexOf('Remarks:')
                                formattedBody = formattedBody.slice(remIdx + 8).trim()
                              }

                              cleanRemark = formattedBody || body
                            } else {
                              cleanRemark = topEntry
                            }
                          }
                        }

                        if (!cleanRemark) {
                          cleanRemark = (cf?.last_followup_remark || cf?.last_remark || lead.last_followup_remark || lead.last_call_remark || lead.summary || '').trim()
                          if (cf?.last_followup_at) lastRemarkTime = cf.last_followup_at
                        }

                        if (!lastRemarkTime && cf?.last_followup_at) lastRemarkTime = cf.last_followup_at
                        if (!lastRemarkTime && cf?.last_action_date) lastRemarkTime = cf.last_action_date
                        if (!lastRemarkTime && lead.last_call_at) lastRemarkTime = lead.last_call_at
                        if (!lastRemarkTime && lead.updated_at && cleanRemark) lastRemarkTime = lead.updated_at
                        if (!lastRemarkTime && lead.created_at && cleanRemark) lastRemarkTime = lead.created_at

                        let formattedRemarkTime = ''
                        if (lastRemarkTime) {
                          try {
                            const rd = new Date(lastRemarkTime)
                            if (!isNaN(rd.getTime())) {
                              formattedRemarkTime = rd.toLocaleString('en-IN', {
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
                        const lastRemark = cleanRemark

                        const rawNextDate = lead.next_followup || cf?.next_action_date || lead.booked_time
                        const nextActionType = (cf?.next_action_type || lead.next_action_type || 'Call').trim()
                        const nextActionRemark = (cf?.next_action_remark || cf?.next_remarks || '').trim()

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

                                <a
                                  href={`tel:${lead.phone}`}
                                  className="p-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors shadow-xs flex items-center justify-center"
                                  title="Direct Call"
                                >
                                  <Phone size={18} />
                                </a>
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
                                  <div className="bg-blue-50/80 border border-blue-200/80 p-2.5 rounded-xl text-xs text-blue-950 font-medium leading-relaxed flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                    <div>
                                      <span className="font-extrabold text-blue-800 uppercase text-[10px] tracking-wider inline mr-2">🗓️ Next Action ({nextActionType}):</span>
                                      <span className="font-bold text-slate-800">{nextActionFormatted}</span>
                                    </div>
                                    {nextActionRemark && (
                                      <span className="text-slate-600 text-[11px] font-semibold italic">Note: {nextActionRemark}</span>
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
      />

      {/* UPDATE FOLLOWUP MODAL */}
      <UpdateFollowupModal
        isOpen={!!followupLead}
        lead={followupLead}
        onClose={() => setFollowupLead(null)}
        onSuccess={() => {
          if (followupLead) {
            const updatedId = followupLead.id
            setDrilldownModal(prev => ({
              ...prev,
              leads: prev.leads.filter((l: any) => l.id !== updatedId)
            }))
          }
          setFollowupLead(null)
          fetchAnalytics(true)
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
