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
  Calendar
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

  const fetchData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/')
        return
      }

      // 1. Get current/impersonated user profile
      const { data: authProfile } = await supabase.from('profiles').select('role, agency_id').eq('id', session.user.id).single()
      
      // If user is Admin/Agent, default to their agency
      const targetId = impersonateId || authProfile?.agency_id || session.user.id
      
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', targetId).single()
      setCurrentUser(profile)

      // 2. Fetch Team Members (Admin or Agent)
      // They are linked via parent_id
      const { data: members, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('parent_id', targetId)
        .in('role', ['admin', 'agent'])
        .order('created_at', { ascending: false })

      if (error) throw error
      setTeam(members || [])
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

  const handleDeleteMember = async (memberId: string) => {
    if (!confirm("Are you sure you want to remove this team member? This will delete their account access.")) return

    try {
      const response = await fetch('/api/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: currentUser.id,
          agentId: memberId
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to remove member')
      }

      toast.success("Member removed from team")
      fetchData()
    } catch (err: any) {
      toast.error("Error", { description: err.message })
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
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shadow-sm ${
                    member.role === 'admin' ? 'bg-indigo-100 text-indigo-600' : 'bg-blue-50 text-blue-500'
                  }`}>
                    {member.business_name?.charAt(0) || <Users size={20} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 truncate">{member.business_name}</h3>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                        member.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {member.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                      <Mail size={12} />
                      <span className="truncate">{member.email}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        <span className="flex items-center gap-1"><Calendar size={12} /> Added {new Date(member.created_at).toLocaleDateString()}</span>
                    </div>
                    <button 
                        onClick={() => handleDeleteMember(member.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors p-2"
                        title="Remove Member"
                    >
                        <Trash2 size={16} />
                    </button>
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