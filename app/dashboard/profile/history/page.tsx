'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowLeftRight,
  Sparkles,
  Video,
  FileText,
  Globe,
  Coins,
  Search,
  Filter,
  Download,
  RefreshCw,
  ExternalLink,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  Phone,
  MessageCircle,
  Megaphone,
  User,
  X,
  Play,
  Share2
} from 'lucide-react'
import { toast } from 'sonner'

interface ActivityItem {
  id: string
  timestamp: string
  category: 'transfers' | 'leads' | 'assets' | 'landing_pages' | 'campaigns' | 'credits' | 'products' | 'system'
  isCreation?: boolean
  action: string
  title: string
  description: string
  statusBadge?: {
    text: string
    variant: 'blue' | 'emerald' | 'purple' | 'amber' | 'rose' | 'slate' | 'indigo'
  }
  link?: string
  metadata?: Record<string, any>
}

interface ActivityResponse {
  success: boolean
  activities: ActivityItem[]
  total: number
  page: number
  limit: number
  totalPages: number
  counts: {
    all: number
    transfers: number
    creations: number
    leads: number
    assets: number
    landing_pages: number
    campaigns: number
    credits: number
    products: number
  }
  targetUser?: {
    id: string
    email: string
    name: string
  }
}

export default function AccountHistoryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState<ActivityResponse | null>(null)

  // Filters state
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [dateRange, setDateRange] = useState<string>('all')
  const [page, setPage] = useState<number>(1)
  const limit = 40

  // Search debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setPage(1)
    }, 350)
    return () => clearTimeout(handler)
  }, [searchQuery])

  // Fetch activities
  const fetchActivities = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const params = new URLSearchParams()
      if (impersonateId) params.set('impersonate', impersonateId)
      if (selectedCategory !== 'all') params.set('category', selectedCategory)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (dateRange !== 'all') params.set('date_range', dateRange)
      params.set('page', page.toString())
      params.set('limit', limit.toString())

      const res = await fetch(`/api/profile/history?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: ActivityResponse = await res.json()
      if (json.success) {
        setData(json)
      } else {
        toast.error('Failed to load history logs')
      }
    } catch (err: any) {
      console.error('Error fetching account history:', err)
      toast.error('Could not load account activity history')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [impersonateId, selectedCategory, debouncedSearch, dateRange, page])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  // CSV Export handler
  const handleExportCSV = () => {
    if (!data || !data.activities || data.activities.length === 0) {
      toast.error('No activities available to export')
      return
    }

    const headers = ['Timestamp', 'Category', 'Action', 'Title', 'Description', 'Link']
    const rows = data.activities.map(item => [
      `"${new Date(item.timestamp).toLocaleString()}"`,
      `"${item.category}"`,
      `"${(item.action || '').replace(/"/g, '""')}"`,
      `"${(item.title || '').replace(/"/g, '""')}"`,
      `"${(item.description || '').replace(/"/g, '""')}"`,
      `"${item.link ? window.location.origin + item.link : ''}"`
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `account_activity_${data.targetUser?.email || 'history'}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('Activity log exported to CSV')
  }

  // Format date grouping helper
  const formatDateHeading = (dateStr: string) => {
    const d = new Date(dateStr)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  // Group activities by date
  const groupedActivities = useMemo(() => {
    if (!data?.activities) return []
    const groups: { [key: string]: ActivityItem[] } = {}
    data.activities.forEach(item => {
      const heading = formatDateHeading(item.timestamp)
      if (!groups[heading]) groups[heading] = []
      groups[heading].push(item)
    })
    return Object.entries(groups).map(([date, items]) => ({ date, items }))
  }, [data?.activities])

  // Get icon & colors for category
  const getCategoryTheme = (category: string, action: string, isVideo = false) => {
    switch (category) {
      case 'transfers':
        return {
          icon: <ArrowLeftRight className="w-4 h-4 text-purple-400" />,
          bg: 'bg-purple-950/40 border-purple-800/50',
          badgeBg: 'bg-purple-500/10 text-purple-400 border-purple-500/20'
        }
      case 'assets':
        return {
          icon: isVideo ? <Video className="w-4 h-4 text-indigo-400" /> : <Sparkles className="w-4 h-4 text-pink-400" />,
          bg: 'bg-indigo-950/40 border-indigo-800/50',
          badgeBg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
        }
      case 'leads':
        return {
          icon: <User className="w-4 h-4 text-emerald-400" />,
          bg: 'bg-emerald-950/40 border-emerald-800/50',
          badgeBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        }
      case 'landing_pages':
        return {
          icon: <Globe className="w-4 h-4 text-blue-400" />,
          bg: 'bg-blue-950/40 border-blue-800/50',
          badgeBg: 'bg-blue-500/10 text-blue-400 border-blue-500/20'
        }
      case 'campaigns':
        return {
          icon: <Megaphone className="w-4 h-4 text-sky-400" />,
          bg: 'bg-sky-950/40 border-sky-800/50',
          badgeBg: 'bg-sky-500/10 text-sky-400 border-sky-500/20'
        }
      case 'credits':
        return {
          icon: <Coins className="w-4 h-4 text-amber-400" />,
          bg: 'bg-amber-950/40 border-amber-800/50',
          badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        }
      case 'products':
        return {
          icon: <Layers className="w-4 h-4 text-violet-400" />,
          bg: 'bg-violet-950/40 border-violet-800/50',
          badgeBg: 'bg-violet-500/10 text-violet-400 border-violet-500/20'
        }
      default:
        return {
          icon: <Clock className="w-4 h-4 text-slate-400" />,
          bg: 'bg-slate-900 border-slate-800',
          badgeBg: 'bg-slate-800 text-slate-300 border-slate-700'
        }
    }
  }

  const formatTimeOnly = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }

  const formatRelativeTime = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHr = Math.floor(diffMin / 60)
    const diffDays = Math.floor(diffHr / 24)

    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHr > 0) return `${diffHr}h ago`
    if (diffMin > 0) return `${diffMin}m ago`
    return 'Just now'
  }

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* TOP BAR / NAVIGATION */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 hover:border-slate-700 transition-all flex items-center justify-center shadow-sm"
              title="Back to Profile"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                  Account Activity & Audit History
                </h1>
                <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  Live Audit
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                Complete chronological audit log of lead transfers, creations, AI generations, and billing events.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {data?.targetUser && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                <User size={13} className="text-slate-400" />
                <span className="font-medium text-white">{data.targetUser.name}</span>
                <span className="text-slate-500 text-[11px]">({data.targetUser.email})</span>
              </div>
            )}
            <button
              onClick={() => fetchActivities(true)}
              disabled={refreshing}
              className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-all flex items-center gap-2 text-xs font-semibold shadow-sm"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin text-blue-400' : ''} />
              <span>Refresh</span>
            </button>
            <button
              onClick={handleExportCSV}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transition-all flex items-center gap-2 text-xs font-semibold shadow-sm"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* SUMMARY STAT CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between backdrop-blur">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium uppercase tracking-wider">Total Actions</span>
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Layers size={16} />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold text-white">{data?.counts?.all ?? 0}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Recorded in account audit</div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between backdrop-blur">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium uppercase tracking-wider">Lead Transfers</span>
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <ArrowLeftRight size={16} />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold text-purple-300">{data?.counts?.transfers ?? 0}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Inbound & outbound moves</div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between backdrop-blur">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium uppercase tracking-wider">Creations & AI</span>
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Sparkles size={16} />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold text-emerald-300">{data?.counts?.creations ?? 0}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Videos, pages, ads & leads</div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between backdrop-blur">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-medium uppercase tracking-wider">Credit Activity</span>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Coins size={16} />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold text-amber-300">{data?.counts?.credits ?? 0}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Billing & deductions</div>
            </div>
          </div>
        </div>

        {/* CONTROLS & FILTER BAR */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search actions, transfers, lead names, phone, descriptions..."
                className="w-full pl-10 pr-9 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Date Range Selector */}
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-slate-500 hidden sm:block" />
              <select
                value={dateRange}
                onChange={e => {
                  setDateRange(e.target.value)
                  setPage(1)
                }}
                className="bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-300 focus:outline-none focus:border-blue-500/60"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
              </select>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
            {[
              { id: 'all', label: 'All Activities', count: data?.counts?.all },
              { id: 'transfers', label: 'Transfers', count: data?.counts?.transfers, icon: ArrowLeftRight },
              { id: 'creations', label: 'All Creations', count: data?.counts?.creations, icon: Sparkles },
              { id: 'leads', label: 'Leads & CRM', count: data?.counts?.leads, icon: User },
              { id: 'assets', label: 'AI Assets & Videos', count: data?.counts?.assets, icon: Video },
              { id: 'landing_pages', label: 'Landing Pages', count: data?.counts?.landing_pages, icon: Globe },
              { id: 'campaigns', label: 'Campaigns', count: data?.counts?.campaigns, icon: Megaphone },
              { id: 'credits', label: 'Credits & Billing', count: data?.counts?.credits, icon: Coins }
            ].map(cat => {
              const active = selectedCategory === cat.id
              const IconComp = cat.icon
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategory(cat.id)
                    setPage(1)
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all whitespace-nowrap font-medium ${
                    active
                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/20'
                      : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {IconComp && <IconComp size={12} />}
                  <span>{cat.label}</span>
                  {typeof cat.count === 'number' && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        active ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {cat.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* TIMELINE FEED */}
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center space-y-3 bg-slate-900/30 border border-slate-800/60 rounded-2xl">
            <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Aggregating account audit timeline...</p>
          </div>
        ) : groupedActivities.length === 0 ? (
          <div className="p-16 text-center bg-slate-900/30 border border-slate-800/60 rounded-2xl space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700 mx-auto flex items-center justify-center text-slate-400">
              <Search size={22} />
            </div>
            <h3 className="text-base font-semibold text-white">No activity records found</h3>
            <p className="text-xs sm:text-sm text-slate-400 max-w-sm mx-auto">
              {debouncedSearch
                ? `No events match "${debouncedSearch}". Try resetting filters or choosing another category.`
                : 'No actions have been recorded for this account in the selected time range.'}
            </p>
            {(debouncedSearch || selectedCategory !== 'all' || dateRange !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setSelectedCategory('all')
                  setDateRange('all')
                  setPage(1)
                }}
                className="mt-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all inline-flex items-center gap-1.5"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {groupedActivities.map(group => (
              <div key={group.date} className="space-y-3">
                {/* Date Header Pill */}
                <div className="sticky top-2 z-10 flex items-center gap-2 py-1">
                  <div className="px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-semibold text-slate-300 backdrop-blur shadow-sm flex items-center gap-2">
                    <Calendar size={13} className="text-blue-400" />
                    <span>{group.date}</span>
                    <span className="text-[10px] text-slate-500">({group.items.length})</span>
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-slate-800 to-transparent" />
                </div>

                {/* Items List */}
                <div className="space-y-2.5 relative pl-4 sm:pl-6 border-l border-slate-800/80 ml-3">
                  {group.items.map(item => {
                    const isVideo = item.metadata?.type === 'video' || item.action.toLowerCase().includes('video')
                    const theme = getCategoryTheme(item.category, item.action, isVideo)

                    return (
                      <div
                        key={item.id}
                        className="relative group bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800/80 hover:border-slate-700/80 rounded-2xl p-4 transition-all shadow-sm"
                      >
                        {/* Timeline Node Icon */}
                        <div
                          className={`absolute -left-[27px] sm:-left-[35px] top-4 p-1.5 rounded-full border bg-slate-950 ${theme.bg}`}
                        >
                          {theme.icon}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            {/* Action badge & timestamps */}
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md border ${theme.badgeBg}`}
                              >
                                {item.action}
                              </span>

                              {item.statusBadge && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
                                  {item.statusBadge.text}
                                </span>
                              )}

                              <span className="text-[11px] text-slate-500 flex items-center gap-1 ml-auto sm:ml-0">
                                <Clock size={11} />
                                {formatTimeOnly(item.timestamp)}
                                <span className="text-slate-600">•</span>
                                <span>{formatRelativeTime(item.timestamp)}</span>
                              </span>
                            </div>

                            {/* Headline */}
                            <h4 className="text-sm font-semibold text-white truncate group-hover:text-blue-300 transition-colors">
                              {item.title}
                            </h4>

                            {/* Description */}
                            <p className="text-xs text-slate-400 leading-relaxed break-words whitespace-pre-line">
                              {item.description}
                            </p>

                            {/* Media thumbnail if video asset */}
                            {item.metadata?.thumbnailUrl && (
                              <div className="pt-2 flex items-center gap-3">
                                <div className="relative w-20 h-12 rounded-lg overflow-hidden border border-slate-700 bg-slate-950">
                                  <img
                                    src={item.metadata.thumbnailUrl}
                                    alt="Creative Thumbnail"
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                    <Play size={12} className="text-white fill-white" />
                                  </div>
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {item.metadata.videoModel && <span className="block font-medium text-slate-300">Model: {item.metadata.videoModel.toUpperCase()}</span>}
                                  {item.metadata.duration && <span>Duration: {Math.round(item.metadata.duration)}s</span>}
                                </div>
                              </div>
                            )}

                            {/* Metadata Pills */}
                            {item.metadata && (item.metadata.source || item.metadata.phone || item.metadata.lead_id) && (
                              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                {item.metadata.source && (
                                  <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-slate-400">
                                    Source: <strong className="text-slate-300">{item.metadata.source}</strong>
                                  </span>
                                )}
                                {item.metadata.phone && (
                                  <span className="text-[10px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-slate-400">
                                    Phone: <strong className="text-slate-300">{item.metadata.phone}</strong>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Quick Link Button */}
                          {item.link && (
                            <div className="self-end sm:self-center shrink-0">
                              <Link
                                href={
                                  impersonateId && !item.link.includes('impersonate=')
                                    ? `${item.link}${item.link.includes('?') ? '&' : '?'}impersonate=${impersonateId}`
                                    : item.link
                                }
                                className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-blue-600 hover:text-white border border-slate-700 text-slate-300 text-xs font-medium transition-all flex items-center gap-1.5 group-hover:border-blue-500/50"
                              >
                                <span>Inspect</span>
                                <ExternalLink size={12} />
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* PAGINATION CONTROLS */}
            {data && data.totalPages > 1 && (
              <div className="pt-4 flex items-center justify-between border-t border-slate-800 text-xs text-slate-400">
                <div>
                  Showing page <strong className="text-white">{data.page}</strong> of <strong className="text-white">{data.totalPages}</strong> ({data.total} total events)
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={data.page <= 1}
                    className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-white font-medium">
                    {data.page}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                    disabled={data.page >= data.totalPages}
                    className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
