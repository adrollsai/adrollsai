'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation' 
import { Loader2, Plus, Shield, Building2, ExternalLink, Save, Users, Edit2, X, Check } from 'lucide-react'

// Types
type Organization = { 
    id: string; 
    name: string; 
    created_at: string;
    agent_limit?: number; 
}

export default function SuperAdminPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Data
  const [orgs, setOrgs] = useState<Organization[]>([])
  
  // New Org Form State
  const [newOrgData, setNewOrgData] = useState({ 
      name: '', 
      adminEmail: '', 
      adminName: '', 
      adminPassword: '',
      agentLimit: 10 
  })
  const [showCreateOrg, setShowCreateOrg] = useState(false)

  // --- EDIT MODE STATE ---
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null)
  const [editLimitValue, setEditLimitValue] = useState<number>(0)
  const [isUpdating, setIsUpdating] = useState(false)

  // 1. SECURITY CHECK & FETCH
  useEffect(() => {
    fetchOrgs()
  }, []) 

  const fetchOrgs = async () => {
    try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profile?.role !== 'super_user') {
            router.replace('/dashboard')
            return
        }

        const { data } = await supabase
            .from('organizations')
            .select('id, name, created_at, agent_limit')
            .order('created_at', { ascending: false })
        
        if (data) setOrgs(data)
        setLoading(false)
    } catch (error) {
        console.error("Auth check failed", error)
        router.push('/dashboard')
    }
  }

  // --- Handle Create Organization ---
  const handleCreateOrg = async () => {
      if (!newOrgData.name || !newOrgData.adminEmail || !newOrgData.adminPassword) {
          alert("Please fill all fields")
          return
      }
      setIsSubmitting(true)
      try {
          const res = await fetch('/api/admin/create-org', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  orgName: newOrgData.name,
                  adminEmail: newOrgData.adminEmail,
                  adminPassword: newOrgData.adminPassword,
                  adminName: newOrgData.adminName,
                  agentLimit: newOrgData.agentLimit 
              })
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error)
          
          alert(`✅ Organization '${newOrgData.name}' created successfully!`)
          setNewOrgData({ name: '', adminEmail: '', adminName: '', adminPassword: '', agentLimit: 10 })
          setShowCreateOrg(false)
          fetchOrgs() // Refresh list

      } catch (e: any) {
          alert("❌ Failed: " + e.message)
      } finally {
          setIsSubmitting(false)
      }
  }

  // --- Handle Update Limit ---
  const startEditing = (org: Organization) => {
      setEditingOrgId(org.id)
      setEditLimitValue(org.agent_limit || 5)
  }

  const cancelEditing = () => {
      setEditingOrgId(null)
      setEditLimitValue(0)
  }

  const saveLimit = async (orgId: string) => {
      setIsUpdating(true)
      try {
          const res = await fetch('/api/admin/update-org-limit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  orgId: orgId,
                  agentLimit: editLimitValue
              })
          })
          
          if (!res.ok) {
              const data = await res.json()
              throw new Error(data.error || 'Failed to update')
          }

          // Update local state immediately for speed
          setOrgs(orgs.map(org => org.id === orgId ? { ...org, agent_limit: editLimitValue } : org))
          setEditingOrgId(null)

      } catch (e: any) {
          alert("❌ Update Failed: " + e.message)
      } finally {
          setIsUpdating(false)
      }
  }

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 pb-32">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
                <div className="bg-purple-600 text-white p-2.5 rounded-xl shadow-lg shadow-purple-200">
                    <Shield size={24} />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Super User Console</h1>
                    <p className="text-xs text-slate-500 font-medium">Organization Management</p>
                </div>
            </div>
            <button 
                onClick={() => setShowCreateOrg(!showCreateOrg)}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-800"
            >
                <Plus size={16}/> New Organization
            </button>
        </div>

        {/* CREATE ORG FORM */}
        {showCreateOrg && (
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mb-8 animate-in slide-in-from-top-4">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><Building2 size={18} className="text-purple-600"/> Create New Organization</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input 
                        placeholder="Organization Name" 
                        className="bg-slate-50 p-3 rounded-xl text-sm border border-transparent focus:border-purple-200 focus:bg-white outline-none"
                        value={newOrgData.name} onChange={e => setNewOrgData({...newOrgData, name: e.target.value})}
                    />
                    <input 
                        placeholder="Admin Name" 
                        className="bg-slate-50 p-3 rounded-xl text-sm border border-transparent focus:border-purple-200 focus:bg-white outline-none"
                        value={newOrgData.adminName} onChange={e => setNewOrgData({...newOrgData, adminName: e.target.value})}
                    />
                    <input 
                        placeholder="Admin Email" 
                        type="email"
                        className="bg-slate-50 p-3 rounded-xl text-sm border border-transparent focus:border-purple-200 focus:bg-white outline-none"
                        value={newOrgData.adminEmail} onChange={e => setNewOrgData({...newOrgData, adminEmail: e.target.value})}
                    />
                    <input 
                        placeholder="Set Admin Password" 
                        type="text"
                        className="bg-slate-50 p-3 rounded-xl text-sm border border-transparent focus:border-purple-200 focus:bg-white outline-none"
                        value={newOrgData.adminPassword} onChange={e => setNewOrgData({...newOrgData, adminPassword: e.target.value})}
                    />
                    
                    {/* Agent Limit Input */}
                    <div className="md:col-span-2 flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-transparent focus-within:border-purple-200 focus-within:bg-white">
                        <Users size={16} className="text-slate-400"/>
                        <label className="text-sm font-bold text-slate-500 whitespace-nowrap">Agent Limit:</label>
                        <input 
                            type="number"
                            min="1"
                            className="bg-transparent w-full text-sm outline-none font-bold text-slate-800"
                            value={newOrgData.agentLimit} 
                            onChange={e => setNewOrgData({...newOrgData, agentLimit: parseInt(e.target.value)})}
                        />
                    </div>
                </div>
                <div className="mt-4 flex justify-end gap-3">
                    <button onClick={() => setShowCreateOrg(false)} className="text-slate-500 text-xs font-bold px-4 py-2 hover:bg-slate-50 rounded-lg">Cancel</button>
                    <button 
                        onClick={handleCreateOrg}
                        disabled={isSubmitting}
                        className="bg-purple-600 text-white px-6 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-purple-700"
                    >
                        {isSubmitting ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Create Organization
                    </button>
                </div>
            </div>
        )}

        {/* ORGS LIST */}
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
            <h2 className="font-bold text-slate-400 text-xs uppercase tracking-wider mb-4 ml-1">All Organizations</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {orgs.map(org => (
                    <div 
                        key={org.id} 
                        className="p-4 rounded-2xl border border-slate-100 bg-white relative group hover:border-purple-100 transition-all"
                    >
                        <div>
                            <p className="font-bold text-sm text-slate-800">{org.name}</p>
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">{org.id}</p>
                            
                            {/* --- AGENT LIMIT SECTION --- */}
                            <div className="mt-3 bg-slate-50 p-2 rounded-lg inline-flex items-center gap-2">
                                <Users size={12} className="text-purple-500"/> 
                                
                                {editingOrgId === org.id ? (
                                    <div className="flex items-center gap-1 animate-in fade-in zoom-in duration-200">
                                        <input 
                                            type="number" 
                                            className="w-12 text-xs font-bold bg-white border border-purple-200 rounded px-1 py-0.5 outline-none focus:ring-2 focus:ring-purple-100"
                                            value={editLimitValue}
                                            onChange={(e) => setEditLimitValue(parseInt(e.target.value))}
                                            autoFocus
                                        />
                                        <button 
                                            onClick={() => saveLimit(org.id)}
                                            disabled={isUpdating}
                                            className="bg-green-500 text-white p-1 rounded hover:bg-green-600"
                                        >
                                            {isUpdating ? <Loader2 size={10} className="animate-spin"/> : <Check size={10}/>}
                                        </button>
                                        <button 
                                            onClick={cancelEditing}
                                            className="bg-slate-200 text-slate-500 p-1 rounded hover:bg-slate-300"
                                        >
                                            <X size={10}/>
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <span className="text-xs font-medium text-slate-600">Limit: {org.agent_limit || '∞'}</span>
                                        <button 
                                            onClick={() => startEditing(org)}
                                            className="text-slate-400 hover:text-purple-600 p-1 hover:bg-purple-50 rounded-full transition-colors"
                                            title="Edit Limit"
                                        >
                                            <Edit2 size={10} />
                                        </button>
                                    </>
                                )}
                            </div>
                            
                            <p className="text-[10px] text-slate-400 mt-2">Created: {new Date(org.created_at).toLocaleDateString()}</p>
                        </div>

                        <a 
                            href={`/dashboard?impersonate_org=${org.id}`}
                            target="_blank"
                            className="absolute top-3 right-3 bg-slate-900 text-white text-[10px] font-bold px-2 py-1.5 rounded-lg transition-all flex items-center gap-1 shadow-md opacity-0 group-hover:opacity-100"
                            title="Login as Admin"
                        >
                            Login <ExternalLink size={10} />
                        </a>
                    </div>
                ))}
            </div>
            {orgs.length === 0 && <div className="text-center py-10 text-slate-400">No organizations found.</div>}
        </div>
      </div>
    </div>
  )
}