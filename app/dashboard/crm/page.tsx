'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Phone, MessageCircle, RefreshCw, Upload, Plus, CheckCircle2, X, Download, Trash2, UserPlus, Clock, Send, Bell } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import TestNotificationBtn from '@/components/TestNotificationBtn'

const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed']
const CACHE_KEY = 'crm_leads_cache'
const CACHE_TIME_KEY = 'crm_leads_last_fetch'
const CACHE_DURATION = 5 * 60 * 1000 // 5 Minutes

// Utility for Push Notification key conversion
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
  return outputArray;
}

export default function CRMPage() {
  const supabase = createClient()
  
  // --- STATE ---
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('New')
  
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('')

  // Sync State
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [forms, setForms] = useState<any[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [isLoadingForms, setIsLoadingForms] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  // Manual Add State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', notes: '' })
  const [isAdding, setIsAdding] = useState(false)

  // Edit/View State (Expanded for Profile/History)
  const [selectedLead, setSelectedLead] = useState<any>(null)
  
  // New: History & Reminders State
  const [leadHistory, setLeadHistory] = useState<any[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [remarkInput, setRemarkInput] = useState('')
  const [reminderDate, setReminderDate] = useState('')
  const [isPushEnabled, setIsPushEnabled] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- 1. DATA FETCHING & INITIALIZATION ---
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
      if (permission !== 'granted') return alert('Permission denied');

      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey!);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });

      const subData = JSON.parse(JSON.stringify(subscription));
      await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subData.endpoint, keys: subData.keys })
      });
      setIsPushEnabled(true);
      alert('Notifications Enabled!');
    } catch (e) {
      console.error(e);
      alert('Push setup failed. Make sure VAPID keys are configured.');
    }
  }

  const fetchLeads = async (force = false) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // A. Try Local Cache First
    const cachedData = localStorage.getItem(CACHE_KEY)
    const lastFetch = localStorage.getItem(CACHE_TIME_KEY)
    const now = Date.now()

    if (cachedData && !force) {
        setLeads(JSON.parse(cachedData))
        setLoading(false)
        
        // If cache is fresh (< 5 mins), stop here
        if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) {
            return
        }
    }

    // B. Fetch from DB
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

  // --- 2. ACTIONS ---

  const handleLeadClick = (lead: any) => {
      setSelectedLead(lead)
      setLeadHistory([])
      fetchLeadHistory(lead.id)
  }

  // Manual Add
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

        // DB Insert
        const { data, error } = await supabase.from('leads').insert(leadPayload).select().single()
        
        if (data) {
            setLeads(prev => prev.map(l => l.id === optimisticLead.id ? data : l))
            const currentCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
            localStorage.setItem(CACHE_KEY, JSON.stringify([data, ...currentCache]))
        } else {
            alert("Failed to save lead.")
            fetchLeads(true)
        }
    }
    setIsAdding(false)
  }

  // Delete Lead
  const handleDeleteLead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation() 
    if (!confirm("Are you sure you want to delete this lead?")) return

    const updatedLeads = leads.filter(l => l.id !== id)
    setLeads(updatedLeads)
    localStorage.setItem(CACHE_KEY, JSON.stringify(updatedLeads)) 

    await supabase.from('leads').delete().eq('id', id)
  }

  // Sync Facebook
  const openSyncModal = async () => {
    setIsSyncModalOpen(true)
    setIsLoadingForms(true)
    try {
        const res = await fetch('/api/facebook/forms')
        const data = await res.json()
        if (data.forms) setForms(data.forms)
    } catch (e) { console.error(e) } 
    finally { setIsLoadingForms(false) }
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
    } catch (e) { alert('Network Error') }
    setIsSyncing(false)
  }

  // CSV Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
        const text = event.target?.result as string
        const rows = text.split('\n').slice(1) 
        const { data: { user } } = await supabase.auth.getUser()
        const newLeads = []

        for (const row of rows) {
            const cols = row.split(',')
            if (cols.length < 2) continue
            newLeads.push({
                user_id: user?.id,
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
            alert(`Imported ${newLeads.length} leads.`)
        }
    }
    reader.readAsText(file)
  }

  // Update Stage
  const updateStage = async (leadId: string, newStage: string) => {
    const updated = leads.map(l => l.id === leadId ? { ...l, pipeline_stage: newStage } : l)
    setLeads(updated)
    localStorage.setItem(CACHE_KEY, JSON.stringify(updated))
    
    // Log history
    const desc = `Moved to ${newStage}`
    setLeadHistory([{ id: Date.now(), action_type: 'STATUS_CHANGE', description: desc, created_at: new Date().toISOString() }, ...leadHistory])

    await fetch('/api/crm/update-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, newStage, notes: selectedLead?.notes })
    })

    // Log to new backend history table
    await fetch('/api/crm/lead-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, actionType: 'STATUS_CHANGE', description: desc })
    })
  }

  // Add Remark
  const handleAddRemark = async () => {
      if (!remarkInput.trim()) return
      
      const newAction = { id: Date.now(), action_type: 'REMARK', description: remarkInput, created_at: new Date().toISOString() }
      setLeadHistory([newAction, ...leadHistory])
      const text = remarkInput
      setRemarkInput('')

      await fetch('/api/crm/lead-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: selectedLead.id, actionType: 'REMARK', description: text })
      })
  }

  // Set Reminder
  const handleSetReminder = async () => {
      if (!reminderDate) return
      
      const desc = `Follow-up set for ${new Date(reminderDate).toLocaleString()}`
      const newAction = { id: Date.now(), action_type: 'REMINDER_SET', description: desc, created_at: new Date().toISOString() }
      setLeadHistory([newAction, ...leadHistory])
      
      setLeads(leads.map(l => l.id === selectedLead.id ? { ...l, next_followup: reminderDate } : l))
      setReminderDate('')

      await fetch('/api/crm/lead-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: selectedLead.id, actionType: 'REMINDER_SET', description: desc, nextFollowup: reminderDate })
      })
  }

  // Filter Logic
  const filteredLeads = leads.filter(l => {
      const matchStage = (l.pipeline_stage || 'New') === activeStage
      const matchSearch = l.name?.toLowerCase().includes(searchQuery.toLowerCase()) || l.phone?.includes(searchQuery)
      return matchStage && matchSearch
  })

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24 relative">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-6">
        <div>
            <h1 className="text-2xl font-bold text-slate-900">CRM</h1>
            {!isPushEnabled ? (
                <button onClick={enablePushNotifications} className="text-[10px] text-primary font-bold flex items-center gap-1 mt-1 bg-blue-50 px-2 py-0.5 rounded">
                    <Bell size={10} /> Enable Notifications
                </button>
            ) : (
                <TestNotificationBtn />
            )}
        </div>
        <div className="flex gap-2">
            <button onClick={() => fetchLeads(true)} disabled={loading} className="p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform bg-white">
                <RefreshCw size={20} className={`text-slate-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={openSyncModal} className="p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform bg-white">
                <Download size={20} className="text-slate-600" />
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform bg-white">
                <Upload size={20} className="text-slate-600" />
            </button>
            <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-900 text-white p-3 rounded-full shadow-md active:scale-95 transition-transform">
                <Plus size={20} />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search leads..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white pl-10 pr-4 py-3 rounded-xl text-sm border border-slate-100 focus:ring-2 focus:ring-blue-100 outline-none shadow-sm"
          />
      </div>

      {/* Pipeline Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide mb-2">
        {STAGES.map(stage => (
            <button 
                key={stage} 
                onClick={() => setActiveStage(stage)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeStage === stage ? 'bg-blue-100 text-blue-700' : 'bg-white text-slate-500 border border-slate-100'}`}
            >
                {stage} <span className="ml-1 opacity-60">({leads.filter(l => (l.pipeline_stage || 'New') === stage).length})</span>
            </button>
        ))}
      </div>

      {/* Lead List */}
      <div className="space-y-3 min-h-[50vh]">
        {filteredLeads.map(lead => (
            <div key={lead.id} onClick={() => handleLeadClick(lead)} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 active:scale-98 transition-transform cursor-pointer relative group">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-slate-800">{lead.name || 'Unknown Lead'}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{lead.phone}</p>
                        {lead.next_followup && new Date(lead.next_followup) > new Date() && (
                            <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1 mt-1 bg-amber-50 w-fit px-1.5 py-0.5 rounded">
                                <Clock size={10} /> {new Date(lead.next_followup).toLocaleDateString()}
                            </p>
                        )}
                    </div>
                    {/* Action Buttons */}
                    <div className="flex gap-2">
                        {lead.phone && (
                            <>
                                <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} onClick={e => e.stopPropagation()} target="_blank" className="p-2 bg-green-50 text-green-600 rounded-full hover:bg-green-100">
                                    <MessageCircle size={18} />
                                </a>
                                <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="p-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100">
                                    <Phone size={18} />
                                </a>
                            </>
                        )}
                        <button onClick={(e) => handleDeleteLead(lead.id, e)} className="p-2 bg-red-50 text-red-400 rounded-full hover:bg-red-100">
                            <Trash2 size={18} />
                        </button>
                    </div>
                </div>
                
                {/* Footer Info */}
                <div className="mt-3 pt-3 border-t border-slate-50 flex flex-col gap-1">
                    <span className="text-[10px] text-slate-300 self-end">
                        {new Date(lead.created_at).toLocaleDateString()}
                    </span>
                    <div className="flex flex-wrap gap-1">
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                            {lead.source}
                        </span>
                        {lead.ad_name && (
                            <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-1 rounded-md truncate max-w-full">
                                {lead.ad_name}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        ))}
        {filteredLeads.length === 0 && <div className="text-center py-10 text-slate-400 text-xs">No leads found.</div>}
      </div>

      {/* --- MODALS --- */}

      {/* 1. MANUAL ADD MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserPlus size={20}/> Add Lead</h2>
                    <button onClick={() => setIsAddModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={18} /></button>
                </div>
                <div className="space-y-3">
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Name</label><input type="text" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none" placeholder="John Doe" /></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Phone</label><input type="tel" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none" placeholder="+91 98765..." /></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Email (Optional)</label><input type="email" value={newLead.email} onChange={e => setNewLead({...newLead, email: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none" placeholder="john@example.com" /></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Notes (Optional)</label><textarea value={newLead.notes} onChange={e => setNewLead({...newLead, notes: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none resize-none" rows={2} /></div>
                    
                    <button onClick={handleAddLead} disabled={isAdding} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold mt-2 disabled:opacity-70">
                        {isAdding ? 'Saving...' : 'Save Lead'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* 2. SYNC MODAL */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-slate-800">Sync Facebook Leads</h2>
                    <button onClick={() => setIsSyncModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={18} /></button>
                </div>

                <div className="space-y-4">
                    {isLoadingForms ? (
                        <div className="py-8 flex flex-col items-center gap-2 text-slate-400 text-xs">
                            <RefreshCw className="animate-spin" size={24} />
                            Fetching forms...
                        </div>
                    ) : (
                        <>
                            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                                <button 
                                    onClick={() => setSelectedFormId('')}
                                    className={`w-full p-3 rounded-xl text-left text-xs font-bold border transition-all flex justify-between items-center ${selectedFormId === '' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-100 bg-white text-slate-600'}`}
                                >
                                    <span>Sync All Forms</span>
                                    {selectedFormId === '' && <CheckCircle2 size={16} />}
                                </button>
                                
                                {forms.map(form => (
                                    <button 
                                        key={form.id}
                                        onClick={() => setSelectedFormId(form.id)}
                                        className={`w-full p-3 rounded-xl text-left text-xs font-bold border transition-all flex justify-between items-center ${selectedFormId === form.id ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-100 bg-white text-slate-600'}`}
                                    >
                                        <div>
                                            <p className="truncate w-48">{form.name}</p>
                                            <p className="text-[10px] opacity-60 font-normal mt-0.5">{form.leads_count} leads • {form.status}</p>
                                        </div>
                                        {selectedFormId === form.id && <CheckCircle2 size={16} />}
                                    </button>
                                ))}
                            </div>

                            <button onClick={handleSync} disabled={isSyncing} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-70">
                                {isSyncing ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
                                {isSyncing ? 'Syncing...' : 'Start Sync'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* 3. EXPANDED LEAD PROFILE & HISTORY MODAL */}
      {selectedLead && (
        <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl animate-in slide-in-from-bottom-10 flex flex-col max-h-[90vh]">
            
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">{selectedLead.name}</h2>
                    <p className="text-xs text-slate-500 mt-1">{selectedLead.phone} {selectedLead.email ? `• ${selectedLead.email}` : ''}</p>
                </div>
                <button onClick={() => setSelectedLead(null)} className="bg-slate-100 p-2 rounded-full text-slate-500 shrink-0"><X size={20} /></button>
            </div>

            {/* Scrollable Content Area */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/50">
                
                {/* Source & Notes Block (From Original App) */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <p className="text-xs font-medium text-slate-600">
                        <span className="font-bold text-slate-400">Source:</span> {selectedLead.ad_name || selectedLead.source}
                    </p>
                    <div className="mt-3 pt-3 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Static Notes</label>
                        <textarea 
                            className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none resize-none" 
                            rows={2}
                            placeholder="Add basic notes..."
                            defaultValue={selectedLead.notes || ''}
                            onBlur={(e) => setSelectedLead({...selectedLead, notes: e.target.value})}
                        />
                    </div>
                </div>

                {/* Stage Selector */}
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">Pipeline Stage</label>
                    <div className="flex flex-wrap gap-2">
                        {STAGES.map(stage => (
                            <button 
                                key={stage} 
                                onClick={() => updateStage(selectedLead.id, stage)} 
                                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${selectedLead.pipeline_stage === stage ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                            >
                                {stage}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Reminder Setup */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 flex items-center gap-1 mb-2">
                        <Clock size={12}/> Set Follow-up Reminder
                    </label>
                    <div className="flex gap-2">
                        <input type="datetime-local" value={reminderDate} onChange={e => setReminderDate(e.target.value)} className="flex-1 bg-slate-50 p-2.5 rounded-xl text-sm border border-slate-100 outline-none focus:ring-2 focus:ring-primary" />
                        <button onClick={handleSetReminder} className="bg-slate-900 text-white px-5 rounded-xl text-xs font-bold active:scale-95 transition-transform">Set</button>
                    </div>
                </div>

                {/* History Timeline */}
                <div>
                    <h3 className="text-sm font-bold text-slate-800 mb-4 ml-1">Activity Log</h3>
                    <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                        
                        {isLoadingHistory ? (
                            <p className="text-xs text-slate-400 ml-10">Loading history...</p>
                        ) : leadHistory.length === 0 ? (
                            <p className="text-xs text-slate-400 ml-10">No history logged yet.</p>
                        ) : (
                            leadHistory.map((item) => (
                                <div key={item.id} className="relative flex items-center gap-4">
                                    <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 border-white shrink-0 shadow-sm z-10 ml-1 ${item.action_type === 'REMARK' ? 'bg-blue-100 text-blue-500' : 'bg-slate-100 text-slate-500'}`}>
                                        {item.action_type === 'REMARK' ? <MessageCircle size={14}/> : <CheckCircle2 size={14} />}
                                    </div>
                                    <div className="flex-1 bg-white p-3.5 rounded-2xl shadow-sm border border-slate-100">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="font-bold text-xs text-slate-800 capitalize">{item.action_type.replace('_', ' ')}</div>
                                            <time className="text-[9px] font-medium text-slate-400">{new Date(item.created_at).toLocaleString()}</time>
                                        </div>
                                        <div className="text-xs text-slate-500 leading-relaxed">{item.description}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>

            {/* Sticky Footer for Remarks Input */}
            <div className="p-4 border-t border-slate-100 bg-white rounded-b-[2rem] shrink-0">
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={remarkInput} 
                        onChange={e => setRemarkInput(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && handleAddRemark()} 
                        placeholder="Add a remark or note to history..." 
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-5 text-sm outline-none focus:ring-2 focus:ring-blue-100 transition-shadow" 
                    />
                    <button 
                        onClick={handleAddRemark} 
                        disabled={!remarkInput.trim()} 
                        className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center disabled:opacity-50 active:scale-95 transition-transform shrink-0"
                    >
                        <Send size={16} className="ml-1" />
                    </button>
                </div>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}