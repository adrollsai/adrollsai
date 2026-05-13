'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Search, Phone, MessageCircle, RefreshCw, Upload, 
  Plus, CheckCircle2, X, Download, Trash2, UserPlus, 
  Clock, Bell, Users, Shuffle, Mail, Tag, Loader2, Filter, ChevronDown, FileText
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import TestNotificationBtn from '@/components/TestNotificationBtn'

const STAGES = ['New', 'Qualified', 'Appointment booked', 'Appointment done', 'Closed', 'Unqualified']


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
  const [role, setRole] = useState<'admin' | 'agent'>('admin')
  const [team, setTeam] = useState<any[]>([])
  const [parentAdminId, setParentAdminId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)

  // --- CRM STATE (LOCAL CACHE) ---
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // --- FILTER STATE ---
  const [activeStage, setActiveStage] = useState('New')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [selectedForm, setSelectedForm] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // --- MODAL STATE ---
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [forms, setForms] = useState<any[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [isLoadingForms, setIsLoadingForms] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', notes: '' })
  const [isAdding, setIsAdding] = useState(false)
 
  const [isPushEnabled, setIsPushEnabled] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. SAFE FETCH WITH LOCAL CACHING
  const fetchLeads = async (force = false) => {
    try {
      if (!force && leads.length === 0) setLoading(true)
      if (force) setIsRefreshing(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // Fetch Fresh Data
      const { data: profile } = await supabase.from('profiles').select('role, parent_id, business_name').eq('id', user.id).single()
      const currentRole = profile?.role || 'admin'
      setRole(currentRole)
      if (profile?.parent_id) setParentAdminId(profile.parent_id)

      if (currentRole === 'admin') {
          const { data: teamData } = await supabase.from('profiles').select('id, business_name').eq('parent_id', user.id)
          setTeam(teamData || [])
      } else {
          // For agents, we should at least have their own info in "team" so they don't see "Unassigned" for themselves
          setTeam([{ id: user.id, business_name: profile?.business_name || 'You' }])
      }

      let query = supabase.from('leads')
        .select('*, lead_history(action_type, description, created_at)')
        .order('facebook_created_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (currentRole === 'admin') {
          query = query.eq('user_id', user.id) 
      } else {
          query = query.eq('user_id', profile?.parent_id).eq('assigned_to', user.id) 
      }

      const { data, error } = await query
      
      if (error) throw error
      
      if (data) {
          setLeads(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  // Trigger initial fetch
  useEffect(() => { 
    fetchLeads()
    checkPushSubscription()
  }, [])

  // 2. SUPABASE REAL-TIME (Listen for Webhook Insertions)
  useEffect(() => {
    if (!userId) return

    const channel = supabase.channel('realtime_leads')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const newLead = payload.new
        // Only inject into UI if this lead belongs to this Admin OR is assigned to this Agent
        if (newLead.user_id === userId || newLead.assigned_to === userId) {
             setLeads(prev => {
                 // Prevent duplicates if manual add triggered exactly at same time
                 if (prev.find(l => l.id === newLead.id)) return prev;
                 const updated = [newLead, ...prev];
                 
                 // Update cache silently
                 const cacheKey = `crm_cache_${userId}`
                 localStorage.setItem(cacheKey, JSON.stringify(updated))
                 
                 return updated;
             })
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, supabase])

  // --- PUSH NOTIFICATIONS ---
  const checkPushSubscription = async () => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) setIsPushEnabled(true);
    }
  }

  const enablePushNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return alert('Permission denied.');
      
      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!)
      });
      const res = await fetch('/api/web-push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: JSON.parse(JSON.stringify(subscription)) })
      });
      if (res.ok) { setIsPushEnabled(true); alert('Alerts Enabled!'); }
    } catch (e) { console.error(e); }
  }

  const handleLeadClick = (lead: any) => router.push(`/dashboard/crm/${lead.id}`)

  // --- ACTIONS ---
  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone) return alert("Name and Phone required")
    setIsAdding(true)
    
    if (userId) {
        const leadPayload: any = {
            user_id: role === 'agent' && parentAdminId ? parentAdminId : userId,
            name: newLead.name, phone: newLead.phone, email: newLead.email, notes: newLead.notes,
            source: 'Manual', pipeline_stage: 'New'
        }
        if (role === 'agent') leadPayload.assigned_to = userId

        const { error } = await supabase.from('leads').insert(leadPayload)
        if (!error) {
            // Force cache refresh
            await fetchLeads(true)
            setIsAddModalOpen(false)
            setNewLead({ name: '', phone: '', email: '', notes: '' })
        }
    }
    setIsAdding(false)
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
    fetchLeads(true) 
  }

  const executeRoundRobin = async () => {
    if (team.length === 0) return alert("Add team members first.")
    const unassignedLeads = leads.filter(l => !l.assigned_to)
    if (unassignedLeads.length === 0) return alert("All leads assigned.")

    setIsAssigning(true)
    let idx = 0
    try {
        for (const lead of unassignedLeads) {
            await supabase.from('leads').update({ assigned_to: team[idx].id }).eq('id', lead.id)
            idx = (idx + 1) % team.length
        }
        fetchLeads(true)
        alert(`Distributed ${unassignedLeads.length} leads.`)
    } catch (e: any) { alert(e.message) } 
    finally { setIsAssigning(false) }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try {
        const res = await fetch('/api/crm/sync', { 
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
    if (!file || !userId) return
    const reader = new FileReader()
    reader.onload = async (event) => {
        const rows = (event.target?.result as string).split('\n').slice(1)
        const newLeads = rows.map(r => r.split(',')).filter(c => c.length >= 2).map(cols => ({ 
            user_id: userId, name: cols[0]?.trim(), phone: cols[1]?.trim(), 
            email: cols[2]?.trim(), source: 'CSV Import', pipeline_stage: 'New' 
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

  // --- DYNAMIC FILTER EXTRACTION ---
  const uniqueCampaigns = useMemo(() => {
    const campaigns = leads.map(l => l.ad_name || l.campaign_name).filter(Boolean)
    return [...new Set(campaigns)] as string[]
  }, [leads])

  const uniqueForms = useMemo(() => {
    const formNames = leads.map(l => l.form_name || l.source).filter(Boolean)
    return [...new Set(formNames)] as string[]
  }, [leads])

  // --- ADVANCED FILTERING ---
  const filteredLeads = leads.filter(l => {
      const matchStage = (l.pipeline_stage || 'New') === activeStage
      const matchSearch = l.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          l.phone?.includes(searchQuery) || 
                          l.email?.toLowerCase().includes(searchQuery.toLowerCase())
      const matchCampaign = selectedCampaign === '' || (l.ad_name === selectedCampaign || l.campaign_name === selectedCampaign)
      const matchForm = selectedForm === '' || (l.form_name === selectedForm || l.source === selectedForm)
      
      return matchStage && matchSearch && matchCampaign && matchForm
  })

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
                {role === 'admin' && (
                    <>
                        <button onClick={executeRoundRobin} disabled={isAssigning} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            {isAssigning ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} />}
                            <span className="font-bold text-[10px] sm:text-sm">Distribute</span>
                        </button>
                        <button onClick={() => { setIsSyncModalOpen(true); fetch('/api/facebook/forms').then(r=>r.json()).then(d=>setForms(d.forms||[])) }} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            <Download size={16} />
                            <span className="font-bold text-[10px] sm:text-sm">Sync Meta</span>
                        </button>
                        <button onClick={downloadAllVCard} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-slate-200/60 bg-white hover:bg-slate-50 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2" title="Export All Contacts to Phone">
                            <Download size={16} className="text-slate-600" />
                            <span className="font-bold text-[10px] sm:text-sm text-slate-600">Export VCF</span>
                        </button>
                        <button onClick={() => fileInputRef.current?.click()} className="flex-1 md:flex-none p-3 rounded-2xl shadow-sm border border-slate-200/60 bg-white hover:bg-slate-50 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
                            <Upload size={16} className="text-slate-600" />
                            <span className="font-bold text-[10px] sm:text-sm text-slate-600">Import CSV</span>
                        </button>
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
                    {(selectedCampaign || selectedForm) && (
                        <button onClick={() => { setSelectedCampaign(''); setSelectedForm(''); }} className="px-4 py-3.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-2xl transition-colors">Clear Filters</button>
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
                            {leads.filter(l => (l.pipeline_stage || 'New') === stage).length}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                {filteredLeads.map(lead => (
                    <div key={lead.id} onClick={() => handleLeadClick(lead)} className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-200/60 cursor-pointer hover:border-blue-300 hover:shadow-md active:scale-[0.98] transition-all duration-300 flex flex-col h-full group">
                        
                        {/* ROW 1: Name and Actions */}
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex-1 min-w-0 pr-4 mt-1">
                                <h3 className="font-extrabold text-slate-900 text-lg truncate group-hover:text-blue-600">{lead.name || 'Unknown Lead'}</h3>
                                <p className="text-[11px] font-bold text-slate-500 mt-0.5">{lead.phone || 'No phone number'}</p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                {lead.phone && (
                                    <>
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const vcfName = lead.name || 'Lead';
                                                const vcfPhone = lead.phone || '';
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
                                        <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} onClick={e => e.stopPropagation()} target="_blank" rel="noopener noreferrer" className="p-2.5 bg-slate-50 text-slate-600 hover:bg-[#25D366] hover:text-white rounded-full transition-colors border border-slate-200/60 shadow-sm"><MessageCircle size={16} /></a>
                                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="p-2.5 bg-slate-50 text-slate-600 hover:bg-blue-600 hover:text-white rounded-full transition-colors border border-slate-200/60 shadow-sm"><Phone size={16} /></a>
                                    </>
                                )}
                                <button onClick={(e) => handleDeleteLead(lead.id, e)} className="p-2.5 bg-slate-50 text-slate-400 hover:bg-red-500 hover:text-white rounded-full transition-colors border border-slate-200/60 shadow-sm"><Trash2 size={16} /></button>
                            </div>
                        </div>

                        {/* ROW 2: Status & Date */}
                        <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-100 border-dashed">
                            <span className="text-sm font-bold text-blue-600">{lead.pipeline_stage || 'New Lead'}</span>
                            <span className="text-[11px] font-bold text-slate-400">
                                {new Date(lead.facebook_created_at || lead.created_at).toLocaleString([], {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit'})}
                            </span>
                        </div>

                        {/* ROW 3: Data Grid */}
                        <div className="grid grid-cols-2 gap-y-4 gap-x-2 mb-4">
                            {/* Left Column */}
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Lead Manager</span>
                                {role === 'admin' ? (
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
                                <span className="text-xs font-bold text-slate-700 truncate">{lead.source || '--'}</span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Source Detail</span>
                                <span className="text-xs font-bold text-slate-700 truncate">{lead.form_name || lead.campaign_name || lead.ad_name || '--'}</span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Budget</span>
                                <span className="text-xs font-bold text-slate-700 truncate">{lead.budget || '--'}</span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Requirement</span>
                                <span className="text-xs font-bold text-slate-700 truncate">{lead.priority_status || '--'}</span>
                            </div>
                            
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Timeline</span>
                                <span className="text-xs font-bold text-slate-700 truncate">{lead.timeline || '--'}</span>
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
                ))}
            </div>
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
      {role === 'admin' && isSyncModalOpen && (
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
      </div>
    </div>
  )
}