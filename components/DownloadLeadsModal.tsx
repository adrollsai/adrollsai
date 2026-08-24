'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
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
  ChevronDown,
  Megaphone,
  FileText,
  UserCheck,
  Check
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

interface SearchableOption {
  id: string
  label: string
  count?: number
  subLabel?: string
}

interface SearchableMultiSelectProps {
  label: string
  icon?: any
  options: SearchableOption[]
  selectedValues: string[]
  onChange: (values: string[]) => void
  allOptionLabel: string
  placeholder?: string
}

function SearchableMultiSelect({
  label,
  icon: Icon,
  options,
  selectedValues,
  onChange,
  allOptionLabel,
  placeholder = 'Search options...'
}: SearchableMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const isAllSelected = selectedValues.includes('ALL') || selectedValues.length === 0 || (options.length > 0 && selectedValues.length === options.length)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options
    const q = search.toLowerCase().trim()
    return options.filter(
      opt => opt.label.toLowerCase().includes(q) || (opt.subLabel && opt.subLabel.toLowerCase().includes(q))
    )
  }, [options, search])

  const toggleOption = (id: string) => {
    if (id === 'ALL') {
      onChange(['ALL'])
      return
    }
    let current = selectedValues.filter(v => v !== 'ALL')
    if (current.includes(id)) {
      current = current.filter(v => v !== id)
      if (current.length === 0) {
        onChange(['ALL'])
      } else {
        onChange(current)
      }
    } else {
      current.push(id)
      if (current.length === options.length) {
        onChange(['ALL'])
      } else {
        onChange(current)
      }
    }
  }

  const handleSelectAllFiltered = () => {
    if (!search.trim()) {
      onChange(['ALL'])
    } else {
      const filteredIds = filteredOptions.map(o => o.id)
      const current = selectedValues.filter(v => v !== 'ALL')
      const merged = Array.from(new Set([...current, ...filteredIds]))
      if (merged.length >= options.length) {
        onChange(['ALL'])
      } else {
        onChange(merged)
      }
    }
  }

  const handleClear = () => {
    onChange(['ALL'])
  }

  // Summary Text
  let summaryText = allOptionLabel
  if (!isAllSelected) {
    if (selectedValues.length === 1) {
      const match = options.find(o => o.id === selectedValues[0])
      summaryText = match ? match.label : selectedValues[0]
    } else {
      summaryText = `${selectedValues.length} Selected`
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1">
          {Icon && <Icon size={12} className="text-slate-400 shrink-0" />}
          <span className="truncate">{label}</span>
        </span>
        {!isAllSelected && (
          <span className="text-[9px] font-black text-indigo-700 bg-indigo-100 px-1.5 py-0.2 rounded-md shrink-0">
            {selectedValues.length} active
          </span>
        )}
      </label>

      {/* TRIGGER BUTTON */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full text-left border text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 transition-all flex items-center justify-between cursor-pointer ${
          !isAllSelected 
            ? 'border-indigo-300 bg-indigo-50/70 text-indigo-950 ring-1 ring-indigo-500/20 shadow-xs' 
            : 'border-slate-200 bg-slate-50 hover:bg-slate-100/80 text-slate-800'
        }`}
      >
        <span className="truncate pr-2">{summaryText}</span>
        <ChevronDown 
          size={14} 
          className={`text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180 text-indigo-600' : ''}`} 
        />
      </button>

      {/* DROPDOWN POPOVER */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-2.5 animate-in fade-in zoom-in-95 duration-150 min-w-[260px]">
          
          {/* SEARCH INPUT */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
            <input
              type="text"
              autoFocus
              placeholder={placeholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white pl-8 pr-7 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 focus:border-indigo-500 outline-none"
            />
            {search && (
              <button 
                type="button" 
                onClick={() => setSearch('')} 
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* ACTION BAR */}
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-100 text-[10px] font-bold text-slate-500 px-1">
            <span>{filteredOptions.length} of {options.length} options</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-indigo-600 hover:text-indigo-800 hover:underline font-extrabold cursor-pointer"
              >
                Select All
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={handleClear}
                className="text-slate-400 hover:text-slate-600 hover:underline cursor-pointer"
              >
                Reset
              </button>
            </div>
          </div>

          {/* OPTIONS LIST */}
          <div className="max-h-52 overflow-y-auto space-y-0.5 scrollbar-thin">
            {/* "ALL" OPTION */}
            {!search.trim() && (
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  toggleOption('ALL')
                }}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer select-none ${
                  isAllSelected ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                  isAllSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs' : 'border-slate-300 bg-white'
                }`}>
                  {isAllSelected && <Check size={11} strokeWidth={3.5} />}
                </div>
                <span className="truncate">{allOptionLabel}</span>
              </div>
            )}

            {/* FILTERED OPTIONS */}
            {filteredOptions.length === 0 ? (
              <div className="text-center py-4 text-xs text-slate-400 font-semibold">
                No matching options found
              </div>
            ) : (
              filteredOptions.map(opt => {
                const isChecked = !isAllSelected && selectedValues.includes(opt.id)
                return (
                  <div
                    key={opt.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      toggleOption(opt.id)
                    }}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer select-none ${
                      isChecked
                        ? 'bg-indigo-50/80 font-black text-indigo-950'
                        : 'font-semibold text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate min-w-0">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                        isChecked ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs' : 'border-slate-300 bg-white'
                      }`}>
                        {isChecked && <Check size={11} strokeWidth={3.5} />}
                      </div>
                      <div className="truncate">
                        <span className="truncate block">{opt.label}</span>
                        {opt.subLabel && (
                          <span className="text-[10px] text-slate-400 font-normal truncate block">{opt.subLabel}</span>
                        )}
                      </div>
                    </div>
                    {opt.count !== undefined && (
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full shrink-0">
                        {opt.count}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>

        </div>
      )}
    </div>
  )
}

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
  // Multi-select Filter States inside Modal
  const [filterStages, setFilterStages] = useState<string[]>(['ALL'])
  const [filterAgents, setFilterAgents] = useState<string[]>(['ALL'])
  const [filterCampaigns, setFilterCampaigns] = useState<string[]>(['ALL'])
  const [filterForms, setFilterForms] = useState<string[]>(['ALL'])
  const [filterCsvAudience, setFilterCsvAudience] = useState<string>('ALL')

  // Date & other filter states
  const [filterDateRange, setFilterDateRange] = useState<string>('ALL')
  const [filterStartDate, setFilterStartDate] = useState<string>('')
  const [filterEndDate, setFilterEndDate] = useState<string>('')
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
        setFilterStages(initialFilters.selectedSpecificStage && initialFilters.selectedSpecificStage !== 'ALL' && initialFilters.selectedSpecificStage !== 'All Leads' ? [initialFilters.selectedSpecificStage] : ['ALL'])
        setFilterAgents(initialFilters.selectedAgentFilter && initialFilters.selectedAgentFilter !== 'ALL' ? [initialFilters.selectedAgentFilter] : ['ALL'])
        setFilterCampaigns(initialFilters.selectedCampaign && initialFilters.selectedCampaign !== 'ALL' ? [initialFilters.selectedCampaign] : ['ALL'])
        setFilterForms(initialFilters.selectedForm && initialFilters.selectedForm !== 'ALL' ? [initialFilters.selectedForm] : ['ALL'])
        setFilterDateRange(initialFilters.selectedDateRange || 'ALL')
        setFilterStartDate(initialFilters.crmStartDate || '')
        setFilterEndDate(initialFilters.crmEndDate || '')
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
    const list: string[] = []
    leads.forEach(l => {
      const campName = getLeadCampaignName(l)
      if (campName && campName.trim()) list.push(campName.trim())
      if (l.ad_name && l.ad_name.trim()) list.push(l.ad_name.trim())
      if (l.campaign_name && l.campaign_name.trim()) list.push(l.campaign_name.trim())
    })
    return Array.from(new Set(list)).filter(c => c && c !== 'null' && c !== 'undefined').sort()
  }, [leads, getLeadCampaignName])

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

  // Prepare searchable option lists with counts
  const stageOptions = useMemo<SearchableOption[]>(() => {
    return allStages.map(st => {
      const sLower = st.toLowerCase()
      const count = leads.filter(l => {
        const leadStatus = (l.status || '').toLowerCase().trim()
        const leadStage = (l.pipeline_stage || '').toLowerCase().trim()
        return leadStatus === sLower || leadStage === sLower || (
          sLower === 'new lead' && ['new lead', 'new', 'fresh', 'uncontacted', ''].includes(leadStatus || leadStage)
        ) || (
          sLower === 'requirement taken' && ['requirement taken', 'requirement', 'contacted', 'qualified'].includes(leadStatus || leadStage)
        ) || (
          sLower === 'visit done' && ['visit done', 'visited', 'site visit done'].includes(leadStatus || leadStage)
        ) || (
          sLower === 'lost/ni' && ['lost/ni', 'lost', 'ni', 'not interested', 'unqualified'].includes(leadStatus || leadStage)
        )
      }).length
      return { id: st, label: st, count }
    })
  }, [allStages, leads])

  const agentOptions = useMemo<SearchableOption[]>(() => {
    const unassignedCount = leads.filter(l => !l.assigned_to).length
    const list: SearchableOption[] = [
      { id: 'UNASSIGNED', label: 'Unassigned Leads', count: unassignedCount }
    ]
    team.forEach(m => {
      const count = leads.filter(l => l.assigned_to === m.id).length
      list.push({
        id: m.id,
        label: m.business_name || m.full_name || m.email || 'Team Member',
        subLabel: m.email || '',
        count
      })
    })
    return list
  }, [team, leads])

  const campaignOptions = useMemo<SearchableOption[]>(() => {
    return uniqueCampaigns.map(c => {
      const target = c.trim().toLowerCase()
      const count = leads.filter(l => {
        const leadCamp = (getLeadCampaignName(l) || '').trim().toLowerCase()
        const adName = (l.ad_name || '').trim().toLowerCase()
        const campName = (l.campaign_name || '').trim().toLowerCase()
        return leadCamp === target || adName === target || campName === target
      }).length
      return { id: c, label: c, count }
    })
  }, [uniqueCampaigns, leads, getLeadCampaignName])

  const formOptions = useMemo<SearchableOption[]>(() => {
    return uniqueForms.map(f => {
      const target = f.trim().toLowerCase()
      const count = leads.filter(l => {
        const fName = (l.form_name || '').trim().toLowerCase()
        const src = (l.source || '').trim().toLowerCase()
        return fName === target || src === target
      }).length
      return { id: f, label: f, count }
    })
  }, [uniqueForms, leads])

  // Filter matching leads computation (Optimized in-memory filtering)
  const matchingLeads = useMemo(() => {
    if (!leads || leads.length === 0) return []

    const isAllAgents = filterAgents.includes('ALL') || filterAgents.length === 0
    const isAllStages = filterStages.includes('ALL') || filterStages.length === 0
    const isAllCampaigns = filterCampaigns.includes('ALL') || filterCampaigns.length === 0
    const isAllForms = filterForms.includes('ALL') || filterForms.length === 0

    return leads.filter(l => {
      // 1. Search Query
      if (filterSearch.trim()) {
        const q = filterSearch.toLowerCase().trim()
        const matchName = l.name?.toLowerCase().includes(q)
        const matchPhone = l.phone?.includes(q)
        const matchEmail = l.email?.toLowerCase().includes(q)
        if (!matchName && !matchPhone && !matchEmail) return false
      }

      // 2. Assigned Agent Multi-Select
      if (!isAllAgents) {
        if (!l.assigned_to) {
          if (!filterAgents.includes('UNASSIGNED')) return false
        } else {
          if (!filterAgents.includes(l.assigned_to)) return false
        }
      }

      // 3. Pipeline Stage Multi-Select
      if (!isAllStages) {
        const leadStatus = (l.status || '').toLowerCase().trim()
        const leadStage = (l.pipeline_stage || '').toLowerCase().trim()
        const stageMatch = filterStages.some(st => {
          const sLower = st.toLowerCase()
          return leadStatus === sLower || leadStage === sLower || (
            sLower === 'new lead' && ['new lead', 'new', 'fresh', 'uncontacted', ''].includes(leadStatus || leadStage)
          ) || (
            sLower === 'requirement taken' && ['requirement taken', 'requirement', 'contacted', 'qualified'].includes(leadStatus || leadStage)
          ) || (
            sLower === 'visit done' && ['visit done', 'visited', 'site visit done'].includes(leadStatus || leadStage)
          ) || (
            sLower === 'lost/ni' && ['lost/ni', 'lost', 'ni', 'not interested', 'unqualified'].includes(leadStatus || leadStage)
          )
        })
        if (!stageMatch) return false
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

      // 5. Campaign Multi-Select Filter
      if (!isAllCampaigns) {
        const leadCamp = (getLeadCampaignName(l) || '').trim().toLowerCase()
        const adName = (l.ad_name || '').trim().toLowerCase()
        const campName = (l.campaign_name || '').trim().toLowerCase()
        const campMatch = filterCampaigns.some(c => {
          const target = c.trim().toLowerCase()
          return leadCamp === target || adName === target || campName === target
        })
        if (!campMatch) return false
      }

      // 6. Form / Source Multi-Select Filter
      if (!isAllForms) {
        const fName = (l.form_name || '').trim().toLowerCase()
        const src = (l.source || '').trim().toLowerCase()
        const formMatch = filterForms.some(f => {
          const target = f.trim().toLowerCase()
          return fName === target || src === target
        })
        if (!formMatch) return false
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
    filterAgents,
    filterStages,
    filterDateRange,
    filterStartDate,
    filterEndDate,
    filterCampaigns,
    filterForms,
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
    setFilterStages(['ALL'])
    setFilterAgents(['ALL'])
    setFilterDateRange('ALL')
    setFilterStartDate('')
    setFilterEndDate('')
    setFilterCampaigns(['ALL'])
    setFilterForms(['ALL'])
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
      setFilterStages(initialFilters.selectedSpecificStage && initialFilters.selectedSpecificStage !== 'ALL' && initialFilters.selectedSpecificStage !== 'All Leads' ? [initialFilters.selectedSpecificStage] : ['ALL'])
      setFilterAgents(initialFilters.selectedAgentFilter && initialFilters.selectedAgentFilter !== 'ALL' ? [initialFilters.selectedAgentFilter] : ['ALL'])
      setFilterCampaigns(initialFilters.selectedCampaign && initialFilters.selectedCampaign !== 'ALL' ? [initialFilters.selectedCampaign] : ['ALL'])
      setFilterForms(initialFilters.selectedForm && initialFilters.selectedForm !== 'ALL' ? [initialFilters.selectedForm] : ['ALL'])
      setFilterDateRange(initialFilters.selectedDateRange || 'ALL')
      setFilterStartDate(initialFilters.crmStartDate || '')
      setFilterEndDate(initialFilters.crmEndDate || '')
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
        return lead.phone || ''
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

      // Build Data Rows with Excel scientific notation protection
      const dataRows = finalExportLeads.map(lead => {
        return activeHeaders
          .map(h => {
            const rawVal = resolveFieldValue(lead, h.id)
            const strVal = String(rawVal ?? '')

            // Phone Number protection: format as Excel formula string ="917350604412"
            // This prevents Excel from converting 10-12 digit numbers to scientific notation (9.17E+11)
            if (h.id === 'phone') {
              const cleanPhone = strVal.trim()
              if (!cleanPhone) return '""'
              return `"=""${cleanPhone.replace(/"/g, '""')}"""`
            }

            // Standard CSV cell formatting with escaped quotes
            return `"${strVal.replace(/"/g, '""')}"`
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
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-2 sm:p-6 pb-28 sm:pb-6 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white w-full max-w-4xl rounded-3xl sm:rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh] sm:max-h-[86vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* MODAL HEADER */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400 shadow-inner shrink-0">
              <FileSpreadsheet size={20} className="sm:w-[22px] sm:h-[22px]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black tracking-tight truncate">Export CRM Leads</h3>
                <span className="bg-indigo-500/30 text-indigo-300 text-[9px] sm:text-[10px] font-extrabold px-2 sm:px-2.5 py-0.5 rounded-full border border-indigo-400/20 uppercase tracking-wider shrink-0">
                  CSV / Excel
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-300 font-medium mt-0.5 truncate">
                Download filtered leads with custom field selection & quantity limits
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 ml-2"
          >
            <X size={16} className="sm:w-[18px] sm:h-[18px]" />
          </button>
        </div>

        {/* MODAL BODY (SCROLLABLE) */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 sm:space-y-6 text-slate-800 divide-y divide-slate-100">
          
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
              
              {/* Pipeline Stage Multi-Select with Search */}
              <SearchableMultiSelect
                label="Pipeline Stage"
                icon={Layers}
                options={stageOptions}
                selectedValues={filterStages}
                onChange={setFilterStages}
                allOptionLabel="All Pipeline Stages"
                placeholder="Search pipeline stages..."
              />

              {/* Assigned Agent Multi-Select with Search */}
              <SearchableMultiSelect
                label="Assigned Agent"
                icon={UserCheck}
                options={agentOptions}
                selectedValues={filterAgents}
                onChange={setFilterAgents}
                allOptionLabel="All Team Members"
                placeholder="Search teammates by name or email..."
              />

              {/* Campaign Multi-Select with Search */}
              <SearchableMultiSelect
                label="Campaign / Ad"
                icon={Megaphone}
                options={campaignOptions}
                selectedValues={filterCampaigns}
                onChange={setFilterCampaigns}
                allOptionLabel="All Campaigns & Ads"
                placeholder="Search campaigns & ads..."
              />

              {/* Form / Source Multi-Select with Search */}
              <SearchableMultiSelect
                label="Lead Source / Form"
                icon={FileText}
                options={formOptions}
                selectedValues={filterForms}
                onChange={setFilterForms}
                allOptionLabel="All Sources & Forms"
                placeholder="Search lead forms & sources..."
              />

              {/* Date Range Preset */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Calendar size={12} className="text-slate-400 shrink-0" />
                  <span>Created Date Range</span>
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

              {/* DNP / Call Status */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  DNP (Missed Call) Status
                </label>
                <select
                  value={filterDnp}
                  onChange={(e) => setFilterDnp(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Leads (No DNP Filter)</option>
                  <option value="NO_DNP">✅ Clean Leads (0 DNPs)</option>
                  <option value="DNP_ONLY">⚠️ Any DNP (1+ Missed Calls)</option>
                  <option value="DNP_1">1 DNP</option>
                  <option value="DNP_2">2 DNPs</option>
                  <option value="DNP_3PLUS">3+ DNPs</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Next Action Scheduled Filter */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Scheduled Next Action
                </label>
                <select
                  value={filterNextAction}
                  onChange={(e) => setFilterNextAction(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Leads</option>
                  <option value="TODAY">⏰ Action Due Today</option>
                  <option value="OVERDUE">🚨 Overdue Actions</option>
                  <option value="UPCOMING">📅 Upcoming Actions</option>
                  <option value="HAS_ACTION">📌 Has Any Scheduled Action</option>
                  <option value="NO_ACTION">⚪ No Scheduled Action</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

              {/* Next Action Type Filter */}
              <div className="relative">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                  Action Type
                </label>
                <select
                  value={filterNextActionType}
                  onChange={(e) => setFilterNextActionType(e.target.value)}
                  className="w-full appearance-none bg-slate-50 hover:bg-slate-100/70 border border-slate-200 text-slate-800 text-xs font-bold rounded-xl py-2.5 pl-3 pr-8 outline-none focus:border-indigo-500 cursor-pointer truncate"
                >
                  <option value="ALL">All Action Types</option>
                  <option value="Call">📞 Call</option>
                  <option value="Meeting">🤝 Meeting</option>
                  <option value="Visit">🏡 Site Visit</option>
                  <option value="Follow-up">💬 Follow-up</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
              </div>

            </div>
          </div>

          {/* SECTION 3: QUANTITY LIMIT SELECTION */}
          <div className="pt-6 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <Hash size={16} className="text-indigo-600" />
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  2. Number of Leads to Download
                </h4>
              </div>
              <span className="text-[11px] font-medium text-slate-400">
                Leave blank or 0 to export all matching ({matchingLeads.length.toLocaleString()})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="number"
                min="0"
                max={matchingLeads.length}
                placeholder={`All (${matchingLeads.length.toLocaleString()} leads)`}
                value={maxDownloadLimit}
                onChange={(e) => setMaxDownloadLimit(e.target.value)}
                className="w-48 bg-slate-50 hover:bg-slate-100/50 focus:bg-white px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 focus:border-indigo-500 outline-none transition-all"
              />

              {/* Quick Limit Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMaxDownloadLimit('')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    !maxDownloadLimit
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  All ({matchingLeads.length.toLocaleString()})
                </button>
                {[50, 100, 250, 500, 1000].map(qty => {
                  if (qty > matchingLeads.length && matchingLeads.length > 0) return null
                  const isSelected = parsedLimit === qty
                  return (
                    <button
                      key={qty}
                      type="button"
                      onClick={() => setMaxDownloadLimit(String(qty))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                      }`}
                    >
                      Top {qty.toLocaleString()}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* SECTION 4: FIELD SELECTION MULTI-CHECKBOXES */}
          <div className="pt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
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
                  className="text-xs font-extrabold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {selectedFields.length === AVAILABLE_FIELDS.length ? (
                    <>
                      <Square size={13} />
                      <span>Deselect All</span>
                    </>
                  ) : (
                    <>
                      <CheckSquare size={13} />
                      <span>Select All</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Fields Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-2.5 p-2.5 sm:p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80">
              {AVAILABLE_FIELDS.map((field) => {
                const isChecked = selectedFields.includes(field.id)
                return (
                  <div
                    key={field.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      toggleField(field.id)
                    }}
                    className={`flex items-center gap-2.5 p-2 sm:p-2.5 rounded-xl border text-xs font-bold transition-all select-none cursor-pointer ${
                      isChecked
                        ? 'bg-white border-indigo-300 text-indigo-950 shadow-xs ring-1 ring-indigo-500/10'
                        : 'bg-white/60 border-slate-200/70 text-slate-500 hover:bg-white hover:text-slate-700'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                      isChecked ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs' : 'border-slate-300 bg-white'
                    }`}>
                      {isChecked && <Check size={11} strokeWidth={3.5} />}
                    </div>
                    <span className="truncate">{field.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* MODAL FOOTER */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 font-semibold text-center sm:text-left w-full sm:w-auto">
            Ready to download{' '}
            <strong className="text-slate-900 font-black">{finalExportLeads.length.toLocaleString()}</strong> leads with{' '}
            <strong className="text-slate-900 font-black">{selectedFields.length}</strong> columns.
          </div>

          <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 transition-all cursor-pointer text-center"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExecuteDownload}
              disabled={isExporting || finalExportLeads.length === 0 || selectedFields.length === 0}
              className="flex-2 sm:flex-initial px-5 sm:px-6 py-2.5 rounded-xl text-xs font-black bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-500 hover:to-blue-500 shadow-md shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-center"
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
