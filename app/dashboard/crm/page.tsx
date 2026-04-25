'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Search, Phone, MessageCircle, Filter, RefreshCw, Upload, 
  Plus, CheckCircle2, X, Download, Trash2, UserPlus, 
  Clock, Bell, Users, Shuffle
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import TestNotificationBtn from '@/components/TestNotificationBtn'

const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed']
const CACHE_KEY_PREFIX = 'crm_leads_cache_'
const CACHE_TIME_KEY_PREFIX = 'crm_leads_last_fetch_'
const CACHE_DURATION = 5 * 60 * 1000 

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
  const [isAssigning, setIsAssigning] = useState(false)

  // --- CRM STATE ---
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('New')
  const [searchQuery, setSearchQuery] = useState('')

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

  useEffect(() => { 
    fetchLeads()
    checkPushSubscription()
  }, [])

  const checkPushSubscription = async () => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        setIsPushEnabled(true);
        const subData = JSON.parse(JSON.stringify(subscription));
        await fetch('/api/web-push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: subData })
        }).catch(e => console.error("Auto-sync failed", e));
      } else {
        setIsPushEnabled(false);
      }
    }
  }

  const enablePushNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Permission denied. Please allow notifications in your browser settings.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey!);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });

      const subData = JSON.parse(JSON.stringify(subscription));
      const res = await fetch('/api/web-push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subData })
      });

      if (res.ok) {
        setIsPushEnabled(true);
        alert('Notifications Enabled Successfully!');
      }
    } catch (e) {
      console.error("Push setup error:", e);
    }
  }

  const fetchLeads = async (force = false) => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. Establish Role & Hierarchy
    const { data: profile } = await supabase.from('profiles').select('role, parent_id').eq('id', user.id).single()
    const currentRole = profile?.role || 'admin'
    setRole(currentRole)
    if (profile?.parent_id) setParentAdminId(profile.parent_id)

    // 2. Fetch Team if Admin
    if (currentRole === 'admin') {
        const { data: teamData } = await supabase.from('profiles').select('id, business_name').eq('parent_id', user.id)
        setTeam(teamData || [])
    }

    // 3. Cache Logic (Keyed by User ID for security)
    const CACHE_KEY = CACHE_KEY_PREFIX + user.id
    const CACHE_TIME_KEY = CACHE_TIME_KEY_PREFIX + user.id
    const cachedData = localStorage.getItem(CACHE_KEY)
    const lastFetch = localStorage.getItem(CACHE_TIME_KEY)
    const now = Date.now()

    if (cachedData && !force) {
        setLeads(JSON.parse(cachedData))
        setLoading(false)
        if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) return;
    }

    // 4. Fetch Leads strictly based on Role
    let query = supabase.from('leads').select('*').order('created_at', { ascending: false })
    
    if (currentRole === 'admin') {
        query = query.eq('user_id', user.id) // Admin sees their master list
    } else {
        query = query.eq('user_id', profile?.parent_id).eq('assigned_to', user.id) // Agent sees assigned
    }

    const { data } = await query
    
    if (data) {
        setLeads(data)
        localStorage.setItem(CACHE_KEY, JSON.stringify(data))
        localStorage.setItem(CACHE_TIME_KEY, now.toString())
    }
    setLoading(false)
  }

  const handleLeadClick = (lead: any) => {
      router.push(`/dashboard/crm/${lead.id}`)
  }

  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone) return alert("Name and Phone are required")
    setIsAdding(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
        // If agent creates a lead, route to Admin's CRM but assign to the creating agent
        const leadPayload: any = {
            user_id: role === 'agent' && parentAdminId ? parentAdminId : user.id,
            name: newLead.name,
            phone: newLead.phone,
            email: newLead.email,
            notes: newLead.notes,
            source: 'Manual',
            pipeline_stage: 'New'
        }

        if (role === 'agent') {
            leadPayload.assigned_to = user.id
        }

        const optimisticLead = { ...leadPayload, id: 'temp-' + Date.now(), created_at: new Date().toISOString() }
        setLeads(prev => [optimisticLead, ...prev])
        setIsAddModalOpen(false)
        setNewLead({ name: '', phone: '', email: '', notes: '' })

        const { data, error } = await supabase.from('leads').insert(leadPayload).select().single()
        
        if (data) {
            setLeads(prev => prev.map(l => l.id === optimisticLead.id ? data : l))
            const CACHE_KEY = CACHE_KEY_PREFIX + user.id
            const currentCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
            localStorage.setItem(CACHE_KEY, JSON.stringify([data, ...currentCache]))
        } else {
            fetchLeads(true) 
        }
    }
    setIsAdding(false)
  }

  const handleDeleteLead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation() 
    if (!confirm("Are you sure you want to delete this lead?")) return

    const { data: { user } } = await supabase.auth.getUser()
    const updatedLeads = leads.filter(l => l.id !== id)
    setLeads(updatedLeads)
    if (user) localStorage.setItem(CACHE_KEY_PREFIX + user.id, JSON.stringify(updatedLeads)) 
    await supabase.from('leads').delete().eq('id', id)
  }

  // --- MANUAL ASSIGNMENT LOGIC ---
  const assignLead = async (leadId: string, agentId: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    const targetAgentId = agentId === '' ? null : agentId;
    
    // Optimistic UI Update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, assigned_to: targetAgentId } : l))
    await supabase.from('leads').update({ assigned_to: targetAgentId }).eq('id', leadId)
    fetchLeads(true) // Refresh cache quietly in background
  }

  // --- ROUND ROBIN LOGIC ---
  const executeRoundRobin = async () => {
    if (team.length === 0) return alert("You need to add team members in the Team tab first.")
    
    const unassignedLeads = leads.filter(l => !l.assigned_to)
    if (unassignedLeads.length === 0) return alert("All leads are currently assigned.")

    setIsAssigning(true)
    let currentAgentIndex = 0
    let updatedLeads = [...leads]

    try {
        for (const lead of unassignedLeads) {
            const agent = team[currentAgentIndex]
            
            // Update DB
            await supabase.from('leads').update({ assigned_to: agent.id }).eq('id', lead.id)
            
            // Update UI State
            const leadIndex = updatedLeads.findIndex(l => l.id === lead.id)
            updatedLeads[leadIndex].assigned_to = agent.id

            currentAgentIndex = (currentAgentIndex + 1) % team.length
        }

        setLeads(updatedLeads)
        const { data: { user } } = await supabase.auth.getUser()
        if (user) localStorage.setItem(CACHE_KEY_PREFIX + user.id, JSON.stringify(updatedLeads))
        alert(`Successfully distributed ${unassignedLeads.length} leads across your team.`)
    } catch (e: any) {
        alert("Error distributing leads: " + e.message)
    } finally {
        setIsAssigning(false)
    }
  }

  const openSyncModal = async () => {
    setIsSyncModalOpen(true)
    setIsLoadingForms(true)
    try {
        const res = await fetch('/api/facebook/forms')
        const data = await res.json()
        if (data.forms) setForms(data.forms)
    } finally { 
        setIsLoadingForms(false) 
    }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try {
        const res = await fetch('/api/crm/sync', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ formId: selectedFormId || undefined }) 
        })
        const data = await res.json()
        if (data.success) {
            alert(`Success! Imported ${data.count} new leads out of ${data.total} found.`)
            fetchLeads(true)
            setIsSyncModalOpen(false)
        }
    } finally {
        setIsSyncing(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (event) => {
        const text = event.target?.result as string
        const rows = text.split('\n').slice(1)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return;
        const newLeads = []
        for (const row of rows) {
            const cols = row.split(',')
            if (cols.length < 2) continue 
            newLeads.push({ 
                user_id: user.id, name: cols[0]?.trim(), phone: cols[1]?.trim(), 
                email: cols[2]?.trim(), source: 'CSV Import', pipeline_stage: 'New' 
            })
        }
        if (newLeads.length > 0) {
            await supabase.from('leads').insert(newLeads)
            fetchLeads(true)
        }
    }
    reader.readAsText(file)
  }

  const filteredLeads = leads.filter(l => {
      const matchStage = (l.pipeline_stage || 'New') === activeStage
      const matchSearch = l.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          l.phone?.includes(searchQuery) ||
                          l.email?.toLowerCase().includes(searchQuery.toLowerCase())
      return matchStage && matchSearch
  })

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24 relative overflow-x-hidden bg-slate-50">
      <div className="flex justify-between items-end mb-6">
        <div className="w-[60%]">
            <h1 className="text-2xl font-bold text-slate-900">CRM</h1>
            <div className="flex items-center gap-2 mt-2">
                {!isPushEnabled ? (
                    <button onClick={enablePushNotifications} className="text-[10px] text-primary font-bold flex items-center gap-1 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors">
                        <Bell size={10} /> Enable Notifications
                    </button>
                ) : <TestNotificationBtn />}
            </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end w-[40%]">
            <button onClick={() => fetchLeads(true)} className="p-2.5 rounded-full shadow-sm border border-slate-100 bg-white hover:bg-slate-50">
                <RefreshCw size={18} className={`text-slate-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
            
            {/* ADMIN ONLY CONTROLS */}
            {role === 'admin' && (
                <>
                    <button onClick={executeRoundRobin} disabled={isAssigning} className="p-2.5 rounded-full shadow-sm border border-slate-100 bg-purple-50 text-purple-600 hover:bg-purple-100" title="Round-Robin Distribute">
                        {isAssigning ? <RefreshCw size={18} className="animate-spin" /> : <Shuffle size={18} />}
                    </button>
                    <button onClick={openSyncModal} className="p-2.5 rounded-full shadow-sm border border-slate-100 bg-white hover:bg-slate-50"><Download size={18} className="text-slate-600" /></button>
                    <button onClick={() => fileInputRef.current?.click()} className="p-2.5 rounded-full shadow-sm border border-slate-100 bg-white hover:bg-slate-50"><Upload size={18} className="text-slate-600" /></button>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
                </>
            )}
            
            {/* BOTH ROLES */}
            <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-900 text-white p-2.5 rounded-full shadow-md"><Plus size={18} /></button>
        </div>
      </div>

      <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input type="text" placeholder="Search leads by name, phone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white pl-10 pr-4 py-3 rounded-xl text-sm border border-slate-200 outline-none shadow-sm" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide mb-2">
        {STAGES.map(stage => (
            <button key={stage} onClick={() => setActiveStage(stage)} className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${activeStage === stage ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border border-slate-200'}`}>
                {stage} <span className={`ml-1.5 px-1.5 py-0.5 rounded-md text-[10px] ${activeStage === stage ? 'bg-blue-200 text-blue-800' : 'bg-slate-100 text-slate-500'}`}>{leads.filter(l => (l.pipeline_stage || 'New') === stage).length}</span>
            </button>
        ))}
      </div>

      <div className="space-y-3 min-h-[50vh]">
        {filteredLeads.map(lead => (
            <div key={lead.id} onClick={() => handleLeadClick(lead)} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 cursor-pointer hover:border-blue-100">
                <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0 pr-2">
                        <h3 className="font-bold text-slate-800 truncate text-base">{lead.name || 'Unknown Lead'}</h3>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{lead.phone}</p>
                        {lead.next_followup && new Date(lead.next_followup) > new Date() && (
                            <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1 mt-1.5 bg-amber-50 border border-amber-100 w-fit px-2 py-0.5 rounded-md"><Clock size={10} /> {new Date(lead.next_followup).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}</p>
                        )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                        {lead.phone && (
                            <>
                                <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} onClick={e => e.stopPropagation()} target="_blank" rel="noopener noreferrer" className="p-2 bg-green-50 text-green-600 rounded-full"><MessageCircle size={16} /></a>
                                <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="p-2 bg-blue-50 text-blue-600 rounded-full"><Phone size={16} /></a>
                            </>
                        )}
                        <button onClick={(e) => handleDeleteLead(lead.id, e)} className="p-2 bg-red-50 text-red-400 rounded-full"><Trash2 size={16} /></button>
                    </div>
                </div>
                
                {/* Lower Row: Source Tags & Assignments */}
                <div className="mt-4 pt-3 border-t border-slate-50 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex gap-1.5">
                            <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-md max-w-[120px] truncate border border-slate-200">{lead.source}</span>
                            {lead.ad_name && <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-1 rounded-md max-w-[150px] truncate border border-blue-100">{lead.ad_name}</span>}
                        </div>

                        {/* Admin Manual Agent Assignment Dropdown */}
                        {role === 'admin' && (
                            <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
                                <select 
                                    value={lead.assigned_to || ''} 
                                    onChange={(e) => assignLead(lead.id, e.target.value, e)}
                                    className="appearance-none bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-bold rounded-md py-1 pl-6 pr-6 outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
                                >
                                    <option value="">Unassigned</option>
                                    {team.map(member => (
                                        <option key={member.id} value={member.id}>{member.business_name}</option>
                                    ))}
                                </select>
                                <Users size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        ))}
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserPlus size={20} className="text-primary" /> Add Lead</h2>
                    <button onClick={() => setIsAddModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={18} /></button>
                </div>
                <div className="space-y-4">
                    <div><input type="text" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border" placeholder="Name *" /></div>
                    <div><input type="tel" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border" placeholder="Phone *" /></div>
                    <div><input type="email" value={newLead.email} onChange={e => setNewLead({...newLead, email: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border" placeholder="Email" /></div>
                    <div><textarea value={newLead.notes} onChange={e => setNewLead({...newLead, notes: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border resize-none" rows={2} placeholder="Notes" /></div>
                    <button onClick={handleAddLead} disabled={isAdding || !newLead.name || !newLead.phone} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold">Save Lead</button>
                </div>
            </div>
        </div>
      )}

      {/* Sync Modal (Admin Only - Render Safety) */}
      {role === 'admin' && isSyncModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Download size={20} className="text-primary"/> Sync Facebook Leads</h2>
                    <button onClick={() => setIsSyncModalOpen(false)} className="bg-slate-100 p-2 rounded-full"><X size={18} /></button>
                </div>
                <div className="space-y-4">
                    {isLoadingForms ? (
                        <div className="py-12 flex flex-col items-center gap-3 text-slate-400 text-xs font-medium"><RefreshCw className="animate-spin" size={28} /></div>
                    ) : (
                        <>
                            <div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar">
                                <button onClick={() => setSelectedFormId('')} className={`w-full p-3.5 rounded-xl text-left text-sm font-bold border flex justify-between ${selectedFormId === '' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-100 bg-white'}`}><span>Sync All</span>{selectedFormId === '' && <CheckCircle2 size={18} />}</button>
                                {forms.map(form => (
                                    <button key={form.id} onClick={() => setSelectedFormId(form.id)} className={`w-full p-3.5 rounded-xl text-left text-sm font-bold border flex justify-between items-center ${selectedFormId === form.id ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-100 bg-white'}`}>
                                        <div className="min-w-0 pr-3"><p className="truncate w-full">{form.name}</p></div>
                                        {selectedFormId === form.id && <CheckCircle2 size={18} className="shrink-0" />}
                                    </button>
                                ))}
                            </div>
                            <button onClick={handleSync} disabled={isSyncing} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                                {isSyncing ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />} Start Import
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
      )}
    </div>
  )
}