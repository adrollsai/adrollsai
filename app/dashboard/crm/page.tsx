'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Search, Phone, MessageCircle, RefreshCw, Upload, 
  Plus, CheckCircle2, X, Download, Trash2, UserPlus, 
  Clock, Bell, Users, Shuffle, Mail, Tag, Loader2, Filter, ChevronDown
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import TestNotificationBtn from '@/components/TestNotificationBtn'

const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed']


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
      const { data: profile } = await supabase.from('profiles').select('role, parent_id').eq('id', user.id).single()
      const currentRole = profile?.role || 'admin'
      setRole(currentRole)
      if (profile?.parent_id) setParentAdminId(profile.parent_id)

      if (currentRole === 'admin') {
          const { data: teamData } = await supabase.from('profiles').select('id, business_name').eq('parent_id', user.id)
          setTeam(teamData || [])
      }

      let query = supabase.from('leads').select('*').order('created_at', { ascending: false })
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
                        <button onClick={executeRoundRobin} disabled={isAssigning} className="flex-1 md:flex-none p-3.5 rounded-2xl shadow-sm border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 active:scale-95 transition-all flex items-center justify-center gap-2">
                            {isAssigning ? <Loader2 size={18} className="animate-spin" /> : <Shuffle size={18} />}
                            <span className="hidden sm:inline font-bold text-sm">Distribute</span>
                        </button>
                        <button onClick={() => { setIsSyncModalOpen(true); fetch('/api/facebook/forms').then(r=>r.json()).then(d=>setForms(d.forms||[])) }} className="flex-1 md:flex-none p-3.5 rounded-2xl shadow-sm border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:scale-95 transition-all flex items-center justify-center gap-2">
                            <Download size={18} />
                            <span className="hidden sm:inline font-bold text-sm">Sync Meta</span>
                        </button>
                        <button onClick={() => fileInputRef.current?.click()} className="flex-1 md:flex-none p-3.5 rounded-2xl shadow-sm border border-slate-200/60 bg-white hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center">
                            <Upload size={18} className="text-slate-600" />
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
                    </>
                )}
                
                <button onClick={() => setIsAddModalOpen(true)} className="flex-1 md:flex-none bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-md shadow-slate-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 font-bold">
                    <Plus size={18} strokeWidth={3} /> <span className="hidden sm:inline">Add Lead</span>
                </button>
            </div>
        </div>

        {/* SEARCH & FILTERS BAR */}
        <div className="bg-white p-4 sm:p-5 rounded-[2rem] shadow-sm border border-slate-200/60 mb-8 space-y-4">
            
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

            <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide pt-1">
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
                    <div key={lead.id} onClick={() => handleLeadClick(lead)} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200/60 cursor-pointer hover:border-blue-300 hover:shadow-lg active:scale-[0.98] transition-all duration-300 flex flex-col h-full group">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex-1 min-w-0 pr-4">
                                <h3 className="font-extrabold text-slate-900 text-lg truncate group-hover:text-blue-600">{lead.name || 'Unknown Lead'}</h3>
                                <div className="flex flex-col gap-1 mt-1.5">
                                    <p className="text-sm text-slate-500 font-medium flex items-center gap-1.5 truncate"><Phone size={14} className="text-slate-400"/> {lead.phone}</p>
                                    {lead.email && <p className="text-xs text-slate-400 font-medium flex items-center gap-1.5 truncate"><Mail size={12} className="text-slate-300"/> {lead.email}</p>}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                {lead.phone && (
                                    <>
                                        <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} onClick={e => e.stopPropagation()} target="_blank" rel="noopener noreferrer" className="p-2.5 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366] hover:text-white rounded-xl transition-colors shadow-sm"><MessageCircle size={18} /></a>
                                        <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="p-2.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-xl transition-colors shadow-sm"><Phone size={18} /></a>
                                    </>
                                )}
                                <button onClick={(e) => handleDeleteLead(lead.id, e)} className="p-2.5 bg-red-50 text-red-400 hover:bg-red-500 hover:text-white rounded-xl transition-colors shadow-sm"><Trash2 size={18} /></button>
                            </div>
                        </div>

                        {lead.next_followup && new Date(lead.next_followup) > new Date() && (
                            <div className="mb-4">
                                <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 font-bold bg-amber-50 border border-amber-200/60 px-3 py-1.5 rounded-xl shadow-sm">
                                    <Clock size={12} /> Reminder: {new Date(lead.next_followup).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                                </span>
                            </div>
                        )}
                        <div className="flex-grow"></div>

                        <div className="mt-2 pt-4 border-t border-slate-100 flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg border border-slate-200 max-w-full truncate uppercase tracking-wider"><Tag size={10}/> {lead.form_name || lead.source}</span>
                                {(lead.ad_name || lead.campaign_name) && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg border border-blue-100 max-w-[150px] truncate uppercase tracking-wider">{lead.ad_name || lead.campaign_name}</span>}
                            </div>
                            {role === 'admin' && (
                                <div className="relative w-full" onClick={e => e.stopPropagation()}>
                                    <Users size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    <select value={lead.assigned_to || ''} onChange={(e) => assignLead(lead.id, e.target.value, e)} className="w-full appearance-none bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 text-slate-700 text-xs font-bold rounded-xl py-2.5 pl-9 pr-8 outline-none transition-all cursor-pointer truncate">
                                        <option value="">Unassigned (Team)</option>
                                        {team.map(member => <option key={member.id} value={member.id}>{member.business_name || 'Agent'}</option>)}
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><ChevronDown size={14} /></div>
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
            <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden">
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
            <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 flex flex-col overflow-hidden">
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