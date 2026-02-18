'use client'

import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut, User, Phone, Mail, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function ProfilePage() {
  const supabase = createClient()
  const router = useRouter()
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => {
    const getProfile = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
            setProfile(data)
        }
    }
    getProfile()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="p-6 pb-32 max-w-lg mx-auto space-y-8">
      <h1 className="text-2xl font-black text-slate-900">My Profile</h1>

      {/* Profile Card */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 text-center space-y-4">
        <div className="w-20 h-20 bg-slate-100 rounded-full mx-auto flex items-center justify-center text-2xl font-bold text-slate-400">
            {profile?.business_name?.[0] || <User/>}
        </div>
        <div>
            <h2 className="text-lg font-bold text-slate-900">{profile?.business_name || 'Loading...'}</h2>
            <p className="text-xs text-slate-500">Fractional Owner</p>
        </div>
        
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-50 text-left">
            <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Email</p>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <Mail size={12}/> {profile?.email}
                </div>
            </div>
            <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Phone</p>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <Phone size={12}/> {profile?.contact_number || 'N/A'}
                </div>
            </div>
        </div>
      </div>

      {/* Settings List */}
      <div className="space-y-2">
        <div className="p-4 bg-white rounded-2xl border border-slate-100 flex items-center gap-3">
            <ShieldCheck size={18} className="text-emerald-500"/>
            <div className="flex-1">
                <p className="text-sm font-bold text-slate-900">KYC Verified</p>
                <p className="text-[10px] text-slate-500">Your documents are approved</p>
            </div>
        </div>
      </div>

      {/* Logout */}
      <button 
        onClick={handleSignOut}
        className="w-full py-4 rounded-xl bg-red-50 text-red-600 font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"
      >
        <LogOut size={16}/>
        Sign Out
      </button>
    </div>
  )
}