'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, CheckCircle2, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import Image from 'next/image'

type AuthMode = 'login' | 'signup' | 'forgot_password'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  
  const [mode, setModeState] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    if (searchParams.get('disabled') === 'true') {
      setError('Your account has been disabled by your administrator. Please contact your admin for access.')
    }
  }, [searchParams])

  const switchMode = (newMode: AuthMode) => {
    setModeState(newMode)
    setError(null)
    setSuccessMessage('')
    setAgreed(false)
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setSuccessMessage('')
    setError(null)

    try {
      if (mode === 'signup') {
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters long.')
        }

        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard/analytics`,
            data: {
              accepted_terms: true,
            }
          },
        })
        if (error) throw error
        
        if (signUpData?.user?.identities?.length === 0) {
          throw new Error('An account with this email address already exists. Please sign in instead.')
        }
        
        if (signUpData?.user) {
          try {
            await supabase
              .from('profiles')
              .upsert({ id: signUpData.user.id, accepted_terms: true }, { onConflict: 'id' })
          } catch (pErr) {
            console.warn('Profile terms update non-fatal error:', pErr)
          }
        }
        
        if (signUpData?.session) {
          toast.success("Account created successfully!")
          router.push('/dashboard/analytics')
        } else {
          setSuccessMessage('Account created! Please check your email to verify your account.')
          toast.success("Verification email sent!")
        }
        
      } else if (mode === 'login') {
        const { data: authData, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) {
          const errMsg = error.message.toLowerCase()
          if (errMsg.includes('banned') || errMsg.includes('disabled')) {
            throw new Error('Your account has been disabled by your administrator. Please contact your admin for access.')
          }
          throw error
        }

        if (authData?.user) {
          const isMetaDisabled = authData.user.user_metadata?.is_disabled === true
          const { data: prof } = await supabase.from('profiles').select('is_disabled').eq('id', authData.user.id).single()
          if (isMetaDisabled || prof?.is_disabled) {
            await supabase.auth.signOut()
            throw new Error('Your account has been disabled by your administrator. Please contact your admin for access.')
          }
        }

        toast.success("Welcome back!")
        router.push('/dashboard/analytics')
        
      } else if (mode === 'forgot_password') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
        })
        if (error) throw error
        setSuccessMessage('Password reset instructions have been sent to your email.')
        toast.success("Reset link sent!")
      }
    } catch (error: any) {
      const msg = error.message || 'An error occurred during authentication.'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleAuth = async () => {
    setLoading(true)
    setError(null)
    setSuccessMessage('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard/analytics`,
        }
      })
      if (error) throw error
    } catch (error: any) {
      setLoading(false)
      toast.error(error.message || 'Failed to authenticate with Google.')
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4">
      
      <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-blue-50 to-[#F8FAFC] -z-10" />
      
      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-8 duration-500">
        
        <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-5 relative drop-shadow-xl hover:scale-105 transition-transform duration-300">
                <Image 
                    src="/icon-512x512.png" 
                    alt="Nobogent AI Logo" 
                    width={80}
                    height={80}
                    priority
                    className="w-full h-full object-contain rounded-2xl" 
                />
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Nobogent AI</h1>
            <p className="text-slate-500 font-medium mt-2">
              {mode === 'login' && 'Welcome back to your workspace'}
              {mode === 'signup' && 'Create your account to get started'}
              {mode === 'forgot_password' && 'Reset your password securely'}
            </p>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/40 border border-slate-100">
            
            {successMessage ? (
               <div className="flex flex-col items-center justify-center text-center py-6">
                   <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                       <CheckCircle2 className="text-green-500" size={32} />
                   </div>
                   <h3 className="text-lg font-bold text-slate-800 mb-2">Check your email</h3>
                   <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">{successMessage}</p>
                   <button 
                      type="button"
                      onClick={() => { switchMode('login'); setPassword(''); }}
                      className="text-sm font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-6 py-3 rounded-full transition-colors"
                   >
                       Back to Login
                   </button>
               </div>
            ) : (
                <form onSubmit={handleEmailAuth} className="space-y-5">
                    
                    {error && (
                        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-300">
                            {error === 'Invalid login credentials' ? 'Invalid email or password. Please try again.' : error}
                        </div>
                    )}
                    
                    <div>
                        <label htmlFor="auth-email" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 mb-2 block">Email Address</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input 
                                id="auth-email"
                                name="email"
                                type="email" 
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 pl-12 pr-4 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none border border-slate-200/60 transition-all" 
                                placeholder="name@company.com" 
                            />
                        </div>
                    </div>

                    {mode !== 'forgot_password' && (
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label htmlFor="auth-password" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 block">Password</label>
                                {mode === 'login' && (
                                    <button 
                                        type="button"
                                        onClick={() => switchMode('forgot_password')} 
                                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 transition-colors"
                                    >
                                        Forgot?
                                    </button>
                                )}
                            </div>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                <input 
                                    id="auth-password"
                                    name="password"
                                    type={showPassword ? "text" : "password"} 
                                    autoComplete={mode === 'signup' ? "new-password" : "current-password"}
                                    minLength={mode === 'signup' ? 6 : undefined}
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 pl-12 pr-12 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none border border-slate-200/60 transition-all" 
                                    placeholder="••••••••" 
                                />
                                <button
                                  type="button" 
                                  onClick={() => setShowPassword(!showPassword)}
                                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 active:scale-90 transition-all p-1"
                                  aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {mode === 'signup' && (
                        <label className="flex items-start gap-3 mt-4 text-xs text-slate-500 cursor-pointer select-none animate-in fade-in slide-in-from-top-2 duration-300">
                            <input 
                                type="checkbox" 
                                required
                                checked={agreed}
                                onChange={(e) => setAgreed(e.target.checked)}
                                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                            />
                            <span className="font-semibold leading-relaxed text-slate-600">
                                I agree to the{' '}
                                <a 
                                  href="/terms-and-conditions" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()} 
                                  className="text-blue-600 font-bold hover:underline"
                                >
                                  Terms & Conditions
                                </a>{' '}
                                and{' '}
                                <a 
                                  href="/privacy-policy" 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()} 
                                  className="text-blue-600 font-bold hover:underline"
                                >
                                  Privacy Policy
                                </a>.
                            </span>
                        </label>
                    )}

                    <button 
                        type="submit" 
                        disabled={loading || !email || (mode !== 'forgot_password' && !password) || (mode === 'signup' && !agreed)}
                        className="w-full bg-slate-950 hover:bg-slate-900 text-white py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 mt-2"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : null}
                        {!loading && mode === 'login' && 'Sign In'}
                        {!loading && mode === 'signup' && 'Create Account'}
                        {!loading && mode === 'forgot_password' && 'Send Reset Link'}
                        {!loading && <ArrowRight size={16} />}
                    </button>

                    {mode !== 'forgot_password' && (
                        <>
                            <div className="relative py-2 flex items-center">
                                <div className="flex-grow border-t border-slate-200/60"></div>
                                <span className="flex-shrink-0 mx-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">or</span>
                                <div className="flex-grow border-t border-slate-200/60"></div>
                            </div>
                            
                            <button 
                                type="button"
                                disabled={loading}
                                onClick={handleGoogleAuth} 
                                className="w-full bg-white hover:bg-slate-50 text-slate-700 py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-3 border border-slate-200/60 shadow-sm active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                </svg>
                                Continue with Google
                            </button>
                        </>
                    )}
                </form>
            )}

            {!successMessage && (
                <div className="mt-8 text-center border-t border-slate-100 pt-6">
                    {mode === 'login' ? (
                        <p className="text-sm text-slate-500 font-medium">
                            Don't have an account?{' '}
                            <button type="button" onClick={() => switchMode('signup')} className="text-blue-600 font-bold hover:underline">Sign up</button>
                        </p>
                    ) : (
                        <button 
                            type="button"
                            onClick={() => switchMode('login')} 
                            className="text-sm text-slate-500 font-bold hover:text-slate-800 flex items-center justify-center gap-1 mx-auto transition-colors"
                        >
                            <ChevronLeft size={16} /> Back to Sign In
                        </button>
                    )}
                </div>
            )}
            
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}