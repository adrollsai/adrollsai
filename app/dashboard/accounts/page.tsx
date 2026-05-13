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
import { useRouter } from 'next/navigation'

export default function AccountsPage() {
  const supabase = createClient()
  const router = useRouter()
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
  }, [])

  const fetchData = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    
    setCurrentUser(profile)

    let query = supabase.from('profiles').select('*')

    if (profile.role === 'super_admin') {
      // Super admin sees all agencies
      query = query.eq('role', 'agency')
    } else if (profile.role === 'agency' || profile.role === 'admin') {
      // Agency sees their clients
      query = query.eq('agency_id', user.id)
    } else {
      router.push('/dashboard')
      return
    }

    const { data: subAccounts } = await query.order('created_at', { ascending: false })
    setAccounts(subAccounts || [])
    setLoading(false)
  }

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)
    setError('')

    try {
      // In a real scenario, you'd use a service role or a specific API route to create users
      // Since I can't create Auth users directly from client without invite,
      // I'll simulate or provide instructions. 
      // For this implementation, we will assume an API route exists or will be created.
      
      const response = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId: currentUser.id,
          email: newAccount.email,
          password: newAccount.password,
          businessName: newAccount.business_name,
          role: currentUser.role === 'super_admin' ? 'agency' : 'client'
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

  const filteredAccounts = accounts.filter(acc => 
    acc.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    acc.email?.toLowerCase().includes(searchQuery.toLowerCase())
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
            {currentUser?.role === 'super_admin' ? (
              <><Shield className="text-blue-600" /> Agency Management</>
            ) : (
              <><Building2 className="text-blue-600" /> Client Accounts</>
            )}
          </h1>
          <p className="text-slate-500 mt-1">
            {currentUser?.role === 'super_admin' 
              ? 'Oversee all agency partners in your network.' 
              : 'Manage your sub-accounts and client environments.'}
          </p>
        </div>

        <button 
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-95"
        >
          <Plus size={20} />
          {currentUser?.role === 'super_admin' ? 'Add Agency' : 'New Client'}
        </button>
      </div>

      {/* Stats / Search */}
      <div className="max-w-6xl mx-auto mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text" 
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3.5 pl-12 pr-4 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Accounts List */}
      <div className="max-w-6xl mx-auto">
        {filteredAccounts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAccounts.map((acc) => (
              <div 
                key={acc.id} 
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-100 group-hover:scale-110 transition-transform overflow-hidden">
                    {acc.logo_url ? (
                      <img src={acc.logo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="text-slate-400" />
                    )}
                  </div>
                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    acc.role === 'agency' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {acc.role}
                  </div>
                </div>

                <h3 className="font-bold text-slate-900 truncate">{acc.business_name || 'Unnamed Business'}</h3>
                <p className="text-sm text-slate-500 mb-6 truncate">{acc.email}</p>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                        // Logic to "View" as this user
                        // We can set a cookie or use a specific param
                        router.push(`/dashboard?impersonate=${acc.id}`)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold py-2.5 rounded-xl border border-slate-200 transition-all"
                  >
                    <ExternalLink size={16} />
                    View Dashboard
                  </button>
                  <button className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-xl border border-slate-200 transition-all">
                    <MoreVertical size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-12 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="text-slate-300" size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">No accounts found</h2>
            <p className="text-slate-500 mt-1 max-w-sm mx-auto">
              You haven't added any sub-accounts yet. Get started by clicking the "Add" button.
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
                    {currentUser?.role === 'super_admin' ? 'Add Agency Partner' : 'Add Client Account'}
                  </h3>
                  <p className="text-sm text-slate-500">Create a new sub-environment.</p>
                </div>
              </div>

              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5 ml-1">Business Name</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Skyline Real Estate"
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
