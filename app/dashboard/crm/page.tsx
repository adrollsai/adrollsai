'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
  Search, Phone, MessageCircle, RefreshCw, Upload, 
  Plus, CheckCircle2, X, Download, Trash2, UserPlus, 
  Clock, Bell, Users, Shuffle, Mail, Tag, Loader2, Filter, ChevronDown, ChevronUp, SlidersHorizontal, FileText, Send, HelpCircle, Target, Calendar,
  LayoutGrid, List, PhoneCall, PhoneOff, RotateCcw, History
} from 'lucide-react'
import { getPropertyDisplayLabel } from '@/utils/property-helper'
import { createClient } from '@/utils/supabase/client'
import TestNotificationBtn from '@/components/TestNotificationBtn'
import { toast } from 'sonner'
import WhatsAppTemplateMediaPicker from '@/components/WhatsAppTemplateMediaPicker'
import CallFeedbackModal from '@/components/CallFeedbackModal'
import UpdateFollowupModal from '@/components/UpdateFollowupModal'
import LeadHistoryModal from '@/components/LeadHistoryModal'
import GroupLeadDistributionModal from '@/components/GroupLeadDistributionModal'
import { syncAndroidCallLogs } from '@/utils/callTracking'

import { getLocalCache, setLocalCache, mergeCacheData, getMaxCreatedAt } from '@/utils/client-cache'

const STAGES = [
  'All Leads',
  'New Lead',
  'Ongoing',
  'Requirement Taken',
  'Appointment Booked',
  'Visit Planned',
  'Visit Done',
  'Revisit Done',
  'Negotiation',
  'Deal/Token',
  'Lost/NI',
  'Different Requirement'
]


