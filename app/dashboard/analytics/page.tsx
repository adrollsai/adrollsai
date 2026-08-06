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
  PhoneOff
} from 'lucide-react'

// Render simple markdown headers, bolding, and lists into JSX
function MarkdownRenderer({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split('\n')
  
  return (
    <div className="space-y-4 text-slate-300 leading-relaxed text-sm">
      {lines.map((line, idx) => {
        // Headers (e.g. ### Header or **Header**)
        if (line.startsWith('###') || line.startsWith('##') || line.startsWith('#')) {
          const title = line.replace(/^#+\s*/, '')
          return (
            <h4 key={idx} className="text-base font-black text-white mt-6 mb-2 flex items-center gap-2">
              <span className="w-1.5 h-4 rounded-full bg-blue-500 inline-block"></span>
              {title}
            </h4>
          )
        }
        
        // Bullet list item
        if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
          const content = line.trim().replace(/^[-\*]\s*/, '')
          // Bold matches
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

        // Ordered list item
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

        // Quote blocks
        if (line.trim().startsWith('>')) {
          const content = line.trim().replace(/^>\s*/, '').replace(/^\[!.*?\]\s*/, '') // Strip alerts
          return (
            <blockquote key={idx} className="border-l-4 border-blue-500 bg-white/5 py-2.5 px-4 rounded-r-xl my-3 text-slate-300 italic">
              {content}
            </blockquote>
          )
        }

        if (line.trim() === '') return null

        // Plain line with potential bold tags
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
  const [duration, setDuration] = useState<'7d' | '30d' | 'this_month' | 'last_month' | 'all'>('30d')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  // Data State
  const [leads, setLeads] = useState<any[]>([])
  const [chats, setChats] = useState<any[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [team, setTeam] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [role, setRole] = useState<'admin' | 'agent' | 'agency' | 'super_admin' | 'client'>('admin')

  // AI Analyst State
  const [analyzing, setAnalyzing] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [cachedAnalysis, setCachedAnalysis] = useState<any>(null)

  const isUnlimited = useMemo(() => {
    const email = profile?.email?.toLowerCase() || ''
    return ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com'].includes(email)
  }, [profile])

  // Fetch Analytics & User Info
  const fetchAnalytics = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      // 1. Fetch current profile for role check
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
        setRole(userProfile.role || 'admin')
        if (userProfile.last_ai_analysis) {
          setCachedAnalysis(userProfile.last_ai_analysis)
        }
      }

      // 2. Fetch metrics
      const queryParams = new URLSearchParams()
      queryParams.set('duration', duration)
      if (selectedAgentId) queryParams.set('agentId', selectedAgentId)
      if (impersonateId) queryParams.set('impersonate', impersonateId)

      const res = await fetch(`/api/analytics?${queryParams.toString()}`)
      const data = await res.json()

      if (data.success) {
        setLeads(data.leads || [])
        setChats(data.chats || [])
        setMessages(data.messages || [])
        setTeam(data.team || [])
      } else {
        toast.error('Failed to sync metrics')
      }
    } catch (e) {
      console.error(e)
      toast.error('Connection timed out')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [duration, selectedAgentId])

  // Trigger AI analysis POST request
  const handleRunAIAnalysis = async () => {
    setShowConfirmModal(false)
    setAnalyzing(true)

    try {
      const res = await fetch(`/api/analytics/ai${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration })
      })

      const data = await res.json()
      if (res.ok && data.success) {
        toast.success('AI recommendations generated successfully!')
        setCachedAnalysis(data.analysis)
        // Refresh profile stats (especially credits)
        await fetchAnalytics()
      } else {
        toast.error('Analysis Failed', { description: data.error || 'Check credit balance' })
      }
    } catch (e: any) {
      toast.error('AI Analyst unavailable: ' + e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // --- STATS PRE-COMPUTATIONS ---
  const stats = useMemo(() => {
    const totalLeads = leads.length
    const wonLeads = leads.filter(l => l.pipeline_stage === 'Won' || l.pipeline_stage === 'Closed').length
    const lostLeads = leads.filter(l => l.pipeline_stage === 'Lost' || l.pipeline_stage === 'Unqualified').length
    const inProgress = totalLeads - wonLeads - lostLeads
    const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0'

    // Calls & DNP breakdown
    const totalCalls = Math.max(
      leads.filter(l => l.last_call_at || l.last_call_status).length,
      team.reduce((acc, t) => acc + (t.metrics?.callsCount || 0), 0)
    )
    const totalDnp = Math.max(
      leads.reduce((acc, l) => acc + (l.dnp_count || l.custom_fields?.dnp_count || 0), 0),
      team.reduce((acc, t) => acc + (t.metrics?.dnpCount || 0), 0)
    )

    // WhatsApp breakdown
    const waInbound = messages.filter(m => m.direction === 'inbound').length
    const waOutbound = messages.filter(m => m.direction === 'outbound').length
    const waTotal = waInbound + waOutbound
    const responseRatio = waOutbound > 0 ? (waInbound / waOutbound).toFixed(2) : '0'

    // Leads by stage counts
    const stagesList = ['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified']
    const stageBreakdown = stagesList.map(stage => {
      const count = leads.filter(l => (l.pipeline_stage || 'New') === stage).length
      return { stage, count }
    })

    return {
      totalLeads,
      wonLeads,
      lostLeads,
      inProgress,
      conversionRate,
      totalCalls,
      totalDnp,
      waInbound,
      waOutbound,
      waTotal,
      responseRatio,
      stageBreakdown
    }
  }, [leads, messages, team])

  // --- CHART DATA GENERATION ---
  // A. Leads Timeline Chart
  const leadsChartData = useMemo(() => {
    // Generate dates based on duration
    const numPoints = duration === '7d' ? 7 : duration === '30d' ? 10 : 6
    const points: { label: string; count: number }[] = []
    
    const now = new Date()
    for (let i = numPoints - 1; i >= 0; i--) {
      let label = ''
      let startRange: Date
      let endRange: Date

      if (duration === '7d') {
        const d = new Date()
        d.setDate(now.getDate() - i)
        label = d.toLocaleDateString(undefined, { weekday: 'short' })
        startRange = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
        endRange = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
      } else if (duration === '30d') {
        const d = new Date()
        d.setDate(now.getDate() - i * 3)
        label = `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`
        startRange = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2, 0, 0, 0, 0)
        endRange = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
      } else {
        const d = new Date()
        d.setMonth(now.getMonth() - i)
        label = d.toLocaleDateString(undefined, { month: 'short' })
        startRange = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
        endRange = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
      }

      const matchLeads = leads.filter(l => {
        const cDate = new Date(l.created_at)
        return cDate >= startRange && cDate <= endRange
      }).length

      points.push({ label, count: matchLeads })
    }

    return points
  }, [leads, duration])

  // Compute SVG Points for Leads Chart
  const svgLeadsCoords = useMemo(() => {
    if (leadsChartData.length === 0) {
      return {
        linePath: '',
        areaPath: '',
        points: [] as { x: number; y: number }[],
        maxVal: 5,
        height: 180,
        width: 500,
        padding: 20
      }
    }
    const width = 500
    const height = 180
    const padding = 20
    const maxVal = Math.max(...leadsChartData.map(d => d.count), 5)

    const xStep = (width - padding * 2) / (leadsChartData.length - 1)
    const points = leadsChartData.map((d, index) => {
      const x = padding + index * xStep
      const y = height - padding - (d.count / maxVal) * (height - padding * 2)
      return { x, y }
    })

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`

    return { linePath, areaPath, points, maxVal, height, width, padding }
  }, [leadsChartData])

  // B. WhatsApp Messages Day-wise grouped (Bar Chart)
  const messageChartData = useMemo(() => {
    const numBars = 5
    const data: { label: string; inbound: number; outbound: number }[] = []
    const now = new Date()

    for (let i = numBars - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(now.getDate() - i * (duration === '7d' ? 1 : 5))
      const label = duration === '7d' 
        ? d.toLocaleDateString(undefined, { weekday: 'short' })
        : `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`

      const startRange = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (duration === '7d' ? 0 : 4), 0, 0, 0, 0)
      const endRange = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

      const inCount = messages.filter(m => {
        const cDate = new Date(m.created_at)
        return m.direction === 'inbound' && cDate >= startRange && cDate <= endRange
      }).length

      const outCount = messages.filter(m => {
        const cDate = new Date(m.created_at)
        return m.direction === 'outbound' && cDate >= startRange && cDate <= endRange
      }).length

      data.push({ label, inbound: inCount, outbound: outCount })
    }
    return data
  }, [messages, duration])

  // C. Pipeline Stage Distribution (Doughnut Chart coords)
  const doughnutAngles = useMemo(() => {
    let total = stats.totalLeads
    if (total === 0) return []
    let currentAngle = 0

    const colors = [
      '#3B82F6', // Blue (New)
      '#6366F1', // Indigo (Contacted)
      '#8B5CF6', // Purple (Qualified)
      '#EC4899', // Pink (Appt booked)
      '#F43F5E', // Rose (Appt done)
      '#10B981', // Emerald (Closed)
      '#EF4444'  // Red (Unqualified)
    ]

    return stats.stageBreakdown.map((item, idx) => {
      const percentage = (item.count / total) * 100
      const strokeDasharray = `${percentage} ${100 - percentage}`
      const strokeDashoffset = 100 - currentAngle + 25 // +25 start top center
      currentAngle += percentage

      return {
        ...item,
        percentage: percentage.toFixed(1),
        strokeDasharray,
        strokeDashoffset,
        color: colors[idx % colors.length]
      }
    }).filter(item => item.count > 0)
  }, [stats])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-32">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-wider">WORKSPACE</span>
            {selectedAgentId && (
              <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                <User size={10} /> Agent view: {team.find(t => t.id === selectedAgentId)?.name}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-black text-[#001D35] tracking-tight">Interactive CRM Analytics</h1>
          <p className="text-slate-500 text-sm mt-1">Full performance and growth insights for {profile?.business_name || 'your business'}.</p>
        </div>

        {/* CONTROLS */}
        <div className="flex items-center flex-wrap gap-3">
          {/* Duration Selector */}
          <div className="bg-slate-100 border border-slate-200/60 p-1 rounded-2xl flex items-center shadow-inner">
            {(['7d', '30d', 'this_month', 'last_month', 'all'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${duration === d ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {d === '7d' ? '7 Days' : d === '30d' ? '30 Days' : d === 'this_month' ? 'This Month' : d === 'last_month' ? 'Last Month' : 'All Time'}
              </button>
            ))}
          </div>

          {/* Reset agent filter */}
          {selectedAgentId && (
            <button
              onClick={() => setSelectedAgentId(null)}
              className="px-4 py-2 border border-slate-200 bg-white text-slate-600 rounded-2xl hover:bg-slate-50 text-xs font-black shadow-sm flex items-center gap-2"
            >
              Reset Filter
            </button>
          )}

          {/* Sync status */}
          <button 
            onClick={() => fetchAnalytics(true)} 
            disabled={refreshing}
            className="p-3 bg-white text-slate-600 rounded-2xl border border-slate-200/60 hover:bg-slate-50 shadow-sm flex items-center justify-center transition-all disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 text-slate-400 gap-4">
          <Loader2 />
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* OVERVIEW KEY CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
            
            {/* Total Leads Card */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-5 shadow-sm flex items-center justify-between hover:shadow-md transition-all group">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">CRM Leads</span>
                <span className="text-2xl font-black text-[#001D35] tracking-tight">{stats.totalLeads}</span>
                <span className="text-[11px] text-emerald-600 font-extrabold flex items-center gap-1 mt-1.5">
                  <ArrowUpRight size={13} /> Active
                </span>
              </div>
              <div className="bg-blue-50 p-3.5 rounded-2xl text-blue-600 group-hover:scale-110 transition-transform shrink-0">
                <Users size={20} />
              </div>
            </div>

            {/* Total Calls Card */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-5 shadow-sm flex items-center justify-between hover:shadow-md transition-all group">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Calls Initiated</span>
                <span className="text-2xl font-black text-emerald-600 tracking-tight">{stats.totalCalls}</span>
                <span className="text-[11px] text-slate-400 font-extrabold block mt-1.5">
                  Manual & Voice
                </span>
              </div>
              <div className="bg-emerald-50 p-3.5 rounded-2xl text-emerald-600 group-hover:scale-110 transition-transform shrink-0">
                <Phone size={20} />
              </div>
            </div>

            {/* Total DNP Card */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-5 shadow-sm flex items-center justify-between hover:shadow-md transition-all group">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">DNP Count</span>
                <span className="text-2xl font-black text-rose-600 tracking-tight">{stats.totalDnp}</span>
                <span className="text-[11px] text-rose-500 font-extrabold block mt-1.5">
                  Did Not Pick
                </span>
              </div>
              <div className="bg-rose-50 p-3.5 rounded-2xl text-rose-600 group-hover:scale-110 transition-transform shrink-0">
                <PhoneOff size={20} />
              </div>
            </div>

            {/* Won Conversions Card */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-5 shadow-sm flex items-center justify-between hover:shadow-md transition-all group">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Won Deals</span>
                <span className="text-2xl font-black text-[#001D35] tracking-tight">{stats.wonLeads}</span>
                <span className="text-[11px] text-indigo-600 font-extrabold flex items-center gap-1 mt-1.5">
                  Active: {stats.inProgress}
                </span>
              </div>
              <div className="bg-emerald-50 p-3.5 rounded-2xl text-emerald-600 group-hover:scale-110 transition-transform shrink-0">
                <CheckCircle2 size={20} />
              </div>
            </div>

            {/* Conversion Rate Card */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-5 shadow-sm flex items-center justify-between hover:shadow-md transition-all group">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Conversion %</span>
                <span className="text-2xl font-black text-[#001D35] tracking-tight">{stats.conversionRate}%</span>
                <span className="text-[11px] text-indigo-500 font-extrabold block mt-1.5">
                  Won / Total
                </span>
              </div>
              <div className="bg-indigo-50 p-3.5 rounded-2xl text-indigo-600 group-hover:scale-110 transition-transform shrink-0">
                <TrendingUp size={20} />
              </div>
            </div>

            {/* WhatsApp Messages Card */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-5 shadow-sm flex items-center justify-between hover:shadow-md transition-all group">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">WhatsApp</span>
                <span className="text-2xl font-black text-[#001D35] tracking-tight">{stats.waTotal}</span>
                <span className="text-[11px] text-blue-600 font-extrabold flex items-center gap-1 mt-1.5">
                  In: {stats.waInbound} | Out: {stats.waOutbound}
                </span>
              </div>
              <div className="bg-teal-50 p-3.5 rounded-2xl text-teal-600 group-hover:scale-110 transition-transform shrink-0">
                <MessageCircle size={20} />
              </div>
            </div>

          </div>

          {/* MAIN CHARTS SECTION */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Leads Over Time Chart */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-6 shadow-sm lg:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-base font-black text-[#001D35]">Lead Acquisition Trend</h3>
                  <p className="text-xs text-slate-400">Chronological summary of inbound CRM leads</p>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-black text-slate-500 uppercase bg-slate-50 border border-slate-100 rounded-xl px-2.5 py-1">
                  <TrendingUp size={12} className="text-blue-500" /> Lead volume
                </div>
              </div>

              {leadsChartData.length === 0 || stats.totalLeads === 0 ? (
                <div className="h-[180px] flex items-center justify-center text-slate-400 text-xs italic">
                  No leads recorded in this period.
                </div>
              ) : (
                <div className="w-full">
                  <svg viewBox={`0 0 ${svgLeadsCoords.width} ${svgLeadsCoords.height}`} className="w-full h-[180px] overflow-visible">
                    <defs>
                      <linearGradient id="leadsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity="0.00" />
                      </linearGradient>
                    </defs>

                    {/* Grid lines */}
                    <line x1={svgLeadsCoords.padding} y1={svgLeadsCoords.padding} x2={svgLeadsCoords.width - svgLeadsCoords.padding} y2={svgLeadsCoords.padding} stroke="#F1F5F9" strokeWidth="1" strokeDasharray="4 4" />
                    <line x1={svgLeadsCoords.padding} y1={svgLeadsCoords.height / 2} x2={svgLeadsCoords.width - svgLeadsCoords.padding} y2={svgLeadsCoords.height / 2} stroke="#F1F5F9" strokeWidth="1" strokeDasharray="4 4" />
                    <line x1={svgLeadsCoords.padding} y1={svgLeadsCoords.height - svgLeadsCoords.padding} x2={svgLeadsCoords.width - svgLeadsCoords.padding} y2={svgLeadsCoords.height - svgLeadsCoords.padding} stroke="#E2E8F0" strokeWidth="1.5" />

                    {/* Gradient Area */}
                    <path d={svgLeadsCoords.areaPath} fill="url(#leadsGradient)" />

                    {/* Line path */}
                    <path d={svgLeadsCoords.linePath} fill="none" stroke="#2563EB" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-in fade-in duration-1000" />

                    {/* Glowing Data Dots */}
                    {svgLeadsCoords.points.map((p: { x: number; y: number }, idx: number) => (
                      <g key={idx} className="group/dot cursor-pointer">
                        <circle cx={p.x} cy={p.y} r="6" fill="#FFFFFF" stroke="#2563EB" strokeWidth="3" />
                        <circle cx={p.x} cy={p.y} r="10" fill="#2563EB" fillOpacity="0" className="hover:fill-opacity-15 transition-all" />
                        
                        {/* Hover Tooltip */}
                        <title>{leadsChartData[idx].label}: {leadsChartData[idx].count} leads</title>
                      </g>
                    ))}
                  </svg>

                  {/* X Axis Labels */}
                  <div className="flex justify-between px-5 mt-2">
                    {leadsChartData.map((d, i) => (
                      <span key={i} className="text-[10px] font-bold text-slate-400 uppercase w-12 text-center truncate">{d.label}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Pipeline Stage Distribution Doughnut */}
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-6 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-base font-black text-[#001D35] mb-1">Pipeline Distribution</h3>
                <p className="text-xs text-slate-400 mb-4">Percentage allocation across stages</p>
              </div>

              {stats.totalLeads === 0 ? (
                <div className="h-[140px] flex items-center justify-center text-slate-400 text-xs italic">
                  No active pipeline segments.
                </div>
              ) : (
                <div className="flex items-center gap-4 py-4">
                  {/* Doughnut SVG */}
                  <div className="relative w-32 h-32 shrink-0">
                    <svg viewBox="0 0 42 42" className="w-full h-full transform -rotate-90">
                      <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#F1F5F9" strokeWidth="4.5" />
                      {doughnutAngles.map((item, idx) => (
                        <circle
                          key={idx}
                          cx="21"
                          cy="21"
                          r="15.915"
                          fill="transparent"
                          stroke={item.color}
                          strokeWidth="4.5"
                          strokeDasharray={item.strokeDasharray}
                          strokeDashoffset={item.strokeDashoffset}
                          strokeLinecap="round"
                          className="transition-all duration-500 hover:stroke-[5.5]"
                        />
                      ))}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-full m-3 shadow-inner">
                      <span className="text-lg font-black text-[#001D35]">{stats.totalLeads}</span>
                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Leads</span>
                    </div>
                  </div>

                  {/* Legend list */}
                  <div className="flex-1 space-y-1.5 overflow-y-auto max-h-36 pr-1 scrollbar-hide">
                    {doughnutAngles.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }}></span>
                          <span className="truncate max-w-[80px]">{item.stage}</span>
                        </div>
                        <span>{item.percentage}% ({item.count})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* SECONDARY GRAPH: WHATSAPP COMMUNICATIONS */}
          <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-base font-black text-[#001D35]">WhatsApp Engagement Activity</h3>
                <p className="text-xs text-slate-400">Comparison of Outbound broadcasts vs Inbound response interactions</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-black">
                <div className="flex items-center gap-1.5 text-blue-600">
                  <span className="w-3 h-3 bg-blue-600 rounded-md"></span>
                  Outbound messages
                </div>
                <div className="flex items-center gap-1.5 text-indigo-500">
                  <span className="w-3 h-3 bg-indigo-500 rounded-md"></span>
                  Inbound answers
                </div>
                <div className="border-l border-slate-200 pl-4 text-slate-500">
                  Response Ratio: {stats.responseRatio} in/out
                </div>
              </div>
            </div>

            {stats.waTotal === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs italic border border-dashed border-slate-100 rounded-3xl">
                No WhatsApp conversations recorded in this duration.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Horizontal custom bar representation */}
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-6 pt-4">
                  {messageChartData.map((bar, idx) => {
                    const maxCount = Math.max(...messageChartData.map(b => b.inbound + b.outbound), 1)
                    const outPercent = (bar.outbound / maxCount) * 100
                    const inPercent = (bar.inbound / maxCount) * 100

                    return (
                      <div key={idx} className="flex flex-col items-center gap-3">
                        {/* Vertical stacked progress container */}
                        <div className="h-40 w-8 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-end overflow-hidden relative shadow-inner">
                          <div 
                            style={{ height: `${outPercent}%` }} 
                            className="bg-blue-600 w-full transition-all duration-700 hover:brightness-95 cursor-pointer"
                            title={`Outbound: ${bar.outbound}`}
                          />
                          <div 
                            style={{ height: `${inPercent}%` }} 
                            className="bg-indigo-500 w-full transition-all duration-700 hover:brightness-95 border-t border-white cursor-pointer"
                            title={`Inbound: ${bar.inbound}`}
                          />
                        </div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center truncate w-full">{bar.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* TEAM PERFORMANCE DRILL-DOWN SECTION */}
          {role !== 'agent' && (
            <div className="bg-white border border-slate-200/60 rounded-[2.5rem] p-6 shadow-sm">
              <div className="mb-6">
                <h3 className="text-base font-black text-[#001D35]">Team Performance Overview</h3>
                <p className="text-xs text-slate-400 mt-0.5">Assigned lead counts, conversion performance, and WhatsApp activities of team members.</p>
              </div>

              {team.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs italic border border-dashed border-slate-100 rounded-3xl">
                  No other active team members found in this workspace. Set them up in the <span className="font-bold cursor-pointer text-blue-600 hover:underline" onClick={() => router.push('/dashboard/team')}>Team tab</span>.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        <th className="py-3 pr-4">Team Member</th>
                        <th className="py-3 px-4">Assigned Leads</th>
                        <th className="py-3 px-4">Won Conversions</th>
                        <th className="py-3 px-4">Conversations</th>
                        <th className="py-3 px-4">Messages Processed</th>
                        <th className="py-3 pl-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {team.map((member) => (
                        <tr key={member.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors group">
                          <td className="py-4 pr-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-black text-sm shrink-0 border border-slate-200/50">
                              {member.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="truncate">
                              <p className="text-sm font-black text-slate-700 group-hover:text-blue-700 transition-colors">{member.name}</p>
                              <p className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mt-0.5">{member.role}</p>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-sm font-extrabold text-[#001D35]">{member.metrics.leadsCount}</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-sm font-extrabold text-emerald-600">{member.metrics.wonCount}</span>
                            <span className="text-xs text-slate-400 font-medium"> / {member.metrics.lostCount} lost</span>
                          </td>
                          <td className="py-4 px-4 text-slate-600 font-medium text-sm">{member.metrics.chatsCount} chats</td>
                          <td className="py-4 px-4 text-slate-600 font-medium text-sm">
                            {member.metrics.messagesCount} <span className="text-xs text-slate-400">({member.metrics.inboundCount} in / {member.metrics.outboundCount} out)</span>
                          </td>
                          <td className="py-4 pl-4 text-right">
                            <button
                              onClick={() => setSelectedAgentId(member.id)}
                              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${selectedAgentId === member.id ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                            >
                              {selectedAgentId === member.id ? 'Drilling' : 'Dig Deeper'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* AI BUSINESS RECOMMENDATIONS PANEL */}
          <div className="bg-slate-900 border border-slate-950 rounded-[2.5rem] p-6 sm:p-8 shadow-2xl relative overflow-hidden text-white group">
            
            {/* Visual background flares */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none transform translate-x-10 -translate-y-10 group-hover:bg-blue-600/15 transition-all duration-1000"></div>
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-purple-600/10 rounded-full blur-[100px] pointer-events-none transform -translate-x-10 translate-y-10 group-hover:bg-purple-600/15 transition-all duration-1000"></div>

            <div className="relative z-10">
              
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 border-b border-white/10 pb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 border border-blue-500/30">
                      <Sparkles size={12} className="animate-pulse" /> AI Business Analyst
                    </span>
                    {profile && (
                      <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-300 text-[10px] font-black uppercase tracking-wider border border-yellow-500/30">
                        Credits: {isUnlimited ? 'Unlimited' : (profile.credits ?? 0)}
                      </span>
                    )}
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-white">AI Revenue Growth Analyst</h3>
                  <p className="text-slate-400 text-xs mt-1">Deep analysis of pipeline stage leaks and automated recommendation engine</p>
                </div>

                <div className="shrink-0 flex items-center gap-3">
                  {cachedAnalysis && (
                    <div className="text-right hidden sm:block">
                      <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Last Run Analysis</span>
                      <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mt-0.5 justify-end">
                        <Clock size={12} /> {new Date(cachedAnalysis.timestamp).toLocaleString()}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setShowConfirmModal(true)}
                    disabled={analyzing}
                    className="bg-blue-600 text-white font-black hover:bg-blue-500 transition-colors shadow-lg px-5 py-3 rounded-2xl flex items-center gap-2 text-xs uppercase tracking-wider disabled:opacity-50"
                  >
                    {analyzing ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" /> Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> Run Growth Analysis
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Recommendations Content Panel */}
              {analyzing ? (
                <div className="py-20 flex flex-col items-center justify-center text-center gap-4 text-slate-400">
                  <div className="relative w-16 h-16">
                    <span className="absolute inset-0 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin"></span>
                    <Sparkles size={24} className="absolute inset-0 m-auto text-blue-400 animate-bounce" />
                  </div>
                  <div className="max-w-md">
                    <p className="text-white font-extrabold text-sm animate-pulse">Scanning pipeline drop-offs & WhatsApp ratios...</p>
                    <p className="text-xs mt-1.5 text-slate-500">Gemini is analyzing team efficiency and mapping revenue growth opportunities. Please wait.</p>
                  </div>
                </div>
              ) : cachedAnalysis ? (
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-md">
                  
                  {/* Snapshot of stats at analysis run */}
                  {cachedAnalysis.metricsSnapshot && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 border-b border-white/5 pb-6">
                      <div>
                        <span className="text-[10px] font-black text-slate-500 block uppercase">Snapshotted Leads</span>
                        <span className="text-lg font-black text-white">{cachedAnalysis.metricsSnapshot.totalLeads}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-slate-500 block uppercase">Conversion Rate</span>
                        <span className="text-lg font-black text-emerald-400">{cachedAnalysis.metricsSnapshot.conversionRate}%</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-slate-500 block uppercase">WhatsApp Chats</span>
                        <span className="text-lg font-black text-white">{cachedAnalysis.metricsSnapshot.chatsCount}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-slate-500 block uppercase">Total Messages</span>
                        <span className="text-lg font-black text-blue-400">{cachedAnalysis.metricsSnapshot.messagesCount}</span>
                      </div>
                    </div>
                  )}

                  {/* Generated Analysis Text */}
                  <div className="prose-invert prose-blue max-w-none">
                    <MarkdownRenderer text={cachedAnalysis.recommendations} />
                  </div>

                  {/* Warning disclaimer */}
                  <div className="mt-8 pt-6 border-t border-white/5 flex items-center gap-3 text-slate-500 text-[10px] font-bold">
                    <AlertCircle size={14} className="shrink-0" />
                    Disclaimer: Recommendations are AI-generated based on current trends. Execute responsibly to drive conversions.
                  </div>

                </div>
              ) : (
                <div className="py-16 text-center bg-white/5 border border-white/10 border-dashed rounded-3xl flex flex-col items-center justify-center gap-3">
                  <HelpCircle size={40} className="text-slate-500" />
                  <p className="text-sm font-extrabold text-white">No analysis available for this period.</p>
                  <p className="text-xs text-slate-400 max-w-sm">Deduct 50 credits to run a deep AI analysis and reveal recommendations for maximizing business revenues.</p>
                </div>
              )}

            </div>
          </div>

        </div>
      )}

      {/* CONFIRMATION / CREDIT DEDUCTION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] max-w-md w-full border border-slate-100 p-6 sm:p-8 shadow-2xl relative animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setShowConfirmModal(false)}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-50 text-slate-400 transition-colors"
            >
              <XCircle size={20} />
            </button>

            <div className="text-center pt-2">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Sparkles size={28} className="animate-pulse" />
              </div>
              <h4 className="text-xl font-black text-[#001D35] tracking-tight">Run Growth Analysis?</h4>
              
              <p className="text-slate-500 text-xs my-6 leading-relaxed">
                Running this analysis will pull your active CRM pipeline dropoffs and WhatsApp ratios to formulate actionable suggestions and recommendations to maximize business revenue.
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 py-3 px-4 rounded-2xl border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs font-black uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRunAIAnalysis}
                  className="flex-1 py-3 px-4 rounded-2xl bg-blue-600 text-white font-black hover:bg-blue-500 text-xs font-black uppercase tracking-wider transition-colors shadow-lg"
                >
                  Confirm & Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LOADER COMPONENT HELPER */}
      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

    </div>
  )
}

function Loader2({ className = '', size = 28 }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-slate-400 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-spin text-blue-600"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span className="text-xs font-black tracking-wider uppercase text-slate-400 animate-pulse">Synchronizing Analytics...</span>
    </div>
  )
}
