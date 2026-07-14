'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Search, Phone, MessageCircle, RefreshCw, Upload, 
  Plus, CheckCircle2, X, Download, Trash2, UserPlus, 
  Clock, Bell, Users, Shuffle, Mail, Tag, Loader2, Filter, ChevronDown, FileText, Send, HelpCircle
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import TestNotificationBtn from '@/components/TestNotificationBtn'

import { getLocalCache, setLocalCache, mergeCacheData, getMaxCreatedAt } from '@/utils/client-cache'

const STAGES = ['New', 'Contacted', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified']


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

export default function CRMPage() {
  const supabase = createClient()
  const router = useRouter()
  
  // --- ROLE & HIERARCHY STATE ---
  const [role, setRole] = useState<'super_admin' | 'agency' | 'client' | 'admin' | 'agent'>('admin')
  const [team, setTeam] = useState<any[]>([])
  const [parentAdminId, setParentAdminId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)
  const [autoCallNewLeads, setAutoCallNewLeads] = useState(false)

  const isAdminLike = ['super_admin', 'agency', 'admin', 'client', 'agent'].includes(role)

  // --- CRM STATE (LOCAL CACHE) ---
  const [leads, setLeads] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [enableDistribution, setEnableDistribution] = useState(false)
  const [assignedCampaigns, setAssignedCampaigns] = useState<string[]>([])

  // --- FILTER STATE ---
  const [activeStage, setActiveStageState] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('crm_stage') || 'New'
    }
    return 'New'
  })
  
  const setActiveStage = (stage: string) => {
    setActiveStageState(stage)
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('crm_stage', stage)
    }
  }

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [selectedForm, setSelectedForm] = useState('')
  const [selectedCsvAudience, setSelectedCsvAudience] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  
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

  // Sync page input value when currentPage changes
  useEffect(() => {
    setPageInputVal(currentPage.toString())
  }, [currentPage])

  // Reset page when filters change
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setCurrentPage(1)
  }, [activeStage, searchQuery, selectedCampaign, selectedForm, selectedCsvAudience])

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
  const [isSendingTemplates, setIsSendingTemplates] = useState(false)
  const [isCallingCampaign, setIsCallingCampaign] = useState(false)

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
    
    let sentCount = 0
    let failedCount = 0

    for (const lead of selectedLeads) {
      const displayPhone = lead.phone || lead.custom_fields?.whatsapp_number || lead.custom_fields?.phone_number || '';
      if (!displayPhone) continue

      try {
        const res = await fetch('/api/whatsapp/test-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: displayPhone,
            templateName: selectedTemplateName,
            isSandboxTest: selectedTemplateName === 'hello_world'
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
      const res = await fetch('/api/voice/call', {
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

  // 1. SAFE FETCH WITH LOCAL CACHING
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
      let targetUserId = (['admin', 'agent'].includes(currentRole) && (profile?.parent_id || profile?.agency_id)) 
        ? (profile.parent_id || profile.agency_id) 
        : user.id

      if (impersonateId && (['super_admin', 'agency', 'admin'].includes(currentRole))) {
          if (currentRole !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', profile?.agency_id || user.id) // Correctly check agency root
                .single()
              if (subAccount) targetUserId = impersonateId
          } else {
              targetUserId = impersonateId
          }
      }
      setTargetUserId(targetUserId)

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

      // Setup caching key (agent-specific cache key to prevent admin leads leak/conflicts)
      const cacheKey = currentRole === 'agent' ? `crm_cache_${user.id}` : `crm_cache_${targetUserId}`;
      const cached = force ? [] : getLocalCache<any>(cacheKey);

      if (cached.length > 0 && leads.length === 0) {
          setLeads(cached);
          setLoading(false);
          
          // Restore scroll position gracefully
          const savedScroll = sessionStorage.getItem('crm_scroll');
          if (savedScroll) {
              setTimeout(() => window.scrollTo({ top: parseInt(savedScroll, 10), behavior: 'instant' }), 50);
          }
      } else if (leads.length === 0 && !force) {
          setLoading(true);
      }

      if (force) setIsRefreshing(true);

      const maxCreatedAt = getMaxCreatedAt(cached);

      // Fetch Meta Pixels for target account
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

      if (['super_admin', 'agency', 'admin'].includes(currentRole)) {
          // Fetch all staff members under this agency/organization
          const { data: teamData } = await supabase.from('profiles')
            .select('id, business_name, role')
            .or(`agency_id.eq.${targetUserId},parent_id.eq.${targetUserId}`)
            .in('role', ['admin', 'agent', 'agency'])
          
          let finalTeam = teamData || []
          
          // Ensure the target user (Agency/Parent) is also in the team list if not already
          if (!finalTeam.find(t => t.id === targetUserId)) {
              const { data: targetProfile } = await supabase.from('profiles').select('id, business_name, role').eq('id', targetUserId).single()
              if (targetProfile) finalTeam.push(targetProfile)
          }

          setTeam(finalTeam)
      } else {
          setTeam([{ id: user.id, business_name: profile?.business_name || 'You' }])
      }

      const fetchAllLeads = async () => {
          let allData: any[] = [];
          let start = 0;
          const step = 1000;
          let hasMore = true;

          while (hasMore) {
              let query = supabase.from('leads')
                .select('*, lead_history(action_type, description, created_at)')
                .order('created_at', { ascending: false, nullsFirst: false })
                .range(start, start + step - 1)

              if (maxCreatedAt && !force) {
                  query = query.gt('created_at', maxCreatedAt);
              }

              if (currentRole === 'super_admin') {
                  query = query.eq('user_id', targetUserId)
              } else if (currentRole === 'agency') {
                  if (impersonateId) {
                      query = query.eq('user_id', targetUserId)
                  } else {
                      const { data: clientIds } = await supabase.from('profiles').select('id').eq('agency_id', user.id)
                      const allIds = [user.id, ...(clientIds?.map(c => c.id) || [])]
                      query = query.in('user_id', allIds)
                  }
              } else if (currentRole === 'admin' || currentRole === 'client') {
                  query = query.eq('user_id', targetUserId)
              } else {
                  // Retrieve only leads assigned to the agent
                  query = query.eq('assigned_to', user.id) 
              }

              const { data, error } = await query
              if (error) throw error
              
              if (data && data.length > 0) {
                  allData.push(...data)
                  if (data.length < step || allData.length >= 1000) hasMore = false;
                  else start += step;
              } else {
                  hasMore = false;
              }
          }
          return allData;
      }

      const data = await fetchAllLeads()
      
      if (data) {
          const parsedData = data.map(lead => {
              let parsedCustomFields = lead.custom_fields;
              if (parsedCustomFields && typeof parsedCustomFields === 'string') {
                  try {
                      while (typeof parsedCustomFields === 'string') {
                          parsedCustomFields = JSON.parse(parsedCustomFields);
                      }
                  } catch (e) {
                      parsedCustomFields = {};
                  }
              }
              return { ...lead, custom_fields: parsedCustomFields };
          });
          const merged = force ? parsedData : mergeCacheData<any>(cached, parsedData);
          setLeads(merged);
          // Limit cache size to 150 items to avoid localStorage QuotaExceededError
          setLocalCache(cacheKey, merged.slice(0, 150));
      }
 
      try {
          const res = await fetch(`/api/meta-ads/campaigns${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
          const campaignData = await res.json()
          if (campaignData.campaigns) {
              setCampaigns(campaignData.campaigns)
          }
      } catch (err) {
          console.error("Error fetching campaigns in CRM:", err)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }
 
  // Trigger initial fetch & silent background auto-sync of Facebook leads
  useEffect(() => { 
    const initCRM = async () => {
      await fetchLeads()
      checkPushSubscription()
      
      // Auto-sync leads from Facebook in the background silently
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        const syncRes = await fetch(`/api/crm/sync${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        const syncData = await syncRes.json()
        if (syncData.success && syncData.count > 0) {
          // Silent refresh since new leads were imported & distributed
          fetchLeads(true)
        }
      } catch (err) {
        console.error("[CRM] Background auto-sync failed:", err)
      }
    }
    
    initCRM()
  }, [])
 
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
      const data = await res.json()
      if (data.pixels) {
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
            
            // 1. Trigger automated WhatsApp welcome template send (defaults to hello_world sandbox template)
            fetch('/api/whatsapp/test-send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: leadPayload.phone,
                    templateName: 'hello_world',
                    isSandboxTest: true
                })
            }).then(async (res) => {
                const data = await res.json()
                console.log("[CRM] WhatsApp auto-trigger status:", data)
            }).catch(err => console.error("[CRM] WhatsApp auto-trigger failed:", err))

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
        const data = await res.json()
        if (data.success) {
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
        const rows = (event.target?.result as string).split('\n').slice(1)
        const newLeads = rows.map(r => r.split(',')).filter(c => c.length >= 2).map(cols => ({ 
            user_id: effectiveUserId, name: cols[0]?.trim(), phone: cols[1]?.trim(), 
            email: cols[2]?.trim(), source: 'CSV Import', pipeline_stage: 'New',
            csv_audience: csvAudience,
            created_at: new Date().toISOString()
        }))
        if (newLeads.length > 0) {
            await supabase.from('leads').insert(newLeads)
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
      if (camp) return camp.name;
    }
    return lead.ad_name || lead.campaign_name || '';
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
  // 1. Leads matching search, campaign, and form filters (but NOT pipeline stage)
  const leadsMatchingFilters = useMemo(() => {
    const unfiltered = leads.filter(l => {
      // RESTRICT AGENTS: Only show leads assigned to them
      if (role === 'agent') {
          if (l.assigned_to !== userId) return false;
      }

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
      
      return matchSearch && matchCampaign && matchForm && matchCsvAudience
    })

    // Deduplicate leads by unique phone number (or ID if no phone) to keep CRM clean of duplicate contacts
    const seen = new Set();
    return unfiltered.filter(lead => {
        const cleanPhone = lead.phone ? lead.phone.replace(/\D/g, '') : '';
        const key = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : lead.id;
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
  }, [leads, campaigns, searchQuery, selectedCampaign, selectedForm, role, userId, assignedCampaigns, getLeadCampaignName])

  // 2. Final filtered list including pipeline stage matching and sorted by newest first
  const filteredLeads = useMemo(() => {
    const list = leadsMatchingFilters.filter(l => (l.pipeline_stage || 'New') === activeStage)
    return list.sort((a, b) => {
      const timeA = new Date(a.facebook_created_at || a.created_at).getTime()
      const timeB = new Date(b.facebook_created_at || b.created_at).getTime()
      return timeB - timeA
    })
  }, [leadsMatchingFilters, activeStage])

  const totalPages = Math.ceil(filteredLeads.length / leadsPerPage)
  const currentLeads = filteredLeads.slice((currentPage - 1) * leadsPerPage, currentPage * leadsPerPage)

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
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
            <div>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight ml-1">CRM Pipeline</h1>
                <div className="flex items-center gap-3 mt-2 ml-1">
                    <p className="text-slate-500 text-sm font-medium">Manage and distribute your leads</p>
                    {!isPushEnabled ? (
                        <button onClick={enablePushNotifications} className="text-[10px] text-blue-600 font-bold flex items-center gap-1.5 bg-blue-100/50 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
                            <Bell size={12} /> Enable Alerts
                        </button>
                    ) : <TestNotificationBtn />}
                </div>
            </div>
            
            <div className="flex gap-2.5 flex-wrap w-full md:w-auto">
                {isAdminLike && role !== 'agent' && (
                    <>
                        <button onClick={toggleGlobalDistribution} disabled={isAssigning} className={`flex-1 md:flex-none p-3 rounded-2xl shadow-sm border active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${enableDistribution ? 'bg-violet-600 border-violet-600 text-white hover:bg-violet-700' : 'bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100'}`}>
                            {isAssigning ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} />}
                            <span className="font-bold text-[10px] sm:text-sm">{enableDistribution ? 'Auto Distribute: ON' : 'Auto Distribute: OFF'}</span>
                        </button>
                        <button onClick={() => setIsCampaignAssignModalOpen(true)} disabled={isAssigning} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            <Tag size={16} />
                            <span className="font-bold text-[10px] sm:text-sm">Campaign Assign</span>
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

        {/* SEARCH & FILTERS BAR */}
        <div className="bg-white p-4 sm:p-5 rounded-[1.5rem] xs:rounded-[2rem] shadow-sm border border-slate-200/60 mb-8 space-y-4">
            
            <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                        type="text" 
                        placeholder="Search by name, phone, or email..." 
                        value={searchQuery} 
                        onChange={(e) => setSearchQuery(e.target.value)} 
                        className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white pl-12 pr-5 py-3.5 rounded-2xl text-sm font-medium border border-slate-200/60 focus:border-blue-400 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all" 
                    />
                </div>
                <button 
                    onClick={() => setShowFilters(!showFilters)}
                    className={`px-5 py-3.5 rounded-2xl text-sm font-bold transition-all border flex items-center justify-center gap-2 shrink-0 ${showFilters || selectedCampaign || selectedForm ? 'bg-slate-800 text-white border-slate-800 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                    <Filter size={18} /> Filters {(selectedCampaign || selectedForm) && <span className="w-2 h-2 rounded-full bg-blue-400"></span>}
                </button>
            </div>

            {showFilters && (
                <div className="flex flex-col sm:flex-row gap-3 pt-3 border-t border-slate-100 animate-in slide-in-from-top-2">
                    <div className="relative flex-1">
                        <select value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-sm font-bold rounded-2xl py-3.5 pl-4 pr-10 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer truncate">
                            <option value="">All Campaigns</option>
                            {uniqueCampaigns.map((camp, i) => <option key={i} value={camp}>{camp}</option>)}
                        </select>
                        <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <div className="relative flex-1">
                        <select value={selectedForm} onChange={(e) => setSelectedForm(e.target.value)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-sm font-bold rounded-2xl py-3.5 pl-4 pr-10 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer truncate">
                            <option value="">All Lead Forms / Sources</option>
                            {uniqueForms.map((form, i) => <option key={i} value={form}>{form}</option>)}
                        </select>
                        <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    {uniqueCsvAudiences.length > 0 && (
                        <div className="relative flex-1">
                            <select value={selectedCsvAudience} onChange={(e) => setSelectedCsvAudience(e.target.value)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-sm font-bold rounded-2xl py-3.5 pl-4 pr-10 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer truncate">
                                <option value="">All CSV Audiences</option>
                                {uniqueCsvAudiences.map((aud, i) => <option key={i} value={aud}>{aud}</option>)}
                            </select>
                            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    )}
                    {(selectedCampaign || selectedForm || selectedCsvAudience) && (
                        <button onClick={() => { setSelectedCampaign(''); setSelectedForm(''); setSelectedCsvAudience(''); }} className="px-4 py-3.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-2xl transition-colors">Clear Filters</button>
                    )}
                </div>
            )}

            <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide pt-1 sm:overflow-x-visible sm:flex-wrap">
                {STAGES.map(stage => (
                    <button 
                        key={stage} 
                        onClick={() => setActiveStage(stage)} 
                        className={`whitespace-nowrap px-5 py-3 rounded-2xl text-sm font-bold transition-all shadow-sm flex items-center gap-2 ${activeStage === stage ? 'bg-slate-900 text-white border border-slate-900' : 'bg-white text-slate-600 border border-slate-200/60 hover:bg-slate-50 hover:border-slate-300'}`}
                    >
                        {stage} 
                        <span className={`px-2 py-0.5 rounded-lg text-xs ${activeStage === stage ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                            {leadsMatchingFilters.filter(l => (l.pipeline_stage || 'New') === stage).length}
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                {currentLeads.map(lead => {
                    const displayPhone = lead.phone || lead.custom_fields?.whatsapp_number || lead.custom_fields?.phone_number || '';
                    return (
                    <div key={lead.id} onClick={() => handleLeadClick(lead)} className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-200/60 cursor-pointer hover:border-blue-300 hover:shadow-md active:scale-[0.98] transition-all duration-300 flex flex-col h-full group">
                        
                        {/* ROW 1: Name, Checkbox and Actions */}
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-start gap-3 flex-1 min-w-0 pr-4 mt-1">
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
                                    className="mt-1 rounded text-blue-600 focus:ring-blue-500/20 w-4 h-4 cursor-pointer"
                                />
                                <div className="min-w-0 flex-1">
                                    <h3 className="font-extrabold text-slate-900 text-lg pr-2 break-words whitespace-normal group-hover:text-blue-600">{lead.name || 'Unknown Lead'}</h3>
                                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">{displayPhone || 'No phone number'}</p>
                                    {(getLeadCampaignName(lead) || lead.ad_name || lead.campaign_name) && (
                                        <p className="text-[10px] font-extrabold text-slate-400/80 mt-1 break-words whitespace-normal bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5 inline-block max-w-full" title={getLeadCampaignName(lead) || lead.ad_name || lead.campaign_name}>
                                            📢 {getLeadCampaignName(lead) || lead.ad_name || lead.campaign_name}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                {displayPhone && (
                                    <>
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
                                            className="p-2.5 bg-slate-50 text-slate-600 hover:bg-blue-500 hover:text-white rounded-full transition-colors border border-slate-200/60 shadow-sm"
                                            title="Save to Contacts"
                                        >
                                            <UserPlus size={16} />
                                        </button>
                                        <a 
                                            href={`https://wa.me/${displayPhone.replace(/[^0-9]/g, '')}`} 
                                            onClick={e => { 
                                                e.stopPropagation(); 
                                                sessionStorage.setItem('crm_scroll', window.scrollY.toString()); 
                                            }} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="p-2.5 bg-slate-50 text-slate-600 hover:bg-[#25D366] hover:text-white rounded-full transition-colors border border-slate-200/60 shadow-sm"
                                        >
                                            <MessageCircle size={16} />
                                        </a>
                                        <a 
                                            href={`tel:${displayPhone}`} 
                                            onClick={e => { 
                                                e.stopPropagation(); 
                                                sessionStorage.setItem('crm_scroll', window.scrollY.toString()); 
                                            }} 
                                            className="p-2.5 bg-slate-50 text-slate-600 hover:bg-blue-600 hover:text-white rounded-full transition-colors border border-slate-200/60 shadow-sm"
                                        >
                                            <Phone size={16} />
                                        </a>
                                    </>
                                )}
                                <button 
                                    onClick={(e) => handleDeleteLead(lead.id, e)} 
                                    className="p-2.5 bg-slate-50 text-slate-400 hover:bg-red-500 hover:text-white rounded-full transition-colors border border-slate-200/60 shadow-sm"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        {/* ROW 2: Status & Date */}
                        <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100 border-dashed gap-2">
                            <div className="flex flex-col gap-1 items-start">
                                <span className="text-sm font-bold text-blue-600">{lead.pipeline_stage || 'New Lead'}</span>
                                {lead.booked_time && (
                                    <span className="text-xs font-black bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-300/80 flex items-center gap-1.5 shadow-sm shrink-0 mt-1">
                                        📆 Booked: {new Date(lead.booked_time).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
                                    </span>
                                )}
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 shrink-0">
                                {new Date(lead.facebook_created_at || lead.created_at).toLocaleString([], {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit'})}
                            </span>
                        </div>

                        {/* ROW 3: Data Grid */}
                        <div className="grid grid-cols-2 gap-y-4 gap-x-2 mb-4">
                            {/* Left Column */}
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Lead Manager</span>
                                {isAdminLike ? (
                                    <div onClick={e => e.stopPropagation()} className="relative mt-0.5">
                                        <select value={lead.assigned_to || ''} onChange={(e) => assignLead(lead.id, e.target.value, e)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 text-slate-700 text-xs font-bold rounded-lg py-1.5 pl-2 pr-6 outline-none transition-all cursor-pointer truncate border border-slate-200/60">
                                            <option value="">Unassigned</option>
                                            {team.map(member => <option key={member.id} value={member.id}>{member.business_name || 'Agent'}</option>)}
                                        </select>
                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                ) : (
                                    <span className="text-xs font-bold text-slate-700 truncate mt-0.5">{team.find(t => t.id === lead.assigned_to)?.business_name || 'Unassigned'}</span>
                                )}
                            </div>
                            
                            {/* Right Column */}
                            <div className="flex flex-col gap-1 justify-center">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Lead Source</span>
                                <span className="text-xs font-bold text-slate-700 break-words whitespace-normal">{lead.source || '--'}</span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Source Detail</span>
                                <span className="text-xs font-bold text-slate-700 break-words whitespace-normal" title={getLeadCampaignName(lead) || lead.form_name || lead.ad_name}>{getLeadCampaignName(lead) || lead.form_name || lead.ad_name || '--'}</span>
                            </div>

                            {/* Qualification Details dynamically from custom_fields */}
                            {(() => {
                                let customFields = lead.custom_fields;
                                if (customFields && typeof customFields === 'string') {
                                    try {
                                        while (typeof customFields === 'string') {
                                            customFields = JSON.parse(customFields);
                                        }
                                    } catch (e) {
                                        customFields = {};
                                    }
                                }
                                if (!customFields || typeof customFields !== 'object') {
                                    return null;
                                }
                                return Object.entries(customFields).map(([key, value]) => (
                                    <div key={key} className="flex flex-col gap-1">
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider break-words">{key.replace(/_/g, ' ')}</span>
                                        <span className="text-xs font-bold text-slate-700 break-words whitespace-normal">{String(value || '--')}</span>
                                    </div>
                                ));
                            })()}

                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Meta Pixel</span>
                                {isLoadingPixels ? (
                                    <span className="text-xs text-slate-400 font-bold animate-pulse">Loading...</span>
                                ) : (
                                    <div onClick={e => e.stopPropagation()} className="relative mt-0.5">
                                        <select 
                                            value={lead.pixel_id || ''} 
                                            onChange={(e) => updateLeadPixel(lead.id, e.target.value || null)} 
                                            className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 text-slate-700 text-xs font-bold rounded-lg py-1.5 pl-2 pr-6 outline-none transition-all cursor-pointer truncate border border-slate-200/60"
                                        >
                                            <option value="">Profile Default</option>
                                            {pixels.map(p => (
                                                <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex-grow"></div>

                        {/* ROW 4: Footer Sections (Followup, Opening Comments) */}
                        <div className="mt-auto flex flex-col gap-3">
                            {lead.next_followup && new Date(lead.next_followup) > new Date() && (
                                <div className="pt-3 border-t border-slate-100 flex items-start gap-3">
                                    <div className="mt-0.5 w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                                        <Clock size={12} className="text-blue-500" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-slate-800">
                                            Next Action :- Reminder on <span className="text-blue-600">{new Date(lead.next_followup).toLocaleString([], {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit'})}</span>
                                        </span>
                                        <span className="text-xs text-slate-500 mt-0.5 font-medium">Automated reminder set.</span>
                                    </div>
                                </div>
                            )}

                            {(lead.lead_history?.filter((h: any) => h.action_type === 'REMARK')?.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || lead.notes || lead.email) && (
                                <div className="pt-3 border-t border-slate-100 flex items-start gap-3">
                                    <div className="mt-0.5 w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                                        <FileText size={12} className="text-blue-500" />
                                    </div>
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-xs font-bold text-slate-800">Last Remark :-</span>
                                        <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed font-medium">
                                            {(() => {
                                                const lastRemark = lead.lead_history?.filter((h: any) => h.action_type === 'REMARK')?.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.description;
                                                if (lastRemark) return lastRemark;
                                                return lead.notes ? lead.notes : `Email: ${lead.email}`;
                                            })()}
                                        </p>
                                        <span className="text-[10px] font-bold text-blue-500 mt-1 uppercase tracking-wider hover:underline">Read More</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    )
                })}
            </div>

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
                                      setSelectedTemplateBody(t?.components?.find((c: any) => c.type === 'BODY')?.text || '');
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

                      {selectedTemplateBody && (
                          <div className="space-y-3">
                              <div className="space-y-1">
                                  <label className="text-[10px] font-black text-slate-400 uppercase block ml-1">Template Content</label>
                                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/50 text-xs text-slate-600 leading-relaxed font-semibold font-sans whitespace-pre-wrap">
                                      {selectedTemplateBody}
                                  </div>
                              </div>
                              <div className="bg-blue-50/50 border border-blue-100 p-3.5 rounded-2xl text-[10px] text-blue-800 leading-normal font-bold">
                                  ℹ️ Variables like lead name and company name are mapped automatically when sent to Meta.
                              </div>
                          </div>
                      )}

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
      </div>
    </div>
  )
}