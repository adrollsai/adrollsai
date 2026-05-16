'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  Users, 
  Plus, 
  Search, 
  ExternalLink, 
  MoreVertical, 
  Shield, 
  Building2, 
  User as UserIcon,
  Loader2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function AccountsPage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')

  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [accounts, setAccounts] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  
  // Create Modal State
  const [newAccount, setNewAccount] = useState({
    email: '',
    business_name: '',
    password: '',
    role: 'client'
  })
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchData()
  }, [impersonateId])

  const fetchData = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. Get current logged in user's profile to check authority
    const { data: authProfile } = await supabase
      .from('profiles')
      .select('role, id, agency_id, parent_id')
      .eq('id', user.id)
      .single()

    // 2. Resolve the "Target" user (who we are viewing as)
    // If user is an Admin or Agent, they see through the eyes of their Agency
    let targetUserId = user.id
    if (['admin', 'agent'].includes(authProfile?.role || '') && (authProfile?.agency_id || authProfile?.parent_id)) {
        targetUserId = (authProfile?.agency_id || authProfile?.parent_id) as string
    }
    
    if (impersonateId && (authProfile?.role === 'super_admin' || authProfile?.role === 'agency' || authProfile?.role === 'admin' || authProfile?.role === 'agent')) {
        targetUserId = impersonateId
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .single()
    
    setCurrentUser(profile)

    let query = supabase.from('profiles').select('*') // Show all roles again

    if (profile?.role === 'super_admin') {
      // Super admin sees EVERYONE on the platform
      query = query.neq('id', targetUserId) // Hide self
    } else if (profile?.role === 'agency') {
      // Agency sees only their clients/staff
      query = query.or(`agency_id.eq.${targetUserId},parent_id.eq.${targetUserId}`)
    } else {
      // For admins, agents or basic clients who shouldn't see this page, we redirect
      // BUT if we are impersonating them as a super_admin, we stay
      if (authProfile?.role !== 'super_admin' && authProfile?.role !== 'agency') {
          router.push('/dashboard')
          return
      }
    }

    const { data: subAccounts, error: queryError } = await query.order('created_at', { ascending: false })
    
    if (queryError) console.error("[ACCOUNTS] Query Error:", queryError)
    
    // DIAGNOSTIC: See what is actually being returned
    console.log(`[ACCOUNTS] Fetched ${subAccounts?.length || 0} accounts. Roles:`, subAccounts?.map(a => `${a.email} (${a.role})`))
    
    setAccounts(subAccounts || [])
    setLoading(false)
  }

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)
    setError('')

    try {
      const response = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: currentUser.id,
          email: newAccount.email,
          password: newAccount.password,
          businessName: newAccount.business_name,
          role: newAccount.role // Use the selected role from state
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to create account')
      }

      setShowCreateModal(false)
      setNewAccount({ email: '', business_name: '', password: '', role: 'client' })
      fetchData()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsCreating(false)
    }
  }

  // Grouping logic for hierarchy
  const buildTree = (flatAccounts: any[]) => {
    const roots: any[] = []
    const childrenMap: Record<string, any[]> = {}
    const accountMap: Record<string, any> = {}

    // 1. Map all accounts for quick lookup
    flatAccounts.forEach(acc => accountMap[acc.id] = acc)

    // 2. Identify roots and children
    flatAccounts.forEach(acc => {
      const pId = acc.agency_id || acc.parent_id
      
      // If the parent is NOT in the list, it's effectively a root for this view
      if (!pId || !accountMap[pId]) {
        roots.push(acc)
      } else {
        if (!childrenMap[pId]) childrenMap[pId] = []
        childrenMap[pId].push(acc)
      }
    })

    return roots.map(root => ({
      ...root,
      children: childrenMap[root.id] || []
    }))
  }

  const treeData = buildTree(accounts)
  const filteredTree = treeData.filter(root => 
    root.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    root.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    root.children.some((c: any) => c.business_name?.toLowerCase().includes(searchQuery.toLowerCase()))
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
      <div className="max-w-6xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <Building2 className="text-blue-600" /> Platform Hierarchy
          </h1>
          <p className="text-slate-500 mt-1">
            Oversee all partners, clients, and team members in your network.
          </p>
        </div>

          <button
            onClick={() => {
              setNewAccount({ ...newAccount, role: currentUser?.role === 'super_admin' ? 'agency' : 'client' })
              setShowCreateModal(true)
            }}
            className="bg-blue-600 text-white px-6 py-3 rounded-2xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20 active:scale-95"
          >
            <Plus size={20} />
            {currentUser?.role === 'super_admin' ? 'Add Agency Partner' : 'Add Client Account'}
          </button>
        </div>

      {/* Search */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="Search organizations or users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-12 pr-4 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Hierarchical List */}
      <div className="max-w-6xl mx-auto space-y-6">
        {filteredTree.length > 0 ? (
          filteredTree.map((root) => (
            <div key={root.id} className="space-y-3">
              {/* Parent Card */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-blue-200 transition-all flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-100 group-hover:scale-105 transition-transform overflow-hidden">
                    {root.logo_url ? <img src={root.logo_url} className="w-full h-full object-cover" /> : <Building2 className="text-slate-400" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900">{root.business_name || 'Root Account'}</h3>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-100 text-indigo-700 tracking-tighter">
                        {root.role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{root.email}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <button 
                      onClick={() => router.push(`/dashboard/team?impersonate=${root.id}`)}
                      className="bg-slate-50 hover:bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 transition-all flex items-center gap-1.5"
                    >
                      <Users size={14} /> Team
                    </button>
                    <button 
                      onClick={() => router.push(`/dashboard?impersonate=${root.id}`)}
                      className="bg-slate-50 hover:bg-blue-50 text-slate-600 hover:text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 transition-all flex items-center gap-1.5"
                    >
                      <ExternalLink size={14} /> Access
                    </button>
                </div>
              </div>

              {/* Children Grid/List */}
              {root.children.length > 0 && (
                <div className="ml-8 sm:ml-12 pl-6 border-l-2 border-slate-100 space-y-3">
                  {root.children.map((child: any) => (
                    <div key={child.id} className="bg-white/50 border border-slate-200 rounded-xl p-4 flex items-center justify-between hover:bg-white transition-all group">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-slate-100">
                          {child.logo_url ? <img src={child.logo_url} className="w-full h-full object-cover rounded-lg" /> : <UserIcon size={16} className="text-slate-400" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-800">{child.business_name}</h4>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter ${
                              child.role === 'client' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {child.role}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-medium">{child.email}</p>
                        </div>
                      </div>

                      <button 
                        onClick={() => router.push(`/dashboard?impersonate=${child.id}`)}
                        className="opacity-0 group-hover:opacity-100 bg-white hover:bg-slate-50 text-slate-500 p-1.5 rounded-md border border-slate-200 transition-all"
                        title="Impersonate"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-12 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="text-slate-300" size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">No accounts found</h2>
            <p className="text-slate-500 mt-1 max-w-sm mx-auto">
              Your network hierarchy is empty. Create a root partner to get started.
            </p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="bg-white rounded-[2rem] w-full max-w-md relative shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
                  <Plus className="text-blue-600" />
                </div>
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">
                    {newAccount.role === 'agency' ? 'Add Agency Partner' : 'Add New Client'}
                  </h3>
                  <p className="text-sm text-slate-500 font-medium">
                    {newAccount.role === 'agency' ? 'Onboard a new agency to your platform.' : 'Create a managed account for your customer.'}
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Full Name</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. John Doe"
                    value={newAccount.business_name}
                    onChange={(e) => setNewAccount({...newAccount, business_name: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Email Address</label>
                  <input 
                    type="email" 
                    required
                    placeholder="client@example.com"
                    value={newAccount.email}
                    onChange={(e) => setNewAccount({...newAccount, email: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Assign Password</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Minimum 6 characters"
                    value={newAccount.password}
                    onChange={(e) => setNewAccount({...newAccount, password: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Account Role</label>
                  <select 
                    value={newAccount.role}
                    onChange={(e) => setNewAccount({...newAccount, role: e.target.value as any})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                  >
                    {currentUser?.role === 'super_admin' ? (
                      <>
                        <option value="agency">Agency Partner (Root Account)</option>
                        <option value="client">Direct Client (External Account)</option>
                      </>
                    ) : (
                      <option value="client">Client (Managed Account)</option>
                    )}
                  </select>
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-xl flex items-center gap-2 text-sm font-medium">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="flex-1 py-3 px-4 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isCreating}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                  >
                    {isCreating ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
