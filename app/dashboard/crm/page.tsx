// adrollsai/adrollsai/adrollsai-builder-app-reward-system/app/dashboard/crm/page.tsx

'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search, Phone, MessageCircle, RefreshCw, Upload, Plus, CheckCircle2, X, Download, Trash2, UserPlus, Trophy, Users, BarChart3, ArrowRightLeft, Clock, AlertCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useOrganization } from '@/components/OrganizationWrapper'

// ADDED 'Disqualified'
const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed', 'Disqualified']

type Lead = {
    id: string
    user_id: string
    name: string
    phone: string
    email?: string
    notes?: string
    source?: string
    ad_name?: string
    pipeline_stage: string
    status?: string | null // Added status to type
    created_at: string
}

type Profile = {
    id: string
    business_name: string
    role: 'admin' | 'agent'
    organization_id: string
}

type TeamStat = {
    agentId: string
    name: string
    count: number
}

export default function CRMPage() {
  const supabase = createClient()
  const { org } = useOrganization()
  
  // --- STATE ---
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false) // Added refreshing state
  const [activeStage, setActiveStage] = useState('New')
  
  // Admin / Team State
  const [userProfile, setUserProfile] = useState<Profile | null>(null)
  const [teamMembers, setTeamMembers] = useState<Profile[]>([])
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all')
  const [teamStats, setTeamStats] = useState<TeamStat[]>([])
  
  // Search
  const [searchQuery, setSearchQuery] = useState('')

  // Modals
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isAssigning, setIsAssigning] = useState(false) 
  const [mounted, setMounted] = useState(false)

  // Sync Logic
  const [forms, setForms] = useState<any[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [isSyncing, setIsSyncing] = useState(false)

  // Add Logic
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', notes: '' })
  const [isAdding, setIsAdding] = useState(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- CACHE HELPERS ---
  const saveToCache = (userId: string, data: any) => {
    try {
        localStorage.setItem(`crm_cache_${userId}`, JSON.stringify(data));
        localStorage.setItem(`crm_cache_time_${userId}`, Date.now().toString());
    } catch (e) {
        console.error("Cache Save Error", e);
    }
  }

  const loadFromCache = (userId: string) => {
      try {
          const cached = localStorage.getItem(`crm_cache_${userId}`);
          return cached ? JSON.parse(cached) : null;
      } catch (e) {
          return null;
      }
  }

  // --- 1. FETCH DATA ---
  const fetchCRMData = async (forceRefresh = false) => {
    try {
        if (!forceRefresh) setLoading(true)
        else setIsRefreshing(true)

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // --- TRY CACHE FIRST ---
        if (!forceRefresh) {
            const cachedData = loadFromCache(user.id);
            if (cachedData) {
                console.log("⚡ Loading CRM from Cache");
                setUserProfile(cachedData.userProfile);
                setLeads(cachedData.leads);
                setTeamMembers(cachedData.teamMembers);
                setTeamStats(cachedData.teamStats);
                setLoading(false);
                return; // STOP HERE IF CACHED
            }
        }

        console.log("🌐 Fetching CRM from Database...");

        // A. Get Profile to determine Role
        const { data: profile } = await supabase.from('profiles').select('id, business_name, role, organization_id').eq('id', user.id).single()
        if (!profile) return
        
        // Cast profile safely
        const currentProfile = profile as Profile
        setUserProfile(currentProfile)

        let fetchedLeads: Lead[] = []
        let fetchedMembers: Profile[] = []

        // B. Fetch Leads based on Role
        if (currentProfile.role === 'admin') {
            // ADMIN: Fetch ALL team members and ALL leads
            const { data: members } = await supabase
                .from('profiles')
                .select('id, business_name, role, organization_id')
                .eq('organization_id', currentProfile.organization_id)
            
            if (members) {
                fetchedMembers = members as Profile[]
                setTeamMembers(fetchedMembers)
                
                const memberIds = members.map(m => m.id)
                
                const { data } = await supabase
                    .from('leads')
                    .select('*')
                    .in('user_id', memberIds)
                    .order('created_at', { ascending: false })
                
                if (data) fetchedLeads = data
            }
        } else {
            // AGENT: Fetch ONLY own leads
            const { data } = await supabase
                .from('leads')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
            
            if (data) fetchedLeads = data
        }

        // Calculate Stats
        const calculatedStats = calculateStatsReturn(fetchedLeads, fetchedMembers)

        // Update State
        setLeads(fetchedLeads)
        setTeamStats(calculatedStats)

        // --- SAVE TO CACHE ---
        const cachePayload = {
            userProfile: currentProfile,
            leads: fetchedLeads,
            teamMembers: fetchedMembers,
            teamStats: calculatedStats
        }
        saveToCache(user.id, cachePayload)

    } catch (e) {
        console.error("CRM Error", e)
    } finally {
        setLoading(false)
        setIsRefreshing(false)
    }
  }

  useEffect(() => { 
    fetchCRMData(false) // Load from cache by default
    setMounted(true)
  }, [])

  // Calculate Leaderboard (Helper for both Render and Cache)
  const calculateStatsReturn = (allLeads: Lead[], members: Profile[]) => {
      if (!members || members.length === 0) return []

      const stats: Record<string, number> = {}
      allLeads.forEach(l => {
          if (l.user_id) {
            stats[l.user_id] = (stats[l.user_id] || 0) + 1
          }
      })

      const leaderboard = members
          .map(m => ({ 
              agentId: m.id, 
              name: m.business_name || 'Agent', 
              count: stats[m.id] || 0 
          }))
          .sort((a, b) => b.count - a.count)
      
      return leaderboard
  }

  // Wrapper for existing stats usage (to maintain compatibility if needed)
  const calculateStats = (allLeads: Lead[], members: Profile[]) => {
      const stats = calculateStatsReturn(allLeads, members)
      setTeamStats(stats)
  }

  // --- 2. ACTIONS ---

  // Admin: Assign Lead
  const handleAssignLead = async (agentId: string) => {
      if (!selectedLead) return
      setIsAssigning(true)
      try {
          const res = await fetch('/api/crm/assign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ leadId: selectedLead.id, agentId })
          })
          
          if (!res.ok) throw new Error("Assignment failed")
          
          // Optimistic Update
          const updatedLeads = leads.map(l => l.id === selectedLead.id ? { ...l, user_id: agentId } : l)
          setLeads(updatedLeads)
          setSelectedLead(prev => prev ? { ...prev, user_id: agentId } : null)
          
          calculateStats(updatedLeads, teamMembers)

          alert("Lead reassigned successfully!")
          
          // Force Sync Cache
          fetchCRMData(true)
          
      } catch (e) {
          alert("Failed to reassign lead")
      } finally {
          setIsAssigning(false)
      }
  }

  // --- ADD LEAD ---
  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone) return alert("Name/Phone required")
    setIsAdding(true)
    
    try {
        const res = await fetch('/api/crm/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newLead)
        })
        
        const data = await res.json()
        
        if (!res.ok) throw new Error(data.error || "Failed to add lead")

        let msg = "Lead Added Successfully!"
        if (data.xpGained) msg += `\n\n✨ +${data.xpGained} XP Earned!`
        if (data.leveledUp) msg += `\n🏆 LEVEL UP! You reached Level ${data.newLevel}!`
        
        alert(msg)

        setIsAddModalOpen(false)
        setNewLead({ name: '', phone: '', email: '', notes: '' })
        
        // Force Sync Cache
        fetchCRMData(true)

    } catch (e: any) {
        alert("Error: " + e.message)
    } finally {
        setIsAdding(false)
    }
  }

  const handleDeleteLead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Delete lead?")) return
    
    // Optimistic Delete
    const updatedLeads = leads.filter(l => l.id !== id)
    setLeads(updatedLeads)
    calculateStats(updatedLeads, teamMembers)

    try {
        await supabase.from('leads').delete().eq('id', id)
        // Sync Cache in Background
        fetchCRMData(true)
    } catch (err) {
        console.error(err)
        fetchCRMData(true) // Revert on error
    }
  }

  const openSyncModal = async () => {
     setIsSyncModalOpen(true)
     try {
        const res = await fetch('/api/facebook/forms')
        const d = await res.json() 
        if(d.forms) setForms(d.forms)
     } catch(e) { console.error(e) }
  }

  const handleSync = async () => {
      setIsSyncing(true)
      await fetch('/api/crm/sync', { method: 'POST', body: JSON.stringify({ formId: selectedFormId }) })
      setIsSyncing(false); 
      setIsSyncModalOpen(false)
      fetchCRMData(true) // Force Refresh
  }

  // --- UPDATED: Update Stage with Logic for Approval ---
  const updateStage = async (leadId: string, newStage: string) => {
    // 1. Optimistic Update (Show "Pending" if sensitive stage and user is Agent)
    const isRestricted = newStage === 'Site Visit Done' || newStage === 'Closed'
    const isAgent = userProfile?.role === 'agent'
    
    let newStatus = 'Active'
    if (isRestricted && isAgent) {
        newStatus = 'Pending Approval'
    }

    setLeads(prev => prev.map(l => l.id === leadId ? { 
        ...l, 
        pipeline_stage: newStage,
        status: newStatus 
    } : l))
    
    setSelectedLead(null)
    
    // 2. API Call
    try {
        await fetch('/api/crm/update-stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId, newStage })
        })

        if (isRestricted && isAgent) {
            alert(`Request submitted for ${newStage}! Admin approval pending.`)
        }
        
        // Sync Cache
        fetchCRMData(true)
        
    } catch(e) {
        alert("Failed to update stage")
        fetchCRMData(true) // Revert
    }
  }

  // Filter Logic
  const filteredLeads = leads.filter(l => {
      const matchStage = (l.pipeline_stage || 'New') === activeStage
      const matchSearch = l.name?.toLowerCase().includes(searchQuery.toLowerCase()) || l.phone?.includes(searchQuery)
      const matchAgent = selectedAgentFilter === 'all' || l.user_id === selectedAgentFilter
      return matchStage && matchSearch && matchAgent
  })

  // Helper for Portals
  const ModalPortal = ({ children }: { children: React.ReactNode }) => {
    if (!mounted) return null
    return createPortal(children, document.body)
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">CRM</h1>
            <p className="text-slate-500 text-xs mt-1 font-medium">Pipeline & Leads</p>
        </div>
        <div className="flex gap-2">
            {/* Refresh Button */}
            <button 
                onClick={() => fetchCRMData(true)} 
                disabled={isRefreshing}
                className="bg-white p-3 rounded-full shadow-sm border border-slate-100 text-slate-500 hover:text-slate-900 active:scale-95 transition-all disabled:opacity-50"
            >
                <RefreshCw size={20} className={isRefreshing ? "animate-spin" : ""}/>
            </button>

            {userProfile?.role === 'admin' && (
                <button onClick={openSyncModal} className="bg-white p-3 rounded-full shadow-sm border border-slate-100"><Download size={20} className="text-slate-600"/></button>
            )}
            <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-900 text-white p-3 rounded-full shadow-lg active:scale-95 transition-transform">
                <Plus size={20} />
            </button>
        </div>
      </div>

      {/* ADMIN SECTION: LEADERBOARD */}
      {userProfile?.role === 'admin' && (
          <div className="animate-in slide-in-from-top-4">
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 text-white shadow-xl mb-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10"><Trophy size={100} /></div>
                  <h3 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2"><BarChart3 size={16}/> Team Performance</h3>
                  
                  <div className="flex gap-8 overflow-x-auto pb-2 scrollbar-hide">
                      <div className="flex-1 min-w-[120px]">
                          <p className="text-4xl font-black mb-1">{leads.length}</p>
                          <p className="text-xs opacity-70 uppercase tracking-wider font-bold">Total Leads</p>
                      </div>
                      {teamStats.slice(0, 3).map((stat, i) => (
                          <div key={stat.agentId} className="min-w-[120px] border-l border-white/10 pl-6">
                              <p className="text-2xl font-bold flex items-center gap-2">
                                  {i===0 && <Trophy size={18} className="text-yellow-400"/>}
                                  {stat.count}
                              </p>
                              <p className="text-xs opacity-70 truncate">{stat.name.split(' ')[0]}</p>
                          </div>
                      ))}
                  </div>
              </div>

              {/* Agent Filter */}
              <div className="relative max-w-sm">
                  <select value={selectedAgentFilter} onChange={e => setSelectedAgentFilter(e.target.value)} className="w-full appearance-none bg-white p-3 pl-10 rounded-xl text-sm font-bold border-none shadow-sm outline-none text-slate-600 cursor-pointer">
                      <option value="all">View All Agents</option>
                      {teamMembers.map(m => (
                          <option key={m.id} value={m.id}>
                              {m.business_name} ({teamStats.find(s=>s.agentId===m.id)?.count || 0})
                          </option>
                      ))}
                  </select>
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              </div>
          </div>
      )}

      {/* Search */}
      <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input type="text" placeholder="Search leads by name or phone..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white pl-10 pr-4 py-3 rounded-xl text-sm border-none shadow-sm focus:ring-2 focus:ring-slate-200 outline-none"/>
      </div>

      {/* Pipeline Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {STAGES.map(stage => (
            <button key={stage} onClick={() => setActiveStage(stage)} className={`whitespace-nowrap px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm ${activeStage === stage ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                {stage} <span className="ml-1 opacity-60">({leads.filter(l => (l.pipeline_stage || 'New') === stage).length})</span>
            </button>
        ))}
      </div>

      {/* Lead List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 min-h-[50vh] content-start">
        {filteredLeads.map(lead => (
            <div key={lead.id} onClick={() => setSelectedLead(lead)} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 hover:border-blue-100 hover:shadow-md active:scale-[0.99] transition-all cursor-pointer relative group flex flex-col justify-between h-full">
                
                {/* PENDING APPROVAL BADGE */}
                {lead.status === 'Pending Approval' && (
                    <div className="absolute top-2 right-2 bg-yellow-50 text-yellow-700 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 border border-yellow-200 z-10">
                        <Clock size={10} /> Pending Approval
                    </div>
                )}
                
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h3 className="font-bold text-slate-800 text-base">{lead.name || 'Unknown Lead'}</h3>
                        <p className="text-sm text-slate-400 mt-0.5 font-medium">{lead.phone}</p>
                    </div>
                    {/* Delete only if not pending or if Admin */}
                    <div className="flex gap-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => handleDeleteLead(lead.id, e)} className="p-2 bg-red-50 text-red-400 rounded-full hover:bg-red-100 transition-colors"><Trash2 size={16} /></button>
                    </div>
                </div>
                
                {/* Actions Bar */}
                <div className="flex gap-2 mb-4">
                     {lead.phone && (
                        <>
                            <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} onClick={e => e.stopPropagation()} target="_blank" className="flex-1 py-2 bg-green-50 text-green-700 rounded-lg flex items-center justify-center gap-2 text-xs font-bold hover:bg-green-100 transition-colors">
                                <MessageCircle size={14} /> WhatsApp
                            </a>
                            <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="flex-1 py-2 bg-blue-50 text-blue-700 rounded-lg flex items-center justify-center gap-2 text-xs font-bold hover:bg-blue-100 transition-colors">
                                <Phone size={14} /> Call
                            </a>
                        </>
                    )}
                </div>

                <div className="pt-3 border-t border-slate-50 flex items-center justify-between mt-auto">
                    <div className="flex flex-wrap gap-2">
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-md">{lead.source || 'Unknown Source'}</span>
                        {userProfile?.role === 'admin' && selectedAgentFilter === 'all' && (
                            <span className="text-[10px] font-bold bg-purple-50 text-purple-600 px-2 py-1 rounded-md flex items-center gap-1">
                                <Users size={10}/> {teamMembers.find(m => m.id === lead.user_id)?.business_name?.split(' ')[0] || 'Agent'}
                            </span>
                        )}
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium">{new Date(lead.created_at).toLocaleDateString()}</span>
                </div>
            </div>
        ))}
        {loading && <div className="col-span-full text-center py-20 text-slate-400 flex justify-center"><RefreshCw className="animate-spin"/></div>}
        {!loading && filteredLeads.length === 0 && <div className="col-span-full text-center py-20 text-slate-400 text-sm">No leads found in this stage.</div>}
      </div>

      {/* --- ADD MODAL --- */}
      {isAddModalOpen && (
        <ModalPortal>
            <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserPlus size={20}/> Add Lead</h2>
                        <button onClick={() => setIsAddModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200"><X size={18} /></button>
                    </div>
                    <div className="space-y-3">
                        <input type="text" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none" placeholder="Name" />
                        <input type="tel" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none" placeholder="Phone" />
                        <button onClick={handleAddLead} disabled={isAdding} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold mt-2">{isAdding ? 'Saving...' : 'Save Lead'}</button>
                    </div>
                </div>
            </div>
        </ModalPortal>
      )}
      
      {/* --- SYNC MODAL --- */}
      {isSyncModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-slate-800">Sync Leads</h2>
                    <button onClick={() => setIsSyncModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200"><X size={18} /></button>
                </div>
                <div className="space-y-4">
                     <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                        <button onClick={() => setSelectedFormId('')} className={`w-full p-3 rounded-xl text-left text-xs font-bold border transition-all flex justify-between items-center ${selectedFormId === '' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-100 bg-white text-slate-600'}`}><span>Sync All</span>{selectedFormId === '' && <CheckCircle2 size={16} />}</button>
                        {forms.map(form => (
                            <button key={form.id} onClick={() => setSelectedFormId(form.id)} className={`w-full p-3 rounded-xl text-left text-xs font-bold border transition-all flex justify-between items-center ${selectedFormId === form.id ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-100 bg-white text-slate-600'}`}>
                                <div className="truncate w-40">{form.name}</div>{selectedFormId === form.id && <CheckCircle2 size={16} />}
                            </button>
                        ))}
                     </div>
                     <button onClick={handleSync} disabled={isSyncing} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-70">{isSyncing ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}{isSyncing ? 'Syncing...' : 'Start Sync'}</button>
                </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* --- VIEW/EDIT MODAL --- */}
      {selectedLead && (
        <ModalPortal>
            <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
                <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-slate-800">Details</h2>
                        <button onClick={() => setSelectedLead(null)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200"><X size={20} /></button>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 relative overflow-hidden">
                             {selectedLead.status === 'Pending Approval' && (
                                <div className="absolute top-0 right-0 left-0 bg-yellow-100 text-yellow-800 text-[10px] font-bold text-center py-1 border-b border-yellow-200">
                                    Pending Admin Approval
                                </div>
                             )}
                            <h3 className="font-bold text-lg text-slate-900 mt-2">{selectedLead.name}</h3>
                            <p className="text-sm text-slate-500">{selectedLead.phone}</p>
                            
                            {/* ADMIN ONLY: REASSIGN */}
                            {userProfile?.role === 'admin' && (
                                <div className="mt-3 pt-3 border-t border-slate-200">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1"><ArrowRightLeft size={10}/> Assigned To</label>
                                    <select 
                                        className="w-full bg-white p-2 rounded-lg text-xs font-bold border border-slate-200 outline-none"
                                        value={selectedLead.user_id}
                                        onChange={(e) => handleAssignLead(e.target.value)}
                                        disabled={isAssigning}
                                    >
                                        {teamMembers.map(m => (
                                            <option key={m.id} value={m.id}>{m.business_name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">Stage</label>
                            
                            {selectedLead.status === 'Pending Approval' ? (
                                <div className="bg-yellow-50 border border-yellow-100 p-4 rounded-xl text-center">
                                    <AlertCircle className="mx-auto text-yellow-500 mb-2" size={24}/>
                                    <p className="text-sm font-bold text-slate-800">Waiting for Approval</p>
                                    <p className="text-xs text-slate-500">Stage change to '{selectedLead.pipeline_stage}' is pending admin review.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    {STAGES.map(stage => (
                                        <button key={stage} onClick={() => updateStage(selectedLead.id, stage)} className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all ${selectedLead.pipeline_stage === stage ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>
                                            {stage}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ModalPortal>
      )}

    </div>
  )
}