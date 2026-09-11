'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Users,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Trash2,
  PhoneCall,
  MessageCircle,
  Workflow,
  Eye,
  CheckCircle2,
  Calendar,
  Layers,
  Sparkles,
  Loader2,
  X,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  AlertCircle
} from 'lucide-react'
import { toast } from 'sonner'

type AudienceGroup = {
  id: string
  name: string
  description?: string
  filters: {
    campaigns?: string[]
    sources?: string[]
    pipelineStages?: string[]
    propertyIds?: string[]
    csvAudiences?: string[]
    dateRange?: string
  }
  leadCount: number
  is_active: boolean
  created_at: string
  last_synced_at: string
}

type MetadataCampaign = {
  name: string
  count: number
}

export default function AudienceGroupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')

  // State
  const [audiences, setAudiences] = useState<AudienceGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Metadata state for filter picker
  const [metadata, setMetadata] = useState<{
    totalLeads: number
    campaigns: MetadataCampaign[]
    sources: { name: string; count: number }[]
    stages: { name: string; count: number }[]
    csvAudiences: { name: string; count: number }[]
    properties: { id: string; title: string; count: number }[]
  }>({
    totalLeads: 0,
    campaigns: [],
    sources: [],
    stages: [],
    csvAudiences: [],
    properties: []
  })
  const [loadingMetadata, setLoadingMetadata] = useState(false)

  // Builder Modal State
  const [isBuilderOpen, setIsBuilderOpen] = useState(false)
  const [editingAudienceId, setEditingAudienceId] = useState<string | null>(null)
  const [audName, setAudName] = useState('')
  const [audDesc, setAudDesc] = useState('')
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([])
  const [selectedDateRange, setSelectedDateRange] = useState('all')
  const [manualPhonesText, setManualPhonesText] = useState('')

  // Builder campaign search
  const [builderCampaignSearch, setBuilderCampaignSearch] = useState('')

  // Live Count & Preview in Builder
  const [evaluatingCount, setEvaluatingCount] = useState(false)
  const [liveCount, setLiveCount] = useState<number | null>(null)
  const [previewLeads, setPreviewLeads] = useState<any[]>([])
  const [savingAudience, setSavingAudience] = useState(false)

  // Inspection Modal State
  const [inspectingAudience, setInspectingAudience] = useState<AudienceGroup | null>(null)
  const [inspectLeads, setInspectLeads] = useState<any[]>([])
  const [loadingInspectLeads, setLoadingInspectLeads] = useState(false)

  // Fetch Audiences & Metadata
  useEffect(() => {
    fetchAudiences()
    fetchMetadata()
  }, [impersonateId])

  const fetchAudiences = async () => {
    try {
      setLoading(true)
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/audiences${impParam}`)
      const data = await res.json()
      if (data.success) {
        setAudiences(data.audiences || [])
      } else {
        toast.error(data.error || 'Failed to fetch audiences')
      }
    } catch (e: any) {
      console.error(e)
      toast.error('Network error loading audiences')
    } finally {
      setLoading(false)
    }
  }

  const fetchMetadata = async () => {
    try {
      setLoadingMetadata(true)
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/crm/audiences/metadata${impParam}`)
      const data = await res.json()
      if (data.success) {
        setMetadata({
          totalLeads: data.totalLeads || 0,
          campaigns: data.campaigns || [],
          sources: data.sources || [],
          stages: data.stages || [],
          csvAudiences: data.csvAudiences || [],
          properties: data.properties || []
        })
      }
    } catch (e) {
      console.error('Failed to load metadata for filters:', e)
    } finally {
      setLoadingMetadata(false)
    }
  }

  // Debounced Live Count Evaluation
  useEffect(() => {
    if (!isBuilderOpen) return
    const timer = setTimeout(() => {
      evaluateLiveCount()
    }, 350)
    return () => clearTimeout(timer)
  }, [
    isBuilderOpen,
    selectedCampaigns,
    selectedSources,
    selectedStages,
    selectedPropertyIds,
    selectedDateRange,
    manualPhonesText
  ])

  const evaluateLiveCount = async () => {
    try {
      setEvaluatingCount(true)
      const manualPhones = manualPhonesText
        .split(/[\n,]+/)
        .map(p => p.trim())
        .filter(Boolean)

      const payload = {
        filters: {
          campaigns: selectedCampaigns,
          sources: selectedSources,
          pipelineStages: selectedStages,
          propertyIds: selectedPropertyIds,
          dateRange: selectedDateRange
        },
        manualPhoneNumbers: manualPhones
      }

      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/audiences/count${impParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (data.success) {
        setLiveCount(data.count ?? 0)
        setPreviewLeads(data.previewLeads || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setEvaluatingCount(false)
    }
  }

  // Open Creator
  const handleOpenCreate = () => {
    setEditingAudienceId(null)
    setAudName('')
    setAudDesc('')
    setSelectedCampaigns([])
    setSelectedSources([])
    setSelectedStages([])
    setSelectedPropertyIds([])
    setSelectedDateRange('all')
    setManualPhonesText('')
    setLiveCount(null)
    setPreviewLeads([])
    setIsBuilderOpen(true)
  }

  // Open Editor
  const handleOpenEdit = (aud: AudienceGroup) => {
    setEditingAudienceId(aud.id)
    setAudName(aud.name)
    setAudDesc(aud.description || '')
    setSelectedCampaigns(aud.filters?.campaigns || [])
    setSelectedSources(aud.filters?.sources || [])
    setSelectedStages(aud.filters?.pipelineStages || [])
    setSelectedPropertyIds(aud.filters?.propertyIds || [])
    setSelectedDateRange(aud.filters?.dateRange || 'all')
    setManualPhonesText('')
    setLiveCount(aud.leadCount)
    setIsBuilderOpen(true)
  }

  // Save Audience
  const handleSaveAudience = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!audName.trim()) {
      toast.error('Audience group name is required')
      return
    }

    try {
      setSavingAudience(true)
      const manualPhones = manualPhonesText
        .split(/[\n,]+/)
        .map(p => p.trim())
        .filter(Boolean)

      const payload = {
        id: editingAudienceId,
        name: audName.trim(),
        description: audDesc.trim(),
        filters: {
          campaigns: selectedCampaigns,
          sources: selectedSources,
          pipelineStages: selectedStages,
          propertyIds: selectedPropertyIds,
          dateRange: selectedDateRange
        },
        manualPhoneNumbers: manualPhones
      }

      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/audiences${impParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (data.success) {
        toast.success(data.message || 'Audience group saved successfully! 🎉')
        setIsBuilderOpen(false)
        await fetchAudiences()
        fetchMetadata()
      } else {
        toast.error(data.error || 'Failed to save audience group')
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to save audience')
    } finally {
      setSavingAudience(false)
    }
  }

  // Delete Audience
  const handleDeleteAudience = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete audience group "${name}"?`)) return
    try {
      const impParam = impersonateId ? `&impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/audiences?id=${id}${impParam}`, {
        method: 'DELETE'
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Audience group "${name}" deleted.`)
        setAudiences(prev => prev.filter(a => a.id !== id))
      } else {
        toast.error(data.error || 'Failed to delete audience group')
      }
    } catch {
      toast.error('Failed to delete audience group')
    }
  }

  // Sync / Recalculate single audience
  const handleSyncAudience = async (aud: AudienceGroup) => {
    try {
      setRefreshingId(aud.id)
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/audiences${impParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: aud.id,
          name: aud.name,
          description: aud.description,
          filters: aud.filters
        })
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Audience "${aud.name}" refreshed: ${data.audience?.leadCount ?? 0} leads synced.`)
        await fetchAudiences()
      } else {
        toast.error(data.error || 'Sync failed')
      }
    } catch {
      toast.error('Sync failed')
    } finally {
      setRefreshingId(null)
    }
  }

  // Inspect leads in an audience
  const handleInspectAudience = async (aud: AudienceGroup) => {
    setInspectingAudience(aud)
    setLoadingInspectLeads(true)
    try {
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/audiences/count${impParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: aud.filters })
      })
      const data = await res.json()
      if (data.success) {
        setInspectLeads(data.previewLeads || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingInspectLeads(false)
    }
  }

  // Filtered audience list
  const filteredAudiences = useMemo(() => {
    if (!searchQuery.trim()) return audiences
    const q = searchQuery.toLowerCase().trim()
    return audiences.filter(a => 
      a.name.toLowerCase().includes(q) ||
      (a.description || '').toLowerCase().includes(q)
    )
  }, [audiences, searchQuery])

  // Total Leads in all audience groups
  const totalAudienceLeads = useMemo(() => {
    return audiences.reduce((acc, a) => acc + (a.leadCount || 0), 0)
  }, [audiences])

  return (
    <div className="min-h-screen bg-slate-50/50 pb-24 pt-6 px-4 sm:px-8 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Users size={20} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">Audience Group Maker</h1>
              <p className="text-xs font-semibold text-slate-500">
                Create targeted lead segments with live counts to use in WhatsApp Broadcasts, Voice Calling & Flows
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchAudiences}
            className="p-2.5 rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="Refresh audiences"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleOpenCreate}
            className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 shadow-md shadow-slate-900/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus size={16} /> Create Audience Group
          </button>
        </div>
      </div>

      {/* Metric Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-3xl border border-slate-200/70 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Layers size={22} />
          </div>
          <div>
            <span className="text-2xl font-black text-slate-900">{audiences.length}</span>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Audience Groups</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/70 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Users size={22} />
          </div>
          <div>
            <span className="text-2xl font-black text-slate-900">{metadata.totalLeads.toLocaleString()}</span>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Leads in Database</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-3xl border border-slate-200/70 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Sparkles size={22} />
          </div>
          <div>
            <span className="text-2xl font-black text-slate-900">{metadata.campaigns.length}</span>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Discovered Campaigns</p>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search saved audience groups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500/20 shadow-xs"
          />
        </div>
      </div>

      {/* Audience Cards Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-slate-200 text-slate-400 gap-3">
          <Loader2 size={32} className="animate-spin text-blue-600" />
          <span className="text-xs font-bold">Loading your audience groups...</span>
        </div>
      ) : filteredAudiences.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAudiences.map(aud => {
            const isSyncing = refreshingId === aud.id
            const campaignCount = aud.filters?.campaigns?.length || 0
            const stageCount = aud.filters?.pipelineStages?.length || 0
            const sourceCount = aud.filters?.sources?.length || 0

            return (
              <div
                key={aud.id}
                className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-4 group hover:border-blue-300"
              >
                <div>
                  {/* Top Bar: Title & Count Badge */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-sm font-black text-slate-900 group-hover:text-blue-600 transition-colors">
                      {aud.name}
                    </h3>
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-black px-2.5 py-1 rounded-full shrink-0 flex items-center gap-1.5 shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {aud.leadCount.toLocaleString()} leads
                    </span>
                  </div>

                  {/* Description */}
                  {aud.description ? (
                    <p className="text-xs text-slate-500 line-clamp-2 mb-3">
                      {aud.description}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 italic mb-3">
                      Custom lead segment
                    </p>
                  )}

                  {/* Filter Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {campaignCount > 0 && (
                      <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md truncate max-w-[200px]" title={aud.filters.campaigns?.join(', ')}>
                        🎯 {campaignCount} Campaign{campaignCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {stageCount > 0 && (
                      <span className="text-[10px] font-bold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md">
                        📊 {stageCount} Stage{stageCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {sourceCount > 0 && (
                      <span className="text-[10px] font-bold bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md">
                        🏷️ {sourceCount} Source{sourceCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {aud.filters?.dateRange && aud.filters.dateRange !== 'all' && (
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                        📅 Last {aud.filters.dateRange}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  {/* Campaign Launch Shortcuts */}
                  <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-2xl border border-slate-200/60">
                    <button
                      onClick={() => router.push(`/dashboard/whatsapp${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
                      title="Launch WhatsApp Campaign for this audience"
                      className="flex-1 py-1.5 px-2 rounded-xl bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 text-[10px] font-bold border border-slate-200/50 flex items-center justify-center gap-1 transition-colors shadow-2xs"
                    >
                      <MessageCircle size={12} className="text-emerald-600" /> WhatsApp
                    </button>
                    <button
                      onClick={() => router.push(`/dashboard/voice-agent${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
                      title="Start AI Voice Calling Campaign for this audience"
                      className="flex-1 py-1.5 px-2 rounded-xl bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-[10px] font-bold border border-slate-200/50 flex items-center justify-center gap-1 transition-colors shadow-2xs"
                    >
                      <PhoneCall size={12} className="text-blue-600" /> Call
                    </button>
                    <button
                      onClick={() => router.push(`/dashboard/flows${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
                      title="Run Automation Flow for this audience"
                      className="flex-1 py-1.5 px-2 rounded-xl bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-[10px] font-bold border border-slate-200/50 flex items-center justify-center gap-1 transition-colors shadow-2xs"
                    >
                      <Workflow size={12} className="text-indigo-600" /> Flow
                    </button>
                  </div>

                  {/* Management Buttons */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleInspectAudience(aud)}
                        className="text-[11px] font-bold text-slate-600 hover:text-blue-600 flex items-center gap-1 transition-colors"
                      >
                        <Eye size={13} /> View Leads
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        onClick={() => handleOpenEdit(aud)}
                        className="text-[11px] font-bold text-slate-600 hover:text-slate-900 transition-colors"
                      >
                        Edit
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        onClick={() => handleSyncAudience(aud)}
                        disabled={isSyncing}
                        className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 transition-colors disabled:opacity-50"
                        title="Re-evaluate and refresh lead count"
                      >
                        <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} /> Sync
                      </button>
                    </div>

                    <button
                      onClick={() => handleDeleteAudience(aud.id, aud.name)}
                      className="text-slate-400 hover:text-red-600 p-1 transition-colors"
                      title="Delete audience group"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center flex flex-col items-center justify-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-inner">
            <Users size={32} />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="text-base font-black text-slate-900">No Audience Groups Found</h3>
            <p className="text-xs text-slate-500">
              Create an audience group to bundle leads from campaigns (like Anmol Avenue), stages, or sources and use them instantly across WhatsApp, Voice Calling & Flows.
            </p>
          </div>
          <button
            onClick={handleOpenCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-2xl text-xs font-black shadow-md shadow-blue-500/20 transition-all flex items-center gap-2"
          >
            <Plus size={16} /> Create Your First Audience Group
          </button>
        </div>
      )}

      {/* AUDIENCE GROUP BUILDER MODAL */}
      {isBuilderOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/90">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                  <Layers size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    {editingAudienceId ? 'Edit Audience Group' : 'Create New Audience Group'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Define filters and preview matching contacts with instant live count
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBuilderOpen(false)}
                className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveAudience} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {/* Basic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                    Audience Group Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Anmol Avenue Leads / Hot WhatsApp Prospects"
                    value={audName}
                    onChange={(e) => setAudName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                    Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Leads generated through Anmol Avenue Meta campaigns"
                    value={audDesc}
                    onChange={(e) => setAudDesc(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-medium text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white"
                  />
                </div>
              </div>

              {/* LIVE AUDIENCE METER BANNER */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-2xl flex items-center justify-between shadow-md">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
                    <Users size={20} />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-blue-100">Live Audience Meter</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-black">
                        {evaluatingCount ? (
                          <span className="flex items-center gap-2 text-sm">
                            <Loader2 size={16} className="animate-spin" /> Calculating leads...
                          </span>
                        ) : liveCount !== null ? (
                          `${liveCount.toLocaleString()} Leads match this audience`
                        ) : (
                          'Calculating...'
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {liveCount !== null && (
                  <span className="text-xs font-bold bg-white/20 px-3 py-1.5 rounded-xl backdrop-blur-xs">
                    {(liveCount > 0 ? (liveCount / (metadata.totalLeads || 1) * 100).toFixed(1) : '0')}% of database
                  </span>
                )}
              </div>

              {/* FILTER SECTION */}
              <div className="space-y-5">
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-2 flex items-center gap-2">
                  <Filter size={14} className="text-blue-600" /> Filter Criteria (Multi-Select)
                </h4>

                {/* 1. Campaigns Filter with Instant Search & Lead Counts */}
                <div className="space-y-2 bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="text-xs font-black text-slate-800 uppercase flex items-center gap-1.5">
                      🎯 Meta Ad Campaigns ({metadata.campaigns.length} available)
                      {selectedCampaigns.length > 0 && (
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[10px] font-extrabold">
                          {selectedCampaigns.length} Selected
                        </span>
                      )}
                    </label>

                    <div className="flex items-center gap-2 text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => {
                          const matching = metadata.campaigns
                            .filter(c => !builderCampaignSearch || c.name.toLowerCase().includes(builderCampaignSearch.toLowerCase()))
                            .map(c => c.name)
                          setSelectedCampaigns(Array.from(new Set([...selectedCampaigns, ...matching])))
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        Select All Filtered
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => setSelectedCampaigns([])}
                        className="text-red-500 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Campaign Search Input */}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search campaigns (e.g. Anmol Avenue)..."
                      value={builderCampaignSearch}
                      onChange={(e) => setBuilderCampaignSearch(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-blue-400"
                    />
                  </div>

                  {/* Campaign List */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto custom-scrollbar bg-white p-2 rounded-xl border border-slate-200">
                    {metadata.campaigns
                      .filter(c => !builderCampaignSearch || c.name.toLowerCase().includes(builderCampaignSearch.toLowerCase()))
                      .map(camp => {
                        const isChecked = selectedCampaigns.includes(camp.name)
                        return (
                          <label
                            key={camp.name}
                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                              isChecked ? 'bg-blue-50 text-blue-900 font-bold' : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedCampaigns(selectedCampaigns.filter(c => c !== camp.name))
                                  } else {
                                    setSelectedCampaigns([...selectedCampaigns, camp.name])
                                  }
                                }}
                                className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                              />
                              <span className="truncate">{camp.name}</span>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                              {camp.count}
                            </span>
                          </label>
                        )
                      })}
                  </div>
                </div>

                {/* 2. Pipeline Stages & Sources side-by-side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Pipeline Stages */}
                  <div className="space-y-2 bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl">
                    <label className="text-xs font-black text-slate-800 uppercase block">
                      📊 CRM Pipeline Stages
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 bg-white p-2 rounded-xl border border-slate-200 max-h-36 overflow-y-auto">
                      {(metadata.stages.length > 0 ? metadata.stages : [
                        { name: 'New', count: 0 },
                        { name: 'Contacted', count: 0 },
                        { name: 'Interested', count: 0 },
                        { name: 'Qualified', count: 0 },
                        { name: 'Visit Planned', count: 0 },
                        { name: 'Lost/NI', count: 0 }
                      ]).map(stg => {
                        const isChecked = selectedStages.includes(stg.name)
                        return (
                          <label key={stg.name} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs font-semibold text-slate-700">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedStages(selectedStages.filter(s => s !== stg.name))
                                } else {
                                  setSelectedStages([...selectedStages, stg.name])
                                }
                              }}
                              className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                            />
                            <span className="truncate">{stg.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* Lead Sources */}
                  <div className="space-y-2 bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl">
                    <label className="text-xs font-black text-slate-800 uppercase block">
                      🏷️ Lead Sources ({metadata.sources.length})
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 bg-white p-2 rounded-xl border border-slate-200 max-h-36 overflow-y-auto">
                      {metadata.sources.map(src => {
                        const isChecked = selectedSources.includes(src.name)
                        return (
                          <label key={src.name} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs font-semibold text-slate-700">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedSources(selectedSources.filter(s => s !== src.name))
                                } else {
                                  setSelectedSources([...selectedSources, src.name])
                                }
                              }}
                              className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                            />
                            <span className="truncate">{src.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* 3. Date Range Selector */}
                <div className="space-y-2 bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl">
                  <label className="text-xs font-black text-slate-800 uppercase block">
                    📅 Lead Creation Date Range
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'all', label: 'All Time' },
                      { id: '7d', label: 'Last 7 Days' },
                      { id: '30d', label: 'Last 30 Days' },
                      { id: '90d', label: 'Last 90 Days' }
                    ].map(dr => (
                      <button
                        key={dr.id}
                        type="button"
                        onClick={() => setSelectedDateRange(dr.id)}
                        className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                          selectedDateRange === dr.id
                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {dr.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. Optional Manual Phone Numbers */}
                <div className="space-y-2 bg-slate-50/70 border border-slate-200/80 p-4 rounded-2xl">
                  <label className="text-xs font-black text-slate-800 uppercase block">
                    📱 Manual Phone Numbers (Optional)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Paste phone numbers (comma or new-line separated) to manually add specific prospects into this group.
                  </p>
                  <textarea
                    rows={2}
                    placeholder="e.g. +91 9872490091, 9815317537"
                    value={manualPhonesText}
                    onChange={(e) => setManualPhonesText(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-800 outline-none focus:border-blue-400"
                  />
                </div>
              </div>

              {/* MATCHING LEADS PREVIEW TABLE */}
              {previewLeads.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-black text-slate-800 uppercase">
                      Matching Contacts Preview (First {previewLeads.length})
                    </h5>
                    <span className="text-[11px] text-slate-500 font-semibold">
                      Total: {liveCount?.toLocaleString()}
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="py-2 px-3">Name</th>
                          <th className="py-2 px-3">Phone</th>
                          <th className="py-2 px-3">Campaign / Source</th>
                          <th className="py-2 px-3">Stage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previewLeads.map((lead) => (
                          <tr key={lead.id} className="hover:bg-slate-50/80">
                            <td className="py-2 px-3 font-bold text-slate-900">{lead.name}</td>
                            <td className="py-2 px-3 font-mono text-slate-600">{lead.phone}</td>
                            <td className="py-2 px-3 text-slate-600 truncate max-w-[200px]" title={lead.campaign}>
                              {lead.campaign}
                            </td>
                            <td className="py-2 px-3">
                              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">
                                {lead.stage}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsBuilderOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAudience || !audName.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl text-xs font-black shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {savingAudience ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Saving & Tagging Leads...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} /> Save Audience Group ({liveCount !== null ? liveCount : '...'} leads)
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECTION MODAL */}
      {inspectingAudience && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-black text-slate-900">{inspectingAudience.name}</h3>
                <p className="text-xs text-slate-500">
                  {inspectingAudience.leadCount} verified leads in this audience
                </p>
              </div>
              <button
                onClick={() => setInspectingAudience(null)}
                className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              {loadingInspectLeads ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                  <Loader2 size={24} className="animate-spin text-blue-600" />
                  <span className="text-xs font-bold">Loading member contacts...</span>
                </div>
              ) : inspectLeads.length > 0 ? (
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Name</th>
                        <th className="py-2.5 px-3">Phone</th>
                        <th className="py-2.5 px-3">Campaign</th>
                        <th className="py-2.5 px-3">Stage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inspectLeads.map((lead) => (
                        <tr key={lead.id} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-3 font-bold text-slate-900">{lead.name}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">{lead.phone}</td>
                          <td className="py-2.5 px-3 text-slate-600 truncate max-w-[240px]" title={lead.campaign}>
                            {lead.campaign}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">
                              {lead.stage}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400 text-xs font-bold">
                  No contacts found matching audience group filters.
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setInspectingAudience(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800"
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
