'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Shield, Mail, UserMinus, UserPlus, Loader2, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

type Agent = {
  id: string
  business_name?: string
  logo_url?: string
  role: string
  // Note: If you don't store email in profiles, we rely on their name. 
  // It is recommended to add an 'email' column to your 'profiles' table for easier UI display!
}

export default function TeamManagementPage() {
  const supabase = createClient()
  const router = useRouter()
  
  const [loading, setLoading] = useState(true)
  const [adminId, setAdminId] = useState<string | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  
  // Modal State
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [isRemoving, setIsRemoving] = useState<string | null>(null)

  const fetchTeam = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, business_name, logo_url, role')
      .eq('parent_id', userId)
      .order('created_at', { ascending: false })
      
    if (data) setAgents(data)
  }

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
          router.push('/')
          return
      }

      // Check if user is an admin
      const { data: profile } = await supabase.from('profiles').select('role, business_name').eq('id', user.id).single()
      
      if (profile?.role !== 'admin') {
          toast.error("Unauthorized. Only Admins can manage teams.")
          router.push('/dashboard')
          return
      }

      setAdminId(user.id)
      setBusinessName(profile?.business_name || 'Your Company')
      await fetchTeam(user.id)
      setLoading(false)
    }
    init()
  }, [router, supabase])

  // --- ACTIONS ---
  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail || !adminId) return

    setIsInviting(true)
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, email: inviteEmail.trim(), password: invitePassword, businessName, fullName: inviteName.trim() })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      toast.success(data.message)
      setInviteEmail('')
      setInvitePassword('')
      setInviteName('')
      setShowInviteModal(false)
      
      // Refresh list
      await fetchTeam(adminId)
      
    } catch (error: any) {
      toast.error('Failed to invite agent', { description: error.message })
    } finally {
      setIsInviting(false)
    }
  }

  const handleRemove = async (agentId: string, agentName: string) => {
    if (!confirm(`Are you sure you want to remove ${agentName || 'this agent'}? They will instantly lose access to your workspace and leads.`)) return
    
    setIsRemoving(agentId)
    try {
      const res = await fetch('/api/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, agentId })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      toast.success('Agent access revoked successfully.')
      setAgents(prev => prev.filter(a => a.id !== agentId))
      
    } catch (error: any) {
      toast.error('Failed to remove agent', { description: error.message })
    } finally {
      setIsRemoving(null)
    }
  }

  if (loading) return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center gap-4">
          <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 font-sans">
      
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* Header Row */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 ml-1">
            <div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Team Management</h1>
                <p className="text-slate-500 font-medium mt-1">Manage agent access to your leads and assets.</p>
            </div>
            
            <button 
                onClick={() => setShowInviteModal(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3.5 rounded-full text-sm font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-95 transition-all w-full sm:w-auto"
            >
                <UserPlus size={18} /> Add Agent
            </button>
        </div>

        {/* Dashboard Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200/60 flex items-center gap-4">
                <div className="bg-emerald-100 text-emerald-600 p-4 rounded-[1.25rem]">
                    <Shield size={24} />
                </div>
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active Agents</p>
                    <h3 className="text-3xl font-black text-slate-900">{agents.length}</h3>
                </div>
            </div>
            
            <div className="sm:col-span-2 bg-slate-900 p-6 rounded-[2rem] shadow-sm flex flex-col justify-center relative overflow-hidden">
                <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-emerald-500/20 to-transparent"></div>
                <h4 className="text-white font-bold text-lg mb-1 flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-emerald-400" /> Secure Workspace
                </h4>
                <p className="text-slate-400 text-sm font-medium">When you remove an agent, their account is safely unlinked. Your historical leads and data remain untouched and securely owned by your admin account.</p>
            </div>
        </div>

        {/* Agents List */}
        <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
                <h3 className="font-bold text-lg text-slate-800">Current Members</h3>
            </div>
            
            {agents.length === 0 ? (
                <div className="p-12 text-center flex flex-col items-center justify-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                        <UserMinus size={24} className="text-slate-300" />
                    </div>
                    <p className="text-slate-500 font-bold">No agents added yet.</p>
                    <p className="text-sm text-slate-400 mt-1">Invite your team to start distributing leads.</p>
                </div>
            ) : (
                <div className="divide-y divide-slate-100">
                    {agents.map((agent) => (
                        <div key={agent.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-4 w-full sm:w-auto">
                                {agent.logo_url ? (
                                    <img src={agent.logo_url} alt="Agent" className="w-12 h-12 rounded-full object-cover shadow-sm border border-slate-200" />
                                ) : (
                                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-lg border border-slate-200">
                                        {(agent.business_name || 'A')[0].toUpperCase()}
                                    </div>
                                )}
                                <div>
                                    <h4 className="font-bold text-slate-900">{agent.business_name || 'Agent User'}</h4>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border border-emerald-200/60">Active Agent</span>
                                        <span className="text-xs text-slate-400 font-mono">ID: {agent.id.split('-')[0]}...</span>
                                    </div>
                                </div>
                            </div>
                            
                            <button 
                                onClick={() => handleRemove(agent.id, agent.business_name || 'Agent')}
                                disabled={isRemoving === agent.id}
                                className="w-full sm:w-auto bg-red-50 hover:bg-red-100 text-red-600 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isRemoving === agent.id ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
                                Revoke Access
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-extrabold text-slate-900">Add Agent</h2>
              <button onClick={() => setShowInviteModal(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={20} /></button>
            </div>
            
            <p className="text-sm text-slate-500 mb-6 font-medium leading-relaxed">
                Enter the agent's email address and assign a password. They will be able to log in immediately and access your workspace.
            </p>

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 mb-2 block">Agent's Full Name</label>
                <div className="relative">
                    <CheckCircle2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                        type="text" 
                        required
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 pl-12 pr-4 rounded-[1.25rem] text-slate-800 text-sm font-medium focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none border border-slate-200/60 transition-all" 
                        placeholder="John Doe" 
                    />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 mb-2 block">Agent's Email Address</label>
                <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                        type="email" 
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 pl-12 pr-4 rounded-[1.25rem] text-slate-800 text-sm font-medium focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none border border-slate-200/60 transition-all" 
                        placeholder="agent@company.com" 
                    />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 mb-2 block">Assign Password</label>
                <div className="relative">
                    <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                        type="text" 
                        required
                        value={invitePassword}
                        onChange={(e) => setInvitePassword(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 pl-12 pr-4 rounded-[1.25rem] text-slate-800 text-sm font-medium focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none border border-slate-200/60 transition-all" 
                        placeholder="Assign a secure password" 
                    />
                </div>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-2xl flex items-start gap-3 border border-blue-100 mt-6">
                  <AlertCircle size={18} className="text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-800 font-medium leading-relaxed">Agents can view your inventory and manage CRM leads assigned to them. They cannot access your billing or team settings.</p>
              </div>

              <button 
                  type="submit" 
                  disabled={isInviting || !inviteEmail || !invitePassword} 
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold shadow-xl shadow-slate-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:scale-100 mt-2"
              >
                {isInviting ? <Loader2 size={18} className="animate-spin" /> : <UserPlus size={18} />} 
                {isInviting ? 'Adding Agent...' : 'Add Agent'}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}