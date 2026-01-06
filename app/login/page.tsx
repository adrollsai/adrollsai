'use client'

import { useState, useEffect, Suspense } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Building2, User, LayoutGrid, CheckCircle2, TestTube2, AlertCircle, Mail, Lock, ArrowRight, ShieldCheck, ArrowLeft } from 'lucide-react'

type InviteInfo = {
  name: string
  logo_url: string
}

type BrandingInfo = {
  name: string
  logo: string | null
  isCustom: boolean
  subtitle: string
}

function LoginForm() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [loading, setLoading] = useState(false)
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null)
  
  // Custom Branding State (Default = AdRolls.in)
  const [branding, setBranding] = useState<BrandingInfo>({
    name: 'AdRolls.in',
    logo: '/icon.png', // Default logo
    isCustom: false,
    subtitle: 'Builder & Agent Marketing OS'
  })
  
  // View State: 'login' or 'forgot_password'
  const [view, setView] = useState<'login' | 'forgot_password'>('login')
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)

  const inviteOrg = searchParams.get('invite_org')
  const errorMsg = searchParams.get('error')

  // 1. FETCH CUSTOM BRANDING
  useEffect(() => {
    const fetchBranding = async () => {
      const hostname = window.location.hostname
      
      const SYSTEM_HOSTS = [
        'adrolls.in',
        'www.adrolls.in',
        'app.adrolls.in',
        process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
      ]

      if (SYSTEM_HOSTS.some(h => hostname.includes(h))) {
        return
      }

      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('name, master_logo_url') 
          .eq('custom_domain', hostname)
          .single()

        if (org) {
          setBranding({
            name: org.name,
            logo: org.master_logo_url, 
            isCustom: true,
            subtitle: `Welcome to ${org.name}`
          })
        }
      } catch (error) {
        console.error('Error fetching branding:', error)
      }
    }

    fetchBranding()
  }, []) 

  // 2. Fetch Invite Details
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

  // --- EMAIL LOGIN ---
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
        const { data: { user }, error } = await supabase.auth.signInWithPassword({
          email,
          password
        })

        if (error) throw error
        if (!user) throw new Error("Login failed")

        // Handle Invite Acceptance on Login
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
      setMessage({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  // --- FORGOT PASSWORD ---
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    try {
      // Create the callback URL explicitly
      const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo
      })

      if (error) throw error

      setMessage({ 
        type: 'success', 
        text: 'Password reset link sent! Check your email.' 
      })
      
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  // --- DEMO AGENT LOGIN ---
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

  // --- DEMO ADMIN LOGIN ---
  const handleDemoAdminLogin = async () => {
    setLoading(true)
    try {
      const { data: { user }, error } = await supabase.auth.signInWithPassword({
        email: 'demo-admin@adrolls.in', 
        password: 'demo@123'
      })
      
      if (error) throw error
      if (!user) throw new Error("No user returned")

      router.push('/dashboard')

    } catch (error: any) {
      alert("Demo Admin Login Failed: " + error.message)
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
               {/* Logo Logic */}
               {inviteInfo?.logo_url ? (
                 <img src={inviteInfo.logo_url} className="w-full h-full object-contain" alt="Org Logo"/>
               ) : branding.logo ? (
                 <img src={branding.logo} className="w-full h-full object-contain" alt={branding.name}/>
               ) : (
                 inviteOrg ? <User size={32} className="text-blue-600"/> : <Building2 size={32} className="text-slate-900"/>
               )}
            </div>
            
            <h1 className="text-2xl font-black text-white tracking-tight">
              {inviteInfo ? inviteInfo.name : branding.name}
            </h1>
            <p className="text-slate-400 text-sm mt-1 font-medium">
              {view === 'forgot_password' 
                ? 'Reset your password'
                : (inviteInfo ? 'Invited you to join their team' : branding.subtitle)
              }
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-8 space-y-6">
           
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

           {inviteOrg && !message && view === 'login' && (
             <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3 items-start">
                <CheckCircle2 size={20} className="text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-blue-900">Accept Invitation</h3>
                  <p className="text-xs text-blue-700 leading-relaxed mt-1">
                    Sign in to join <b>{inviteInfo?.name || 'the organization'}</b> as an Agent.
                  </p>
                </div>
             </div>
           )}

           {view === 'login' ? (
             // --- LOGIN VIEW ---
             <>
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
                    <div className="flex justify-between items-center mb-1 ml-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">Password</label>
                      <button 
                        type="button"
                        onClick={() => {
                          setView('forgot_password')
                          setMessage(null)
                        }}
                        className="text-xs font-bold text-slate-900 hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
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
                        Sign In
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
               </form>

               <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400">Or continue with</span></div>
               </div>

               <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={handleDemoLogin} 
                    disabled={loading}
                    className="flex items-center justify-center gap-2 bg-indigo-50 border border-indigo-100 p-4 rounded-xl text-indigo-700 font-bold text-[10px] hover:bg-indigo-100 transition-all active:scale-[0.98]"
                  >
                     <TestTube2 size={16} className="text-indigo-600" />
                     Demo Agent
                  </button>

                  <button 
                    onClick={handleDemoAdminLogin} 
                    disabled={loading}
                    className="flex items-center justify-center gap-2 bg-purple-50 border border-purple-100 p-4 rounded-xl text-purple-700 font-bold text-[10px] hover:bg-purple-100 transition-all active:scale-[0.98]"
                  >
                     <ShieldCheck size={16} className="text-purple-600" />
                     Demo Admin
                  </button>
               </div>
             </>
           ) : (
             // --- FORGOT PASSWORD VIEW ---
             <>
                <div className="text-sm text-slate-600 mb-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  Enter the email address associated with your account and we'll send you a link to reset your password.
                </div>

                <form onSubmit={handleForgotPassword} className="space-y-4">
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

                 <button 
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white p-4 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all active:scale-[0.98]"
                  >
                    {loading ? <Loader2 size={18} className="animate-spin"/> : (
                      <>
                        Send Reset Link
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>

                  <button 
                    type="button"
                    disabled={loading}
                    onClick={() => {
                        setView('login')
                        setMessage(null)
                    }}
                    className="w-full flex items-center justify-center gap-2 text-slate-500 font-bold text-xs hover:text-slate-800 transition-all"
                  >
                     <ArrowLeft size={14} />
                     Back to Login
                  </button>
               </form>
             </>
           )}

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