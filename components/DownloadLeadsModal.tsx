'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  X,
  Download,
  Filter,
  CheckSquare,
  Square,
  FileSpreadsheet,
  Calendar,
  Users,
  Layers,
  Sparkles,
  Search,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Hash,
  ChevronDown
} from 'lucide-react'
import { toast } from 'sonner'

export interface DownloadFieldOption {
  id: string
  label: string
  category: 'core' | 'pipeline' | 'source' | 'actions' | 'other'
  defaultSelected: boolean
}

export const AVAILABLE_FIELDS: DownloadFieldOption[] = [
  { id: 'name', label: 'Full Name', category: 'core', defaultSelected: true },
  { id: 'phone', label: 'Phone Number', category: 'core', defaultSelected: true },
  { id: 'email', label: 'Email Address', category: 'core', defaultSelected: true },
  { id: 'pipeline_stage', label: 'Pipeline Stage / Status', category: 'pipeline', defaultSelected: true },
  { id: 'assigned_to_name', label: 'Assigned Agent Name', category: 'pipeline', defaultSelected: true },
  { id: 'created_at', label: 'Created Date & Time', category: 'core', defaultSelected: true },
  { id: 'source', label: 'Lead Source / Platform', category: 'source', defaultSelected: true },
  { id: 'campaign_name', label: 'Campaign, AdSet & Ad Details (Full Hierarchy)', category: 'source', defaultSelected: true },
  { id: 'campaign_only', label: 'Campaign Name Only', category: 'source', defaultSelected: false },
  { id: 'adset_name', label: 'AdSet Name', category: 'source', defaultSelected: false },
  { id: 'ad_name', label: 'Ad Name / Headline', category: 'source', defaultSelected: false },
  { id: 'form_name', label: 'Meta Form Name', category: 'source', defaultSelected: true },
  { id: 'next_followup', label: 'Next Follow-up Date', category: 'actions', defaultSelected: true },
  { id: 'next_action_type', label: 'Next Action Type', category: 'actions', defaultSelected: true },
  { id: 'dnp_count', label: 'DNP (Missed Call) Count', category: 'actions', defaultSelected: true },
  { id: 'budget', label: 'Budget / Requirement', category: 'pipeline', defaultSelected: true },
  { id: 'location', label: 'Location / City', category: 'core', defaultSelected: true },
  { id: 'notes', label: 'Notes / Remarks', category: 'actions', defaultSelected: true },
  { id: 'booked_time', label: 'Booked Appointment Time', category: 'actions', defaultSelected: true },
  { id: 'csv_audience', label: 'CSV Audience Tag', category: 'source', defaultSelected: true },
  { id: 'whatsapp_enabled', label: 'WhatsApp Enabled', category: 'other', defaultSelected: false },
  { id: 'custom_fields', label: 'Custom Fields (Raw JSON)', category: 'other', defaultSelected: false },
  { id: 'id', label: 'Lead System ID', category: 'other', defaultSelected: false }
]

interface DownloadLeadsModalProps {
  isOpen: boolean
  onClose: () => void
  leads: any[]
  team: any[]
  campaigns: any[]
  customStages: any[]
  getLeadCampaignName: (lead: any) => string
  initialFilters?: {
    searchQuery?: string
    selectedSpecificStage?: string
    selectedAgentFilter?: string
    selectedDateRange?: string
    crmCustomDate?: string
    crmStartDate?: string
    crmEndDate?: string
    selectedCampaign?: string
    selectedForm?: string
    selectedCsvAudience?: string
    selectedDnpFilter?: string
    selectedNextActionFilter?: string
    selectedNextActionType?: string
  }
}

