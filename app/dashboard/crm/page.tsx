'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Phone, MessageCircle, Filter, RefreshCw, Upload, Plus, CheckCircle2, X, Download, Trash2, UserPlus } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed']
const CACHE_KEY = 'crm_leads_cache'
const CACHE_TIME_KEY = 'crm_leads_last_fetch'
const CACHE_DURATION = 5 * 60 * 1000 // 5 Minutes

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

  // Edit/View State
  const [selectedLead, setSelectedLead] = useState<any>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- 1. DATA FETCHING WITH CACHING ---
  const fetchLeads = async (force = false) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // A. Try Local Cache First (Instant Load)
    const cachedData = localStorage.getItem(CACHE_KEY)
    const lastFetch = localStorage.getItem(CACHE_TIME_KEY)
    const now = Date.now()

    if (cachedData && !force) {
        setLeads(JSON.parse(cachedData))
        setLoading(false)
        
        // If cache is fresh (< 5 mins), stop here to save requests
        if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) {
            console.log("Using cached leads")
            return
        }
    }

    // B. Fetch from DB (Background Update or Force)
    console.log("Fetching fresh leads from DB...")
    const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
    
    if (data) {
        setLeads(data)
        // Update Cache
        localStorage.setItem(CACHE_KEY, JSON.stringify(data))
        localStorage.setItem(CACHE_TIME_KEY, now.toString())
    }
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  // --- 2. ACTIONS ---

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

        // Optimistic Update (Show immediately)
        const optimisticLead = { ...leadPayload, id: 'temp-' + Date.now(), created_at: new Date().toISOString() }
        setLeads(prev => [optimisticLead, ...prev])
        setIsAddModalOpen(false)
        setNewLead({ name: '', phone: '', email: '', notes: '' })

        // DB Insert
        const { data, error } = await supabase.from('leads').insert(leadPayload).select().single()
        
        if (data) {
            // Replace temp lead with real one in state
            setLeads(prev => prev.map(l => l.id === optimisticLead.id ? data : l))
            // Update Cache
            const currentCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')
            localStorage.setItem(CACHE_KEY, JSON.stringify([data, ...currentCache]))
        } else {
            alert("Failed to save lead.")
            fetchLeads(true) // Revert on error
        }
    }
    setIsAdding(false)
  }

  // Delete Lead
  const handleDeleteLead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent opening modal
    if (!confirm("Are you sure you want to delete this lead?")) return

    // Optimistic Delete
    const updatedLeads = leads.filter(l => l.id !== id)
    setLeads(updatedLeads)
    localStorage.setItem(CACHE_KEY, JSON.stringify(updatedLeads)) // Update cache immediately

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
            fetchLeads(true) // Force refresh
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
        const rows = text.split('\n').slice(1) // Skip header
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
    localStorage.setItem(CACHE_KEY, JSON.stringify(updated)) // Update cache
    setSelectedLead(null)

    await fetch('/api/crm/update-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, newStage, notes: selectedLead?.notes })
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
            <p className="text-slate-500 text-xs mt-1">Manage leads & pipeline</p>
        </div>
        <div className="flex gap-2">
            <button onClick={() => fetchLeads(true)} disabled={loading} className={`p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform bg-white`}>
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
            <div key={lead.id} onClick={() => setSelectedLead(lead)} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 active:scale-98 transition-transform cursor-pointer relative group">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-slate-800">{lead.name || 'Unknown Lead'}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">{lead.phone}</p>
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

      {/* 3. EDIT/VIEW MODAL */}
      {selectedLead && (
        <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-800">Lead Details</h2>
                    <button onClick={() => setSelectedLead(null)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
                </div>

                <div className="space-y-4">
                    <div className="bg-slate-50 p-4 rounded-xl">
                        <h3 className="font-bold text-lg">{selectedLead.name}</h3>
                        <p className="text-sm text-slate-500">{selectedLead.email}</p>
                        <p className="text-sm text-slate-500">{selectedLead.phone}</p>
                        <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200">
                            Source: {selectedLead.ad_name || selectedLead.source}
                        </p>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">Move Pipeline Stage</label>
                        <div className="grid grid-cols-2 gap-2">
                            {STAGES.map(stage => (
                                <button 
                                    key={stage}
                                    onClick={() => updateStage(selectedLead.id, stage)}
                                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all ${selectedLead.pipeline_stage === stage ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}
                                >
                                    {stage}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Notes</label>
                        <textarea 
                            className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none resize-none" 
                            rows={3}
                            placeholder="Add notes..."
                            defaultValue={selectedLead.notes || ''}
                            onBlur={(e) => {
                                setSelectedLead({...selectedLead, notes: e.target.value})
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
      )}

    </div>
  )
}