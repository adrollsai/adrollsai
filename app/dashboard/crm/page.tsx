'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Phone, MessageCircle, RefreshCw, Upload, Plus, CheckCircle2, X, Download, Trash2, UserPlus, Trophy, Users, BarChart3, Filter } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const STAGES = ['New', 'Qualified', 'Site Visit Done', 'Closed']
const CACHE_KEY = 'crm_leads_cache'

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
    created_at: string
}

type Profile = {
    id: string
    business_name: string
    role: 'admin' | 'agent'
}

type TeamStat = {
    agentId: string
    name: string
    count: number
}

export default function CRMPage() {
  const supabase = createClient()
  
  // --- STATE ---
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
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

  // Sync Logic
  const [forms, setForms] = useState<any[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [isSyncing, setIsSyncing] = useState(false)

  // Add Logic
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', notes: '' })
  const [isAdding, setIsAdding] = useState(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- 1. FETCH DATA ---
  const fetchCRMData = async (force = false) => {
    try {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        // A. Get Profile to determine Role
        const { data: profile } = await supabase.from('profiles').select('id, business_name, role, organization_id').eq('id', user.id).single()
        if (!profile) return
        setUserProfile(profile as Profile)

        let fetchedLeads: Lead[] = []

        // B. Fetch Leads based on Role
        if (profile.role === 'admin') {
            // ADMIN: Fetch ALL team members and ALL leads
            const { data: members } = await supabase
                .from('profiles')
                .select('id, business_name, role')
                .eq('organization_id', profile.organization_id)
            
            if (members) {
                setTeamMembers(members as Profile[])
                const memberIds = members.map(m => m.id)
                
                // Fetch leads belonging to any team member
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

        setLeads(fetchedLeads)
        calculateStats(fetchedLeads, teamMembers)

    } catch (e) {
        console.error("CRM Error", e)
    } finally {
        setLoading(false)
    }
  }

  useEffect(() => { fetchCRMData() }, [])

  // Calculate Leaderboard
  const calculateStats = (allLeads: Lead[], members: Profile[]) => {
      if (members.length === 0) return

      const stats: Record<string, number> = {}
      allLeads.forEach(l => {
          stats[l.user_id] = (stats[l.user_id] || 0) + 1
      })

      const leaderboard = members
          .map(m => ({ agentId: m.id, name: m.business_name || 'Agent', count: stats[m.id] || 0 }))
          .sort((a, b) => b.count - a.count)
      
      setTeamStats(leaderboard)
  }

  // --- 2. ACTIONS ---

  const handleAddLead = async () => {
    if (!newLead.name || !newLead.phone) return alert("Name/Phone required")
    setIsAdding(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
        const payload = {
            user_id: user.id,
            name: newLead.name,
            phone: newLead.phone,
            email: newLead.email,
            notes: newLead.notes,
            source: 'Manual',
            pipeline_stage: 'New'
        }
        await supabase.from('leads').insert(payload)
        fetchCRMData()
        setIsAddModalOpen(false)
        setNewLead({ name: '', phone: '', email: '', notes: '' })
    }
    setIsAdding(false)
  }

  const handleDeleteLead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Delete lead?")) return
    setLeads(prev => prev.filter(l => l.id !== id)) // Optimistic
    await supabase.from('leads').delete().eq('id', id)
  }

  const updateStage = async (leadId: string, newStage: string) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, pipeline_stage: newStage } : l))
    setSelectedLead(null)
    await fetch('/api/crm/update-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, newStage })
    })
  }

  // Filter Logic (Admin Filter + Search + Stage)
  const filteredLeads = leads.filter(l => {
      const matchStage = (l.pipeline_stage || 'New') === activeStage
      const matchSearch = l.name?.toLowerCase().includes(searchQuery.toLowerCase()) || l.phone?.includes(searchQuery)
      
      // Admin Filter
      const matchAgent = selectedAgentFilter === 'all' || l.user_id === selectedAgentFilter
      
      return matchStage && matchSearch && matchAgent
  })

  // --- RENDER ---
  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24 relative bg-slate-50">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-6">
        <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">CRM</h1>
            <p className="text-slate-500 text-xs mt-1 font-medium">Pipeline & Leads</p>
        </div>
        <div className="flex gap-2">
             {/* Add Button */}
            <button onClick={() => setIsAddModalOpen(true)} className="bg-slate-900 text-white p-3 rounded-full shadow-lg active:scale-95 transition-transform">
                <Plus size={20} />
            </button>
        </div>
      </div>

      {/* ADMIN SECTION: LEADERBOARD */}
      {userProfile?.role === 'admin' && (
          <div className="mb-6 animate-in slide-in-from-top-4">
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-4 text-white shadow-xl mb-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10"><Trophy size={80} /></div>
                  <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2"><BarChart3 size={16}/> Team Performance</h3>
                  
                  <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-hide">
                      <div className="flex-1 min-w-[100px]">
                          <p className="text-3xl font-black">{leads.length}</p>
                          <p className="text-[10px] opacity-70 uppercase tracking-wider font-bold">Total Leads</p>
                      </div>
                      {teamStats.slice(0, 2).map((stat, i) => (
                          <div key={stat.agentId} className="min-w-[100px] border-l border-white/10 pl-4">
                              <p className="text-xl font-bold flex items-center gap-1">
                                  {i===0 && <Trophy size={14} className="text-yellow-400"/>}
                                  {stat.count}
                              </p>
                              <p className="text-[10px] opacity-70 truncate max-w-[80px]">{stat.name.split(' ')[0]}</p>
                          </div>
                      ))}
                  </div>
              </div>

              {/* Agent Filter */}
              <div className="relative">
                  <select 
                    value={selectedAgentFilter} 
                    onChange={e => setSelectedAgentFilter(e.target.value)}
                    className="w-full appearance-none bg-white p-3 pl-10 rounded-xl text-xs font-bold border-none shadow-sm outline-none text-slate-600"
                  >
                      <option value="all">View All Agents</option>
                      {teamMembers.map(m => (
                          <option key={m.id} value={m.id}>{m.business_name} ({teamStats.find(s=>s.agentId===m.id)?.count || 0})</option>
                      ))}
                  </select>
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              </div>
          </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search leads..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white pl-10 pr-4 py-3 rounded-xl text-sm border-none shadow-sm focus:ring-2 focus:ring-slate-200 outline-none"
          />
      </div>

      {/* Pipeline Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide mb-2">
        {STAGES.map(stage => (
            <button 
                key={stage} 
                onClick={() => setActiveStage(stage)}
                className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${activeStage === stage ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white text-slate-500'}`}
            >
                {stage} <span className="ml-1 opacity-60">({leads.filter(l => (l.pipeline_stage || 'New') === stage).length})</span>
            </button>
        ))}
      </div>

      {/* Lead List */}
      <div className="space-y-3 min-h-[50vh]">
        {filteredLeads.map(lead => (
            <div key={lead.id} onClick={() => setSelectedLead(lead)} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100/50 active:scale-98 transition-transform cursor-pointer relative group">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-slate-800">{lead.name || 'Unknown Lead'}</h3>
                        <p className="text-xs text-slate-400 mt-0.5 font-medium">{lead.phone}</p>
                    </div>
                    <div className="flex gap-2">
                        {lead.phone && (
                            <>
                                <a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`} onClick={e => e.stopPropagation()} target="_blank" className="p-2 bg-green-50 text-green-600 rounded-full hover:bg-green-100 transition-colors">
                                    <MessageCircle size={18} />
                                </a>
                                <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} className="p-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">
                                    <Phone size={18} />
                                </a>
                            </>
                        )}
                        <button onClick={(e) => handleDeleteLead(lead.id, e)} className="p-2 bg-red-50 text-red-400 rounded-full hover:bg-red-100 transition-colors">
                            <Trash2 size={18} />
                        </button>
                    </div>
                </div>
                
                {/* Footer Info */}
                <div className="mt-3 pt-3 border-t border-slate-50 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                            {lead.source}
                        </span>
                        {/* Admin View: Show who owns this lead */}
                        {userProfile?.role === 'admin' && selectedAgentFilter === 'all' && (
                            <span className="text-[10px] font-bold bg-purple-50 text-purple-600 px-2 py-1 rounded-md flex items-center gap-1">
                                <Users size={10}/> {teamMembers.find(m => m.id === lead.user_id)?.business_name?.split(' ')[0] || 'Agent'}
                            </span>
                        )}
                    </div>
                    <span className="text-[10px] text-slate-300 font-medium">
                        {new Date(lead.created_at).toLocaleDateString()}
                    </span>
                </div>
            </div>
        ))}
        {loading && <div className="text-center py-10 text-slate-400 flex justify-center"><RefreshCw className="animate-spin"/></div>}
        {!loading && filteredLeads.length === 0 && <div className="text-center py-10 text-slate-400 text-xs">No leads found.</div>}
      </div>

      {/* --- ADD MODAL --- */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserPlus size={20}/> Add Lead</h2>
                    <button onClick={() => setIsAddModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={18} /></button>
                </div>
                <div className="space-y-3">
                    <input type="text" value={newLead.name} onChange={e => setNewLead({...newLead, name: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none" placeholder="Name" />
                    <input type="tel" value={newLead.phone} onChange={e => setNewLead({...newLead, phone: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none" placeholder="Phone" />
                    <input type="email" value={newLead.email} onChange={e => setNewLead({...newLead, email: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none" placeholder="Email (Optional)" />
                    <textarea value={newLead.notes} onChange={e => setNewLead({...newLead, notes: e.target.value})} className="w-full bg-slate-50 p-3 rounded-xl text-sm outline-none resize-none" rows={2} placeholder="Notes" />
                    
                    <button onClick={handleAddLead} disabled={isAdding} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold mt-2">
                        {isAdding ? 'Saving...' : 'Save Lead'}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- EDIT MODAL --- */}
      {selectedLead && (
        <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-800">Details</h2>
                    <button onClick={() => setSelectedLead(null)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
                </div>

                <div className="space-y-4">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <h3 className="font-bold text-lg text-slate-900">{selectedLead.name}</h3>
                        <p className="text-sm text-slate-500">{selectedLead.phone}</p>
                        {userProfile?.role === 'admin' && (
                             <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200">
                                Assigned to: {teamMembers.find(m => m.id === selectedLead.user_id)?.business_name || 'Agent'}
                             </p>
                        )}
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">Stage</label>
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
                </div>
            </div>
        </div>
      )}

    </div>
  )
}