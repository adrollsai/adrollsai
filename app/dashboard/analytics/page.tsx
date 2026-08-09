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
  Flame
} from 'lucide-react'
import LeadHistoryModal from '@/components/LeadHistoryModal'
import UpdateFollowupModal from '@/components/UpdateFollowupModal'

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

export default function AnalyticsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const impersonateId = searchParams.get('impersonate')

  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [duration, setDuration] = useState<'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'all'>('30d')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Table Sorting State
  const [sortField, setSortField] = useState<string>('total')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Sub-Tab Navigation
  const [activeTab, setActiveTab] = useState<'analytics' | 'action_mgr' | 'lead_mgr' | 'dnp_mgr' | 'team_mgr' | 'leaderboard'>('analytics')
  const [actionStatusFilter, setActionStatusFilter] = useState<'pending' | 'schedule' | 'today'>('today')

  // Data State
  const [leads, setLeads] = useState<any[]>([])
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

  // Fetch Analytics & User Info
  const fetchAnalytics = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }

      const activeUserId = impersonateId || session.user.id
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', activeUserId)
        .single()

      if (userProfile) {
        setProfile(userProfile)
      }

      const queryParams = new URLSearchParams()
      queryParams.set('duration', duration)
      if (selectedAgentId) queryParams.set('agentId', selectedAgentId)
      if (impersonateId) queryParams.set('impersonate', impersonateId)

      const res = await fetch(`/api/analytics?${queryParams.toString()}`)
      const data = await res.json()

      if (data.success || data.leads) {
        setLeads(data.leads || [])
        setChats(data.chats || [])
        setMessages(data.messages || [])
        setTeam(data.team || [])
      } else {
        toast.error('Failed to sync metrics', { description: data.error || 'Server error' })
      }
    } catch (e: any) {
      console.error(e)
      toast.error('Connection timed out: ' + (e.message || String(e)))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [duration, selectedAgentId])

  // All sales reps resolved from team profiles AND assigned lead records
  const allSalesReps = useMemo(() => {
    const isTeamUser = !!(profile?.parent_id || profile?.agency_id || profile?.role === 'team_member' || profile?.role === 'agent');
    if (isTeamUser && profile?.id) {
      return [{
        id: profile.id,
        name: profile.business_name || profile.full_name || profile.email || 'You',
        email: profile.email,
        role: profile.role || 'agent'
      }]
    }

    const repIdsFromLeads = Array.from(new Set(leads.map(l => l.assigned_to).filter(Boolean)))

    const list = [
      ...team.map(member => ({
        id: member.id,
        name: member.business_name || member.full_name || member.email || 'Sales Rep',
        email: member.email,
        role: member.role || 'agent'
      })),
      ...repIdsFromLeads
        .filter(id => !team.some(t => t.id === id))
        .map(id => ({ id, name: `Agent (${id.slice(0, 6)})`, email: '', role: 'agent' }))
    ]

    return list
  }, [leads, team, profile])

  // Filter leads based on selectedAgentId for dashboard cards
  const filteredLeads = useMemo(() => {
    if (!selectedAgentId) return leads
    if (selectedAgentId === 'unassigned') return leads.filter(l => !l.assigned_to)
    return leads.filter(l => l.assigned_to === selectedAgentId)
  }, [leads, selectedAgentId])

  // --- STATS PRE-COMPUTATIONS ---
  const stats = useMemo(() => {
    const totalLeads = filteredLeads.length
    const wonLeads = filteredLeads.filter(l => l.pipeline_stage === 'Won' || l.pipeline_stage === 'Closed').length
    const lostLeads = filteredLeads.filter(l => l.pipeline_stage === 'Lost' || l.pipeline_stage === 'Unqualified').length
    const inProgress = totalLeads - wonLeads - lostLeads
    const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0'

    const totalCalls = filteredLeads.filter(l => l.last_call_at || l.last_call_status).length
    const totalDnp = filteredLeads.reduce((acc, l) => acc + (l.dnp_count || l.custom_fields?.dnp_count || 0), 0)

    const reopenedLeadsList = filteredLeads.filter(l => l.reopened_count > 0 || l.custom_fields?.reopened_count > 0)
    const unassignedLeadsList = filteredLeads.filter(l => !l.assigned_to)
    const followUpLeadsList = filteredLeads.filter(l => l.next_action_date || l.custom_fields?.next_action_date)
    const freshLeadsList = filteredLeads.filter(l => (l.pipeline_stage || 'New') === 'New')
    const recentLeadsList = filteredLeads.filter(l => {
      const d = new Date(l.created_at)
      return (Date.now() - d.getTime()) <= 86400000
    })

    // Duplicate phone check
    const phoneMap: Record<string, any[]> = {}
    filteredLeads.forEach(l => {
      const p = l.phone ? l.phone.replace(/\D/g, '').slice(-10) : ''
      if (p) {
        if (!phoneMap[p]) phoneMap[p] = []
        phoneMap[p].push(l)
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
      recentLeadsList
    }
  }, [filteredLeads])

  // --- EMPLOYEE-WISE LEAD MANAGER MATRIX (WorkVeu Screenshot 2) ---
  const leadManagerMatrix = useMemo(() => {
    const salesReps = [
      ...allSalesReps,
      { id: 'unassigned', name: 'Unassigned', email: '', role: 'system' }
    ]

    const stagesList = [
      { key: 'new', label: 'New Lead' },
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
      const repLeads = leads.filter(l => rep.id === 'unassigned' ? !l.assigned_to : l.assigned_to === rep.id)
      
      const categoryLeads: Record<string, any[]> = {
        new: repLeads.filter(l => l.pipeline_stage === 'New Lead' || l.pipeline_stage === 'New' || l.status === 'New Lead' || l.status === 'New'),
        contacted: repLeads.filter(l => l.pipeline_stage === 'Contacted' || l.pipeline_stage === 'Requirement Taken' || l.status === 'Contacted'),
        appointment: repLeads.filter(l => l.pipeline_stage === 'Appointment Booked' || l.pipeline_stage === 'Appointment booked'),
        booked: repLeads.filter(l => l.pipeline_stage === 'Visit Planned' || l.status === 'Visit Planned'),
        done: repLeads.filter(l => l.pipeline_stage === 'Visit Done' || l.pipeline_stage === 'Appointment done' || l.status === 'Visit Done'),
        revisit: repLeads.filter(l => l.pipeline_stage === 'Revisit Done' || l.custom_fields?.revisit === true),
        qualified: repLeads.filter(l => l.pipeline_stage === 'Negotiation' || l.pipeline_stage === 'Deal/Token'),
        unqualified: repLeads.filter(l => l.pipeline_stage === 'Lost/NI' || l.pipeline_stage === 'Closed'),
        meeting_planned: repLeads.filter(l => l.status === 'Meeting Planned' || l.pipeline_stage === 'Meeting Planned'),
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
  }, [leads, allSalesReps, searchQuery, sortField, sortOrder])

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

    let rows = salesReps.map(rep => {
      const repLeads = leads.filter(l => rep.id === 'unassigned' ? (!l.assigned_to && !l.user_id) : (l.assigned_to === rep.id || l.user_id === rep.id))
      
      const targetLeads = repLeads.filter(l => {
        let cf: any = l.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) {}
        }

        const lastFollowupDateStr = getLocalDateStr(cf?.last_followup_at || l.last_call_at)
        const nextActionDateStr = getLocalDateStr(l.next_followup || cf?.next_action_date || l.booked_time)

        if (actionStatusFilter === 'today') {
          return nextActionDateStr === todayStr
        } else if (actionStatusFilter === 'schedule') {
          return !!nextActionDateStr && nextActionDateStr > todayStr
        } else if (actionStatusFilter === 'pending') {
          // Show in Pending ONLY if a scheduled followup date in the past was missed AND followup remark was NOT updated on or after that date
          if (!nextActionDateStr || nextActionDateStr >= todayStr) return false
          if (['Closed', 'Lost/NI', 'Deal/Token'].includes(l.status || l.pipeline_stage)) return false
          if (lastFollowupDateStr && lastFollowupDateStr >= nextActionDateStr) return false
          return true
        }
        return true
      })

      const typeLeads: Record<string, any[]> = {
        'Call': [],
        'Visit': [],
        'Revisit': [],
        'Closing Meeting': [],
        'Home Meeting': []
      }

      targetLeads.forEach(l => {
        let cf: any = l.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) {}
        }
        const actType = (cf?.next_action_type || l.next_action_type || cf?.last_followup_type || l.last_followup_type || 'Call').trim()
        if (actType.toLowerCase().includes('revisit')) typeLeads['Revisit'].push(l)
        else if (actType.toLowerCase().includes('closing')) typeLeads['Closing Meeting'].push(l)
        else if (actType.toLowerCase().includes('home')) typeLeads['Home Meeting'].push(l)
        else if (actType.toLowerCase().includes('visit')) typeLeads['Visit'].push(l)
        else typeLeads['Call'].push(l)
      })

      const counts: Record<string, number> = {
        'Call': typeLeads['Call'].length,
        'Visit': typeLeads['Visit'].length,
        'Revisit': typeLeads['Revisit'].length,
        'Closing Meeting': typeLeads['Closing Meeting'].length,
        'Home Meeting': typeLeads['Home Meeting'].length,
        'total': targetLeads.length
      }

      return { rep, counts, typeLeads, targetLeads }
    }).filter(r => r.rep.id !== 'unassigned' || r.counts.total > 0)

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

    const totals: Record<string, number> = { total: 0 }
    actionTypes.forEach(t => totals[t.key] = 0)
    rows.forEach(r => {
      totals.total += r.counts.total
      actionTypes.forEach(t => {
        totals[t.key] += r.counts[t.key] || 0
      })
    })

    return { rows, totals, actionTypes }
  }, [leads, allSalesReps, actionStatusFilter, isAdminLike, profile?.id, selectedAgentId, searchQuery])

  // --- LEADERBOARD COMPUTATIONS (WorkVeu Screenshot 3) ---
  const followupBoardRows = useMemo(() => {
    return allSalesReps.map(rep => {
      const repLeads = leads.filter(l => l.assigned_to === rep.id)
      const totalFollowups = repLeads.filter(l => l.last_followup_at || l.last_call_at || l.notes).length
      const closingMeetings = repLeads.filter(l => l.status === 'Negotiation' || l.pipeline_stage === 'Qualified').length
      const visits = repLeads.filter(l => l.status === 'Visit Done' || l.status === 'Revisit Done' || l.pipeline_stage === 'Appointment done').length
      const dnp = repLeads.filter(l => (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0)).length
      const won = repLeads.filter(l => l.status === 'Deal/Token' || l.pipeline_stage === 'Closed' || l.pipeline_stage === 'Won').length
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
  }, [allSalesReps, leads])

  const statusBoardRows = useMemo(() => {
    return allSalesReps.map(rep => {
      const repLeads = leads.filter(l => l.assigned_to === rep.id)
      const reqTaken = repLeads.filter(l => l.status === 'Requirement Taken' || l.pipeline_stage === 'Contacted').length
      const visitPlanned = repLeads.filter(l => l.status === 'Visit Planned' || l.pipeline_stage === 'Appointment booked').length
      const visitDone = repLeads.filter(l => l.status === 'Visit Done' || l.pipeline_stage === 'Appointment done').length
      const revisitDone = repLeads.filter(l => l.status === 'Revisit Done').length
      const negotiation = repLeads.filter(l => l.status === 'Negotiation' || l.pipeline_stage === 'Qualified').length
      const dealToken = repLeads.filter(l => l.status === 'Deal/Token' || l.pipeline_stage === 'Closed' || l.pipeline_stage === 'Won').length

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
  }, [allSalesReps, leads])

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

  // Open interactive drilldown drawer for leads
  const openLeadsDrilldown = (title: string, subtitle: string, leadList: any[]) => {
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
          
          {/* Employee Filter Select */}
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

          {/* Duration Selector */}
          <div className="bg-slate-100 border border-slate-200 p-1 rounded-2xl flex items-center shadow-inner overflow-x-auto">
            {(['today', '7d', '30d', 'this_month', 'last_month', 'all'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={`px-3 py-1.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${duration === d ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {d === 'today' ? 'Today' : d === '7d' ? '7 Days' : d === '30d' ? '30 Days' : d === 'this_month' ? 'This Month' : d === 'last_month' ? 'Last Month' : 'All Time'}
              </button>
            ))}
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
            onClick={() => setActiveTab('dnp_mgr')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeTab === 'dnp_mgr' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <PhoneOff size={16} />
            <span>DNP Mgr</span>
          </button>

          <button
            onClick={() => setActiveTab('team_mgr')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeTab === 'team_mgr' 
                ? 'bg-blue-600 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <UserCheck size={16} />
            <span>Team Roster ({allSalesReps.length})</span>
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
        {(activeTab === 'lead_mgr' || activeTab === 'dnp_mgr') && (
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
                    <h3 className="font-extrabold text-base text-slate-900">Pipeline Stage Distribution</h3>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">Click to filter</span>
                  </div>

                  <div className="space-y-2.5">
                    {[
                      { label: 'New Lead', stage: 'New Lead', color: 'bg-blue-500' },
                      { label: 'Requirement Taken', stage: 'Requirement Taken', color: 'bg-indigo-500' },
                      { label: 'Visit Planned', stage: 'Visit Planned', color: 'bg-amber-500' },
                      { label: 'Visit Done', stage: 'Visit Done', color: 'bg-emerald-500' },
                      { label: 'Revisit Done', stage: 'Revisit Done', color: 'bg-teal-500' },
                      { label: 'Negotiation', stage: 'Negotiation', color: 'bg-purple-500' },
                      { label: 'Deal/Token', stage: 'Deal/Token', color: 'bg-emerald-600' },
                      { label: 'Lost/NI', stage: 'Lost/NI', color: 'bg-rose-500' }
                    ].map((item) => {
                      const stageLeads = filteredLeads.filter(l => l.pipeline_stage === item.stage || l.status === item.stage || (item.stage === 'New Lead' && (l.pipeline_stage === 'New' || !l.pipeline_stage)))
                      return (
                        <div 
                          key={item.stage}
                          onClick={() => openLeadsDrilldown(item.label, `${stageLeads.length} leads in stage: ${item.stage}`, stageLeads)}
                          className="flex justify-between items-center p-3 bg-slate-50 rounded-2xl text-xs font-bold text-slate-700 hover:bg-blue-50 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${item.color}`}></span>
                            <span>{item.label}</span>
                          </div>
                          <span className="font-black text-slate-900 bg-white px-3 py-1 rounded-xl border border-slate-200">{stageLeads.length}</span>
                        </div>
                      )
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
                      onClick={() => openLeadsDrilldown('Newly Created Fresh Leads', 'Untouched fresh incoming leads', stats.freshLeadsList)}
                      className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-1 cursor-pointer hover:bg-emerald-100/60 transition-colors"
                    >
                      <span className="text-[10px] font-black text-emerald-800 uppercase tracking-wider block">Newly Created</span>
                      <span className="text-2xl font-black text-emerald-950">{stats.freshLeadsList.length}</span>
                      <span className="text-[11px] font-bold text-emerald-700 block mt-1">Click to view &rarr;</span>
                    </div>

                    <div 
                      onClick={() => openLeadsDrilldown('Recent Leads (<= 1 Day)', 'Leads created within last 24 hours', stats.recentLeadsList)}
                      className="p-4 bg-amber-50/60 border border-amber-200 rounded-2xl space-y-1 cursor-pointer hover:bg-amber-100/60 transition-colors"
                    >
                      <span className="text-[10px] font-black text-amber-800 uppercase tracking-wider block">Created &lt;= 1 Day</span>
                      <span className="text-2xl font-black text-amber-950">{stats.recentLeadsList.length}</span>
                      <span className="text-[11px] font-bold text-amber-700 block mt-1">Click to view &rarr;</span>
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

                {/* Filter Checkboxes / Buttons (Pending, Schedule, Today) */}
                <div className="flex items-center gap-2 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/60 self-start md:self-auto">
                  <button
                    onClick={() => setActionStatusFilter('pending')}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                      actionStatusFilter === 'pending' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Clock size={13} /> Pending
                  </button>
                  <button
                    onClick={() => setActionStatusFilter('schedule')}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                      actionStatusFilter === 'schedule' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Calendar size={13} /> Schedule
                  </button>
                  <button
                    onClick={() => setActionStatusFilter('today')}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                      actionStatusFilter === 'today' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <CheckSquare size={13} /> Today
                  </button>
                </div>
              </div>

              {/* Employee Cards Grid (Matching Screenshot 1) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {actionManagerMatrix.rows.map(row => (
                  <div key={row.rep.id} className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                    
                    <div>
                      <div className="mb-4 pb-3 border-b border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Emp Name</span>
                        <h4 className="text-lg font-black text-slate-900 mt-0.5">{row.rep.name}</h4>
                      </div>

                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between items-center py-1.5 px-3 text-xs font-extrabold text-slate-400 border-b border-slate-100">
                          <span>Type</span>
                          <span>T</span>
                        </div>

                        {actionManagerMatrix.actionTypes.map(t => {
                          const count = row.counts[t.key] || 0
                          return (
                            <div
                              key={t.key}
                              onClick={() => {
                                if (count > 0) {
                                  openLeadsDrilldown(
                                    `${row.rep.name} - ${t.label}`,
                                    `${actionStatusFilter.toUpperCase()} ${t.label} Actions (${count})`,
                                    row.typeLeads[t.key] || []
                                  )
                                }
                              }}
                              className={`flex justify-between items-center py-2.5 px-3 rounded-xl transition-all cursor-pointer ${
                                count > 0 ? 'hover:bg-blue-50/70 text-slate-800 font-bold' : 'text-slate-400'
                              }`}
                            >
                              <span className="text-sm font-bold text-slate-700">{t.label}</span>
                              <span className={`text-sm font-black ${count > 0 ? 'text-blue-600' : 'text-slate-400'}`}>{count}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div
                      onClick={() => {
                        if (row.counts.total > 0) {
                          openLeadsDrilldown(
                            `${row.rep.name} - Total Actions`,
                            `${actionStatusFilter.toUpperCase()} Total Actions (${row.counts.total})`,
                            row.targetLeads
                          )
                        }
                      }}
                      className="flex justify-between items-center py-3 px-4 rounded-2xl bg-slate-50 border border-slate-200/80 font-black text-slate-900 mt-5 cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition-colors"
                    >
                      <span className="text-sm font-black">Total</span>
                      <span className="text-lg font-black text-blue-600">{row.counts.total}</span>
                    </div>

                  </div>
                ))}
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
                                if (s.key === 'new') return (l.pipeline_stage || 'New') === 'New'
                                if (s.key === 'contacted') return l.pipeline_stage === 'Contacted'
                                if (s.key === 'booked') return l.pipeline_stage === 'Appointment booked'
                                if (s.key === 'done') return l.pipeline_stage === 'Appointment done'
                                if (s.key === 'revisit') return l.pipeline_stage === 'Revisit Done' || l.custom_fields?.revisit === true
                                if (s.key === 'qualified') return l.pipeline_stage === 'Qualified'
                                if (s.key === 'unqualified') return l.pipeline_stage === 'Unqualified' || l.pipeline_stage === 'Closed'
                                if (s.key === 'meeting_planned') return l.pipeline_stage === 'Meeting Planned'
                                if (s.key === 'meeting_done') return l.pipeline_stage === 'Meeting Done'
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

          {/* TAB 3: DNP MGR (WorkVeu Screenshot 1 Interactive DNP Matrix) */}
          {activeTab === 'dnp_mgr' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* TOP SUMMARY CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Total Never Contacted / Untouched */}
                <div 
                  onClick={() => openLeadsDrilldown('Total Never Contacted / Untouched', 'Leads with 0 calls logged', dnpManagerMatrix.totalUntouchedLeads)}
                  className="bg-emerald-50/80 border border-emerald-200 p-6 rounded-3xl shadow-xs flex items-center justify-between cursor-pointer hover:border-emerald-500 hover:shadow-md transition-all group"
                >
                  <div>
                    <span className="text-xs font-black text-emerald-800 uppercase tracking-wider block mb-1">Total Never Contacted</span>
                    <span className="text-xs font-bold text-slate-500 block mb-2">Untouched leads</span>
                    <span className="text-3xl font-black text-emerald-950 group-hover:text-emerald-600">{dnpManagerMatrix.totalUntouched}</span>
                  </div>
                  <div className="p-4 bg-emerald-100 text-emerald-700 rounded-2xl border border-emerald-300 group-hover:scale-110 transition-transform">
                    <User size={28} />
                  </div>
                </div>

                {/* Total DNP */}
                <div 
                  onClick={() => openLeadsDrilldown('Total DNP / Do Not Contact', 'Leads marked DNP (Did Not Pick)', dnpManagerMatrix.totalDnpLeads)}
                  className="bg-amber-50/80 border border-amber-200 p-6 rounded-3xl shadow-xs flex items-center justify-between cursor-pointer hover:border-amber-500 hover:shadow-md transition-all group"
                >
                  <div>
                    <span className="text-xs font-black text-amber-800 uppercase tracking-wider block mb-1">Total DNP</span>
                    <span className="text-xs font-bold text-slate-500 block mb-2">Do not contact / Didn't pick</span>
                    <span className="text-3xl font-black text-amber-950 group-hover:text-amber-600">{dnpManagerMatrix.totalDnp}</span>
                  </div>
                  <div className="p-4 bg-amber-100 text-amber-700 rounded-2xl border border-amber-300 group-hover:scale-110 transition-transform">
                    <PhoneOff size={28} />
                  </div>
                </div>

              </div>

              {/* EMPLOYEE-WISE DNP MATRIX TABLE */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-extrabold text-base text-slate-900">DNP Manager Matrix</h3>
                  <span className="text-xs font-bold text-slate-500">Click any cell to drilldown exact DNP leads</span>
                </div>
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                        <th className="p-4 pl-6">Name</th>
                        <th className="p-4 text-center">Today's DNP</th>
                        <th className="p-4 text-center">Today's Untouched</th>
                        <th className="p-4 text-center">Pending OLD DNP</th>
                        <th className="p-4 text-center">Pending Untouched</th>
                        <th className="p-4 text-center bg-emerald-100/60 text-emerald-950 pr-6">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs font-bold">
                      {dnpManagerMatrix.rows.map(({ rep, todayDnp, todayUntouched, pendingOldDnp, pendingUntouched, todayDnpLeads, todayUntouchedLeads, pendingOldDnpLeads, pendingUntouchedLeads, totalLeadsList, total }) => (
                        <tr key={rep.id} className="hover:bg-blue-50/40 transition-colors">
                          <td className="p-4 pl-6 font-extrabold text-slate-900 flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black flex items-center justify-center border border-amber-300 shrink-0">
                              {rep.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="truncate max-w-[140px]">{rep.name}</span>
                          </td>
                          
                          <td 
                            onClick={() => todayDnp > 0 && openLeadsDrilldown(`${rep.name} - Today's DNP`, 'DNP calls logged today', todayDnpLeads)}
                            className={`p-4 text-center ${todayDnp > 0 ? 'text-blue-600 font-extrabold cursor-pointer hover:bg-blue-100' : 'text-slate-400'}`}
                          >
                            {todayDnp}
                          </td>

                          <td 
                            onClick={() => todayUntouched > 0 && openLeadsDrilldown(`${rep.name} - Today's Untouched`, 'Leads created today with 0 calls', todayUntouchedLeads)}
                            className={`p-4 text-center ${todayUntouched > 0 ? 'text-emerald-600 font-extrabold cursor-pointer hover:bg-emerald-100' : 'text-slate-400'}`}
                          >
                            {todayUntouched}
                          </td>

                          <td 
                            onClick={() => pendingOldDnp > 0 && openLeadsDrilldown(`${rep.name} - Pending OLD DNP`, 'Accumulated DNP leads from past days', pendingOldDnpLeads)}
                            className={`p-4 text-center ${pendingOldDnp > 0 ? 'text-amber-600 font-extrabold cursor-pointer hover:bg-amber-100' : 'text-slate-400'}`}
                          >
                            {pendingOldDnp}
                          </td>

                          <td 
                            onClick={() => pendingUntouched > 0 && openLeadsDrilldown(`${rep.name} - Pending Untouched`, 'Accumulated untouched leads from past days', pendingUntouchedLeads)}
                            className={`p-4 text-center ${pendingUntouched > 0 ? 'text-slate-700 font-extrabold cursor-pointer hover:bg-slate-100' : 'text-slate-400'}`}
                          >
                            {pendingUntouched}
                          </td>

                          <td 
                            onClick={() => total > 0 && openLeadsDrilldown(`${rep.name} - Total DNP / Untouched`, 'All DNP and untouched leads', totalLeadsList)}
                            className="p-4 text-center font-black text-slate-900 bg-emerald-50/50 pr-6 text-sm cursor-pointer hover:bg-emerald-100"
                          >
                            {total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-emerald-100/80 border-t-2 border-emerald-300 text-xs font-black text-emerald-950">
                        <td className="p-4 pl-6 uppercase tracking-wider">TOTAL</td>
                        <td className="p-4 text-center">{dnpManagerMatrix.totals.todayDnp}</td>
                        <td className="p-4 text-center">{dnpManagerMatrix.totals.todayUntouched}</td>
                        <td className="p-4 text-center">{dnpManagerMatrix.totals.pendingOldDnp}</td>
                        <td className="p-4 text-center">{dnpManagerMatrix.totals.pendingUntouched}</td>
                        <td className="p-4 text-center pr-6 text-base">{dnpManagerMatrix.totals.total}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: TEAM ROSTER */}
          {activeTab === 'team_mgr' && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-6 animate-in fade-in duration-200">
              <div className="flex justify-between items-center pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-900">Sales Representatives Roster</h3>
                  <p className="text-xs text-slate-500">Manage and monitor sales team members & performance metrics.</p>
                </div>
                <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-extrabold border border-blue-200">
                  {allSalesReps.length} Team Members
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allSalesReps.map(rep => {
                  const repLeadsList = leads.filter(l => l.assigned_to === rep.id)
                  const repDnpList = repLeadsList.filter(l => (l.dnp_count > 0 || l.custom_fields?.dnp_count > 0))
                  const repQualifiedList = repLeadsList.filter(l => ['Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Won'].includes(l.pipeline_stage))
                  
                  return (
                    <div key={rep.id} className="p-5 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-3 hover:border-blue-300 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-black flex items-center justify-center text-sm shadow-xs">
                            {rep.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="font-extrabold text-sm text-slate-900">{rep.name}</h4>
                            <span className="text-[10px] font-bold text-slate-400 uppercase">{rep.role}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedAgentId(rep.id)}
                          className="px-2.5 py-1 text-[11px] font-extrabold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                        >
                          Filter Dashboard
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-center text-xs">
                        <div 
                          onClick={() => openLeadsDrilldown(`${rep.name} - Total Assigned`, 'All assigned leads', repLeadsList)}
                          className="p-2 bg-white rounded-xl border border-slate-200/60 cursor-pointer hover:bg-blue-50"
                        >
                          <span className="text-[9px] font-bold text-slate-400 uppercase block">Leads</span>
                          <span className="font-black text-slate-900">{repLeadsList.length}</span>
                        </div>
                        
                        <div 
                          onClick={() => openLeadsDrilldown(`${rep.name} - Qualified`, 'Qualified and booked leads', repQualifiedList)}
                          className="p-2 bg-white rounded-xl border border-slate-200/60 cursor-pointer hover:bg-emerald-50"
                        >
                          <span className="text-[9px] font-bold text-emerald-600 uppercase block">Qualified</span>
                          <span className="font-black text-emerald-700">{repQualifiedList.length}</span>
                        </div>

                        <div 
                          onClick={() => openLeadsDrilldown(`${rep.name} - DNP`, 'DNP leads count', repDnpList)}
                          className="p-2 bg-white rounded-xl border border-slate-200/60 cursor-pointer hover:bg-rose-50"
                        >
                          <span className="text-[9px] font-bold text-rose-600 uppercase block">DNP</span>
                          <span className="font-black text-rose-700">{repDnpList.length}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
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
        <div className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div>
                <h3 className="text-lg sm:text-xl font-extrabold text-slate-900">{drilldownModal.title}</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">{drilldownModal.subtitle}</p>
              </div>
              <button
                onClick={() => setDrilldownModal(prev => ({ ...prev, isOpen: false }))}
                className="p-2 rounded-xl bg-slate-200/60 text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Search Bar */}
            <div className="p-4 border-b border-slate-100 bg-white flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter leads by name, phone, stage..."
                  value={drilldownModal.searchFilter}
                  onChange={(e) => setDrilldownModal(prev => ({ ...prev, searchFilter: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 rounded-xl pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <span className="text-xs font-black text-slate-500 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200 shrink-0">
                {drilldownModal.leads.filter(l => {
                  if (!drilldownModal.searchFilter.trim()) return true
                  const q = drilldownModal.searchFilter.toLowerCase().trim()
                  return (l.name || '').toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.pipeline_stage || '').toLowerCase().includes(q)
                }).length} leads
              </span>
            </div>

            {/* Modal Leads List */}
            <div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar flex-1 space-y-3">
              {(() => {
                const filtered = drilldownModal.leads.filter(l => {
                  if (!drilldownModal.searchFilter.trim()) return true
                  const q = drilldownModal.searchFilter.toLowerCase().trim()
                  return (l.name || '').toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.pipeline_stage || '').toLowerCase().includes(q)
                })

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 text-slate-400">
                      <Users size={32} className="mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-extrabold">No matching leads found for this view.</p>
                    </div>
                  )
                }

                return filtered.map((lead: any) => {
                  const assignedRep = allSalesReps.find(r => r.id === lead.assigned_to)?.name || 'Unassigned'
                  return (
                    <div key={lead.id} className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-blue-50/30 transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-extrabold text-sm text-slate-900">{lead.name || 'Unknown Prospect'}</h4>
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
                        {/* History Button */}
                        <button
                          onClick={() => setHistoryLead(lead)}
                          className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-black hover:bg-slate-100 shadow-xs flex items-center gap-1"
                        >
                          <History size={13} className="text-blue-600" />
                          <span>History</span>
                        </button>

                        {/* Followup Button */}
                        <button
                          onClick={() => setFollowupLead(lead)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-xs flex items-center gap-1"
                        >
                          <RefreshCw size={13} />
                          <span>Followup</span>
                        </button>

                        {/* WhatsApp Auto */}
                        <a
                          href={`https://wa.me/${(lead.phone || '').replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"
                          title="WhatsApp Chat"
                        >
                          <MessageSquare size={14} />
                        </a>

                        {/* Call */}
                        <a
                          href={`tel:${lead.phone}`}
                          className="p-1.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors"
                          title="Direct Call"
                        >
                          <Phone size={14} />
                        </a>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">Click any lead to view full history or record follow-up.</span>
              <button
                onClick={() => setDrilldownModal(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-800"
              >
                Close Drawer
              </button>
            </div>

          </div>
        </div>
      )}

      {/* LEAD HISTORY TIMELINE MODAL */}
      <LeadHistoryModal
        isOpen={!!historyLead}
        lead={historyLead}
        onClose={() => setHistoryLead(null)}
      />

      {/* UPDATE FOLLOWUP MODAL */}
      <UpdateFollowupModal
        isOpen={!!followupLead}
        lead={followupLead}
        onClose={() => setFollowupLead(null)}
        onSuccess={() => {
          setFollowupLead(null)
          fetchAnalytics(true)
        }}
      />

    </div>
  )
}
