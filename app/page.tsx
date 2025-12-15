'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Building2, User, LayoutGrid, CheckCircle2, TestTube2, AlertCircle } from 'lucide-react'

type InviteInfo = {
  name: string
  logo_url: string
}

export default function LoginPage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [loading, setLoading] = useState(false)
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null)
  
  // Capture the invite code
  const inviteOrg = searchParams.get('invite_org')
  const errorMsg = searchParams.get('error')

  // Fetch Org Details if Invited
  useEffect(() => {
    const fetchInviteDetails = async () => {
      if (!inviteOrg) return
      
      const { data, error } = await supabase.rpc('get_public_org_info', { org_id: inviteOrg })
      if (data && data.length > 0) {
        setInviteInfo({ name: data[0].name, logo_url: data[0].logo_url })
      }
    }
    fetchInviteDetails()
  }, [inviteOrg])

  const handleLogin = async (provider: 'google' | 'linkedin_oidc') => {
    setLoading(true)
    try {
      const redirectUrl = new URL(`${window.location.origin}/auth/callback`)
      if (inviteOrg) {
        redirectUrl.searchParams.set('invite_org', inviteOrg)
      }

      await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl.toString(),
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      })
    } catch (error) {
      console.error(error)
      setLoading(false)
    }
  }

  // --- UPDATED DEMO LOGIN ---
  const handleDemoLogin = async () => {
    setLoading(true)
    try {
      // 1. Perform Login
      const { data: { user }, error } = await supabase.auth.signInWithPassword({
        email: 'demo@adrolls.ai',
        password: 'demo123'
      })
      
      if (error) throw error
      if (!user) throw new Error("No user returned")

      // 2. CHECK FOR INVITE & MANUALLY LINK
      if (inviteOrg) {
          console.log("Linking Demo User to Invite Org:", inviteOrg)
          
          // A. Add to Members Table (Upsert to avoid errors if already in)
          await supabase.from('organization_members').upsert({
              user_id: user.id,
              organization_id: inviteOrg,
              role: 'agent'
          }, { onConflict: 'organization_id, user_id' })

          // B. Update Profile to Switch Context to this Org
          await supabase.from('profiles').update({
              organization_id: inviteOrg,
              role: 'agent'
          }).eq('id', user.id)
      }

      // 3. Redirect
      router.push('/dashboard')
    } catch (error: any) {
      alert("Demo Login Failed: " + error.message)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden">
        
        {/* Dynamic Header */}
        <div className="bg-slate-900 p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10">
             <LayoutGrid className="w-full h-full text-white" />
          </div>
          <div className="relative z-10">
            {/* Show Invite Org Logo if available, else Default */}
            <div className="w-20 h-20 bg-white rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg p-2">
               {inviteInfo?.logo_url ? (
                 <img src={inviteInfo.logo_url} className="w-full h-full object-contain" alt="Org Logo"/>
               ) : (
                 inviteOrg ? <User size={32} className="text-blue-600"/> : <Building2 size={32} className="text-slate-900"/>
               )}
            </div>
            
            <h1 className="text-2xl font-black text-white tracking-tight">
              {inviteInfo ? inviteInfo.name : 'AdRolls.ai'}
            </h1>
            <p className="text-slate-400 text-sm mt-1 font-medium">
              {inviteInfo ? 'Invited you to join their team' : 'Builder & Agent Marketing OS'}
            </p>
          </div>
        </div>

        {/* Login Body */}
        <div className="p-8 space-y-6">
           
           {errorMsg && (
             <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex gap-2 items-center text-red-600 text-xs font-bold">
               <AlertCircle size={16}/> {decodeURIComponent(errorMsg)}
             </div>
           )}

           {inviteOrg && (
             <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 items-start">
                <CheckCircle2 size={20} className="text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-blue-900">Accept Invitation</h3>
                  <p className="text-xs text-blue-700 leading-relaxed mt-1">
                    Sign in to join <b>{inviteInfo?.name || 'the organization'}</b> as an Agent. You will gain access to shared projects and creatives.
                  </p>
                </div>
             </div>
           )}

           <div className="space-y-3">
              <button 
                onClick={() => handleLogin('google')} 
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 p-4 rounded-xl text-slate-700 font-bold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-[0.98]"
              >
                {loading ? <Loader2 size={18} className="animate-spin"/> : (
                  <>
                    <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google"/>
                    Continue with Google
                  </>
                )}
              </button>

              <button 
                onClick={handleDemoLogin} 
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-indigo-50 border border-indigo-100 p-4 rounded-xl text-indigo-700 font-bold text-sm hover:bg-indigo-100 transition-all active:scale-[0.98]"
              >
                 {loading ? <Loader2 size={18} className="animate-spin text-indigo-600"/> : (
                    <>
                       <TestTube2 size={20} className="text-indigo-600" />
                       Demo Agent Login
                    </>
                 )}
              </button>
           </div>
           
           <div className="text-center">
             <p className="text-xs text-slate-400">
               By continuing, you agree to our Terms & Privacy Policy.
             </p>
           </div>
        </div>
      </div>
    </div>
  )
}