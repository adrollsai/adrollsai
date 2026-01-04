'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation' // Added useRouter
import { Loader2, Plus, Shield, Building2, ExternalLink, Save } from 'lucide-react'

// Types
type Organization = { id: string; name: string; created_at: string }

export default function SuperAdminPage() {
  const supabase = createClient()
  const router = useRouter() // Initialize router

  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Data
  const [orgs, setOrgs] = useState<Organization[]>([])
  
  // New Org Form State
  const [newOrgData, setNewOrgData] = useState({ name: '', adminEmail: '', adminName: '', adminPassword: '' })
  const [showCreateOrg, setShowCreateOrg] = useState(false)

  // 1. SECURITY CHECK & FETCH
  useEffect(() => {
    const init = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        
        // If not logged in, go to login
        if (!user) {
            router.push('/login')
            return
        }

        // Check Role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        // IF NOT SUPER USER -> KICK OUT
        if (profile?.role !== 'super_user') {
            router.replace('/dashboard') // Use replace to prevent back-button loops
            return
        }

        // If authorized, fetch orgs
        const { data } = await supabase
            .from('organizations')
            .select('id, name, created_at')
            .order('created_at', { ascending: false })
        
        if (data) setOrgs(data)
        setLoading(false)

      } catch (error) {
        console.error("Auth check failed", error)
        router.push('/dashboard')
      }
    }

    init()
  }, []) // Empty dependency array ensures this runs once on mount

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
                  adminName: newOrgData.adminName
              })
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error)
          
          alert(`✅ Organization '${newOrgData.name}' created successfully!`)
          setNewOrgData({ name: '', adminEmail: '', adminName: '', adminPassword: '' })
          setShowCreateOrg(false)
          
          // Refresh list
          const { data: refreshedOrgs } = await supabase
             .from('organizations')
             .select('id, name, created_at')
             .order('created_at', { ascending: false })
          if (refreshedOrgs) setOrgs(refreshedOrgs)

      } catch (e: any) {
          alert("❌ Failed: " + e.message)
      } finally {
          setIsSubmitting(false)
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