'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  Search, Phone, MessageCircle, Filter, RefreshCw, Upload, 
  Plus, CheckCircle2, X, Download, Trash2, UserPlus, 
  Clock, Send, Bell 
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import TestNotificationBtn from '@/components/TestNotificationBtn'

const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed']
const CACHE_KEY = 'crm_leads_cache'
const CACHE_TIME_KEY = 'crm_leads_last_fetch'
const CACHE_DURATION = 5 * 60 * 1000 // 5 Minutes

// Utility for Web Push VAPID key conversion
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
  
  // --- CORE STATE ---
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('New')
  const [searchQuery, setSearchQuery] = useState('')

  // --- SYNC STATE ---
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [forms, setForms] = useState<any[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [isLoadingForms, setIsLoadingForms] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  // --- MANUAL ADD STATE ---
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', notes: '' })
  const [isAdding, setIsAdding] = useState(false)

  // --- LEAD PROFILE & HISTORY STATE ---
  const [selectedLead, setSelectedLead] = useState<any>(null)
  const [leadHistory, setLeadHistory] = useState<any[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [remarkInput, setRemarkInput] = useState('')
  const [reminderDate, setReminderDate] = useState('')
  
  // --- PUSH NOTIFICATION STATE ---
  const [isPushEnabled, setIsPushEnabled] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- 1. INITIALIZATION ---
  useEffect(() => { 
    fetchLeads()
    checkPushSubscription()
  }, [])

  const checkPushSubscription = async () => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsPushEnabled(!!subscription);
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
      
      if (!vapidPublicKey) {
        alert("Configuration Error: VAPID Public Key is missing.");
        return;
      }

      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
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
      } else {
        alert('Failed to save subscription to database.');
      }
    } catch (e) {
      console.error("Push setup error:", e);
      alert('Push setup failed. Make sure VAPID keys are configured properly.');
    }
  }

  // --- 2. DATA FETCHING ---
  const fetchLeads = async (force = false) => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Cache Logic
    const cachedData = localStorage.getItem(CACHE_KEY)
    const lastFetch = localStorage.getItem(CACHE_TIME_KEY)
    const now = Date.now()

    if (cachedData && !force) {
        setLeads(JSON.parse(cachedData))
        setLoading(false)
        // Skip DB fetch if cache is fresh
        if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) {
            return;
        }
    }

    // DB Fetch
    const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
    
    if (data) {
        setLeads(data)
        localStorage.setItem(CACHE_KEY, JSON.stringify(data))
        localStorage.setItem(CACHE_TIME_KEY, now.toString())
    }
    setLoading(false)
  }

  const fetchLeadHistory = async (leadId: string) => {
      setIsLoadingHistory(true)
      const { data } = await supabase
        .from('lead_history')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
      
      if (data) setLeadHistory(data)
      setIsLoadingHistory(false)
  }

  // --- 3. CORE ACTIONS ---

  const handleLeadClick = (lead: any) => {
      setSelectedLead(lead)
      setLeadHistory([])
      fetchLeadHistory(lead.id)
  }

  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone) {
        alert("Name and Phone are required")
        return
    }
    setIsAdding(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
        const leadPayload = {
            user_id: user.id,
            name: newLead.name,
            phone: newLead.phone,
            email: newLead.email,
            notes: newLead.notes,
            source: 'Manual',
            pipeline_stage: 'New'
        }

        // Optimistic Update
        const optimisticLead = { ...leadPayload, id: 'temp-' + Date.now(), created_at: new Date().toISOString() }
        setLeads(prev => [optimisticLead, ...prev])
        setIsAddModalOpen(false)
        setNewLead({ name: '', phone: '', email: '', notes: '' })

        // Actual DB Insert
        const { data, error } = await supabase.from('leads').insert(leadPayload).select().single()
        
        if (data) {
            setLeads(prev => prev.map(l => l.id === optimisticLead.id ? data : l))
            const currentCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
            localStorage.setItem(CACHE_KEY, JSON.stringify([data, ...currentCache]))
        } else {
            console.error("Failed to insert lead:", error)
            alert("Failed to save lead.")
            fetchLeads(true) // Revert optimistic update
        }
    }
    setIsAdding(false)
  }

  const handleDeleteLead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent opening the modal
    if (!confirm("Are you sure you want to delete this lead?")) return

    // Optimistic Delete
    const updatedLeads = leads.filter(l => l.id !== id)
    setLeads(updatedLeads)
    localStorage.setItem(CACHE_KEY, JSON.stringify(updatedLeads)) 

    await supabase.from('leads').delete().eq('id', id)
  }

  const openSyncModal = async () => {
    setIsSyncModalOpen(true)
    setIsLoadingForms(true)
    try {
        const res = await fetch('/api/facebook/forms')
        const data = await res.json()
        if (data.forms) setForms(data.forms)
    } catch (e) { 
        console.error("Error fetching forms:", e) 
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
        } else {
            alert('Sync failed: ' + data.error)
        }
    } catch (e) { 
        console.error(e)
        alert('Network Error during sync.') 
    }
    setIsSyncing(false)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
        const text = event.target?.result as string
        const rows = text.split('\n').slice(1) // Skip header row
        
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return;

        const newLeads = []

        for (const row of rows) {
            const cols = row.split(',')
            if (cols.length < 2) continue // Skip empty rows
            
            newLeads.push({ 
                user_id: user.id, 
                name: cols[0]?.trim(), 
                phone: cols[1]?.trim(), 
                email: cols[2]?.trim(), 
                source: 'CSV Import', 
                pipeline_stage: 'New' 
            })
        }

        if (newLeads.length > 0) {
            await supabase.from('leads').insert(newLeads)
            fetchLeads(true)
            alert(`Successfully imported ${newLeads.length} leads from CSV.`)
        }
    }
    reader.readAsText(file)
  }

  // --- 4. PROFILE & HISTORY ACTIONS ---

  const updateStage = async (leadId: string, newStage: string) => {
    // 1. Optimistic Lead Update
    const updated = leads.map(l => l.id === leadId ? { ...l, pipeline_stage: newStage } : l)
    setLeads(updated)
    localStorage.setItem(CACHE_KEY, JSON.stringify(updated))
    
    if (selectedLead) {
        setSelectedLead({ ...selectedLead, pipeline_stage: newStage })
    }

    // 2. Optimistic History Update
    const desc = `Moved to ${newStage}`
    setLeadHistory([{ 
        id: Date.now(), 
        action_type: 'STATUS_CHANGE', 
        description: desc, 
        created_at: new Date().toISOString() 
    }, ...leadHistory])

    // 3. API Calls
    await fetch('/api/crm/update-stage', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ leadId, newStage, notes: selectedLead?.notes }) 
    })
    
    await fetch('/api/crm/lead-action', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ leadId, actionType: 'STATUS_CHANGE', description: desc }) 
    })
  }

  const handleAddRemark = async () => {
      if (!remarkInput.trim()) return
      const text = remarkInput
      
      // Optimistic Update
      const newAction = { 
          id: Date.now(), 
          action_type: 'REMARK', 
          description: text, 
          created_at: new Date().toISOString() 
      }
      setLeadHistory([newAction, ...leadHistory])
      setRemarkInput('')

      // API Call
      await fetch('/api/crm/lead-action', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ leadId: selectedLead.id, actionType: 'REMARK', description: text }) 
      })
  }

  const handleSetReminder = async () => {
      if (!reminderDate) return
      
      const desc = `Follow-up set for ${new Date(reminderDate).toLocaleString()}`
      
      // Optimistic History Update
      const newAction = { 
          id: Date.now(), 
          action_type: 'REMINDER_SET', 
          description: desc, 
          created_at: new Date().toISOString() 
      }
      setLeadHistory([newAction, ...leadHistory])
      
      // Update local lead state so badge shows immediately
      setLeads(leads.map(l => l.id === selectedLead.id ? { ...l, next_followup: reminderDate } : l))
      setReminderDate('')

      // API Call
      await fetch('/api/crm/lead-action', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ 
              leadId: selectedLead.id, 
              actionType: 'REMINDER_SET', 
              description: desc, 
              nextFollowup: reminderDate 
          }) 
      })
  }

  // --- FILTERING ---
  const filteredLeads = leads.filter(l => {
      const matchStage = (l.pipeline_stage || 'New') === activeStage
      const matchSearch = l.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          l.phone?.includes(searchQuery) ||
                          l.email?.toLowerCase().includes(searchQuery.toLowerCase())
      return matchStage && matchSearch
  })

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24 relative overflow-x-hidden bg-slate-50">
      
      {/* HEADER SECTION */}
      <div className="flex justify-between items-end mb-6">
        <div className="w-[60%]">
            <h1 className="text-2xl font-bold text-slate-900">CRM</h1>
            
            {/* Push Notification Controls */}
            <div className="flex items-center gap-2 mt-2">
                {!isPushEnabled ? (
                    <button 
                        onClick={enablePushNotifications} 
                        className="text-[10px] text-primary font-bold flex items-center gap-1 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                    >
                        <Bell size={10} /> Enable Notifications
                    </button>
                ) : (
                    <TestNotificationBtn />
                )}
            </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap justify-end w-[40%]">
            <button 
                onClick={() => fetchLeads(true)} 
                disabled={loading} 
                className="p-2.5 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform bg-white hover:bg-slate-50"
            >
                <RefreshCw size={18} className={`text-slate-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button 
                onClick={openSyncModal} 
                className="p-2.5 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform bg-white hover:bg-slate-50"
                title="Sync Facebook Leads"
            >
                <Download size={18} className="text-slate-600" />
            </button>
            <button 
                onClick={() => fileInputRef.current?.click()} 
                className="p-2.5 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform bg-white hover:bg-slate-50"
                title="Upload CSV"
            >
                <Upload size={18} className="text-slate-600" />
            </button>
            <button 
                onClick={() => setIsAddModalOpen(true)} 
                className="bg-slate-900 text-white p-2.5 rounded-full shadow-md active:scale-95 transition-transform hover:bg-slate-800"
                title="Manual Add Lead"
            >
                <Plus size={18} />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search leads by name, phone, or email..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            className="w-full bg-white pl-10 pr-4 py-3 rounded-xl text-sm border border-slate-200 focus:ring-2 focus:ring-blue-100 outline-none shadow-sm transition-shadow" 
          />
      </div>

      {/* PIPELINE STAGES (TABS) */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide mb-2">
        {STAGES.map(stage => (
            <button 
                key={stage} 
                onClick={() => setActiveStage(stage)} 
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${activeStage === stage ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}
            >
                {stage} 
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-md text-[10px] ${activeStage === stage ? 'bg-blue-200 text-blue-800' : 'bg-slate-100 text-slate-500'}`}>
                    {leads.filter(l => (l.pipeline_stage || 'New') === stage).length}
                </span>
            </button>
        ))}
      </div>

      {/* LEAD LISTING */}
      <div className="space-y-3 min-h-[50vh]">
        {filteredLeads.map(lead => (
            <div 
                key={lead.id} 
                onClick={() => handleLeadClick(lead)} 
                className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 active:scale-[0.98] transition-transform cursor-pointer relative group hover:border-blue-100 hover:shadow-md"
            >
                <div className="flex justify-between items-start">
                    
                    {/* Info Side */}
                    <div className="flex-1 min-w-0 pr-2">
                        <h3 className="font-bold text-slate-800 truncate text-base">{lead.name || 'Unknown Lead'}</h3>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{lead.phone}</p>
                        
                        {/* Reminder Badge */}
                        {lead.next_followup && new Date(lead.next_followup) > new Date() && (
                            <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1 mt-1.5 bg-amber-50 border border-amber-100 w-fit px-2 py-0.5 rounded-md truncate shadow-sm">
                                <Clock size={10} /> {new Date(lead.next_followup).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                            </p>
                        )}
                    </div>

                    {/* Action Buttons Side */}
                    <div className="flex gap-2 shrink-0">
                        {lead.phone && (
                            <>
                                <a 
                                    href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} 
                                    onClick={e => e.stopPropagation()} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="p-2 bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors shadow-sm"
                                    title="WhatsApp"
                                >
                                    <MessageCircle size={16} />
                                </a>
                                <a 
                                    href={`tel:${lead.phone}`} 
                                    onClick={e => e.stopPropagation()} 
                                    className="p-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors shadow-sm"
                                    title="Call"
                                >
                                    <Phone size={16} />
                                </a>
                            </>
                        )}
                        <button 
                            onClick={(e) => handleDeleteLead(lead.id, e)} 
                            className="p-2 bg-red-50 text-red-400 rounded-full hover:bg-red-100 transition-colors shadow-sm"
                            title="Delete Lead"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                </div>
                
                {/* Footer Badges */}
                <div className="mt-4 pt-3 border-t border-slate-50 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-md max-w-[120px] truncate border border-slate-200">
                            {lead.source}
                        </span>
                        {lead.ad_name && (
                            <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-1 rounded-md max-w-[150px] truncate border border-blue-100">
                                {lead.ad_name}
                            </span>
                        )}
                    </div>
                    <span className="text-[9px] text-slate-300 font-medium tracking-wide self-end">
                        ADDED {new Date(lead.created_at).toLocaleDateString().toUpperCase()}
                    </span>
                </div>
            </div>
        ))}

        {filteredLeads.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-200">
                <Filter size={24} className="mx-auto mb-2 opacity-50" />
                No leads match this criteria.
            </div>
        )}
      </div>


      {/* =========================================
          MODALS
      ============================================= */}

      {/* 1. MANUAL ADD MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <UserPlus size={20} className="text-primary" /> 
                        Add Lead
                    </h2>
                    <button onClick={() => setIsAddModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Name <span className="text-red-400">*</span></label>
                        <input type="text" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border border-slate-100 focus:ring-2 focus:ring-blue-100 outline-none transition-shadow" placeholder="e.g. John Doe" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Phone <span className="text-red-400">*</span></label>
                        <input type="tel" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border border-slate-100 focus:ring-2 focus:ring-blue-100 outline-none transition-shadow" placeholder="+91 9876543210" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Email (Optional)</label>
                        <input type="email" value={newLead.email} onChange={e => setNewLead({...newLead, email: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border border-slate-100 focus:ring-2 focus:ring-blue-100 outline-none transition-shadow" placeholder="john@example.com" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Notes (Optional)</label>
                        <textarea value={newLead.notes} onChange={e => setNewLead({...newLead, notes: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm border border-slate-100 focus:ring-2 focus:ring-blue-100 outline-none resize-none transition-shadow" rows={2} placeholder="Any context or requirements?" />
                    </div>
                    
                    <button 
                        onClick={handleAddLead} 
                        disabled={isAdding || !newLead.name || !newLead.phone} 
                        className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold mt-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors shadow-md"
                    >
                        {isAdding ? 'Saving...' : 'Save Lead'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* 2. SYNC MODAL */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Download size={20} className="text-primary"/>
                        Sync Facebook Leads
                    </h2>
                    <button onClick={() => setIsSyncModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                </div>

                <div className="space-y-4">
                    {isLoadingForms ? (
                        <div className="py-12 flex flex-col items-center gap-3 text-slate-400 text-xs font-medium">
                            <RefreshCw className="animate-spin text-slate-300" size={28} />
                            Fetching Lead Forms...
                        </div>
                    ) : (
                        <>
                            <div className="max-h-64 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                <button 
                                    onClick={() => setSelectedFormId('')} 
                                    className={`w-full p-3.5 rounded-xl text-left text-sm font-bold border transition-all flex justify-between items-center ${selectedFormId === '' ? 'border-green-500 bg-green-50 text-green-700 shadow-sm' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'}`}
                                >
                                    <span>Sync All Active Forms</span>
                                    {selectedFormId === '' && <CheckCircle2 size={18} />}
                                </button>
                                
                                {forms.map(form => (
                                    <button 
                                        key={form.id} 
                                        onClick={() => setSelectedFormId(form.id)} 
                                        className={`w-full p-3.5 rounded-xl text-left text-sm font-bold border transition-all flex justify-between items-center ${selectedFormId === form.id ? 'border-green-500 bg-green-50 text-green-700 shadow-sm' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'}`}
                                    >
                                        <div className="min-w-0 pr-3">
                                            <p className="truncate text-left w-full text-sm">{form.name}</p>
                                            <p className="text-[10px] opacity-70 font-normal mt-1">{form.leads_count} leads captured • {form.status}</p>
                                        </div>
                                        {selectedFormId === form.id && <CheckCircle2 size={18} className="shrink-0" />}
                                    </button>
                                ))}
                            </div>

                            <button 
                                onClick={handleSync} 
                                disabled={isSyncing} 
                                className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors shadow-md mt-2"
                            >
                                {isSyncing ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
                                {isSyncing ? 'Syncing Leads...' : 'Start Import'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* 3. OVERFLOW-SAFE LEAD PROFILE & HISTORY MODAL */}
      {selectedLead && (
        <div className="fixed inset-x-0 bottom-0 top-auto z-[90] bg-black/40 backdrop-blur-sm flex items-end justify-center sm:items-center sm:inset-0 sm:p-4 animate-in fade-in duration-200">
          
          {/* Main Modal Container: Uses DVH (Dynamic Viewport Height) for mobile to prevent keyboard/toolbar overflow */}
          <div className="bg-slate-50 w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col h-[85dvh] sm:h-auto sm:max-h-[85vh] border border-slate-100 overflow-hidden relative">
            
            {/* Modal Header (Fixed at top) */}
            <div className="p-5 sm:p-6 bg-white border-b border-slate-200 flex justify-between items-start shrink-0 z-10">
                <div className="min-w-0 pr-3">
                    <h2 className="text-xl font-bold text-slate-900 truncate">{selectedLead.name}</h2>
                    <p className="text-xs font-medium text-slate-500 mt-1 truncate">
                        {selectedLead.phone} {selectedLead.email ? `• ${selectedLead.email}` : ''}
                    </p>
                </div>
                <button onClick={() => setSelectedLead(null)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors shrink-0">
                    <X size={20} />
                </button>
            </div>

            {/* Scrollable Content Area (Flex 1, Min H 0 ensures inner content scrolls properly) */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 min-h-0 bg-slate-50/50 relative">
                
                {/* Meta & Source Information */}
                <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-50">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lead Source</span>
                        <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md border border-blue-100">{selectedLead.source}</span>
                    </div>
                    {selectedLead.ad_name && (
                        <p className="text-xs font-medium text-slate-600 break-words mb-4 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                            <span className="font-bold text-slate-400 block mb-0.5 text-[10px] uppercase">Campaign / Ad Name</span>
                            {selectedLead.ad_name}
                        </p>
                    )}
                    
                    <div className="mt-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 ml-1">Static Notes</label>
                        <textarea 
                            className="w-full bg-slate-50 p-3 rounded-xl text-sm border border-slate-100 focus:ring-2 focus:ring-blue-100 outline-none resize-none transition-shadow" 
                            rows={2} 
                            placeholder="Add basic static notes here..." 
                            defaultValue={selectedLead.notes || ''}
                            onBlur={(e) => setSelectedLead({...selectedLead, notes: e.target.value})}
                        />
                    </div>
                </div>

                {/* Pipeline Stage Selector */}
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1 block mb-2">Pipeline Stage</label>
                    <div className="flex flex-wrap gap-2">
                        {STAGES.map(stage => (
                            <button 
                                key={stage} 
                                onClick={() => updateStage(selectedLead.id, stage)} 
                                className={`py-2 px-3.5 rounded-xl text-xs font-bold border transition-all ${selectedLead.pipeline_stage === stage ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                            >
                                {stage}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Reminder Setup Block */}
                <div className="bg-white p-4.5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-400" />
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider ml-2 flex items-center gap-1 mb-2">
                        <Clock size={12} className="text-amber-500"/> Set Follow-up Reminder
                    </label>
                    <div className="flex gap-2 w-full pl-1">
                        <input 
                            type="datetime-local" 
                            value={reminderDate} 
                            onChange={e => setReminderDate(e.target.value)} 
                            className="flex-1 min-w-0 bg-slate-50 p-2.5 rounded-xl text-sm border border-slate-100 outline-none focus:ring-2 focus:ring-amber-200 transition-shadow" 
                        />
                        <button 
                            onClick={handleSetReminder} 
                            className="bg-amber-100 text-amber-700 px-5 rounded-xl text-xs font-bold active:scale-95 transition-transform shrink-0 border border-amber-200 hover:bg-amber-200"
                        >
                            Set Alert
                        </button>
                    </div>
                </div>

                {/* Vertical Timeline History Log */}
                <div className="pt-2">
                    <h3 className="text-sm font-bold text-slate-900 mb-5 ml-1">Activity Log</h3>
                    
                    <div className="space-y-5 relative before:absolute before:inset-0 before:ml-[22px] before:-translate-x-px before:h-full before:w-[2px] before:bg-slate-200 before:rounded-full">
                        
                        {isLoadingHistory ? (
                            <div className="flex items-center gap-2 text-xs text-slate-400 ml-12 font-medium">
                                <RefreshCw size={12} className="animate-spin" /> Loading timeline...
                            </div>
                        ) : leadHistory.length === 0 ? (
                            <p className="text-xs text-slate-400 ml-12 font-medium italic">No activity logged yet.</p>
                        ) : (
                            leadHistory.map((item, index) => {
                                const isRemark = item.action_type === 'REMARK';
                                const isReminder = item.action_type === 'REMINDER_SET';
                                const isStatus = item.action_type === 'STATUS_CHANGE';

                                return (
                                    <div key={item.id} className="relative flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}>
                                        
                                        {/* Icon Node */}
                                        <div className={`flex items-center justify-center w-11 h-11 rounded-full border-[3px] border-slate-50 shrink-0 shadow-sm z-10 ${isRemark ? 'bg-blue-100 text-blue-600' : isReminder ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
                                            {isRemark ? <MessageCircle size={16}/> : isReminder ? <Clock size={16} /> : <CheckCircle2 size={16} />}
                                        </div>
                                        
                                        {/* Content Card */}
                                        <div className="flex-1 min-w-0 bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mt-0.5">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <div className="font-bold text-xs text-slate-900 capitalize truncate pr-2">
                                                    {item.action_type.replace('_', ' ')}
                                                </div>
                                                <time className="text-[10px] font-bold text-slate-400 shrink-0 bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-100">
                                                    {new Date(item.created_at).toLocaleString([], {hour: '2-digit', minute:'2-digit', month: 'short', day: 'numeric'})}
                                                </time>
                                            </div>
                                            <div className="text-xs text-slate-600 leading-relaxed break-words font-medium">
                                                {item.description}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Sticky Footer (Input for Remarks) - Fixed at bottom of modal */}
            <div className="p-4 sm:p-5 bg-white border-t border-slate-200 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-safe relative z-20">
                <div className="flex gap-2 w-full max-w-full">
                    <input 
                        type="text" 
                        value={remarkInput} 
                        onChange={e => setRemarkInput(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && handleAddRemark()} 
                        placeholder="Type a note or remark..." 
                        className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-full px-5 text-sm outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all shadow-inner" 
                    />
                    <button 
                        onClick={handleAddRemark} 
                        disabled={!remarkInput.trim()} 
                        className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-50 disabled:bg-slate-300 active:scale-95 transition-all shrink-0 shadow-md hover:shadow-lg"
                        title="Add Remark"
                    >
                        <Send size={18} className="ml-1" />
                    </button>
                </div>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}