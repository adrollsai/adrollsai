'use client'

import { useState, useEffect } from 'react'
import { 
  Users, 
  Plus, 
  Search, 
  Shield, 
  UserPlus, 
  Trash2, 
  Loader2, 
  AlertCircle,
  MoreVertical,
  Mail,
  Calendar,
  ArrowLeft,
  ArrowRight,
  UserCheck,
  History,
  Clock,
  CheckCircle2,
  X
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

export default function TeamPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  
  const [newMember, setNewMember] = useState({
    business_name: '',
    email: '',
    password: '',
    role: 'agent'
  })

  // Offboard & Lead Reassignment Modal State
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    member: any | null;
    assignedLeadsCount: number;
    reassignTo: string;
    deleteHistory: boolean;
    transferWithScheduledActions: boolean;
    isDeleting: boolean;
    isLoadingCount: boolean;
  }>({
    isOpen: false,
    member: null,
    assignedLeadsCount: 0,
    reassignTo: '',
    deleteHistory: false,
    transferWithScheduledActions: true,
    isDeleting: false,
    isLoadingCount: false
  })

  const fetchData = async () => {
    const cacheKey = `team_cache_${impersonateId || 'own'}`;
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            setTeam(JSON.parse(cached));
            setLoading(false);
        }
    } catch (e) {}

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }

      // 1. Get current/impersonated user profile
      const { data: authProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', session.user.id).single()
      
      // If user is Admin/Agent, default to their agency/parent
      const targetId = impersonateId || authProfile?.agency_id || authProfile?.parent_id || session.user.id
      
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', targetId).single()
      setCurrentUser(profile)

      // 2. Fetch Team Members via API to get accurate is_disabled status
      const response = await fetch(`/api/team?adminId=${targetId}`)
      if (response.ok) {
        const teamData = await response.json()
        if (teamData.team) {
          setTeam(teamData.team)
          try { localStorage.setItem(cacheKey, JSON.stringify(teamData.team)); } catch (e) {}
          return
        }
      }

      // Fallback: Fetch directly from Supabase
      const { data: members, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('parent_id', targetId)
        .in('role', ['admin', 'agent'])
        .order('created_at', { ascending: false })

      if (error) throw error
      const finalMembers = members || []
      setTeam(finalMembers)
      try { localStorage.setItem(cacheKey, JSON.stringify(finalMembers)); } catch (e) {}
    } catch (error: any) {
      console.error("Team fetch error:", error)
      toast.error("Failed to load team")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [impersonateId])

  const handleToggleMemberStatus = async (memberId: string, newDisabledState: boolean) => {
    if (!currentUser?.id) return
    try {
      // Optimistic state update
      setTeam(prev => prev.map(m => m.id === memberId ? { ...m, is_disabled: newDisabledState } : m))

      const response = await fetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: currentUser.id,
          agentId: memberId,
          isDisabled: newDisabledState
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to update member status')
      }

      const resData = await response.json()
      toast.success(resData.message || (newDisabledState ? "Member access disabled" : "Member access enabled"))
      fetchData()
    } catch (err: any) {
      toast.error("Status Update Failed", { description: err.message })
      fetchData()
    }
  }

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)

    try {
      const response = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: currentUser.id,
          email: newMember.email,
          password: newMember.password,
          fullName: newMember.business_name,
          role: newMember.role
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to add member')
      }

      toast.success("Team member added successfully!")
      setShowCreateModal(false)
      setNewMember({ business_name: '', email: '', password: '', role: 'agent' })
      fetchData()
    } catch (err: any) {
      toast.error("Action Failed", { description: err.message })
    } finally {
      setIsCreating(false)
    }
  }

  // Open rich Offboard & Lead Reassignment Modal
  const openDeleteModal = async (member: any) => {
    setDeleteModal({
      isOpen: true,
      member,
      assignedLeadsCount: 0,
      reassignTo: currentUser?.id || 'unassigned',
      deleteHistory: false,
      transferWithScheduledActions: true,
      isDeleting: false,
      isLoadingCount: true
    })

    try {
      const { count } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .or(`assigned_to.eq.${member.id},user_id.eq.${member.id}`)

      setDeleteModal(prev => ({
        ...prev,
        assignedLeadsCount: count || 0,
        isLoadingCount: false
      }))
    } catch (e) {
      setDeleteModal(prev => ({ ...prev, isLoadingCount: false }))
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteModal.member || !currentUser?.id) return
    setDeleteModal(prev => ({ ...prev, isDeleting: true }))

    try {
      const response = await fetch('/api/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: currentUser.id,
          agentId: deleteModal.member.id,
          reassignTo: deleteModal.reassignTo,
          deleteHistory: deleteModal.deleteHistory,
          transferWithScheduledActions: deleteModal.transferWithScheduledActions
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove member')
      }

      toast.success("Member offboarded", { description: data.message })
      setDeleteModal({
        isOpen: false,
        member: null,
        assignedLeadsCount: 0,
        reassignTo: '',
        deleteHistory: false,
        transferWithScheduledActions: true,
        isDeleting: false,
        isLoadingCount: false
      })
      fetchData()
    } catch (err: any) {
      toast.error("Error offboarding member", { description: err.message })
      setDeleteModal(prev => ({ ...prev, isDeleting: false }))
    }
  }

  const filteredTeam = team.filter(m => 
    m.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.email?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 px-4 sm:px-8 pt-8">
      {/* Back Button */}
      <div className="max-w-5xl mx-auto mb-4">
        <button
          onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200/80 px-3.5 py-2 rounded-xl transition-all shadow-xs active:scale-95 cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Back to Profile</span>
        </button>
      </div>

      {/* Header */}
      <div className="max-w-5xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Shield className="text-blue-600" /> Internal Team
          </h1>
          <p className="text-slate-500 text-sm font-medium mt-1">
            Manage staff roles and access for <span className="text-blue-600 font-bold">{currentUser?.business_name || 'your workspace'}</span>
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-6 py-3 rounded-2xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95"
        >
          <UserPlus size={18} /> Add Member
        </button>
      </div>

      {/* Search */}
      <div className="max-w-5xl mx-auto mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search team members by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm font-medium"
          />
        </div>
      </div>

      {/* Team List */}
      <div className="max-w-5xl mx-auto space-y-4">
        {filteredTeam.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTeam.map((member) => (
              <div key={member.id} className="bg-white border border-slate-200 rounded-[1.5rem] p-5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center text-lg font-bold shadow-sm bg-slate-50 border border-slate-100 shrink-0">
                    {member.avatar_url ? (
                      <img src={member.avatar_url} alt={member.full_name || member.business_name} className="w-full h-full object-cover" />
                    ) : (
                      <span className={member.role === 'admin' ? 'text-indigo-600' : 'text-blue-500'}>
                        {(member.full_name || member.business_name || '').charAt(0).toUpperCase() || <Users size={20} />}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 truncate">{member.full_name || member.business_name}</h3>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                        member.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {member.role}
                      </span>
                      {member.is_disabled && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-rose-100 text-rose-700">
                          Disabled
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      <Mail size={12} />
                      <span className="truncate">{member.email}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        <span className="flex items-center gap-1"><Calendar size={12} /> Added {new Date(member.created_at).toLocaleDateString()}</span>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {/* Access Toggle */}
                      <div className="flex items-center gap-2" title={member.is_disabled ? 'Click to enable platform access' : 'Click to disable platform access'}>
                        <span className={`text-[11px] font-bold ${member.is_disabled ? 'text-rose-500' : 'text-emerald-600'}`}>
                          {member.is_disabled ? 'Disabled' : 'Active'}
                        </span>
                        <button 
                          type="button"
                          onClick={() => handleToggleMemberStatus(member.id, !member.is_disabled)}
                          className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            !member.is_disabled ? 'bg-emerald-500' : 'bg-slate-300'
                          }`}
                        >
                          <span 
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                              !member.is_disabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <button 
                          onClick={() => openDeleteModal(member)}
                          className="text-slate-300 hover:text-red-500 hover:bg-rose-50 rounded-lg transition-all p-1.5 cursor-pointer"
                          title="Remove & Reassign Member"
                      >
                          <Trash2 size={16} />
                      </button>
                    </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-dashed border-slate-300 rounded-[2rem] p-16 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-100">
              <Users className="text-slate-300" size={40} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">No team members yet</h2>
            <p className="text-slate-500 mt-2 max-w-sm mx-auto font-medium">
              Start building your internal team by adding managers and agents.
            </p>
          </div>
        )}
      </div>

      {/* Offboard & Reassign Leads Modal */}
      {deleteModal.isOpen && deleteModal.member && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !deleteModal.isDeleting && setDeleteModal(prev => ({ ...prev, isOpen: false }))} />
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg relative shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 border border-slate-100">
            <div className="p-6 sm:p-8">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                    <Trash2 size={22} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900">Offboard Team Member</h3>
                    <p className="text-xs text-slate-500 font-semibold">
                      Reassign active leads before deleting <span className="font-bold text-slate-800">{deleteModal.member.full_name || deleteModal.member.business_name}</span>.
                    </p>
                  </div>
                </div>
                <button
                  disabled={deleteModal.isDeleting}
                  onClick={() => setDeleteModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Member & Assigned Leads Summary Card */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 mb-5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-500">Member:</span>
                  <span className="font-black text-slate-900">{deleteModal.member.full_name || deleteModal.member.business_name} ({deleteModal.member.email})</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-500">Role:</span>
                  <span className="font-extrabold uppercase text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">{deleteModal.member.role}</span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
                  <span className="font-bold text-slate-700">Currently Assigned Leads:</span>
                  <span className="font-black text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                    {deleteModal.isLoadingCount ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <><span>{deleteModal.assignedLeadsCount}</span> leads</>
                    )}
                  </span>
                </div>
              </div>

              {/* Form Controls */}
              <div className="space-y-4">
                {/* 1. Reassign To Dropdown */}
                <div>
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
                    1. Reassign Leads To
                  </label>
                  <select
                    disabled={deleteModal.isDeleting}
                    value={deleteModal.reassignTo}
                    onChange={(e) => setDeleteModal(prev => ({ ...prev, reassignTo: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 text-xs focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold text-slate-800"
                  >
                    {currentUser && (
                      <option value={currentUser.id}>
                        👑 {currentUser.business_name || currentUser.full_name || 'Workspace Owner'} (Workspace Admin)
                      </option>
                    )}
                    {team
                      .filter(m => m.id !== deleteModal.member?.id && m.id !== currentUser?.id)
                      .map(m => (
                        <option key={m.id} value={m.id}>
                          👤 {m.business_name || m.full_name || m.email} ({m.role})
                        </option>
                      ))}
                    <option value="unassigned">⚠️ Leave Leads Unassigned</option>
                  </select>
                </div>

                {/* 2. Options / Checkboxes */}
                <div className="space-y-2.5 pt-1">
                  <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1">
                    2. Reassignment Rules
                  </label>

                  {/* Scheduled Actions Toggle */}
                  <label className="flex items-start gap-3 p-3 bg-slate-50/80 hover:bg-slate-100/80 border border-slate-200 rounded-2xl cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={deleteModal.transferWithScheduledActions}
                      disabled={deleteModal.isDeleting}
                      onChange={(e) => setDeleteModal(prev => ({ ...prev, transferWithScheduledActions: e.target.checked }))}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                    />
                    <div className="flex-1 text-xs">
                      <span className="font-extrabold text-slate-800 block">Transfer with Scheduled Pending Actions</span>
                      <span className="text-slate-500 text-[11px] font-medium leading-relaxed">
                        Keep scheduled next follow-up dates, reminders, and booking times intact for the new assignee.
                      </span>
                    </div>
                  </label>

                  {/* Past History Option */}
                  <label className="flex items-start gap-3 p-3 bg-slate-50/80 hover:bg-slate-100/80 border border-slate-200 rounded-2xl cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={deleteModal.deleteHistory}
                      disabled={deleteModal.isDeleting}
                      onChange={(e) => setDeleteModal(prev => ({ ...prev, deleteHistory: e.target.checked }))}
                      className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    />
                    <div className="flex-1 text-xs">
                      <span className="font-extrabold text-slate-800 block">Hide Past History & Reset to "New Lead"</span>
                      <span className="text-slate-500 text-[11px] font-medium leading-relaxed">
                        Hides previous conversation logs from new assignee and moves these leads to "New Lead" stage for fresh outreach.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  disabled={deleteModal.isDeleting}
                  onClick={() => setDeleteModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 px-4 rounded-2xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteModal.isDeleting}
                  onClick={handleConfirmDelete}
                  className="flex-[1.5] bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 px-4 rounded-2xl text-xs transition-all shadow-lg shadow-rose-500/20 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
                >
                  {deleteModal.isDeleting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Offboarding...
                    </>
                  ) : (
                    <>
                      <Trash2 size={15} /> Confirm & Reassign Leads
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="bg-white rounded-[2.5rem] w-full max-w-md relative shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="p-8">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center shadow-inner">
                  <UserPlus className="text-blue-600" size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">Add Member</h3>
                  <p className="text-sm text-slate-500 font-medium">Invite staff to manage this workspace.</p>
                </div>
              </div>

              <form onSubmit={handleCreateMember} className="space-y-5">
                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Full Name</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Sarah Jenkins"
                    value={newMember.business_name}
                    onChange={(e) => setNewMember({...newMember, business_name: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Email Address</label>
                  <input 
                    type="email" 
                    required
                    placeholder="sarah@agency.com"
                    value={newMember.email}
                    onChange={(e) => setNewMember({...newMember, email: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Assign Password</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Create a secure password"
                    value={newMember.password}
                    onChange={(e) => setNewMember({...newMember, password: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Team Role</label>
                  <select 
                    value={newMember.role}
                    onChange={(e) => setNewMember({...newMember, role: e.target.value as any})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 px-5 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold text-slate-700"
                  >
                    <option value="agent">Agent (Standard Access)</option>
                    <option value="admin">Admin (Full Management)</option>
                  </select>
                  <p className="mt-3 text-[10px] text-slate-500 font-medium leading-relaxed px-1">
                    {newMember.role === 'agent' 
                      ? 'Agents can manage inventory, ads, and CRM leads assigned to them. They cannot access billing or team settings.' 
                      : 'Admins have full access to billing, team management, and all workspace assets.'}
                  </p>
                </div>

                {isCreating ? (
                  <button disabled className="w-full bg-slate-100 text-slate-400 py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin" /> Processing...
                  </button>
                ) : (
                  <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl text-sm font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]">
                    Add Member Now
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}