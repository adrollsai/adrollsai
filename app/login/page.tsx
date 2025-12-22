'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Building2, User, LayoutGrid, CheckCircle2, TestTube2, AlertCircle, Mail, Lock, ArrowRight } from 'lucide-react'

type InviteInfo = {
  name: string
  logo_url: string
}

function LoginForm() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [loading, setLoading] = useState(false)
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null)
  
  // New State for Email Auth
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)

  // Capture the invite code and error
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

  // --- OAUTH LOGIN ---
  const handleOAuthLogin = async (provider: 'google' | 'linkedin_oidc') => {
    setLoading(true)
    try {
      const origin = window.location.origin
      const redirectUrl = new URL(`${origin}/auth/callback`)
      
      if (inviteOrg) {
        redirectUrl.searchParams.set('invite_org', inviteOrg)
      }

      await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl.toString(),
          queryParams: {
            config_id: '25664675166502911',
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

  // --- EMAIL LOGIN / SIGNUP ---
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      if (authMode === 'signup') {
        // 1. SIGN UP FLOW
        const origin = window.location.origin
        const redirectUrl = new URL(`${origin}/auth/callback`)
        if (inviteOrg) redirectUrl.searchParams.set('invite_org', inviteOrg)

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl.toString() // Important: passes invite_org to callback
          }
        })

        if (error) throw error
        setMessage({ type: 'success', text: 'Check your email for the confirmation link.' })
        
      } else {
        // 2. LOGIN FLOW
        const { data: { user }, error } = await supabase.auth.signInWithPassword({
          email,
          password
        })

        if (error) throw error
        if (!user) throw new Error("Login failed")

        // Manually handle Invite Linking (since login skips the callback route)
        if (inviteOrg) {
          console.log("Linking User to Invite Org:", inviteOrg)
          
          await supabase.from('organization_members').upsert({
              user_id: user.id,
              organization_id: inviteOrg,
              role: 'agent'
          }, { onConflict: 'organization_id, user_id' })

          await supabase.from('profiles').update({
              organization_id: inviteOrg,
              role: 'agent'
          }).eq('id', user.id)
        }

        router.push('/dashboard')
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  // --- DEMO LOGIN LOGIC ---
  const handleDemoLogin = async () => {
    setLoading(true)
    try {
      const { data: { user }, error } = await supabase.auth.signInWithPassword({
        email: 'demo@adrolls.ai',
        password: 'demo123'
      })
      
      if (error) throw error
      if (!user) throw new Error("No user returned")

      if (inviteOrg) {
          await supabase.from('organization_members').upsert({
              user_id: user.id,
              organization_id: inviteOrg,
              role: 'agent'
          }, { onConflict: 'organization_id, user_id' })

          await supabase.from('profiles').update({
              organization_id: inviteOrg,
              role: 'agent'
          }).eq('id', user.id)
      }

      router.push('/dashboard')
    } catch (error: any) {
      alert("Demo Login Failed: " + error.message)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-slate-900 p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10">
             <LayoutGrid className="w-full h-full text-white" />
          </div>
          <div className="relative z-10">
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

        {/* Body */}
        <div className="p-8 space-y-6">
           
           {/* Global Error/Success Messages */}
           {(errorMsg || message) && (
             <div className={`p-3 rounded-xl flex gap-2 items-center text-xs font-bold ${
               message?.type === 'success' 
                 ? 'bg-green-50 border border-green-100 text-green-700' 
                 : 'bg-red-50 border border-red-100 text-red-600'
             }`}>
               {message?.type === 'success' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>} 
               {message ? message.text : decodeURIComponent(errorMsg || '')}
             </div>
           )}

           {inviteOrg && !message && (
             <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 items-start">
                <CheckCircle2 size={20} className="text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-blue-900">Accept Invitation</h3>
                  <p className="text-xs text-blue-700 leading-relaxed mt-1">
                    {authMode === 'login' ? 'Sign in' : 'Sign up'} to join <b>{inviteInfo?.name || 'the organization'}</b> as an Agent.
                  </p>
                </div>
             </div>
           )}

           {/* --- EMAIL FORM --- */}
           <form onSubmit={handleEmailAuth} className="space-y-4">
             <div>
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email Address</label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="email" 
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    placeholder="name@company.com"
                  />
                </div>
             </div>
             
             <div>
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Password</label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="password" 
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                    placeholder="••••••••"
                  />
                </div>
             </div>

             <button 
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white p-4 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all active:scale-[0.98]"
              >
                {loading ? <Loader2 size={18} className="animate-spin"/> : (
                  <>
                    {authMode === 'login' ? 'Sign In' : 'Create Account'}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
           </form>

           {/* Toggle Auth Mode */}
           <div className="text-center">
             <button 
               type="button"
               onClick={() => {
                 setAuthMode(authMode === 'login' ? 'signup' : 'login')
                 setMessage(null)
               }}
               className="text-sm text-slate-500 hover:text-slate-800 font-medium transition-colors"
             >
               {authMode === 'login' 
                 ? "Don't have an account? Sign up" 
                 : "Already have an account? Sign in"}
             </button>
           </div>

           <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400">Or continue with</span></div>
           </div>

           <div className="space-y-3">
              <button 
                onClick={() => handleOAuthLogin('google')} 
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 p-4 rounded-xl text-slate-700 font-bold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-[0.98]"
              >
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google"/>
                Google
              </button>

              <button 
                onClick={handleDemoLogin} 
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-indigo-50 border border-indigo-100 p-4 rounded-xl text-indigo-700 font-bold text-sm hover:bg-indigo-100 transition-all active:scale-[0.98]"
              >
                 <TestTube2 size={20} className="text-indigo-600" />
                 Demo Agent Login
              </button>
           </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400 w-8 h-8" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}