function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) { 
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatCallPhone(phoneRaw: string | null | undefined): string {
  if (!phoneRaw) return '';
  let clean = phoneRaw.trim();
  if (clean.startsWith('+')) return clean;
  let digits = clean.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.substring(1);
  }
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export default function CRMPage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  
  // --- ROLE & HIERARCHY STATE ---
  const [role, setRole] = useState<'super_admin' | 'agency' | 'client' | 'admin' | 'agent'>('admin')
  const [team, setTeam] = useState<any[]>([])
  const [parentAdminId, setParentAdminId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)
  const [autoCallNewLeads, setAutoCallNewLeads] = useState(false)

  const isAdminLike = ['super_admin', 'agency', 'admin', 'client', 'agent'].includes(role)

  // --- CRM STATE ---
  const [leads, setLeads] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = getLocalCache<any>('crm_last_leads_cache')
      if (cached && Array.isArray(cached) && cached.length > 0) return cached
    }
    return []
  })
  const [totalLeadsCount, setTotalLeadsCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const cached = getLocalCache<any>('crm_last_leads_cache')
      if (cached && Array.isArray(cached) && cached.length > 0) return cached.length
    }
    return 0
  })
  const [properties, setProperties] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = getLocalCache<any>('crm_properties_cache')
      if (cached && Array.isArray(cached) && cached.length > 0) return cached
    }
    return []
  })
  const [campaigns, setCampaigns] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = getLocalCache<any>('crm_campaigns_cache')
      if (cached && Array.isArray(cached) && cached.length > 0) return cached
    }
    return []
  })
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const cached = getLocalCache<any>('crm_last_leads_cache')
      if (cached && Array.isArray(cached) && cached.length > 0) return false
    }
    return true
  })
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSyncingCalls, setIsSyncingCalls] = useState(false)
  const [showMobileCrmActions, setShowMobileCrmActions] = useState(false)
  const [enableDistribution, setEnableDistribution] = useState(false)
  const [assignedCampaigns, setAssignedCampaigns] = useState<string[]>([])
  const [activeMediaModal, setActiveMediaModal] = useState<any>(null)

  // --- FILTER STATE ---
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [activeStage, setActiveStageState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('crm_stage')
      if (saved && STAGES.includes(saved)) return saved
      if (saved === 'New') return 'New Lead'
      if (saved === 'Appointment booked') return 'Appointment Booked'
      if (saved === 'Appointment done') return 'Visit Done'
      return saved || 'New Lead'
    }
    return 'New Lead'
  })
  
  const setActiveStage = (stage: string) => {
    setActiveStageState(stage)
    setCurrentPageState(1)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('crm_stage', stage)
      sessionStorage.setItem('crm_page', '1')
    }
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [selectedForm, setSelectedForm] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [isMobileControlsCollapsed, setIsMobileControlsCollapsed] = useState(true)

  // --- VIEW MODE & DNP MANAGER STATE ---
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('crm_view_mode') as 'cards' | 'table') || 'cards'
    }
    return 'cards'
  })

  const setViewModeState = (mode: 'cards' | 'table') => {
    setViewMode(mode)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('crm_view_mode', mode)
    }
  }

  const [selectedDnpFilter, setSelectedDnpFilter] = useState<'ALL' | 'DNP_ONLY' | 'DNP_1' | 'DNP_2' | 'DNP_3PLUS' | 'NO_DNP'>('ALL')
  const [selectedNextActionFilter, setSelectedNextActionFilter] = useState<'ALL' | 'HAS_ACTION' | 'TODAY' | 'OVERDUE' | 'UPCOMING' | 'NO_ACTION'>('ALL')
  const [selectedNextActionType, setSelectedNextActionType] = useState<string>('ALL')
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('ALL')
  const [selectedDateRange, setSelectedDateRange] = useState<string>('ALL')
  const [selectedCsvAudience, setSelectedCsvAudience] = useState<string>('')
  const [callFeedbackLead, setCallFeedbackLead] = useState<any>(null)
  const [updateFollowupLead, setUpdateFollowupLead] = useState<any>(null)
  const [historyLead, setHistoryLead] = useState<any>(null)
  const [isGroupDistributionModalOpen, setIsGroupDistributionModalOpen] = useState(false)
  
  const [currentPage, setCurrentPageState] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = sessionStorage.getItem('crm_page')
      return p ? parseInt(p, 10) : 1
    }
    return 1
  })
  
  const setCurrentPage = (page: number) => {
    setCurrentPageState(page)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('crm_page', page.toString())
    }
  }

  const [pageInputVal, setPageInputVal] = useState(String(currentPage))
  const leadsPerPage = 50
  const isFirstRender = useRef(true)
  const isSearchMounted = useRef(false)

  // Sync page input value when currentPage changes
  useEffect(() => {
    setPageInputVal(currentPage.toString())
  }, [currentPage])

  // --- MODAL STATE ---
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [forms, setForms] = useState<any[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [isLoadingForms, setIsLoadingForms] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [pixels, setPixels] = useState<any[]>([])
  const [isLoadingPixels, setIsLoadingPixels] = useState(false)

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', notes: '' })
  const [isAdding, setIsAdding] = useState(false)
 
  const [isCampaignAssignModalOpen, setIsCampaignAssignModalOpen] = useState(false)
  const [batchCampaign, setBatchCampaign] = useState('')
  const [batchAgentIds, setBatchAgentIds] = useState<string[]>([])
  const [autoAssignFuture, setAutoAssignFuture] = useState(true)
  
  const [isPushEnabled, setIsPushEnabled] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- BULK WHATSAPP STATE ---
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([])
  const [isSendTemplateModalOpen, setIsSendTemplateModalOpen] = useState(false)
  const [approvedTemplates, setApprovedTemplates] = useState<any[]>([])
  const [selectedTemplateName, setSelectedTemplateName] = useState('')
  const [selectedTemplateBody, setSelectedTemplateBody] = useState('')
  const [selectedTemplateLanguage, setSelectedTemplateLanguage] = useState('en_US')
  const [selectedHeaderFormat, setSelectedHeaderFormat] = useState<'IMAGE' | 'VIDEO' | 'DOCUMENT' | null>(null)
  const [selectedHeaderMediaUrl, setSelectedHeaderMediaUrl] = useState('')
  const [isSendingTemplates, setIsSendingTemplates] = useState(false)
  const [isCallingCampaign, setIsCallingCampaign] = useState(false)
  const [templateVarMappings, setTemplateVarMappings] = useState<Record<string, { field: string; customVal: string }>>({})
  const [userBusinessName, setUserBusinessName] = useState('Nobogent')
  const [userRole, setUserRole] = useState<string>('admin')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('profiles').select('role, business_name').eq('id', user.id).single().then(({ data }) => {
          if (data?.role) setUserRole(data.role)
          if (data?.business_name) setUserBusinessName(data.business_name)
        })
      }
    })
  }, [supabase])

  const getDetectedTemplateVars = (bodyText: string): number[] => {
    const matches = bodyText.match(/\{\{(\d+)\}\}/g) || []
    const parsed = matches.map((m: string) => parseInt(m.replace(/\D/g, '')))
    return Array.from<number>(new Set(parsed)).sort((a, b) => a - b)
  }

  const fetchApprovedTemplates = async () => {
    try {
      const res = await fetch('/api/whatsapp/templates')
      const data = await res.json()
      if (data.success) {
        setApprovedTemplates(data.templates || [])
      }
    } catch (e) {
      console.error("Failed to fetch templates:", e)
    }
  }

  useEffect(() => {
    if (isSendTemplateModalOpen) {
      fetchApprovedTemplates()
    }
  }, [isSendTemplateModalOpen])

  const handleBulkSendTemplate = async () => {
    if (!selectedTemplateName) return alert("Please select a template")
    setIsSendingTemplates(true)

    const selectedLeads = leads.filter(l => selectedLeadIds.includes(l.id))
    const detectedVars = getDetectedTemplateVars(selectedTemplateBody)
    
    let sentCount = 0
    let failedCount = 0

    for (const lead of selectedLeads) {
      const displayPhone = lead.phone || lead.custom_fields?.whatsapp_number || lead.custom_fields?.phone_number || '';
      if (!displayPhone) continue

      const parameters = detectedVars.map(vNum => {
        const mapping = templateVarMappings[vNum.toString()] || { 
          field: vNum === 1 ? 'name' : vNum === 2 ? 'property_title' : 'business_name', 
          customVal: '' 
        }
        let val = ''
        if (mapping.field === 'custom') val = mapping.customVal || 'Valued Customer'
        else if (mapping.field === 'name') val = lead.name || 'Valued Customer'
        else if (mapping.field === 'phone') val = lead.phone || ''
        else if (mapping.field === 'email') val = lead.email || ''
        else if (mapping.field === 'property_title') val = lead.custom_fields?.property_title || 'Premium Property'
        else if (mapping.field === 'business_name') val = userBusinessName
        else val = mapping.field || 'Valued Customer'
        
        return { type: 'text', text: val }
      })


      try {
        const res = await fetch('/api/whatsapp/test-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: displayPhone,
            templateName: selectedTemplateName,
            isSandboxTest: selectedTemplateName === 'hello_world',
            parameters,
            headerMediaUrl: selectedHeaderMediaUrl,
            language: selectedTemplateLanguage
          })
        })

        if (res.ok) {
          sentCount++
          await fetch('/api/crm/lead-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: lead.id,
              actionType: 'REMARK',
              description: `💬 Manual WhatsApp template sent: "${selectedTemplateName}"`
            })
          })
        } else {
          failedCount++
        }
      } catch (err) {
        failedCount++
      }
    }

    setIsSendingTemplates(false)
    setIsSendTemplateModalOpen(false)
    setSelectedLeadIds([])
    alert(`WhatsApp blast complete! Sent: ${sentCount}, Failed: ${failedCount}`)
    fetchLeads(true)
  }

  const handleBulkVoiceCampaign = async () => {
    if (selectedLeadIds.length === 0) return
    setIsCallingCampaign(true)
    try {
      const res = await fetch(`/api/voice/call${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: selectedLeadIds })
      })
      const data = await res.json()
      if (data.success) {
        const successes = data.results?.filter((r: any) => r.success).length || 0
        const total = data.results?.length || 0
        alert(`🎙️ AI Voice Agent Campaign triggered! Initiated calls to ${successes}/${total} leads.`)
        setSelectedLeadIds([])
        fetchLeads(true)
      } else {
        alert(data.error || 'Failed to trigger voice campaign.')
      }
    } catch (err: any) {
      alert(err.message || 'An error occurred triggering the campaign.')
    } finally {
      setIsCallingCampaign(false)
    }
  }

  // 1. SAFE FETCH WITH SERVER-SIDE PAGINATION
  const fetchLeads = async (force = false) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // Fetch Fresh Profile Data first to get targetUserId
      const { data: profile } = await supabase.from('profiles').select('role, parent_id, agency_id, business_name, enable_distribution, ad_account_id, auto_call_new_leads').eq('id', user.id).single()
      const currentRole = profile?.role as any || 'admin'
      setRole(currentRole)
      setEnableDistribution(!!profile?.enable_distribution)
      setAutoCallNewLeads(!!profile?.auto_call_new_leads)
      
      const parentId = profile?.parent_id || profile?.agency_id
      if (parentId) setParentAdminId(parentId)

      // Impersonation & Hierarchy Logic
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      let targetUserId = (['admin', 'agent', 'team_member'].includes(currentRole) && (profile?.parent_id || profile?.agency_id)) 
        ? (profile.parent_id || profile.agency_id) 
        : user.id

      if (impersonateId && (['super_admin', 'agency', 'admin'].includes(currentRole))) {
          if (currentRole !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', profile?.agency_id || user.id)
                .single()
              if (subAccount) targetUserId = impersonateId
          } else {
              targetUserId = impersonateId
          }
      }
      setTargetUserId(targetUserId)

      // Fetch user properties for title resolution and manual product assignment via /api/inventory
      try {
        const invRes = await fetch('/api/inventory')
        let invData: any = null
        if (invRes.ok) {
          try { invData = await invRes.json() } catch (e) {}
        }
        if (invData && invData.success && Array.isArray(invData.properties) && invData.properties.length > 0) {
          setProperties(invData.properties)
          setLocalCache('crm_properties_cache', invData.properties)
          try { localStorage.setItem(`properties_cache_${targetUserId}`, JSON.stringify(invData.properties)); } catch(e) {}
        } else {
          const workspaceOwnerIds = Array.from(new Set([targetUserId, parentId, user.id].filter(Boolean)))
          const { data: propsData } = await supabase
            .from('properties')
            .select('id, title, tags, configurations')
            .in('user_id', workspaceOwnerIds)
            .order('created_at', { ascending: false })

          if (propsData && propsData.length > 0) {
            setProperties(propsData)
            try { localStorage.setItem(`properties_cache_${targetUserId}`, JSON.stringify(propsData)); } catch(e) {}
          }
        }
      } catch (e) {}

      // Get campaign assignment rules for agents
      let activeCampaigns: string[] = []
      if (currentRole === 'agent' && parentId) {
          const { data: automations } = await supabase
            .from('automations')
            .select('title, description')
            .eq('user_id', parentId)
            .like('title', 'Campaign-Assignment:%')
            .eq('is_active', true)
          
          if (automations) {
              for (const aut of automations) {
                  try {
                      const agentIds = JSON.parse(aut.description || '[]');
                      if (Array.isArray(agentIds) && agentIds.includes(user.id)) {
                          const campName = aut.title.replace('Campaign-Assignment:', '').trim();
                          activeCampaigns.push(campName);
                      }
                  } catch (e) {}
              }
          }
      }
      setAssignedCampaigns(activeCampaigns)

      // Check local client cache to hydrate CRM pipeline immediately without showing loader spinner
      const cacheKey = `crm_cache_${user.id}_${targetUserId}`;
      const cachedLeads = force ? [] : (getLocalCache<any>(cacheKey) || getLocalCache<any>('crm_last_leads_cache'));

      if (cachedLeads && cachedLeads.length > 0) {
          setLeads(prev => prev.length === 0 ? cachedLeads : prev);
          setLoading(false);
      } else if (leads.length === 0 && !force) {
          setLoading(true);
      }
      if (force) setIsRefreshing(true);

      // Fetch Meta Pixels for target account safely
      try {
        let adAccountId = profile?.ad_account_id
        if (targetUserId !== user.id) {
            const { data: targetProfile } = await supabase.from('profiles').select('ad_account_id').eq('id', targetUserId).single()
            if (targetProfile?.ad_account_id) {
                adAccountId = targetProfile.ad_account_id
            }
        }
        if (adAccountId) {
            fetchPixels(adAccountId, impersonateId)
        }
      } catch (e) {}

      // Fetch team members safely
      try {
        if (['super_admin', 'agency', 'admin'].includes(currentRole)) {
            const { data: teamData } = await supabase.from('profiles')
              .select('id, business_name, role')
              .or(`agency_id.eq.${targetUserId},parent_id.eq.${targetUserId}`)
              .in('role', ['admin', 'agent', 'agency'])
            
            let finalTeam = teamData || []
            if (!finalTeam.find(t => t.id === targetUserId)) {
                const { data: targetProfile } = await supabase.from('profiles').select('id, business_name, role').eq('id', targetUserId).single()
                if (targetProfile) finalTeam.push(targetProfile)
            }

            setTeam(finalTeam)
        } else {
            setTeam([{ id: user.id, business_name: profile?.business_name || 'You' }])
        }
      } catch (e) {
        setTeam([{ id: user.id, business_name: profile?.business_name || 'You' }])
      }

      // Fetch all workspace leads via server API without 1,000 row cap
      try {
        const leadsRes = await fetch(`/api/crm/leads${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
        let leadsJson: any = null
        if (leadsRes.ok) {
          try {
            leadsJson = await leadsRes.json()
          } catch (e) {}
        }
        if (leadsJson && leadsJson.success && Array.isArray(leadsJson.leads)) {
          setLeads(leadsJson.leads)
          setLocalCache(cacheKey, leadsJson.leads.slice(0, 300))
          setLocalCache('crm_last_leads_cache', leadsJson.leads.slice(0, 300))
          setTotalLeadsCount(leadsJson.leads.length)
        } else {
          // Fallback to direct client query if API fails
          let q = supabase.from('leads').select('*').order('created_at', { ascending: false, nullsFirst: false })
          const isTeamMemberUser = currentRole === 'agent' || currentRole === 'team_member' || !!parentId
          if (isTeamMemberUser) q = q.or(`assigned_to.eq.${user.id},user_id.eq.${user.id}`)
          else q = q.eq('user_id', targetUserId)
          const { data } = await q
          if (data) {
            setLeads(data)
            setLocalCache(cacheKey, data.slice(0, 300))
            setLocalCache('crm_last_leads_cache', data.slice(0, 300))
            setTotalLeadsCount(data.length)
          }
        }
      } catch (err) {
        console.error('[CRM fetchLeads error]:', err)
      }

      try {
          const res = await fetch(`/api/meta-ads/campaigns${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
          if (res.ok) {
              const campaignData = await res.json().catch(() => null)
              if (campaignData && campaignData.campaigns) {
                  setCampaigns(campaignData.campaigns)
                  setLocalCache('crm_campaigns_cache', campaignData.campaigns)
              }
          }
      } catch (err) {
          console.error("Error fetching campaigns in CRM:", err)
      }
    } catch (e: any) {
      console.error("[CRM fetchLeads Error]:", e?.message || e?.details || String(e), e)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  const updateStage = async (leadId: string, newStage: string, e?: any) => {
    if (e) e.stopPropagation();
    try {
      const { error } = await supabase
        .from('leads')
        .update({ status: newStage, pipeline_stage: newStage })
        .eq('id', leadId);

      if (error) throw error;

      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStage, pipeline_stage: newStage } : l));
      toast.success(`Pipeline stage updated to ${newStage}`);

      fetch('/api/crm/lead-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          actionType: 'STATUS_CHANGE',
          description: `Stage updated to ${newStage}`
        })
      }).catch(err => console.error("Failed to log stage change:", err));
    } catch (err: any) {
      toast.error("Failed to update stage: " + (err.message || String(err)));
    }
  };

  const handleAssignProduct = async (leadId: string, propertyId: string | null) => {
    try {
      const selectedProp = properties.find(p => p.id === propertyId);
      const newPropTitle = selectedProp ? selectedProp.title : null;

      const targetLead = leads.find(l => l.id === leadId);
      let updatedCustomFields = targetLead?.custom_fields || {};
      if (updatedCustomFields.meta_ad_origin) {
        updatedCustomFields = {
          ...updatedCustomFields,
          meta_ad_origin: {
            ...updatedCustomFields.meta_ad_origin,
            product_name: newPropTitle,
            product_id: propertyId
          }
        };
      }

      const { error } = await supabase
        .from('leads')
        .update({ 
          property_id: propertyId,
          custom_fields: updatedCustomFields
        })
        .eq('id', leadId);

      if (error) throw error;

      setLeads(prev => prev.map(l => {
        if (l.id === leadId) {
          return {
            ...l,
            property_id: propertyId,
            custom_fields: updatedCustomFields
          };
        }
        return l;
      }));
    } catch (err: any) {
      alert("Failed to assign product: " + (err.message || String(err)));
    }
  }

  const handleToggleWhatsAppEnabled = async (leadId: string, currentlyDisabled: boolean) => {
    const nextState = currentlyDisabled ? true : false;
    try {
      const { error } = await supabase
        .from('leads')
        .update({ whatsapp_enabled: nextState })
        .eq('id', leadId);
      
      if (error) throw error;

      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, whatsapp_enabled: nextState } : l));
      toast.success(nextState ? "WhatsApp auto-messaging enabled" : "WhatsApp auto-messaging paused");
    } catch(e: any) {
      toast.error("Failed to update WhatsApp settings: " + (e.message || String(e)));
    }
  };

  const openMediaModal = async (origin: any, liveAdUrl: string, leadId?: string) => {
    setActiveMediaModal({ origin, liveAdUrl })
    if (!origin?.video_url && (origin?.ad_id || leadId)) {
      try {
        const res = await fetch(`/api/meta-ads/video-source?adId=${origin.ad_id || ''}&leadId=${leadId || ''}`)
        if (res.ok) {
          const data = await res.json().catch(() => null)
          if (data && data.success && data.video_url) {
            const updatedOrigin = { 
              ...origin, 
              video_url: data.video_url, 
              headline: data.headline || origin.headline, 
              body: data.body || origin.body 
            }
            setActiveMediaModal({ origin: updatedOrigin, liveAdUrl })
            
            if (leadId) {
              setLeads(prev => prev.map(l => {
                if (l.id === leadId) {
                  let cf = l.custom_fields || {}
                  if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
                  return { ...l, custom_fields: { ...cf, meta_ad_origin: updatedOrigin } }
                }
                return l
              }))
            }
          }
        }
      } catch (e) {
        console.error("Failed to resolve video URL:", e)
      }
    }
  }

  // --- BULLETPROOF MOBILE & SWIPE GESTURE SCROLL RESTORATION ---
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Enforce manual scroll restoration so iOS Safari & Android Chrome don't force reset viewport to top (0,0)
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const saveScrollPosition = () => {
      if (window.scrollY > 0) {
        sessionStorage.setItem('crm_scroll_position', window.scrollY.toString())
      }
    }

    const restoreScroll = () => {
      const savedPos = sessionStorage.getItem('crm_scroll_position')
      if (savedPos && parseInt(savedPos, 10) > 0) {
        const targetY = parseInt(savedPos, 10)
        window.scrollTo({ top: targetY, behavior: 'instant' as any })
        requestAnimationFrame(() => window.scrollTo({ top: targetY, behavior: 'instant' as any }))
        setTimeout(() => window.scrollTo({ top: targetY, behavior: 'instant' as any }), 50)
        setTimeout(() => window.scrollTo({ top: targetY, behavior: 'instant' as any }), 150)
        setTimeout(() => window.scrollTo({ top: targetY, behavior: 'instant' as any }), 300)
        setTimeout(() => window.scrollTo({ top: targetY, behavior: 'instant' as any }), 500)
      }
    }

    window.addEventListener('scroll', saveScrollPosition, { passive: true })
    window.addEventListener('pageshow', restoreScroll)
    window.addEventListener('popstate', restoreScroll)

    return () => {
      saveScrollPosition()
      window.removeEventListener('scroll', saveScrollPosition)
      window.removeEventListener('pageshow', restoreScroll)
      window.removeEventListener('popstate', restoreScroll)
    }
  }, [])


  // Restore scroll position after leads finish rendering in DOM
  useEffect(() => {
    if (!loading && leads.length > 0 && typeof window !== 'undefined') {
      const savedPos = sessionStorage.getItem('crm_scroll_position')
      if (savedPos && parseInt(savedPos, 10) > 0) {
        const targetY = parseInt(savedPos, 10)
        const restore = () => window.scrollTo({ top: targetY, behavior: 'instant' as any })
        restore()
        requestAnimationFrame(restore)
        setTimeout(restore, 50)
        setTimeout(restore, 150)
        setTimeout(restore, 300)
      }
    }
  }, [loading, leads.length])

  // Trigger initial fetch & silent background auto-sync of WhatsApp & Facebook leads
  useEffect(() => { 
    const initCRM = async () => {
      await fetchLeads()
      checkPushSubscription()
      
      // Auto-backfill WhatsApp leads & auto-sync Facebook leads in background silently
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')

        fetch('/api/crm/backfill-whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ impersonateId })
        }).then(res => res.ok ? res.json() : null).then(data => {
          if (data && data.updatedCount > 0) {
            fetchLeads(true);
          }
        }).catch(err => console.error("WhatsApp lead auto-backfill error:", err));

        const syncRes = await fetch(`/api/crm/sync${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (syncRes.ok) {
          const syncData = await syncRes.json().catch(() => null)
          if (syncData && syncData.success && syncData.count > 0) {
            fetchLeads(true)
          }
        }
      } catch (e) {
        console.error("Auto background CRM sync error:", e)
      }
    }
    
    initCRM()
  }, [])

  // Debounced database-level global search
  useEffect(() => {
    if (!isSearchMounted.current) {
      isSearchMounted.current = true
      return
    }
    const delayDebounce = setTimeout(() => {
      fetchLeads(true)
    }, 600)
    return () => clearTimeout(delayDebounce)
  }, [searchQuery])
 
  // 2. SUPABASE REAL-TIME (Listen for Webhook Insertions & Updates)
  useEffect(() => {
    if (!userId) return
 
    const channel = supabase.channel('realtime_leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        if (payload.eventType === 'INSERT') {
            const newLead = payload.new
            let parsedCustomFields = newLead.custom_fields;
            if (parsedCustomFields && typeof parsedCustomFields === 'string') {
                try {
                    while (typeof parsedCustomFields === 'string') {
                        parsedCustomFields = JSON.parse(parsedCustomFields);
                    }
                } catch (e) {
                    parsedCustomFields = {};
                }
            }
            newLead.custom_fields = parsedCustomFields;

            // Only inject into UI if this lead belongs to the target (impersonated/agency client), the logged-in user, or assigned to this user
            if (newLead.user_id === targetUserId || newLead.user_id === userId || newLead.assigned_to === userId) {
                 setLeads(prev => {
                      // Prevent duplicates if manual add triggered exactly at same time
                      if (prev.find(l => l.id === newLead.id)) return prev;
                      const updated = [newLead, ...prev];
                      
                      // Update cache silently with size limit
                      const cacheKey = `crm_cache_${userId}`
                      setLocalCache(cacheKey, updated.slice(0, 150))
                      
                      return updated;
                 })
            }
        } else if (payload.eventType === 'UPDATE') {
            const updatedLead = payload.new
            let parsedCustomFields = updatedLead.custom_fields;
            if (parsedCustomFields && typeof parsedCustomFields === 'string') {
                try {
                    while (typeof parsedCustomFields === 'string') {
                        parsedCustomFields = JSON.parse(parsedCustomFields);
                    }
                } catch (e) {
                    parsedCustomFields = {};
                }
            }
            updatedLead.custom_fields = parsedCustomFields;

            setLeads(prev => {
                const index = prev.findIndex(l => l.id === updatedLead.id)
                if (index === -1) return prev;
                const updated = [...prev]
                updated[index] = { ...updated[index], ...updatedLead }
                
                // Update cache silently with size limit
                const cacheKey = `crm_cache_${userId}`
                setLocalCache(cacheKey, updated.slice(0, 150))
                
                return updated;
            })
        } else if (payload.eventType === 'DELETE') {
            const oldId = payload.old.id
            setLeads(prev => {
                const updated = prev.filter(l => l.id !== oldId)
                
                // Update cache silently with size limit
                const cacheKey = `crm_cache_${userId}`
                setLocalCache(cacheKey, updated.slice(0, 150))
                
                return updated;
            })
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, targetUserId, supabase])

  const fetchPixels = async (adAccountId: string, impId: string | null) => {
    setIsLoadingPixels(true)
    try {
      const res = await fetch('/api/facebook/pixels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adAccountId, impersonateId: impId })
      })
      let data: any = null
      if (res.ok) {
        data = await res.json().catch(() => null)
      }
      if (data && data.pixels) {
        setPixels(data.pixels)
      } else {
        setPixels([])
      }
    } catch (e) {
      console.error("Error fetching pixels in CRM:", e)
      setPixels([])
    } finally {
      setIsLoadingPixels(false)
    }
  }

  const updateLeadPixel = async (leadId: string, pixelId: string | null) => {
    try {
      const { error } = await supabase
        .from('leads')
        .update({ pixel_id: pixelId })
        .eq('id', leadId)
      
      if (error) throw error
    } catch (e: any) {
      alert("Failed to update lead pixel: " + e.message)
    }
  }

  // --- PUSH NOTIFICATIONS ---
  const checkPushSubscription = async () => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) setIsPushEnabled(true);
      } catch (error) {
        console.error('Failed to check push subscription:', error);
      }
    }
  }

  const enablePushNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return alert('Permission denied.');
      
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });

      // Ensure service worker is active before trying to subscribe
      if (!registration.active) {
        await new Promise<void>((resolve) => {
          const worker = registration.installing || registration.waiting;
          if (worker) {
            const stateChangeHandler = () => {
              if (worker.state === 'activated') {
                worker.removeEventListener('statechange', stateChangeHandler);
                resolve();
              }
            };
            worker.addEventListener('statechange', stateChangeHandler);
          } else {
            resolve();
          }
        });
      }

      let vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        return alert('Configuration Error: Missing VAPID Key');
      }
      vapidPublicKey = vapidPublicKey.replace(/^['"]|['"]$/g, '').trim();
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
      const res = await fetch('/api/web-push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: JSON.parse(JSON.stringify(subscription)) })
      });
      if (res.ok) { setIsPushEnabled(true); alert('Alerts Enabled!'); }
    } catch (e) { console.error(e); }
  }

  const handleLeadClick = (lead: any) => {
      sessionStorage.setItem('crm_scroll', window.scrollY.toString())
      const urlParams = new URLSearchParams(window.location.search)
      const impersonateId = urlParams.get('impersonate')
      router.push(`/dashboard/crm/${lead.id}${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
  }

  // --- ACTIONS ---
  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone) return alert("Name and Phone required")
    setIsAdding(true)
    
    try {
        if (!userId) {
            alert("Error: You must be logged in to add a lead (userId is null).");
            setIsAdding(false);
            return;
        }

        const searchPhone = newLead.phone.trim()
        const cleanSearchPhone = searchPhone.replace(/\D/g, '')
        
        const orFilter = `phone.eq."${searchPhone}",phone.eq."${cleanSearchPhone}"`
        const { data: existingLead } = await supabase
            .from('leads')
            .select('id, name, phone')
            .eq('user_id', targetUserId || userId)
            .or(orFilter)
            .maybeSingle()

        if (existingLead) {
            const proceed = confirm(`A lead with this phone number already exists: ${existingLead.name} (${existingLead.phone}). Do you want to create a duplicate lead anyway?`);
            if (!proceed) {
                setIsAdding(false);
                return;
            }
        }

        const leadPayload: any = {
            user_id: targetUserId || userId,
            name: newLead.name, phone: newLead.phone, email: newLead.email, notes: newLead.notes,
            source: 'Manual', pipeline_stage: 'New',
            created_at: new Date().toISOString()
        }
        if (role === 'agent') leadPayload.assigned_to = userId

        console.log("[CRM] Inserting manual lead payload:", leadPayload);

        const { data: savedLead, error } = await supabase.from('leads').insert(leadPayload).select().single()
        if (!error && savedLead) {
            console.log("[CRM] Lead inserted successfully!", savedLead);

            // Force cache refresh
            await fetchLeads(true)
            setIsAddModalOpen(false)
            setNewLead({ name: '', phone: '', email: '', notes: '' })
        } else {
            console.error("[CRM] Manual lead insert database error:", error);
            alert("Error adding lead: " + (error ? error.message : "Unknown error"));
        }
    } catch (err: any) {
        console.error("[CRM] Unhandled error in handleAddLead:", err);
        alert("Unhandled error: " + (err.message || err));
    } finally {
        setIsAdding(false)
    }
  }

  const handleDeleteLead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation() 
    if (!confirm("Are you sure you want to delete this lead?")) return
    await supabase.from('leads').delete().eq('id', id)
    fetchLeads(true)
  }

  const assignLead = async (leadId: string, agentId: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    const targetAgentId = agentId === '' ? null : agentId;
    await supabase.from('leads').update({ assigned_to: targetAgentId }).eq('id', leadId)
    
    // Notify Agent
    if (targetAgentId) {
        const leadName = leads.find(l => l.id === leadId)?.name || 'A new lead';
        fetch('/api/crm/notify-assignment', {
            method: 'POST',
            body: JSON.stringify({ agentId: targetAgentId, title: 'Lead Assigned to You', message: `${leadName} has been assigned to you.`, url: `/dashboard/crm/${leadId}` })
        }).catch(() => {})
    }
    
    fetchLeads(true) 
  }

  const executeRoundRobin = async (isTogglingOn = false) => {
    // Filter out the main workspace owner (targetUserId) from auto-distribution if other team members exist
    const distributionPool = team.filter(m => m.id !== targetUserId)
    const finalPool = distributionPool.length > 0 ? distributionPool : team

    if (finalPool.length === 0) {
        if (!isTogglingOn) alert("Add team members first.")
        return
    }
    const unassignedLeads = leads.filter(l => !l.assigned_to)
    if (unassignedLeads.length === 0) {
        if (!isTogglingOn) alert("All leads assigned.")
        return
    }

    setIsAssigning(true)
    let idx = 0
    try {
        for (const lead of unassignedLeads) {
            const agentId = finalPool[idx].id;
            await supabase.from('leads').update({ assigned_to: agentId }).eq('id', lead.id)
            
            // Notify
            fetch('/api/crm/notify-assignment', {
                method: 'POST',
                body: JSON.stringify({ agentId, title: 'New Leads Assigned', message: `You have new leads from round-robin distribution.`, url: `/dashboard/crm` })
            }).catch(() => {})
            
            idx = (idx + 1) % finalPool.length
        }
        fetchLeads(true)
        if (!isTogglingOn) alert(`Distributed ${unassignedLeads.length} leads across ${finalPool.length} staff members.`)
    } catch (e: any) { alert(e.message) } 
    finally { setIsAssigning(false) }
  }

  const toggleGlobalDistribution = async () => {
    const newValue = !enableDistribution
    setEnableDistribution(newValue)
    const effectiveUserId = targetUserId || userId
    if (effectiveUserId) {
        await supabase.from('profiles').update({ enable_distribution: newValue }).eq('id', effectiveUserId)
    }
    if (newValue) {
        executeRoundRobin(true)
    }
  }

  const handleCampaignAssign = async () => {
    if (!batchCampaign || batchAgentIds.length === 0) return alert("Select both Campaign and at least one Agent")
    setIsAssigning(true)
    try {
        const effectiveUserId = targetUserId || userId;
        if (autoAssignFuture && effectiveUserId) {
            const ruleTitle = `Campaign-Assignment: ${batchCampaign}`;
            await supabase.from('automations').delete().eq('user_id', effectiveUserId).eq('title', ruleTitle);
            await supabase.from('automations').insert({
                user_id: effectiveUserId,
                title: ruleTitle,
                description: JSON.stringify(batchAgentIds),
                is_active: true
            });
        }

        const leadsToAssign = leads.filter(l => {
            if (l.assigned_to) return false;
            if (l.campaign_id) {
                const camp = campaigns.find(c => c.id === l.campaign_id);
                if (camp && camp.name.trim() === batchCampaign.trim()) return true;
            }
            return l.ad_name === batchCampaign || l.campaign_name === batchCampaign;
        })
        if (leadsToAssign.length > 0) {
            let idx = 0;
            const notifiedAgents = new Set();
            for (const lead of leadsToAssign) {
                const agentId = batchAgentIds[idx];
                await supabase.from('leads').update({ assigned_to: agentId }).eq('id', lead.id)
                
                if (!notifiedAgents.has(agentId)) {
                    notifiedAgents.add(agentId);
                    fetch('/api/crm/notify-assignment', {
                        method: 'POST',
                        body: JSON.stringify({ agentId, title: 'Campaign Leads Assigned', message: `You received leads from ${batchCampaign}.`, url: `/dashboard/crm` })
                    }).catch(() => {})
                }
                
                idx = (idx + 1) % batchAgentIds.length
            }
        }
        
        await fetchLeads(true)
        alert(`Successfully setup assignments for "${batchCampaign}". Processed ${leadsToAssign.length} existing leads.`)
        setIsCampaignAssignModalOpen(false)
    } catch (e: any) {
        alert(e.message)
    } finally {
        setIsAssigning(false)
    }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    const urlParams = new URLSearchParams(window.location.search)
    const impersonateId = urlParams.get('impersonate')
    try {
        const res = await fetch(`/api/crm/sync${impersonateId ? `?impersonate=${impersonateId}` : ''}`, { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ formId: selectedFormId || undefined }) 
        })
        let data: any = null
        if (res.ok) {
          data = await res.json().catch(() => null)
        }
        if (data && data.success) {
            alert(`Imported ${data.count} new leads out of ${data.total} found.`)
            fetchLeads(true)
            setIsSyncModalOpen(false)
        }
    } finally { setIsSyncing(false) }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const effectiveUserId = targetUserId || userId;
    if (!file || !effectiveUserId) return

    // Prompt the user for an audience name
    const defaultName = file.name.replace(".csv", "")
    const audienceName = prompt("Give a name to this CSV uploaded audience:", defaultName);
    if (audienceName === null) return; // User cancelled upload
    const csvAudience = audienceName.trim() || 'General CSV Import'

    const reader = new FileReader()
    reader.onload = async (event) => {
        const text = (event.target?.result as string) || ''
        
        // Multi-line CSV parser with quote handling
        const parseCSVRows = (str: string) => {
          const rows: string[][] = []
          let row: string[] = [], field = '', inQuotes = false
          for (let i = 0; i < str.length; i++) {
            const c = str[i]
            if (c === '"') inQuotes = !inQuotes
            else if (c === ',' && !inQuotes) { row.push(field); field = '' }
            else if ((c === '\r' || c === '\n') && !inQuotes) {
              if (c === '\r' && str[i + 1] === '\n') i++
              row.push(field)
              if (row.some(f => f.trim())) rows.push(row)
              row = []; field = ''
            } else { field += c }
          }
          if (field || row.length) { row.push(field); if (row.some(f => f.trim())) rows.push(row) }
          return rows
        }

        const parseCustomDate = (dateStr: string) => {
          if (!dateStr || !dateStr.trim()) return null
          const s = dateStr.trim()
          try {
            const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
            if (match) {
              let day = parseInt(match[1], 10), month = parseInt(match[2], 10) - 1, year = parseInt(match[3], 10)
              let hour = parseInt(match[4], 10), minute = parseInt(match[5], 10)
              const ampm = match[6]?.toLowerCase()
              if (ampm === 'pm' && hour < 12) hour += 12
              if (ampm === 'am' && hour === 12) hour = 0
              const d = new Date(Date.UTC(year, month, day, hour - 5, minute - 30))
              if (!isNaN(d.getTime())) return d.toISOString()
            }
            const fallback = new Date(s)
            if (!isNaN(fallback.getTime())) return fallback.toISOString()
          } catch (e) {}
          return null
        }

        const rows = parseCSVRows(text)
        if (rows.length < 2) return

        const headers = rows[0].map(h => h.trim())
        const idx = {
          name: headers.indexOf('Lead Name'),
          phone: headers.indexOf('Contacts'),
          email: headers.indexOf('Email'),
          owner: headers.indexOf('Lead Owner'),
          source: headers.indexOf('Lead Source'),
          sourceDetails: headers.indexOf('Source Details'),
          budget: headers.indexOf('Budget'),
          status: headers.indexOf('Lead Status'),
          clientStatus: headers.indexOf('Client Status'),
          nextFollowupText: headers.indexOf('Next Followup'),
          nextFollowupDate: headers.indexOf('Next Followup Date'),
          followupTaken: headers.indexOf('Followup Taken'),
          openingRemarks: headers.indexOf('Openning Remarks'),
          lastRemarks: headers.indexOf('Last Remarks'),
          meetingDate: headers.indexOf('Meeting Date'),
          createdDate: headers.indexOf('Created Date')
        }

        // Build list of team profiles to resolve Lead Owner
        const { data: teamProfiles } = await supabase
          .from('profiles')
          .select('id, email, business_name, full_name')
          .or(`parent_id.eq.${effectiveUserId},agency_id.eq.${effectiveUserId},id.eq.${effectiveUserId}`)

        const resolveOwner = (ownerName: string) => {
          if (!ownerName || !teamProfiles) return effectiveUserId
          const nameLower = ownerName.toLowerCase().trim()
          const matched = teamProfiles.find(p => {
            const bName = (p.business_name || p.full_name || p.email || '').toLowerCase()
            return bName.includes(nameLower) || nameLower.includes(bName.split(' ')[0])
          })
          return matched ? matched.id : effectiveUserId
        }

        const newLeads = rows.slice(1).map(r => {
          const name = idx.name !== -1 ? (r[idx.name] || '').trim() : (r[0] || '').trim()
          const rawPhone = idx.phone !== -1 ? (r[idx.phone] || '').trim() : (r[1] || '').trim()
          if (!name && !rawPhone) return null

          let phone = rawPhone
          if (phone && !phone.startsWith('+')) {
            const digits = phone.replace(/\D/g, '')
            if (digits.length === 10) phone = `+91${digits}`
            else if (digits.length > 10) phone = `+${digits}`
          }

          const email = idx.email !== -1 ? (r[idx.email] || '').trim() : (r[2] || '').trim()
          const ownerName = idx.owner !== -1 ? (r[idx.owner] || '').trim() : ''
          const assignedTo = resolveOwner(ownerName)

          const source = idx.source !== -1 ? ((r[idx.source] || '').trim() || 'CSV Import') : 'CSV Import'
          const sourceDetails = idx.sourceDetails !== -1 ? (r[idx.sourceDetails] || '').trim() : ''
          const budget = idx.budget !== -1 ? (r[idx.budget] || '').trim() : ''
          const leadStatus = idx.status !== -1 ? ((r[idx.status] || '').trim() || 'New Lead') : 'New'
          const clientStatus = idx.clientStatus !== -1 ? (r[idx.clientStatus] || '').trim() : ''
          
          const nextFollowupText = idx.nextFollowupText !== -1 ? (r[idx.nextFollowupText] || '').trim() : ''
          const nextFollowupDateStr = idx.nextFollowupDate !== -1 ? (r[idx.nextFollowupDate] || '').trim() : ''
          const isoNextFollowup = parseCustomDate(nextFollowupDateStr)

          let nextActionType = 'Call'
          if (nextFollowupText.toLowerCase().includes('visit')) nextActionType = 'Visit'
          else if (nextFollowupText.toLowerCase().includes('revisit')) nextActionType = 'Revisit'
          else if (nextFollowupText.toLowerCase().includes('meeting')) nextActionType = 'Closing Meeting'

          const followupTaken = idx.followupTaken !== -1 ? (r[idx.followupTaken] || '').trim() : ''
          const openingRemarks = idx.openingRemarks !== -1 ? (r[idx.openingRemarks] || '').trim() : ''
          const lastRemarks = idx.lastRemarks !== -1 ? (r[idx.lastRemarks] || '').trim() : ''
          const meetingDateStr = idx.meetingDate !== -1 ? (r[idx.meetingDate] || '').trim() : ''
          const isoMeetingDate = parseCustomDate(meetingDateStr)
          const createdDateStr = idx.createdDate !== -1 ? (r[idx.createdDate] || '').trim() : ''
          const isoCreatedDate = parseCustomDate(createdDateStr) || new Date().toISOString()

          let stage = 'New'
          if (leadStatus.includes('Meeting')) stage = 'Meeting Planned'
          else if (leadStatus.includes('Visit Planned')) stage = 'Appointment booked'
          else if (leadStatus.includes('Visit Done')) stage = 'Appointment done'
          else if (leadStatus.includes('Negotiation')) stage = 'Qualified'
          else if (leadStatus.includes('Deal') || leadStatus.includes('Token')) stage = 'Closed'
          else if (leadStatus.includes('Lost')) stage = 'Unqualified'
          else if (leadStatus.includes('Requirement')) stage = 'Contacted'

          let notes = ''
          if (openingRemarks) notes += `[Opening Remarks]: ${openingRemarks}\n\n`
          if (lastRemarks) notes += `[Last Remarks]: ${lastRemarks}`
          notes = notes.trim()

          return {
            user_id: effectiveUserId,
            assigned_to: assignedTo,
            name: name || 'Lead',
            phone: phone || null,
            email: email || null,
            source,
            ad_name: sourceDetails || null,
            budget: budget || null,
            status: leadStatus,
            pipeline_stage: stage,
            next_followup: isoNextFollowup,
            booked_time: isoMeetingDate,
            created_at: isoCreatedDate,
            notes: notes || null,
            csv_audience: csvAudience,
            custom_fields: {
              client_status: clientStatus,
              next_action_type: nextActionType,
              next_action_date: isoNextFollowup,
              opening_comments: openingRemarks,
              last_followup_remark: lastRemarks,
              followup_count: followupTaken ? parseInt(followupTaken, 10) : 0,
              meeting_date: isoMeetingDate,
              csv_audience: csvAudience
            }
          }
        }).filter(Boolean)

        if (newLeads.length > 0) {
            const BATCH = 500
            for (let i = 0; i < newLeads.length; i += BATCH) {
              await supabase.from('leads').insert(newLeads.slice(i, i + BATCH))
            }
            toast.success(`Successfully imported ${newLeads.length} leads!`)
            fetchLeads(true)
        }
    }
    reader.readAsText(file)
  }

  const downloadAllVCard = () => {
    if (leads.length === 0) return alert("No contacts to export")
    
    let vcfContent = ""
    leads.forEach(lead => {
        const vcfName = lead.name || 'Lead'
        const vcfPhone = lead.phone || ''
        const vcfEmail = lead.email || ''
        
        vcfContent += `BEGIN:VCARD
VERSION:3.0
FN:${vcfName}
TEL;TYPE=CELL:${vcfPhone}
EMAIL:${vcfEmail}
END:VCARD\n`
    })
    
    const blob = new Blob([vcfContent], { type: 'text/vcard' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `CRM_Contacts_Export_${new Date().toISOString().split('T')[0]}.vcf`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  const getLeadCampaignName = useCallback((lead: any) => {
    if (lead.campaign_id) {
      const camp = campaigns.find(c => c.id === lead.campaign_id);
      if (camp?.name) return camp.name;
    }
    let cf = lead.custom_fields;
    if (cf && typeof cf === 'string') {
      try {
        while (typeof cf === 'string') cf = JSON.parse(cf);
      } catch (e) {}
    }
    const origin = cf?.meta_ad_origin;
    if (origin) {
      const originName = origin.ad_name || origin.headline || origin.campaign_name || origin.product_name;
      if (originName) return originName;
    }
    if (lead.ad_name) return lead.ad_name;
    if (lead.campaign_name) return lead.campaign_name;
    if (cf?.ad_name) return cf.ad_name;
    if (cf?.campaign_name) return cf.campaign_name;
    if (cf?.source_detail) return cf.source_detail;
    if (cf?.referral_ad_title) return cf.referral_ad_title;
    if (lead.form_name) return lead.form_name;

    if (lead.source && lead.source.toLowerCase().includes('whatsapp')) {
      return 'WhatsApp Direct Message';
    }
    return '';
  }, [campaigns])

  // --- DYNAMIC FILTER EXTRACTION ---
  // Hybrid: use campaigns DB table names + lead ad_name values as fallback
  const uniqueCampaigns = useMemo(() => {
    // 1. Campaign names from the campaigns DB table
    const dbNames = campaigns.map(c => c.name).filter(Boolean);
    // 2. Ad names extracted from leads (fallback for users without DB campaigns)
    const leadNames = leads
      .map(l => {
        // If this lead has a campaign_id that matches a DB campaign, skip it (already covered)
        if (l.campaign_id) {
          const camp = campaigns.find(c => c.id === l.campaign_id);
          if (camp) return null; // already in dbNames
        }
        return l.ad_name || l.campaign_name;
      })
      .filter(c => c && c !== 'null' && c !== 'undefined' && typeof c === 'string')
    return [...new Set([...dbNames, ...leadNames])] as string[]
  }, [campaigns, leads])

  const uniqueForms = useMemo(() => {
    const formNames = leads
      .map(l => l.form_name || l.source)
      .filter(f => f && f !== 'null' && f !== 'undefined' && typeof f === 'string')
    return [...new Set(formNames)] as string[]
  }, [leads])

  const uniqueCsvAudiences = useMemo(() => {
    const audiences = leads
      .map(l => l.csv_audience)
      .filter(a => a && a !== 'null' && a !== 'undefined' && typeof a === 'string')
    return [...new Set(audiences)] as string[]
  }, [leads])

  // --- ADVANCED FILTERING ---
  // 1. Leads matching search, campaign, form, agent, date range, and DNP filters
  const leadsMatchingFilters = useMemo(() => {
    return leads.filter(l => {
      // RESTRICT AGENTS / TEAM MEMBERS: Only show leads assigned to them or created by them
      const isTeamMemberUser = (role as string) === 'agent' || (role as string) === 'team_member' || !!parentAdminId;
      if (isTeamMemberUser) {
          if (l.assigned_to !== userId && l.user_id !== userId) return false;
      }

      // ASSIGNED AGENT FILTER
      const matchAgent = selectedAgentFilter === 'ALL' || (() => {
        if (selectedAgentFilter === 'UNASSIGNED') {
          return !l.assigned_to
        }
        return l.assigned_to === selectedAgentFilter || l.user_id === selectedAgentFilter
      })()

      // DATE CREATED RANGE FILTER
      const matchDate = selectedDateRange === 'ALL' || (() => {
        const rawDateStr = l.facebook_created_at || l.created_at
        if (!rawDateStr) return false
        const leadDate = new Date(rawDateStr)
        const now = new Date()
        if (isNaN(leadDate.getTime())) return false

        if (selectedDateRange === 'TODAY') {
          return leadDate.getFullYear() === now.getFullYear() &&
                 leadDate.getMonth() === now.getMonth() &&
                 leadDate.getDate() === now.getDate()
        } else if (selectedDateRange === 'YESTERDAY') {
          const yest = new Date(now)
          yest.setDate(now.getDate() - 1)
          return leadDate.getFullYear() === yest.getFullYear() &&
                 leadDate.getMonth() === yest.getMonth() &&
                 leadDate.getDate() === yest.getDate()
        } else if (selectedDateRange === '7D') {
          const limit = new Date(now)
          limit.setDate(now.getDate() - 7)
          return leadDate >= limit
        } else if (selectedDateRange === '30D') {
          const limit = new Date(now)
          limit.setDate(now.getDate() - 30)
          return leadDate >= limit
        }
        return true
      })()

      // DNP FILTER
      const matchDnp = selectedDnpFilter === 'ALL' || (() => {
        let cf: any = l.custom_fields
        if (typeof cf === 'string') {
          try { cf = JSON.parse(cf) } catch (e) {}
        }
        const count = l.dnp_count || cf?.dnp_count || 0
        if (selectedDnpFilter === 'DNP_ONLY') return count > 0
        if (selectedDnpFilter === 'DNP_1') return count === 1
        if (selectedDnpFilter === 'DNP_2') return count === 2
        if (selectedDnpFilter === 'DNP_3PLUS') return count >= 3
        if (selectedDnpFilter === 'NO_DNP') return count === 0
        return true
      })()

      // NEXT ACTION FILTER
      const matchNextAction = (() => {
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

            if (actionDateObj < startOfToday) {
              isPast = true
            } else if (actionDateObj >= startOfToday && actionDateObj <= endOfToday) {
              isToday = true
            } else {
              isFuture = true
            }
          }
        }

        if (selectedNextActionFilter === 'HAS_ACTION' && !hasDate) return false
        if (selectedNextActionFilter === 'TODAY' && (!hasDate || !isToday)) return false
        if (selectedNextActionFilter === 'OVERDUE' && (!hasDate || !isPast)) return false
        if (selectedNextActionFilter === 'UPCOMING' && (!hasDate || !isFuture)) return false
        if (selectedNextActionFilter === 'NO_ACTION' && hasDate) return false

        if (selectedNextActionType !== 'ALL') {
          const actionType = l.next_action_type || cf?.next_action_type || l.last_followup_type || 'Call'
          if (actionType.toLowerCase() !== selectedNextActionType.toLowerCase()) return false
        }

        return true
      })()

      const matchSearch = !searchQuery || 
                          l.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          l.phone?.includes(searchQuery) || 
                          l.email?.toLowerCase().includes(searchQuery.toLowerCase())
      const matchCampaign = selectedCampaign === '' || (() => {
        if (l.campaign_id) {
          const camp = campaigns.find(c => c.id === l.campaign_id);
          if (camp && camp.name.trim() === selectedCampaign.trim()) return true;
        }
        return l.ad_name?.trim() === selectedCampaign.trim() || 
               l.campaign_name?.trim() === selectedCampaign.trim();
      })()
      const matchForm = selectedForm === '' || 
                        l.form_name?.trim() === selectedForm.trim() || 
                        l.source?.trim() === selectedForm.trim()
      const matchCsvAudience = selectedCsvAudience === '' || 
                               l.csv_audience?.trim() === selectedCsvAudience.trim()
      
      return matchAgent && matchDate && matchDnp && matchNextAction && matchSearch && matchCampaign && matchForm && matchCsvAudience
    })
  }, [leads, campaigns, searchQuery, selectedCampaign, selectedForm, selectedCsvAudience, selectedAgentFilter, selectedDateRange, selectedDnpFilter, selectedNextActionFilter, selectedNextActionType, role, userId, parentAdminId])

  const matchLeadToStage = (l: any, stageName: string): boolean => {
    if (stageName === 'All Leads') return true
    const statusLower = (l.status || '').trim().toLowerCase()
    const pipelineLower = (l.pipeline_stage || '').trim().toLowerCase()
    const s1 = statusLower || pipelineLower || 'new lead'
    const s2 = pipelineLower || statusLower || 'new lead'

    const checkMatch = (s: string) => {
      if (stageName === 'New Lead') {
        return ['new lead', 'new', 'fresh', 'uncontacted', ''].includes(s)
      } else if (stageName === 'Ongoing') {
        return ['ongoing', 'in progress', 'attempted', 'ongoing lead'].includes(s)
      } else if (stageName === 'Requirement Taken') {
        return ['requirement taken', 'requirement', 'contacted', 'qualified', 'requirement_taken'].includes(s)
      } else if (stageName === 'Appointment Booked') {
        return ['appointment booked', 'appointment', 'booked', 'appointment_booked'].includes(s)
      } else if (stageName === 'Visit Planned') {
        return ['visit planned', 'visit plan', 'planned', 'visit_planned'].includes(s)
      } else if (stageName === 'Visit Done') {
        return ['visit done', 'appointment done', 'visited', 'site visit done', 'visit_done'].includes(s)
      } else if (stageName === 'Revisit Done') {
        return ['revisit done', 'revisit', 're-visited', 'revisit_done'].includes(s)
      } else if (stageName === 'Negotiation') {
        return ['negotiation', 'negotiating', 'offer'].includes(s)
      } else if (stageName === 'Deal/Token') {
        return ['deal/token', 'deal', 'token', 'closed', 'won', 'deal_token'].includes(s)
      } else if (stageName === 'Lost/NI') {
        return ['lost/ni', 'lost', 'ni', 'unqualified', 'not interested', 'lost_ni'].includes(s)
      } else if (stageName === 'Different Requirement') {
        return ['different requirement', 'different_requirement', 'different req'].includes(s)
      }
      return s === stageName.toLowerCase()
    }

    return checkMatch(s1) || checkMatch(s2)
  }

  // 2. Stage counts calculated directly from leadsMatchingFilters using matchLeadToStage
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    STAGES.forEach(s => {
      counts[s] = leadsMatchingFilters.filter(l => matchLeadToStage(l, s)).length
    })
    return counts
  }, [leadsMatchingFilters])

  // 3. Final filtered list including flexible pipeline stage matching and date sorting
  const filteredLeads = useMemo(() => {
    const list = leadsMatchingFilters.filter(l => {
      if (searchQuery.trim() !== '') return true
      if (!activeStage) return true
      return matchLeadToStage(l, activeStage)
    })
    return list.sort((a, b) => {
      const timeA = new Date(a.facebook_created_at || a.created_at).getTime()
      const timeB = new Date(b.facebook_created_at || b.created_at).getTime()
      return sortOrder === 'oldest' ? timeA - timeB : timeB - timeA
    })
  }, [leadsMatchingFilters, activeStage, searchQuery, sortOrder])

  const totalFilteredCount = filteredLeads.length
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / leadsPerPage))
  const currentLeads = useMemo(() => {
    const start = (currentPage - 1) * leadsPerPage
    return filteredLeads.slice(start, start + leadsPerPage)
  }, [filteredLeads, currentPage, leadsPerPage])

  const renderPagination = (position: 'top' | 'bottom') => {
    if (totalPages <= 1) return null
    return (
        <div className={`flex flex-col sm:flex-row justify-center items-center gap-4 ${position === 'top' ? 'mb-6' : 'mt-8'}`}>
            <div className="flex items-center gap-3">
                <button 
                    onClick={() => {
                        const newPage = Math.max(1, currentPage - 1)
                        setCurrentPage(newPage)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    disabled={currentPage === 1}
                    type="button"
                    className="px-5 py-2.5 rounded-2xl bg-white border border-slate-200 font-bold text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    Previous
                </button>
                <span className="text-sm font-bold text-slate-500">
                    Page {currentPage} of {totalPages}
                </span>
                <button 
                    type="button"
                    onClick={() => {
                        const newPage = Math.min(totalPages, currentPage + 1)
                        setCurrentPage(newPage)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    disabled={currentPage === totalPages}
                    className="px-5 py-2.5 rounded-2xl bg-white border border-slate-200 font-bold text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                    Next
                </button>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Go to page:</span>
                <input 
                    type="number"
                    min={1}
                    max={totalPages}
                    value={pageInputVal}
                    onChange={(e) => setPageInputVal(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            const val = parseInt(pageInputVal, 10)
                            if (val >= 1 && val <= totalPages) {
                                setCurrentPage(val)
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                            } else {
                                alert(`Please enter a page between 1 and ${totalPages}`)
                            }
                        }
                    }}
                    className="w-16 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 text-center outline-none focus:border-blue-400 transition-all shadow-sm"
                />
                <button
                    type="button"
                    onClick={() => {
                        const val = parseInt(pageInputVal, 10)
                        if (val >= 1 && val <= totalPages) {
                            setCurrentPage(val)
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                        } else {
                            alert(`Please enter a page between 1 and ${totalPages}`)
                        }
                    }}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                >
                    Go
                </button>
            </div>
        </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">
      
      {/* FIXED REFRESH BUTTON */}
      <button 
          onClick={() => fetchLeads(true)}
          className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
          title="Refresh Leads"
      >
          <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-6">
            <div>
                <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight ml-1">CRM Pipeline</h1>
                <div className="flex items-center gap-3 mt-1.5 ml-1">
                    <p className="text-slate-500 text-xs sm:text-sm font-medium">Manage and distribute your leads</p>
                    {!isPushEnabled ? (
                        <button onClick={enablePushNotifications} className="text-[10px] text-blue-600 font-bold flex items-center gap-1.5 bg-blue-100/50 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-colors">
                            <Bell size={12} /> Enable Alerts
                        </button>
                    ) : <TestNotificationBtn />}
                </div>
            </div>
            
            {/* MOBILE COLLAPSIBLE ACTIONS TOGGLE BUTTON */}
            <div className="w-full md:hidden">
              <button
                type="button"
                onClick={() => setShowMobileCrmActions(!showMobileCrmActions)}
                className="w-full py-2.5 px-4 bg-white border border-slate-200 rounded-2xl text-xs font-black text-slate-700 flex items-center justify-between shadow-xs transition-all active:scale-98"
              >
                <span className="flex items-center gap-2">
                  <Tag size={14} className="text-blue-600" />
                  <span>CRM Actions & Controls</span>
                </span>
                <ChevronDown size={16} className={`transition-transform duration-200 text-slate-500 ${showMobileCrmActions ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div className={`gap-2 flex-wrap w-full md:w-auto ${showMobileCrmActions ? 'flex' : 'hidden md:flex'}`}>
                {isAdminLike && role !== 'agent' && (
                    <>
                        <button onClick={() => setIsGroupDistributionModalOpen(true)} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-blue-200 bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer shadow-md shadow-blue-600/20">
                            <SlidersHorizontal size={16} />
                            <span className="font-bold text-[10px] sm:text-sm">Group Lead Distribution</span>
                        </button>
                        <button onClick={() => { 
                            setIsSyncModalOpen(true); 
                            const urlParams = new URLSearchParams(window.location.search);
                            const impersonateId = urlParams.get('impersonate');
                            fetch(`/api/facebook/forms${impersonateId ? `?impersonate=${impersonateId}` : ''}`).then(r=>r.json()).then(d=>setForms(d.forms||[])) 
                        }} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            <Download size={16} />
                            <span className="font-bold text-[10px] sm:text-sm">Sync Meta</span>
                        </button>
                        <button 
                            onClick={async () => {
                                setIsSyncingCalls(true)
                                try {
                                    const res = await syncAndroidCallLogs()
                                    if (res.success) {
                                        toast.success(`Synced ${res.syncedCount} calls and matched ${res.matchedLeadsCount} leads!`)
                                        fetchLeads(true)
                                    } else {
                                        toast.error(res.error || 'Failed to sync call logs')
                                    }
                                } catch (e: any) {
                                    toast.error('Sync error: ' + e.message)
                                } finally {
                                    setIsSyncingCalls(false)
                                }
                            }}
                            disabled={isSyncingCalls}
                            className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 disabled:opacity-50"
                        >
                            <Phone size={16} className={isSyncingCalls ? 'animate-spin text-blue-600' : 'text-blue-600'} />
                            <span className="font-bold text-[10px] sm:text-sm">{isSyncingCalls ? 'Syncing...' : 'Sync Calls'}</span>
                        </button>
                        <button onClick={downloadAllVCard} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-slate-200/60 bg-white hover:bg-slate-50 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2" title="Export All Contacts to Phone">
                            <Download size={16} className="text-slate-600" />
                            <span className="font-bold text-[10px] sm:text-sm text-slate-600">Export VCF</span>
                        </button>
                        <div className="flex items-center gap-1">
                            <button onClick={() => fileInputRef.current?.click()} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-slate-200/60 bg-white hover:bg-slate-50 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                                <Upload size={16} className="text-slate-600" />
                                <span className="font-bold text-[10px] sm:text-sm text-slate-600">Import CSV</span>
                            </button>
                            <div className="relative group">
                                <button type="button" className="p-1 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none" title="CSV Format Guide">
                                    <HelpCircle size={16} />
                                </button>
                                <div className="absolute right-0 top-full mt-2 w-72 p-4 bg-slate-950 text-white text-xs rounded-2xl shadow-xl border border-slate-800 opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 z-50">
                                    <p className="font-bold text-slate-200 mb-1.5 flex items-center gap-1">
                                        <HelpCircle size={12} className="text-indigo-400" /> CSV Import Format
                                    </p>
                                    <p className="text-slate-400 leading-relaxed mb-2 font-medium">
                                        Your CSV file must include headers on the first row: <code className="font-mono text-yellow-300">Name,Phone,Email</code>
                                    </p>
                                    <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 font-mono text-[10px] text-emerald-400 space-y-1">
                                        <div>Name,Phone,Email</div>
                                        <div>John Doe,+919999999999,john@example.com</div>
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-2 font-semibold leading-normal">
                                        Name and Phone columns are required. Ensure phone numbers include country prefix (e.g. +91).
                                    </p>
                                </div>
                            </div>
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
                    </>
                )}
                
                <button onClick={() => setIsAddModalOpen(true)} className="flex-1 md:flex-none bg-slate-900 text-white p-3 rounded-2xl shadow-md shadow-slate-900/20 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 font-bold">
                    <Plus size={16} strokeWidth={3} /> 
                    <span className="text-[10px] sm:text-sm">Add Lead</span>
                </button>
            </div>
        </div>

        {/* SEARCH, VIEW SWITCHER & FILTERS BAR */}
        <div className="bg-white p-4 sm:p-5 rounded-[1.5rem] xs:rounded-[2rem] shadow-sm border border-slate-200/60 mb-8 space-y-4">
            
            <div className="flex flex-col md:flex-row items-center gap-3">
                {/* Search Input */}
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                        type="text" 
                        placeholder="Search by name, phone, or email..." 
                        value={searchQuery} 
                        onChange={(e) => setSearchQuery(e.target.value)} 
                        className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white pl-12 pr-5 py-3.5 rounded-2xl text-sm font-medium border border-slate-200/60 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all" 
                    />
                </div>

                {/* Mobile Toggle Button for View & Filter Controls */}
                <button 
                  type="button" 
                  onClick={() => setIsMobileControlsCollapsed(!isMobileControlsCollapsed)}
                  className="sm:hidden flex items-center justify-between w-full bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/80 rounded-2xl px-4 py-2.5 transition-all text-left font-extrabold text-xs text-slate-700 active:scale-98 cursor-pointer shrink-0"
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={14} className="text-blue-600" />
                    <span>View & Filter Controls</span>
                    {(selectedCampaign || selectedForm || selectedAgentFilter !== 'ALL' || selectedDateRange !== 'ALL' || selectedDnpFilter !== 'ALL' || selectedNextActionFilter !== 'ALL' || selectedNextActionType !== 'ALL') && (
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400 font-bold text-[10px] uppercase tracking-wider">
                    <span>{isMobileControlsCollapsed ? 'Show' : 'Hide'}</span>
                    {isMobileControlsCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                  </div>
                </button>

                {/* View Mode Switcher (Cards vs Table List) - Collapsible on Mobile */}
                <div className={`${isMobileControlsCollapsed ? 'hidden sm:flex' : 'flex'} flex-col sm:flex-row items-center gap-3 w-full md:w-auto`}>
                    <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-1 border border-slate-200/80 shrink-0 self-stretch sm:self-auto justify-center w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={() => setViewModeState('cards')}
                            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all flex-1 sm:flex-initial ${
                                viewMode === 'cards'
                                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="Cards View"
                        >
                            <LayoutGrid size={15} /> Grid Cards
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewModeState('table')}
                            className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all flex-1 sm:flex-initial ${
                                viewMode === 'table'
                                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="Table List View"
                        >
                            <List size={15} /> List Table
                        </button>
                    </div>

                    <select
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
                        className="bg-white border border-slate-200/80 text-slate-800 font-extrabold text-xs rounded-2xl px-3.5 py-3.5 shadow-xs focus:outline-none focus:border-blue-500 cursor-pointer shrink-0"
                    >
                        <option value="newest">📅 Sort: Newest First</option>
                        <option value="oldest">📅 Sort: Oldest First</option>
                    </select>

                    <button 
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-5 py-3.5 rounded-2xl text-sm font-bold transition-all border flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto ${showFilters || selectedCampaign || selectedForm || selectedAgentFilter !== 'ALL' || selectedDateRange !== 'ALL' || selectedNextActionFilter !== 'ALL' || selectedNextActionType !== 'ALL' ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    >
                        <Filter size={18} /> Filters {(selectedCampaign || selectedForm || selectedAgentFilter !== 'ALL' || selectedDateRange !== 'ALL' || selectedNextActionFilter !== 'ALL' || selectedNextActionType !== 'ALL') && <span className="w-2 h-2 rounded-full bg-blue-400"></span>}
                    </button>
                </div>
            </div>

            {showFilters && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-3 border-t border-slate-100 animate-in slide-in-from-top-2">
                    {/* Agent Filter */}
                    <div className="relative flex-1">
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Assigned Agent</label>
                        <select value={selectedAgentFilter} onChange={(e) => setSelectedAgentFilter(e.target.value)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-xs font-bold rounded-xl py-3 pl-3 pr-8 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer truncate">
                            <option value="ALL">All Team Members</option>
                            <option value="UNASSIGNED">Unassigned Only</option>
                            {team.map(m => (
                                <option key={m.id} value={m.id}>{m.business_name || m.email}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
                    </div>

                    {/* Next Action Timing Filter */}
                    <div className="relative flex-1">
                        <label className="block text-[9px] font-black text-purple-600 uppercase mb-1">Next Action Schedule</label>
                        <select value={selectedNextActionFilter} onChange={(e) => setSelectedNextActionFilter(e.target.value as any)} className="w-full appearance-none bg-purple-50/60 hover:bg-purple-100/60 border border-purple-200/80 text-purple-950 text-xs font-bold rounded-xl py-3 pl-3 pr-8 outline-none focus:ring-4 focus:ring-purple-500/20 transition-all cursor-pointer truncate">
                            <option value="ALL">All Next Actions</option>
                            <option value="TODAY">📅 Due Today</option>
                            <option value="OVERDUE">⚠️ Overdue Actions</option>
                            <option value="UPCOMING">⚡ Upcoming / Future</option>
                            <option value="HAS_ACTION">🔔 Any Scheduled Action</option>
                            <option value="NO_ACTION">❌ No Action Scheduled</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 bottom-3 text-purple-400 pointer-events-none" />
                    </div>

                    {/* Next Action Type Filter */}
                    <div className="relative flex-1">
                        <label className="block text-[9px] font-black text-purple-600 uppercase mb-1">Action Type</label>
                        <select value={selectedNextActionType} onChange={(e) => setSelectedNextActionType(e.target.value)} className="w-full appearance-none bg-purple-50/60 hover:bg-purple-100/60 border border-purple-200/80 text-purple-950 text-xs font-bold rounded-xl py-3 pl-3 pr-8 outline-none focus:ring-4 focus:ring-purple-500/20 transition-all cursor-pointer truncate">
                            <option value="ALL">All Action Types</option>
                            <option value="Call">📞 Call</option>
                            <option value="Visit">🏠 Visit</option>
                            <option value="Revisit">🔄 Revisit</option>
                            <option value="Closing Meeting">💼 Closing Meeting</option>
                            <option value="Home Meeting">🏡 Home Meeting</option>
                            <option value="WhatsApp">💬 WhatsApp</option>
                            <option value="Email">✉️ Email</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 bottom-3 text-purple-400 pointer-events-none" />
                    </div>

                    {/* DNP Filter Dropdown */}
                    <div className="relative flex-1">
                        <label className="block text-[9px] font-black text-rose-500 uppercase mb-1">DNP Status</label>
                        <select value={selectedDnpFilter} onChange={(e) => setSelectedDnpFilter(e.target.value as any)} className="w-full appearance-none bg-rose-50/60 hover:bg-rose-100/60 border border-rose-200/80 text-rose-950 text-xs font-bold rounded-xl py-3 pl-3 pr-8 outline-none focus:ring-4 focus:ring-rose-500/20 transition-all cursor-pointer truncate">
                            <option value="ALL">All Leads (No DNP Filter)</option>
                            <option value="DNP_ONLY">🔥 DNP Only</option>
                            <option value="DNP_1">DNP 1</option>
                            <option value="DNP_2">DNP 2</option>
                            <option value="DNP_3PLUS">DNP 3+ (Retry Queue)</option>
                            <option value="NO_DNP">No DNP</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 bottom-3 text-rose-400 pointer-events-none" />
                    </div>

                    {/* Date Range Filter */}
                    <div className="relative flex-1">
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Date Created</label>
                        <select value={selectedDateRange} onChange={(e) => setSelectedDateRange(e.target.value)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-xs font-bold rounded-xl py-3 pl-3 pr-8 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer truncate">
                            <option value="ALL">All Time</option>
                            <option value="TODAY">Today</option>
                            <option value="YESTERDAY">Yesterday</option>
                            <option value="7D">Last 7 Days</option>
                            <option value="30D">Last 30 Days</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
                    </div>

                    {/* Campaign Filter */}
                    <div className="relative flex-1">
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Campaign</label>
                        <select value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-xs font-bold rounded-xl py-3 pl-3 pr-8 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer truncate">
                            <option value="">All Campaigns</option>
                            {uniqueCampaigns.map((camp, i) => <option key={i} value={camp}>{camp}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
                    </div>

                    {/* Form / Source Filter */}
                    <div className="relative flex-1">
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Lead Form / Source</label>
                        <select value={selectedForm} onChange={(e) => setSelectedForm(e.target.value)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-xs font-bold rounded-xl py-3 pl-3 pr-8 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer truncate">
                            <option value="">All Lead Forms</option>
                            {uniqueForms.map((form, i) => <option key={i} value={form}>{form}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 bottom-3 text-slate-400 pointer-events-none" />
                    </div>

                    {(selectedCampaign || selectedForm || selectedAgentFilter !== 'ALL' || selectedDateRange !== 'ALL' || selectedDnpFilter !== 'ALL' || selectedNextActionFilter !== 'ALL' || selectedNextActionType !== 'ALL') && (
                        <div className="col-span-full flex justify-end">
                            <button onClick={() => { setSelectedCampaign(''); setSelectedForm(''); setSelectedAgentFilter('ALL'); setSelectedDateRange('ALL'); setSelectedDnpFilter('ALL'); setSelectedNextActionFilter('ALL'); setSelectedNextActionType('ALL'); }} className="px-4 py-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors">Clear All Filters</button>
                        </div>
                    )}
                </div>
            )}

            <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide pt-1 sm:overflow-x-visible sm:flex-wrap">
                {STAGES.map(stage => (
                    <button 
                        key={stage} 
                        onClick={() => {
                            setActiveStage(stage)
                            setCurrentPage(1)
                        }} 
                        className={`whitespace-nowrap px-5 py-3 rounded-2xl text-sm font-bold transition-all shadow-sm flex items-center gap-2 ${activeStage === stage ? 'bg-slate-900 text-white border border-slate-900' : 'bg-white text-slate-600 border border-slate-200/60 hover:bg-slate-50 hover:border-slate-300'}`}
                    >
                        {stage} 
                        <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${activeStage === stage ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                            {stageCounts[stage] || 0}
                        </span>
                    </button>
                ))}
            </div>
        </div>

        {/* LEADS GRID */}
        {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-4">
                <Loader2 size={32} className="animate-spin text-slate-300" />
                <p className="text-sm font-medium animate-pulse">Loading Pipeline...</p>
            </div>
        ) : filteredLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-400 bg-white rounded-[2.5rem] border border-slate-200/60 border-dashed">
                <Users size={48} className="text-slate-200 mb-4" />
                <p className="text-base font-bold text-slate-600">No leads found.</p>
                <p className="text-sm mt-1">Adjust filters or wait for new leads to sync.</p>
            </div>
        ) : (
            <>
            {/* SELECT ALL & SELECTION ACTIONS INFO BAR */}
            <div className="flex justify-between items-center bg-white border border-slate-200/60 py-3 px-5 rounded-2xl mb-6 shadow-sm">
                <div className="flex items-center gap-3">
                    <input 
                        type="checkbox"
                        checked={currentLeads.length > 0 && currentLeads.every(l => selectedLeadIds.includes(l.id))}
                        onChange={(e) => {
                            const currentIds = currentLeads.map(l => l.id);
                            const allSelected = currentIds.every(id => selectedLeadIds.includes(id));
                            if (allSelected) {
                                setSelectedLeadIds(prev => prev.filter(id => !currentIds.includes(id)));
                            } else {
                                setSelectedLeadIds(prev => Array.from(new Set([...prev, ...currentIds])));
                            }
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500/20 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-700">Select All {currentLeads.length} leads on this page</span>
                </div>
                {selectedLeadIds.length > 0 && (
                    <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full">{selectedLeadIds.length} Selected</span>
                )}
            </div>

            {renderPagination('top')}

            {viewMode === 'table' ? (
                <div className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm overflow-hidden mb-6">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-200/60 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                    <th className="p-4 w-10 text-center">
                                        <input 
                                            type="checkbox"
                                            checked={currentLeads.length > 0 && currentLeads.every(l => selectedLeadIds.includes(l.id))}
                                            onChange={(e) => {
                                                const currentIds = currentLeads.map(l => l.id);
                                                const allSelected = currentIds.every(id => selectedLeadIds.includes(id));
                                                if (allSelected) {
                                                    setSelectedLeadIds(prev => prev.filter(id => !currentIds.includes(id)));
                                                } else {
                                                    setSelectedLeadIds(prev => Array.from(new Set([...prev, ...currentIds])));
                                                }
                                            }}
                                            className="rounded text-blue-600 focus:ring-blue-500/20 w-4 h-4 cursor-pointer"
                                        />
                                    </th>
                                    <th className="p-4">Lead Name & Phone</th>
                                    <th className="p-4">Stage</th>
                                    <th className="p-4">Assigned Agent</th>
                                    <th className="p-4">DNP Status</th>
                                    <th className="p-4">Campaign / Source</th>
                                    <th className="p-4">Date</th>
                                    <th className="p-4 text-right">Quick Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {currentLeads.map(lead => {
                                    const displayPhone = lead.phone || lead.custom_fields?.whatsapp_number || lead.custom_fields?.phone_number || '';
                                    const dnpCount = lead.dnp_count || lead.custom_fields?.dnp_count || 0;
                                    return (
                                        <tr key={lead.id} onClick={() => handleLeadClick(lead)} className="hover:bg-slate-50/70 transition-colors cursor-pointer group">
                                            <td className="p-4 text-center" onClick={e => e.stopPropagation()}>
                                                <input 
                                                    type="checkbox"
                                                    checked={selectedLeadIds.includes(lead.id)}
                                                    onChange={(e) => {
                                                        if (selectedLeadIds.includes(lead.id)) {
                                                            setSelectedLeadIds(prev => prev.filter(id => id !== lead.id))
                                                        } else {
                                                            setSelectedLeadIds(prev => [...prev, lead.id])
                                                        }
                                                    }}
                                                    className="rounded text-blue-600 focus:ring-blue-500/20 w-4 h-4 cursor-pointer"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col min-w-[160px]">
                                                    <span className="font-extrabold text-slate-900 text-sm group-hover:text-blue-600 transition-colors truncate">{lead.name || 'Unknown Lead'}</span>
                                                    <span className="text-xs font-semibold text-slate-500">{displayPhone || '--'}</span>
                                                </div>
                                            </td>
                                            <td className="p-4" onClick={e => e.stopPropagation()}>
                                                <select
                                                    value={lead.pipeline_stage || 'New'}
                                                    onChange={(e) => updateStage(lead.id, e.target.value, e)}
                                                    className="appearance-none bg-blue-50 text-blue-700 text-xs font-bold rounded-xl py-1.5 px-2.5 border border-blue-200/80 outline-none cursor-pointer hover:bg-blue-100 transition-all"
                                                >
                                                    {STAGES.filter(s => s !== 'All Leads').map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            </td>
                                            <td className="p-4" onClick={e => e.stopPropagation()}>
                                                {isAdminLike ? (
                                                    <select value={lead.assigned_to || ''} onChange={(e) => assignLead(lead.id, e.target.value, e)} className="appearance-none bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg py-1.5 px-2.5 outline-none transition-all cursor-pointer border border-slate-200/60 max-w-[140px] truncate">
                                                        <option value="">Unassigned</option>
                                                        {team.map(member => <option key={member.id} value={member.id}>{member.business_name || 'Agent'}</option>)}
                                                    </select>
                                                ) : (
                                                    <span className="text-xs font-bold text-slate-700">{team.find(t => t.id === lead.assigned_to)?.business_name || 'Unassigned'}</span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                {dnpCount > 0 ? (
                                                    <span className="px-2.5 py-1 text-[10px] font-black rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20 inline-flex items-center gap-1">
                                                        <PhoneOff size={11} /> DNP x{dnpCount}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-slate-400 font-medium">No DNP</span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col max-w-[160px]">
                                                    <span className="text-xs font-bold text-slate-700 truncate">{lead.source || 'Direct'}</span>
                                                    <span className="text-[10px] font-semibold text-slate-400 truncate">{getLeadCampaignName(lead) || lead.ad_name || '--'}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 whitespace-nowrap">
                                                <span className="text-xs text-slate-500 font-bold block">
                                                    {new Date(lead.facebook_created_at || lead.created_at).toLocaleDateString([], {day: '2-digit', month: 'short', year: 'numeric'})}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-1.5 shrink-0">
                                                    <button 
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setHistoryLead(lead);
                                                        }}
                                                        className="px-2.5 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-600 hover:text-white rounded-xl text-xs font-bold transition-all border border-purple-200 flex items-center gap-1 shrink-0"
                                                        title="View Lead History Timeline"
                                                    >
                                                        <History size={13} /> History
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setUpdateFollowupLead(lead);
                                                        }}
                                                        className="px-2.5 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-xl text-xs font-bold transition-all border border-blue-200 flex items-center gap-1 shrink-0"
                                                        title="Update Followup & Log Outcome"
                                                    >
                                                        <PhoneCall size={13} /> Followup
                                                    </button>
                                                    {displayPhone && (
                                                        <>
                                                            <button 
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const telUri = `tel:${formatCallPhone(displayPhone)}`;
                                                                    window.open(telUri, '_self');
                                                                    setUpdateFollowupLead(lead);
                                                                }} 
                                                                className="p-2 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-xl transition-all border border-emerald-500/20"
                                                                title="Call Lead & Log Outcome"
                                                            >
                                                                <Phone size={14} />
                                                            </button>
                                                            <a 
                                                                href={`https://wa.me/${displayPhone.replace(/[^0-9]/g, '')}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="p-2 bg-emerald-50 text-emerald-600 hover:bg-[#25D366] hover:text-white rounded-xl transition-all border border-emerald-200"
                                                                title="Chat on WhatsApp"
                                                            >
                                                                <MessageCircle size={14} />
                                                            </a>
                                                        </>
                                                    )}
                                                    <button 
                                                        onClick={(e) => handleDeleteLead(lead.id, e)} 
                                                        className="p-2 bg-slate-50 text-slate-400 hover:bg-red-500 hover:text-white rounded-xl transition-colors border border-slate-200/60"
                                                        title="Delete Lead"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                    {currentLeads.map(lead => {
                        const displayPhone = lead.phone || lead.custom_fields?.whatsapp_number || lead.custom_fields?.phone_number || '';
                        const dnpCount = lead.dnp_count || lead.custom_fields?.dnp_count || 0;
                        return (
                        <div key={lead.id} onClick={() => handleLeadClick(lead)} className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-200/60 cursor-pointer hover:border-blue-300 hover:shadow-md active:scale-[0.98] transition-all duration-300 flex flex-col h-full group">
                            
                            {/* ROW 1: Lead Name, Checkbox, Phone & Reopened Badge */}
                            <div className="flex items-start gap-2.5 mb-2 pb-2 border-b border-slate-100">
                                <input 
                                    type="checkbox"
                                    checked={selectedLeadIds.includes(lead.id)}
                                    onChange={(e) => {
                                        e.stopPropagation();
                                        if (selectedLeadIds.includes(lead.id)) {
                                            setSelectedLeadIds(prev => prev.filter(id => id !== lead.id))
                                        } else {
                                            setSelectedLeadIds(prev => [...prev, lead.id])
                                        }
                                    }}
                                    className="mt-1 rounded text-blue-600 focus:ring-blue-500/20 w-4 h-4 cursor-pointer shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <h3 className="font-extrabold text-slate-900 text-base sm:text-lg leading-snug group-hover:text-blue-600 break-words" title={lead.name || 'Unknown Lead'}>
                                            {lead.name || 'Unknown Lead'}
                                        </h3>
                                        {(lead.reopened_count > 0 || lead.custom_fields?.reopened_count > 0) && (
                                            <span 
                                                onClick={(e) => { e.stopPropagation(); setHistoryLead(lead); }}
                                                className="px-1.5 py-0.5 text-[10px] font-black rounded-md bg-amber-50 text-amber-700 border border-amber-300 shrink-0 inline-flex items-center gap-0.5 cursor-pointer hover:bg-amber-100 transition-all shadow-xs" 
                                                title={`Reopened ${(lead.reopened_count || lead.custom_fields?.reopened_count)} times from ad submissions`}
                                            >
                                                ⏰<span className="w-4 h-4 rounded-full bg-rose-500 text-white font-extrabold text-[9px] flex items-center justify-center -ml-0.5">{(lead.reopened_count || lead.custom_fields?.reopened_count)}</span>
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                        <span className="text-[11px] font-bold text-slate-500">{displayPhone || 'No phone number'}</span>
                                        {dnpCount > 0 && (
                                            <span className="px-1.5 py-0.5 text-[9px] font-black rounded bg-rose-50 text-rose-600 border border-rose-200 shrink-0 flex items-center gap-1">
                                                <PhoneOff size={10} /> DNP x{dnpCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* ROW 2: Dedicated Quick Action Button Row */}
                            <div className="flex items-center justify-between gap-1.5 mb-3 pt-0.5 flex-wrap" onClick={e => e.stopPropagation()}>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setHistoryLead(lead);
                                        }}
                                        className="px-2.5 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-600 hover:text-white rounded-xl text-xs font-bold transition-all border border-purple-200 flex items-center gap-1 shadow-xs"
                                        title="View Lead History Timeline"
                                    >
                                        <History size={13} /> History
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setUpdateFollowupLead(lead);
                                        }}
                                        className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-600 text-blue-600 hover:text-white rounded-xl text-xs font-bold transition-all border border-blue-200 flex items-center gap-1 shadow-xs"
                                        title="Update Followup & Log Outcome"
                                    >
                                        <PhoneCall size={13} /> Followup
                                    </button>
                                </div>
                                {displayPhone && (
                                    <div className="flex items-center gap-1.5">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const vcfName = lead.name || 'Lead';
                                                const vcfPhone = displayPhone || '';
                                                const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${vcfName}\nTEL;TYPE=CELL:${vcfPhone}\nEMAIL:${lead.email || ''}\nEND:VCARD`;
                                                const blob = new Blob([vcard], { type: 'text/vcard' });
                                                const url = window.URL.createObjectURL(blob);
                                                const link = document.createElement('a');
                                                link.href = url;
                                                link.setAttribute('download', `${vcfName.replace(/\s+/g, '_')}.vcf`);
                                                document.body.appendChild(link);
                                                link.click();
                                                document.body.removeChild(link);
                                                window.URL.revokeObjectURL(url);
                                            }} 
                                            className="p-2 bg-slate-50 text-slate-600 hover:bg-blue-500 hover:text-white rounded-xl transition-colors border border-slate-200/60 shadow-xs"
                                            title="Save to Contacts"
                                        >
                                            <UserPlus size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleWhatsAppEnabled(lead.id, lead.whatsapp_enabled === false);
                                            }}
                                            className={`p-2 rounded-xl transition-all border shadow-xs ${
                                                lead.whatsapp_enabled !== false 
                                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' 
                                                    : 'bg-red-50 text-red-500 border-red-200 hover:bg-red-100'
                                            }`}
                                            title={lead.whatsapp_enabled !== false ? 'WhatsApp Auto: Active' : 'WhatsApp Auto: Paused'}
                                        >
                                            <MessageCircle size={14} className={lead.whatsapp_enabled === false ? 'line-through opacity-70' : ''} />
                                        </button>
                                        <a 
                                             href={`tel:${formatCallPhone(displayPhone)}`} 
                                             onClick={e => { 
                                                 e.stopPropagation(); 
                                                 setUpdateFollowupLead(lead);
                                             }} 
                                             className="p-2.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-xl transition-colors shadow-xs flex items-center justify-center"
                                             title="Call Lead & Log Outcome"
                                         >
                                             <Phone size={18} />
                                         </a>
                                        {userRole !== 'agent' && (
                                            <button 
                                                onClick={(e) => handleDeleteLead(lead.id, e)} 
                                                className="p-2 bg-slate-50 text-slate-400 hover:bg-red-500 hover:text-white rounded-xl transition-colors border border-slate-200/60 shadow-xs"
                                                title="Delete Lead"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Campaign Badge - Truncated, No Vertical Break */}
                            {(() => {
                                const campName = getLeadCampaignName(lead) || lead.ad_name || lead.campaign_name;
                                if (!campName) return null;
                                return (
                                    <div className="mb-2">
                                        <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md truncate max-w-full inline-block" title={campName}>
                                            📢 {campName}
                                        </span>
                                    </div>
                                );
                            })()}

                        {/* ROW 2: Status Dropdown & Date */}
                        <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100 border-dashed gap-2">
                            <div className="flex flex-col gap-1 items-start">
                                <div onClick={e => e.stopPropagation()} className="relative">
                                    <select
                                        value={lead.pipeline_stage || 'New'}
                                        onChange={(e) => updateStage(lead.id, e.target.value, e)}
                                        className="appearance-none bg-blue-50 text-blue-700 text-xs font-bold rounded-xl py-1 px-3 pr-7 border border-blue-200 outline-none cursor-pointer hover:bg-blue-100 transition-all"
                                    >
                                        {STAGES.filter(s => s !== 'All Leads').map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
                                </div>
                                {(lead.next_followup || lead.custom_fields?.next_action_date) && (
                                    <span className="text-xs font-black bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg border border-indigo-200/80 flex items-center gap-1.5 shadow-sm shrink-0 mt-1">
                                        ⏰ Next Action: {lead.custom_fields?.next_action_type || 'Followup'} on {new Date(lead.next_followup || lead.custom_fields?.next_action_date).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
                                    </span>
                                )}
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 shrink-0">
                                {new Date(lead.facebook_created_at || lead.created_at).toLocaleString([], {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit'})}
                            </span>
                        </div>

                        {/* Last Remarks Box */}
                        {(() => {
                            let customFields = lead.custom_fields;
                            if (customFields && typeof customFields === 'string') {
                                try { while (typeof customFields === 'string') customFields = JSON.parse(customFields); } catch (e) {}
                            }
                            const extractLastRemark = (notesStr?: string | null) => {
                                if (!notesStr || !notesStr.includes('[Last Remarks]:')) return null;
                                return notesStr.split('[Last Remarks]:')[1]?.split('\n\n')[0]?.trim() || null;
                            };
                            const lastRemark = customFields?.last_followup_remark || lead.last_followup_remark || lead.last_call_remark || extractLastRemark(lead.notes);
                            if (!lastRemark) return null;
                            return (
                                <div className="mb-4 text-[11px] font-medium text-slate-700">
                                    <div className="flex items-start gap-2 bg-slate-50 border border-slate-200/80 p-2.5 rounded-2xl shadow-xs">
                                        <span className="text-slate-500 font-bold shrink-0 mt-0.5">📝</span>
                                        <div className="min-w-0 flex-1">
                                            <span className="font-extrabold text-slate-900">Last Remarks :- </span>
                                            <p className="text-slate-600 text-[11px] leading-snug line-clamp-3 mt-0.5 font-medium">{lastRemark}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* ROW 3: Data Grid (Clean & Compact) */}
                        <div className={`grid ${['super_admin', 'agency', 'admin'].includes(userRole) ? 'grid-cols-2' : 'grid-cols-1'} gap-y-3 gap-x-2 mt-3 pt-3 border-t border-slate-100`}>
                            {/* Left Column - Lead Manager (Only visible to Admins) */}
                            {['super_admin', 'agency', 'admin'].includes(userRole) && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lead Manager</span>
                                    <div onClick={e => e.stopPropagation()} className="relative">
                                        <select value={lead.assigned_to || ''} onChange={(e) => assignLead(lead.id, e.target.value, e)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 text-slate-700 text-xs font-bold rounded-lg py-1.5 pl-2 pr-6 outline-none transition-all cursor-pointer truncate border border-slate-200/60">
                                            <option value="">Unassigned</option>
                                            {team.map(member => <option key={member.id} value={member.id}>{member.business_name || 'Agent'}</option>)}
                                        </select>
                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            )}
                            
                            {/* Right Column */}
                            <div className="flex flex-col gap-1 justify-center min-w-0">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lead Source</span>
                                <span className="text-xs font-bold text-slate-700 truncate block">{lead.source || '--'}</span>
                            </div>
                        </div>

                        <div className="flex-grow"></div>
                    </div>
                    )
                })}
            </div>
            )}

            {renderPagination('bottom')}
            </>
        )}

      {/* ADD MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <UserPlus size={22} className="text-blue-600" /> Manual Entry
                    </h2>
                    <button onClick={() => setIsAddModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                </div>
                
                <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh] custom-scrollbar">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Full Name <span className="text-red-400">*</span></label>
                        <input type="text" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200/60 focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all" placeholder="John Doe" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Phone Number <span className="text-red-400">*</span></label>
                        <input type="tel" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200/60 focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all" placeholder="+91 98765 43210" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Email Address</label>
                        <input type="email" value={newLead.email} onChange={e => setNewLead({...newLead, email: e.target.value})} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200/60 focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all" placeholder="john@example.com" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Internal Notes</label>
                        <textarea value={newLead.notes} onChange={e => setNewLead({...newLead, notes: e.target.value})} className="w-full bg-slate-50 hover:bg-slate-100/50 py-4 px-4 rounded-3xl text-sm font-medium border border-slate-200/60 focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none resize-none transition-all" rows={3} placeholder="Met at the property expo..." />
                    </div>

                    <button onClick={handleAddLead} disabled={isAdding || !newLead.name || !newLead.phone} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-50 disabled:scale-100 mt-2">
                        {isAdding ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} strokeWidth={3} />} Save Lead
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* SYNC MODAL */}
      {isAdminLike && isSyncModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Download size={22} className="text-emerald-500"/> Sync Meta Leads</h2>
                    <button onClick={() => setIsSyncModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                </div>
                
                <div className="p-6 space-y-5">
                    {isLoadingForms ? (
                        <div className="py-16 flex flex-col items-center gap-4 text-slate-500">
                            <Loader2 className="animate-spin text-emerald-500" size={32} />
                            <p className="text-sm font-bold">Fetching Ad Forms...</p>
                        </div>
                    ) : (
                        <>
                            <div className="max-h-72 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                                <button onClick={() => setSelectedFormId('')} className={`w-full p-4 rounded-2xl text-left text-sm font-bold border-2 flex justify-between items-center transition-all ${selectedFormId === '' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200 text-slate-600'}`}>
                                    <span>Sync All Active Forms</span>
                                    {selectedFormId === '' && <CheckCircle2 size={20} className="text-emerald-600" />}
                                </button>
                                {forms.map(form => (
                                    <button key={form.id} onClick={() => setSelectedFormId(form.id)} className={`w-full p-4 rounded-2xl text-left text-sm font-bold border-2 flex justify-between items-center transition-all ${selectedFormId === form.id ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200 text-slate-600'}`}>
                                        <div className="min-w-0 pr-3 flex flex-col gap-1">
                                            <p className="truncate w-full">{form.name}</p>
                                            <p className="text-[10px] font-medium opacity-70 truncate">ID: {form.id}</p>
                                        </div>
                                        {selectedFormId === form.id && <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />}
                                    </button>
                                ))}
                            </div>
                            <button onClick={handleSync} disabled={isSyncing} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-50 disabled:scale-100 mt-2">
                                {isSyncing ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />} 
                                {isSyncing ? 'Importing Leads...' : 'Start Import'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* CAMPAIGN ASSIGN MODAL */}
      {isCampaignAssignModalOpen && (
          <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-300">
              <div className="bg-white w-full max-w-md rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden">
                  <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
                      <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Tag className="text-orange-600" size={20} />
                        Campaign Assignment
                      </h2>
                      <button onClick={() => setIsCampaignAssignModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={20} /></button>
                  </div>

                  <div className="p-6 space-y-6 overflow-y-auto max-h-[80vh] custom-scrollbar">
                      <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">Step 1: Select Campaign</label>
                          <div className="relative">
                              <select 
                                  value={batchCampaign} 
                                  onChange={(e) => setBatchCampaign(e.target.value)}
                                  className="w-full appearance-none bg-slate-50 border border-slate-100 py-4 px-6 rounded-2xl text-sm font-bold text-slate-900 focus:ring-4 focus:ring-orange-500/10 focus:border-orange-400 outline-none transition-all cursor-pointer"
                              >
                                  <option value="">Choose Campaign...</option>
                                  {uniqueCampaigns.map((camp, i) => <option key={i} value={camp}>{camp}</option>)}
                              </select>
                              <ChevronDown size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>
                      </div>

                      <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">Step 2: Assign To Agents (Round-Robin)</label>
                          <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                              {team.map(member => (
                                  <label key={member.id} className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all cursor-pointer ${batchAgentIds.includes(member.id) ? 'border-orange-500 bg-orange-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                                      <input 
                                          type="checkbox" 
                                          checked={batchAgentIds.includes(member.id)}
                                          onChange={(e) => {
                                              if (e.target.checked) setBatchAgentIds([...batchAgentIds, member.id]);
                                              else setBatchAgentIds(batchAgentIds.filter(id => id !== member.id));
                                          }}
                                          className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                                      />
                                      <span className="text-sm font-bold text-slate-700">{member.business_name || 'Agent'}</span>
                                  </label>
                              ))}
                          </div>
                      </div>

                      <div className="bg-orange-50 p-5 rounded-3xl border border-orange-100 mb-2 space-y-4">
                          <label className="flex items-center gap-3 cursor-pointer">
                              <input type="checkbox" checked={autoAssignFuture} onChange={e => setAutoAssignFuture(e.target.checked)} className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500" />
                              <span className="text-sm font-bold text-orange-800">Auto-assign future leads</span>
                          </label>
                          <p className="text-xs font-bold text-orange-700 leading-relaxed opacity-80">
                              This will assign all unassigned existing leads and optionally route new leads from this campaign to the selected agents automatically via round-robin.
                          </p>
                      </div>

                      <button 
                          onClick={handleCampaignAssign}
                          disabled={isAssigning || !batchCampaign || batchAgentIds.length === 0}
                          className="w-full bg-slate-900 hover:bg-slate-800 text-white py-5 rounded-[2rem] text-sm font-bold shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                          {isAssigning ? <Loader2 className="animate-spin" size={20} /> : <><CheckCircle2 size={18} /> Confirm Bulk Assignment</>}
                      </button>
                  </div>
              </div>
          </div>
      )}
       {/* FLOATING ACTION OVERLAY PANEL */}
      {selectedLeadIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-slate-950/95 backdrop-blur-md px-6 py-4 rounded-full shadow-2xl border border-slate-800 text-white flex items-center gap-6 animate-in slide-in-from-bottom-5 duration-300">
              <span className="text-xs font-black tracking-wider text-slate-300 uppercase">
                  {selectedLeadIds.length} Leads Selected
              </span>
              <div className="w-[1px] h-6 bg-slate-800" />
              <div className="flex gap-2">
                  <button 
                      onClick={() => setIsSendTemplateModalOpen(true)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                      <MessageCircle size={14} /> Send WhatsApp Template
                  </button>
                  <button 
                      onClick={handleBulkVoiceCampaign}
                      disabled={isCallingCampaign}
                      className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                      {isCallingCampaign ? <Loader2 size={12} className="animate-spin text-white" /> : <Phone size={12} />} Run Voice Campaign
                  </button>
                  <button 
                      onClick={() => setSelectedLeadIds([])}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-full text-xs font-bold transition-all text-slate-400 hover:text-white cursor-pointer"
                  >
                      Cancel
                  </button>
              </div>
          </div>
      )}

      {/* SEND WHATSAPP TEMPLATE MODAL */}
      {isSendTemplateModalOpen && (
          <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
              <div className="bg-white w-full max-w-md rounded-t-[1.75rem] xs:rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden">
                  <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
                      <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                          <MessageCircle size={22} className="text-blue-600" />
                          Send Template Blast
                      </h2>
                      <button onClick={() => setIsSendTemplateModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                  </div>
                  
                  <div className="p-6 space-y-4">
                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block ml-1">Select WhatsApp Template</label>
                          <div className="relative">
                              <select 
                                  value={selectedTemplateName} 
                                  onChange={(e) => {
                                      const name = e.target.value;
                                      setSelectedTemplateName(name);
                                      const t = approvedTemplates.find(x => x.name === name);
                                      setSelectedTemplateBody(t?.components?.find((c: any) => c.type === 'BODY' || c.type === 'body')?.text || '');
                                      setSelectedTemplateLanguage(t?.language || 'en_US');
                                      const headerComp = t?.components?.find((c: any) => c.type === 'HEADER' || c.type === 'header');
                                      const fmt = headerComp?.format || headerComp?.type;
                                      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(fmt)) {
                                          setSelectedHeaderFormat(fmt);
                                      } else {
                                          setSelectedHeaderFormat(null);
                                      }
                                      setSelectedHeaderMediaUrl('');
                                  }}
                                  className="w-full appearance-none bg-slate-50 border border-slate-100 py-3.5 px-5 rounded-2xl text-sm font-bold text-slate-900 focus:ring-4 focus:ring-blue-500/10 outline-none cursor-pointer"
                              >
                                  <option value="">Choose template...</option>
                                  {approvedTemplates.map(t => (
                                      <option key={t.name} value={t.name}>{t.name} ({t.status})</option>
                                  ))}
                              </select>
                              <ChevronDown size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>
                      </div>

                      {selectedTemplateBody && (() => {
                          const detectedVars = getDetectedTemplateVars(selectedTemplateBody);
                          return (
                              <div className="space-y-3">
                                  <div className="space-y-1">
                                      <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Template Content</label>
                                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/50 text-xs text-slate-600 leading-relaxed font-semibold font-sans whitespace-pre-wrap">
                                          {selectedTemplateBody}
                                      </div>
                                  </div>

                                  {selectedHeaderFormat && (
                                      <WhatsAppTemplateMediaPicker
                                          headerType={selectedHeaderFormat}
                                          mediaUrl={selectedHeaderMediaUrl}
                                          onMediaSelect={(url: string) => setSelectedHeaderMediaUrl(url)}
                                      />
                                  )}

                                  {detectedVars.length > 0 ? (
                                      <div className="bg-blue-50/60 border border-blue-100 p-4 rounded-2xl space-y-3">
                                          <div className="flex justify-between items-center">
                                              <span className="text-xs font-black text-blue-900 uppercase tracking-wider">⚡ Assign Variables ({detectedVars.length} detected)</span>
                                              <span className="text-[9px] font-bold text-blue-600">Manual Field Mapping</span>
                                          </div>

                                          <div className="space-y-2.5">
                                              {detectedVars.map(vNum => {
                                                  const current = templateVarMappings[vNum.toString()] || { 
                                                      field: vNum === 1 ? 'name' : vNum === 2 ? 'property_title' : 'business_name', 
                                                      customVal: '' 
                                                  };
                                                  return (
                                                      <div key={vNum} className="bg-white p-3 rounded-xl border border-slate-200/80 space-y-2">
                                                          <div className="flex items-center justify-between">
                                                              <label className="text-[10px] font-black text-blue-600 uppercase">Variable {"{{" + vNum + "}}"} value:</label>
                                                          </div>

                                                          <div className="grid grid-cols-1 gap-2">
                                                              <select
                                                                  value={current.field}
                                                                  onChange={(e) => {
                                                                      const fieldVal = e.target.value;
                                                                      setTemplateVarMappings(prev => ({
                                                                          ...prev,
                                                                          [vNum.toString()]: { ...current, field: fieldVal }
                                                                      }))
                                                                  }}
                                                                  className="w-full bg-slate-50 border border-slate-200 py-1.5 px-3 rounded-lg text-xs font-bold text-slate-800 outline-none cursor-pointer"
                                                              >
                                                                  <option value="name">Lead Name</option>
                                                                  <option value="property_title">Project / Property Title</option>
                                                                  <option value="business_name">Business Name ({userBusinessName})</option>
                                                                  <option value="phone">Lead Phone</option>
                                                                  <option value="email">Lead Email</option>
                                                                  <option value="custom">Custom Static Text...</option>
                                                              </select>

                                                              {current.field === 'custom' && (
                                                                  <input 
                                                                      type="text"
                                                                      value={current.customVal}
                                                                      onChange={(e) => {
                                                                          const textVal = e.target.value;
                                                                          setTemplateVarMappings(prev => ({
                                                                              ...prev,
                                                                              [vNum.toString()]: { ...current, customVal: textVal }
                                                                          }))
                                                                      }}
                                                                      placeholder={`Enter custom value for {{${vNum}}}...`}
                                                                      className="w-full bg-slate-50 border border-slate-200 py-1.5 px-3 rounded-lg text-xs font-bold text-slate-800 outline-none focus:border-blue-400"
                                                                  />
                                                              )}
                                                          </div>
                                                      </div>
                                                  )
                                              })}
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-2xl text-[10px] text-slate-500 leading-normal font-bold">
                                          ℹ️ Standard template with 0 variables.
                                      </div>
                                  )}
                              </div>
                          )
                      })()}


                      <button 
                          onClick={handleBulkSendTemplate} 
                          disabled={isSendingTemplates || !selectedTemplateName} 
                          className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-50 disabled:scale-100 mt-2"
                      >
                          {isSendingTemplates ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} 
                          {isSendingTemplates ? `Sending to ${selectedLeadIds.length} Leads...` : `Send Message to ${selectedLeadIds.length} Leads`}
                      </button>
                  </div>
              </div>
          </div>
       )}

       {/* Enlargeable Ad Creative & Product Lightbox Modal */}
       {activeMediaModal && (
         <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
           <div className="bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative space-y-4 max-h-[92vh] overflow-y-auto">
             {/* Modal Header */}
             <div className="flex justify-between items-center border-b border-slate-800 pb-3.5">
               <div className="flex items-center gap-2.5">
                 <span className="p-2 bg-indigo-600 rounded-xl text-sm font-black text-white shadow-md">🎯</span>
                 <div>
                   <h3 className="font-extrabold text-base text-white">Meta Ad Creative & Product Mapping</h3>
                   <p className="text-[11px] text-slate-400">View enlarged media or open live Meta ad post</p>
                 </div>
               </div>
               <div className="flex items-center gap-2">
                 {activeMediaModal.liveAdUrl && (
                   <a 
                     href={activeMediaModal.liveAdUrl} 
                     target="_blank" 
                     rel="noreferrer" 
                     className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-md active:scale-95"
                   >
                     🔗 Open Live Ad on Meta
                   </a>
                 )}
                 <button 
                   onClick={() => setActiveMediaModal(null)} 
                   className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-base font-extrabold transition-colors"
                 >
                   ✕
                 </button>
               </div>
             </div>

             {/* Media Player / Photo */}
             <div className="bg-black rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center min-h-[260px] max-h-[62vh] shadow-inner">
               {activeMediaModal.origin?.video_url ? (
                 <video 
                   src={activeMediaModal.origin.video_url} 
                   controls 
                   autoPlay 
                   className="w-full max-h-[60vh] object-contain rounded-xl"
                 />
               ) : activeMediaModal.origin?.image_url ? (
                 <img 
                   src={activeMediaModal.origin.image_url} 
                   alt="Enlarged Creative" 
                   className="w-full max-h-[60vh] object-contain rounded-xl"
                 />
               ) : (
                 <div className="text-slate-500 text-xs py-10 font-semibold">No visual media creative thumbnail available</div>
               )}
             </div>

             {/* Complete Ad Copy & Info Card */}
             <div className="space-y-3 bg-slate-800/80 p-4 rounded-2xl border border-slate-700/80">
               <div>
                 <span className="text-[9px] font-black uppercase text-indigo-400 tracking-wider block">Ad Headline</span>
                 <h4 className="font-extrabold text-sm text-white">{activeMediaModal.origin?.headline || activeMediaModal.origin?.ad_name}</h4>
               </div>
               {activeMediaModal.origin?.body && (
                 <div>
                   <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Ad Copy (Primary Text)</span>
                   <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed mt-1">{activeMediaModal.origin.body}</p>
                 </div>
               )}
               <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-700/80 text-[10px]">
                 <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Ad Name</span><span className="font-bold text-slate-200 truncate block">{activeMediaModal.origin?.ad_name || 'N/A'}</span></div>
                 <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Ad Set</span><span className="font-bold text-slate-200 truncate block">{activeMediaModal.origin?.adset_name || 'N/A'}</span></div>
                 <div><span className="text-slate-400 font-bold block text-[8px] uppercase">Campaign</span><span className="font-bold text-slate-200 truncate block">{activeMediaModal.origin?.campaign_name || 'N/A'}</span></div>
               </div>
             </div>
           </div>
         </div>
       )}

       {/* CALL FEEDBACK MODAL */}
       <CallFeedbackModal 
         isOpen={!!callFeedbackLead} 
         lead={callFeedbackLead} 
         onClose={() => setCallFeedbackLead(null)} 
         onSuccess={() => fetchLeads(true)} 
         currentUserId={userId} 
       />

       {/* UPDATE FOLLOWUP MODAL */}
       <UpdateFollowupModal
         isOpen={!!updateFollowupLead}
         lead={updateFollowupLead}
         onClose={() => setUpdateFollowupLead(null)}
         onSuccess={() => fetchLeads(true)}
         properties={properties}
         teamMembers={team}
       />

       {/* LEAD HISTORY TIMELINE MODAL */}
       <LeadHistoryModal
         isOpen={!!historyLead}
         lead={historyLead}
         onClose={() => setHistoryLead(null)}
       />

       {/* GROUP LEAD DISTRIBUTION MODAL */}
       <GroupLeadDistributionModal
         isOpen={isGroupDistributionModalOpen}
         onClose={() => setIsGroupDistributionModalOpen(false)}
         team={team}
         campaigns={uniqueCampaigns}
         leads={leads}
         targetUserId={targetUserId || userId || ''}
         impersonateId={impersonateId}
         onLeadsUpdated={() => fetchLeads(true)}
       />
       </div>
     </div>
   )
 }