export default function DownloadLeadsModal({
  isOpen,
  onClose,
  leads,
  team,
  campaigns,
  customStages,
  getLeadCampaignName,
  initialFilters
}: DownloadLeadsModalProps) {
  // Filter States inside Modal
  const [filterStage, setFilterStage] = useState<string>('ALL')
  const [filterAgent, setFilterAgent] = useState<string>('ALL')
  const [filterDateRange, setFilterDateRange] = useState<string>('ALL')
  const [filterStartDate, setFilterStartDate] = useState<string>('')
  const [filterEndDate, setFilterEndDate] = useState<string>('')
  const [filterCampaign, setFilterCampaign] = useState<string>('ALL')
  const [filterForm, setFilterForm] = useState<string>('ALL')
  const [filterCsvAudience, setFilterCsvAudience] = useState<string>('ALL')
  const [filterDnp, setFilterDnp] = useState<string>('ALL')
  const [filterNextAction, setFilterNextAction] = useState<string>('ALL')
  const [filterNextActionType, setFilterNextActionType] = useState<string>('ALL')
  const [filterSearch, setFilterSearch] = useState<string>('')

  // Limit State
  const [maxDownloadLimit, setMaxDownloadLimit] = useState<string>('')

  // Field selection state
  const [selectedFields, setSelectedFields] = useState<string[]>(() =>
    AVAILABLE_FIELDS.filter(f => f.defaultSelected).map(f => f.id)
  )

  const [isExporting, setIsExporting] = useState<boolean>(false)

  // Populate or Reset to active page filters when opened
  useEffect(() => {
    if (isOpen) {
      if (initialFilters) {
        setFilterStage(initialFilters.selectedSpecificStage || 'ALL')
        setFilterAgent(initialFilters.selectedAgentFilter || 'ALL')
        setFilterDateRange(initialFilters.selectedDateRange || 'ALL')
        setFilterStartDate(initialFilters.crmStartDate || '')
        setFilterEndDate(initialFilters.crmEndDate || '')
        setFilterCampaign(initialFilters.selectedCampaign ? initialFilters.selectedCampaign : 'ALL')
        setFilterForm(initialFilters.selectedForm ? initialFilters.selectedForm : 'ALL')
        setFilterCsvAudience(initialFilters.selectedCsvAudience ? initialFilters.selectedCsvAudience : 'ALL')
        setFilterDnp(initialFilters.selectedDnpFilter || 'ALL')
        setFilterNextAction(initialFilters.selectedNextActionFilter || 'ALL')
        setFilterNextActionType(initialFilters.selectedNextActionType || 'ALL')
        setFilterSearch(initialFilters.searchQuery || '')
      }
      setMaxDownloadLimit('')
    }
  }, [isOpen, initialFilters])

  // Extract unique campaigns and forms from leads
  const uniqueCampaigns = useMemo(() => {
    const dbNames = campaigns.map(c => c.name).filter(Boolean)
    const leadNames = leads.map(l => l.ad_name || l.campaign_name).filter(Boolean)
    return Array.from(new Set([...dbNames, ...leadNames])).sort()
  }, [campaigns, leads])

  const uniqueForms = useMemo(() => {
    const list: string[] = []
    leads.forEach(l => {
      if (l.form_name && l.form_name.trim()) list.push(l.form_name.trim())
      if (l.source && l.source.trim()) list.push(l.source.trim())
    })
    return Array.from(new Set(list)).sort()
  }, [leads])

  const uniqueCsvAudiences = useMemo(() => {
    return Array.from(new Set(leads.map(l => l.csv_audience).filter(Boolean))).sort()
  }, [leads])

  // Pipeline stages list
  const allStages = useMemo(() => {
    if (customStages && customStages.length > 0) {
      return customStages.map(s => (typeof s === 'string' ? s : s.name))
    }
    return [
      'New Lead',
      'Requirement Taken',
      'Appointment Booked',
      'Visit Planned',
      'Visit Done',
      'Revisit Done',
      'Meeting Planned',
      'Meeting Done',
      'Negotiation',
      'Deal/Token',
      'Never Picked',
      'Dealer',
      'Plan Postponed',
      'Already Purchased',
      'Lost/NI',
      'Different Requirement'
    ]
  }, [customStages])

  // Filter matching leads computation (Optimized in-memory filtering)
  const matchingLeads = useMemo(() => {
    if (!leads || leads.length === 0) return []

    return leads.filter(l => {
      // 1. Search Query
      if (filterSearch.trim()) {
        const q = filterSearch.toLowerCase().trim()
        const matchName = l.name?.toLowerCase().includes(q)
        const matchPhone = l.phone?.includes(q)
        const matchEmail = l.email?.toLowerCase().includes(q)
        if (!matchName && !matchPhone && !matchEmail) return false
      }

      // 2. Assigned Agent
      if (filterAgent !== 'ALL') {
        if (filterAgent === 'UNASSIGNED') {
          if (l.assigned_to) return false
        } else {
          if (l.assigned_to !== filterAgent) return false
        }
      }

      // 3. Pipeline Stage
      if (filterStage !== 'ALL') {
        const sLower = filterStage.toLowerCase()
        const leadStatus = (l.status || '').toLowerCase().trim()
        const leadStage = (l.pipeline_stage || '').toLowerCase().trim()
        const matches = leadStatus === sLower || leadStage === sLower || (
          sLower === 'new lead' && ['new lead', 'new', 'fresh', 'uncontacted', ''].includes(leadStatus || leadStage)
        ) || (
          sLower === 'requirement taken' && ['requirement taken', 'requirement', 'contacted', 'qualified'].includes(leadStatus || leadStage)
        ) || (
          sLower === 'visit done' && ['visit done', 'visited', 'site visit done'].includes(leadStatus || leadStage)
        ) || (
          sLower === 'lost/ni' && ['lost/ni', 'lost', 'ni', 'not interested', 'unqualified'].includes(leadStatus || leadStage)
        )
        if (!matches) return false
      }

      // 4. Date Range Filter
      if (filterDateRange !== 'ALL') {
        const leadDateStr = l.facebook_created_at || l.created_at
        if (!leadDateStr) return false
        const leadDate = new Date(leadDateStr)
        const now = new Date()

        if (filterDateRange === 'TODAY') {
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          if (leadDate < startOfToday) return false
        } else if (filterDateRange === 'YESTERDAY') {
          const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
          const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999)
          if (leadDate < startOfYesterday || leadDate > endOfYesterday) return false
        } else if (filterDateRange === 'LAST_7_DAYS') {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          if (leadDate < sevenDaysAgo) return false
        } else if (filterDateRange === 'LAST_30_DAYS') {
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          if (leadDate < thirtyDaysAgo) return false
        } else if (filterDateRange === 'THIS_MONTH') {
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
          if (leadDate < startOfMonth) return false
        } else if (filterDateRange === 'LAST_MONTH') {
          const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
          const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
          if (leadDate < startOfLastMonth || leadDate > endOfLastMonth) return false
        } else if (filterDateRange === 'CUSTOM') {
          if (filterStartDate) {
            const start = new Date(filterStartDate)
            start.setHours(0, 0, 0, 0)
            if (leadDate < start) return false
          }
          if (filterEndDate) {
            const end = new Date(filterEndDate)
            end.setHours(23, 59, 59, 999)
            if (leadDate > end) return false
          }
        }
      }

      // 5. Campaign Filter
      if (filterCampaign !== 'ALL') {
        const leadCamp = getLeadCampaignName(l)?.trim() || ''
        const adName = (l.ad_name || '').trim()
        const campName = (l.campaign_name || '').trim()
        const targetCamp = filterCampaign.trim()
        if (leadCamp !== targetCamp && adName !== targetCamp && campName !== targetCamp) {
          return false
        }
      }

      // 6. Form / Source Filter
      if (filterForm !== 'ALL') {
        const targetForm = filterForm.trim()
        const fName = (l.form_name || '').trim()
        const src = (l.source || '').trim()
        if (fName !== targetForm && src !== targetForm) return false
      }

      // 7. CSV Audience Filter
      if (filterCsvAudience !== 'ALL') {
        if ((l.csv_audience || '').trim() !== filterCsvAudience.trim()) return false
      }

      // 8. DNP Filter
      if (filterDnp !== 'ALL') {
        let cf: any = l.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) {}
        }
        const count = l.dnp_count || cf?.dnp_count || 0
        if (filterDnp === 'NO_DNP' && count !== 0) return false
        if (filterDnp === 'DNP_ONLY' && count === 0) return false
        if (filterDnp === 'DNP_1' && count !== 1) return false
        if (filterDnp === 'DNP_2' && count !== 2) return false
        if (filterDnp === 'DNP_3PLUS' && count < 3) return false
      }

      // 9. Next Action Filter
      if (filterNextAction !== 'ALL') {
        let cf: any = l.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) {}
        }
        const actionDateStr = l.next_action_date || l.next_followup || cf?.next_action_date
        const hasDate = !!actionDateStr
        let isPast = false
        let isToday = false
        let isFuture = false

        if (hasDate) {
          const actionDateObj = new Date(actionDateStr)
          if (!isNaN(actionDateObj.getTime())) {
            const now = new Date()
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
            if (actionDateObj < startOfToday) isPast = true
            else if (actionDateObj >= startOfToday && actionDateObj <= endOfToday) isToday = true
            else isFuture = true
          }
        }

        if (filterNextAction === 'HAS_ACTION' && !hasDate) return false
        if (filterNextAction === 'NO_ACTION' && hasDate) return false
        if (filterNextAction === 'TODAY' && (!hasDate || !isToday)) return false
        if (filterNextAction === 'OVERDUE' && (!hasDate || !isPast)) return false
        if (filterNextAction === 'UPCOMING' && (!hasDate || !isFuture)) return false
      }

      // 10. Action Type
      if (filterNextActionType !== 'ALL') {
        let cf: any = l.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) {}
        }
        const actionType = l.next_action_type || cf?.next_action_type || l.last_followup_type || 'Call'
        if (actionType.toLowerCase() !== filterNextActionType.toLowerCase()) return false
      }

      return true
    })
  }, [
    leads,
    filterSearch,
    filterAgent,
    filterStage,
    filterDateRange,
    filterStartDate,
    filterEndDate,
    filterCampaign,
    filterForm,
    filterCsvAudience,
    filterDnp,
    filterNextAction,
    filterNextActionType,
    getLeadCampaignName
  ])

  // Count after applying optional maxDownloadLimit
  const parsedLimit = maxDownloadLimit ? parseInt(maxDownloadLimit, 10) : 0
  const finalExportLeads = useMemo(() => {
    if (parsedLimit > 0 && parsedLimit < matchingLeads.length) {
      return matchingLeads.slice(0, parsedLimit)
    }
    return matchingLeads
  }, [matchingLeads, parsedLimit])

  // Toggle single field
  const toggleField = (fieldId: string) => {
    setSelectedFields(prev =>
      prev.includes(fieldId) ? prev.filter(id => id !== fieldId) : [...prev, fieldId]
    )
  }

  // Toggle all fields
  const handleToggleAllFields = () => {
    if (selectedFields.length === AVAILABLE_FIELDS.length) {
      setSelectedFields([])
    } else {
      setSelectedFields(AVAILABLE_FIELDS.map(f => f.id))
    }
  }

  // Reset filters inside modal
  const handleClearAllFilters = () => {
    setFilterStage('ALL')
    setFilterAgent('ALL')
    setFilterDateRange('ALL')
    setFilterStartDate('')
    setFilterEndDate('')
    setFilterCampaign('ALL')
    setFilterForm('ALL')
    setFilterCsvAudience('ALL')
    setFilterDnp('ALL')
    setFilterNextAction('ALL')
    setFilterNextActionType('ALL')
    setFilterSearch('')
    setMaxDownloadLimit('')
  }

  // Restore current CRM view filters
  const handleResetToCurrentCrmView = () => {
    if (initialFilters) {
      setFilterStage(initialFilters.selectedSpecificStage || 'ALL')
      setFilterAgent(initialFilters.selectedAgentFilter || 'ALL')
      setFilterDateRange(initialFilters.selectedDateRange || 'ALL')
      setFilterStartDate(initialFilters.crmStartDate || '')
      setFilterEndDate(initialFilters.crmEndDate || '')
      setFilterCampaign(initialFilters.selectedCampaign ? initialFilters.selectedCampaign : 'ALL')
      setFilterForm(initialFilters.selectedForm ? initialFilters.selectedForm : 'ALL')
      setFilterCsvAudience(initialFilters.selectedCsvAudience ? initialFilters.selectedCsvAudience : 'ALL')
      setFilterDnp(initialFilters.selectedDnpFilter || 'ALL')
      setFilterNextAction(initialFilters.selectedNextActionFilter || 'ALL')
      setFilterNextActionType(initialFilters.selectedNextActionType || 'ALL')
      setFilterSearch(initialFilters.searchQuery || '')
    }
  }

  // Resolve Field Value Helper for CSV Row
  const resolveFieldValue = (lead: any, fieldId: string): string => {
    let cf: any = lead.custom_fields
    if (typeof cf === 'string') {
      try {
        while (typeof cf === 'string') cf = JSON.parse(cf)
      } catch (e) {}
    }

    switch (fieldId) {
      case 'name':
        return lead.name || ''
      case 'phone': {
        const p = lead.phone || ''
        // Ensure phone starts with quote or is clean format so Excel doesn't scramble it
        return p
      }
      case 'email':
        return lead.email || ''
      case 'pipeline_stage':
        return lead.pipeline_stage || lead.status || 'New Lead'
      case 'assigned_to_name': {
        if (!lead.assigned_to) return 'Unassigned'
        const member = team.find(m => m.id === lead.assigned_to)
        return member?.business_name || member?.full_name || member?.email || 'Assigned Agent'
      }
      case 'created_at': {
        const d = lead.facebook_created_at || lead.created_at
        if (!d) return ''
        try {
          const dateObj = new Date(d)
          return isNaN(dateObj.getTime()) ? d : dateObj.toLocaleString('en-IN')
        } catch (e) {
          return d
        }
      }
      case 'source':
        return lead.source || (lead.form_name ? 'Meta Lead Ads' : 'CRM')
      case 'campaign_name': {
        const origin = cf?.meta_ad_origin || {}
        
        let campaignName = ''
        if (lead.campaign_id) {
          const matchedCamp = campaigns.find(c => c.id === lead.campaign_id)
          if (matchedCamp?.name) campaignName = matchedCamp.name
        }
        if (!campaignName) {
          campaignName = origin.campaign_name || lead.campaign_name || cf?.campaign_name || ''
        }

        const adsetName = origin.adset_name || lead.adset_name || cf?.adset_name || ''
        const adName = origin.ad_name || origin.headline || lead.ad_name || cf?.ad_name || cf?.referral_ad_title || ''

        const parts: string[] = []
        if (campaignName) parts.push(`Campaign: ${campaignName}`)
        if (adsetName) parts.push(`AdSet: ${adsetName}`)
        if (adName && adName.trim().toLowerCase() !== campaignName.trim().toLowerCase()) {
          parts.push(`Ad: ${adName}`)
        }

        if (parts.length > 0) return parts.join(' | ')

        const fallback = getLeadCampaignName(lead) || lead.ad_name || lead.campaign_name || ''
        return fallback ? `Campaign: ${fallback}` : ''
      }
      case 'campaign_only': {
        const origin = cf?.meta_ad_origin || {}
        let campaignName = ''
        if (lead.campaign_id) {
          const matchedCamp = campaigns.find(c => c.id === lead.campaign_id)
          if (matchedCamp?.name) campaignName = matchedCamp.name
        }
        if (!campaignName) {
          campaignName = origin.campaign_name || lead.campaign_name || cf?.campaign_name || ''
        }
        return campaignName || getLeadCampaignName(lead) || lead.campaign_name || ''
      }
      case 'adset_name': {
        const origin = cf?.meta_ad_origin || {}
        return origin.adset_name || lead.adset_name || cf?.adset_name || ''
      }
      case 'ad_name': {
        const origin = cf?.meta_ad_origin || {}
        return origin.ad_name || origin.headline || lead.ad_name || cf?.ad_name || cf?.referral_ad_title || ''
      }
      case 'form_name':
        return lead.form_name || cf?.form_name || ''
      case 'next_followup': {
        const d = lead.next_action_date || lead.next_followup || cf?.next_action_date
        if (!d) return ''
        try {
          const dateObj = new Date(d)
          return isNaN(dateObj.getTime()) ? d : dateObj.toLocaleString('en-IN')
        } catch (e) {
          return d
        }
      }
      case 'next_action_type':
        return lead.next_action_type || cf?.next_action_type || lead.last_followup_type || ''
      case 'dnp_count':
        return String(lead.dnp_count || cf?.dnp_count || 0)
      case 'budget':
        return lead.budget || cf?.budget || ''
      case 'location':
        return cf?.location || cf?.city || cf?.area || ''
      case 'notes':
        return lead.notes || cf?.notes || cf?.latest_call_notes || ''
      case 'booked_time': {
        const b = lead.booked_time || cf?.booked_time || cf?.appointment_time
        if (!b) return ''
        try {
          const dateObj = new Date(b)
          return isNaN(dateObj.getTime()) ? b : dateObj.toLocaleString('en-IN')
        } catch (e) {
          return b
        }
      }
      case 'csv_audience':
        return lead.csv_audience || ''
      case 'whatsapp_enabled':
        return lead.whatsapp_enabled ? 'Yes' : 'No'
      case 'custom_fields':
        return cf ? JSON.stringify(cf) : ''
      case 'id':
        return lead.id || ''
      default:
        return lead[fieldId] !== undefined ? String(lead[fieldId]) : ''
    }
  }

  // CSV Exporter
  const handleExecuteDownload = () => {
    if (selectedFields.length === 0) {
      toast.error('Please select at least one field to export.')
      return
    }

    if (finalExportLeads.length === 0) {
      toast.error('No leads found matching your current filter criteria.')
      return
    }

    setIsExporting(true)
    try {
      // Build Headers
      const activeHeaders = AVAILABLE_FIELDS.filter(f => selectedFields.includes(f.id))
      const headerRow = activeHeaders.map(h => `"${h.label.replace(/"/g, '""')}"`).join(',')

      // Build Data Rows
      const dataRows = finalExportLeads.map(lead => {
        return activeHeaders
          .map(h => {
            const rawVal = resolveFieldValue(lead, h.id)
            const cleanVal = String(rawVal ?? '').replace(/"/g, '""')
            // If phone number, prepend tab or wrap in string formula if needed, or standard double quotes
            return `"${cleanVal}"`
          })
          .join(',')
      })

      // Combine with UTF-8 BOM (\uFEFF) for Excel compatibility
      const csvContent = '\uFEFF' + [headerRow, ...dataRows].join('\r\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      const dateStamp = new Date().toISOString().slice(0, 10)
      const timeStamp = new Date().toTimeString().slice(0, 5).replace(':', '')
      const fileName = `Nobogent_CRM_Leads_${dateStamp}_${timeStamp}.csv`

      link.setAttribute('href', url)
      link.setAttribute('download', fileName)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`Successfully exported ${finalExportLeads.length} leads to ${fileName}!`)
      onClose()
    } catch (err: any) {
      console.error('[CSV EXPORT ERROR]', err)
      toast.error('Failed to generate export file: ' + err.message)
    } finally {
      setIsExporting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-3 sm:p-6 pb-24 sm:pb-6 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[86vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* MODAL HEADER */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400 shadow-inner">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black tracking-tight">Export CRM Leads</h3>
                <span className="bg-indigo-500/30 text-indigo-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-indigo-400/20 uppercase tracking-wider">
                  CSV / Excel
                </span>
              </div>
              <p className="text-xs text-slate-300 font-medium mt-0.5">
                Download filtered leads with custom field selection & quantity limits
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* MODAL BODY (SCROLLABLE) */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-800 divide-y divide-slate-100">
          
          {/* SECTION 1: LIVE STATS & QUICK ACTIONS */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-4 py-2 rounded-2xl shadow-xs">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span className="text-xs font-black">
                  {matchingLeads.length.toLocaleString()} Leads match filters
                </span>
              </div>

              {parsedLimit > 0 && parsedLimit < matchingLeads.length && (
                <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 px-3.5 py-2 rounded-2xl text-xs font-black">
                  <Hash size={14} />
                  <span>Limit applied: Exporting top {parsedLimit.toLocaleString()} leads</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetToCurrentCrmView}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/70 border border-indigo-200/70 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                title="Sync modal filters with what's currently active on your CRM screen"
              >
                <Sparkles size={13} />
                <span>Use Current View Filters</span>
              </button>
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200/80 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>Clear Filters</span>
              </button>
            </div>
          </div>

          {/* SECTION 2: FILTERS GRID */}
          <div className="pt-6 space-y-4">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-indigo-600" />
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                1. Filter Leads To Download
              </h4>
            </div>

            {/* Keyword search filter */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search leads by name, phone number, or email..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white pl-10 pr-4 py-2.5 rounded-xl text-xs font-semibold border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              
              {/* Pipeline Stage */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Pipeline Stage
                </label>
                <select
                  value={filterStage}
                  onChange={(e) => setFilterStage(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Pipeline Stages</option>
                  {allStages.map((st, i) => (
                    <option key={i} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Assigned Agent */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Assigned Agent
                </label>
                <select
                  value={filterAgent}
                  onChange={(e) => setFilterAgent(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Team Members</option>
                  <option value="UNASSIGNED">Unassigned Only</option>
                  {team.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.business_name || m.full_name || m.email || 'Team Member'}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Date Range Preset */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Created Date Range
                </label>
                <select
                  value={filterDateRange}
                  onChange={(e) => setFilterDateRange(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Time</option>
                  <option value="TODAY">📅 Created Today</option>
                  <option value="YESTERDAY">📅 Created Yesterday</option>
                  <option value="LAST_7_DAYS">⚡ Last 7 Days</option>
                  <option value="LAST_30_DAYS">🗓️ Last 30 Days</option>
                  <option value="THIS_MONTH">📊 This Month</option>
                  <option value="LAST_MONTH">📊 Last Month</option>
                  <option value="CUSTOM">⚙️ Custom Date Range...</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Custom Date Pickers */}
              {filterDateRange === 'CUSTOM' && (
                <>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 px-3 outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 px-3 outline-none focus:border-indigo-500"
                    />
                  </div>
                </>
              )}

              {/* Campaign / Ad */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Campaign / Ad
                </label>
                <select
                  value={filterCampaign}
                  onChange={(e) => setFilterCampaign(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Campaigns</option>
                  {uniqueCampaigns.map((c, i) => (
                    <option key={i} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Form / Source */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Lead Source / Form
                </label>
                <select
                  value={filterForm}
                  onChange={(e) => setFilterForm(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Sources & Forms</option>
                  {uniqueForms.map((f, i) => (
                    <option key={i} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* CSV Audience Tag */}
              {uniqueCsvAudiences.length > 0 && (
                <div className="relative">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                    CSV Audience
                  </label>
                  <select
                    value={filterCsvAudience}
                    onChange={(e) => setFilterCsvAudience(e.target.value)}
                    className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                  >
                    <option value="ALL">All CSV Audiences</option>
                    {uniqueCsvAudiences.map((a, i) => (
                      <option key={i} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
                </div>
              )}

              {/* DNP Filter */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  DNP (Missed Calls)
                </label>
                <select
                  value={filterDnp}
                  onChange={(e) => setFilterDnp(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All DNP Counts</option>
                  <option value="NO_DNP">No DNP (0 missed)</option>
                  <option value="DNP_ONLY">Any DNP (1+ missed)</option>
                  <option value="DNP_1">1 DNP</option>
                  <option value="DNP_2">2 DNPs</option>
                  <option value="DNP_3PLUS">3+ DNPs</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Next Action Schedule */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Next Action Schedule
                </label>
                <select
                  value={filterNextAction}
                  onChange={(e) => setFilterNextAction(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Next Actions</option>
                  <option value="TODAY">📅 Due Today</option>
                  <option value="OVERDUE">⚠️ Overdue Actions</option>
                  <option value="UPCOMING">⚡ Upcoming / Future</option>
                  <option value="HAS_ACTION">🔔 Any Action Scheduled</option>
                  <option value="NO_ACTION">❌ No Action Scheduled</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

            </div>
          </div>

          {/* SECTION 3: QUANTITY LIMIT SELECTION */}
          <div className="pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Hash size={16} className="text-indigo-600" />
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  2. Number of Leads to Download
                </h4>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">
                Leave blank or 0 to export all matching ({matchingLeads.length.toLocaleString()})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <input
                  type="number"
                  min="0"
                  max={matchingLeads.length || undefined}
                  placeholder={`All (${matchingLeads.length.toLocaleString()} leads)`}
                  value={maxDownloadLimit}
                  onChange={(e) => setMaxDownloadLimit(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 px-3 outline-none focus:border-indigo-500"
                />
              </div>

              {/* Quick limit chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMaxDownloadLimit('')}
                  className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                    !maxDownloadLimit
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/80'
                  }`}
                >
                  All ({matchingLeads.length.toLocaleString()})
                </button>
                {[50, 100, 250, 500, 1000].map((count) => {
                  if (count > matchingLeads.length && matchingLeads.length > 0 && count > 100) return null
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setMaxDownloadLimit(String(count))}
                      className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                        maxDownloadLimit === String(count)
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200/80'
                      }`}
                    >
                      Top {count}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* SECTION 4: SELECT FIELDS TO INCLUDE */}
          <div className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-indigo-600" />
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  3. Select Fields to Include in CSV
                </h4>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold text-slate-400">
                  {selectedFields.length} of {AVAILABLE_FIELDS.length} fields selected
                </span>
                <button
                  type="button"
                  onClick={handleToggleAllFields}
                  className="text-xs font-black text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100/80 border border-indigo-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {selectedFields.length === AVAILABLE_FIELDS.length ? (
                    <>
                      <Square size={13} /> Deselect All
                    </>
                  ) : (
                    <>
                      <CheckSquare size={13} /> Select All
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Checkbox grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80">
              {AVAILABLE_FIELDS.map((field) => {
                const isChecked = selectedFields.includes(field.id)
                return (
                  <label
                    key={field.id}
                    onClick={() => toggleField(field.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none ${
                      isChecked
                        ? 'bg-white border-indigo-300 text-indigo-950 shadow-xs ring-1 ring-indigo-500/10'
                        : 'bg-white/60 border-slate-200/70 text-slate-500 hover:bg-white hover:text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}} // Handled by label click
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 pointer-events-none"
                    />
                    <span className="truncate">{field.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

        </div>

        {/* MODAL FOOTER */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 font-semibold text-center sm:text-left">
            Ready to download{' '}
            <strong className="text-slate-900 font-black">{finalExportLeads.length.toLocaleString()}</strong> leads with{' '}
            <strong className="text-slate-900 font-black">{selectedFields.length}</strong> columns.
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExecuteDownload}
              disabled={isExporting || finalExportLeads.length === 0 || selectedFields.length === 0}
              className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl text-xs font-black bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-500 hover:to-blue-500 shadow-md shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={15} />
              <span>{isExporting ? 'Exporting...' : `Download CSV (${finalExportLeads.length.toLocaleString()})`}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
