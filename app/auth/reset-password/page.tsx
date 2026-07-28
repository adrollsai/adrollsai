'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Lock, Loader2, Sparkles, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [checkingLink, setCheckingLink] = useState(true)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const initResetFlow = async () => {
      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get('code')
      const error = urlParams.get('error_description') || urlParams.get('error')

      if (error) {
        if (mounted) {
          setLinkError(decodeURIComponent(error))
          setCheckingLink(false)
        }
        return
      }

      // 1. Check existing session (set via /auth/callback route or cookies)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        if (mounted) {
          setCheckingLink(false)
        }
        return
      }

      // 2. If code parameter is present in URL, exchange for session directly
      if (code) {
        try {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
          if (data?.session && mounted) {
            setCheckingLink(false)
            return
          }
        } catch (err: any) {
          console.error('Error exchanging code:', err)
          if (mounted) {
            setLinkError('The reset link is invalid or has expired. Please request a new password reset link.')
            setCheckingLink(false)
          }
          return
        }
      }

      // 3. Listen for Auth State Changes (e.g. hash fragments or PASSWORD_RECOVERY events)
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return
        if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || session) {
          setCheckingLink(false)
          setLinkError(null)
        }
      })

      // 4. Bounded timeout fallback
      const timeout = setTimeout(() => {
        if (mounted && checkingLink) {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (!mounted) return
            if (s) {
              setCheckingLink(false)
            } else {
              setLinkError('No active session or valid reset code found. Please request a new link.')
              setCheckingLink(false)
            }
          })
        }
      }, 2500)

      return () => {
        subscription.unsubscribe()
        clearTimeout(timeout)
      }
    }

    initResetFlow()

    return () => {
      mounted = false
    }
  }, [supabase])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error

      setIsSuccess(true)
      toast.success("Password updated successfully!")
      
    } catch (error: any) {
      toast.error(error.message || 'Failed to update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-8 duration-500">
        
        {/* Branding */}
        <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-[1.25rem] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-600/20 rotate-3">
                <Sparkles className="text-white" size={32} />
            </div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Nobogent</h1>
            <p className="text-slate-500 font-medium mt-2">Securely set your new password</p>
        </div>

        {/* Main Card */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/40 border border-slate-100">
            {checkingLink ? (
                <div className="flex flex-col items-center justify-center text-center py-12 space-y-4">
                    <Loader2 size={32} className="animate-spin text-blue-600" />
                    <p className="text-sm text-slate-500 font-semibold">Verifying your secure reset link...</p>
                </div>
            ) : linkError ? (
                <div className="flex flex-col items-center justify-center text-center py-6">
                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
                        <AlertCircle className="text-red-500" size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Invalid Reset Link</h3>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">{linkError}</p>
                    <button 
                       onClick={() => router.push('/login')}
                       className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold shadow-md transition-all cursor-pointer"
                    >
                        Go to Login Page
                    </button>
                </div>
            ) : isSuccess ? (
                <div className="flex flex-col items-center justify-center text-center py-6">
                   <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                       <CheckCircle2 className="text-green-500" size={32} />
                   </div>
                   <h3 className="text-lg font-bold text-slate-800 mb-2">Password Updated!</h3>
                   <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">Your password has been changed successfully. You can now access your dashboard.</p>
                   <button 
                       onClick={() => router.push('/dashboard')}
                       className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold shadow-md transition-all cursor-pointer"
                   >
                       Go to Dashboard
                   </button>
                </div>
            ) : (
                <form onSubmit={handleResetPassword} className="space-y-5">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2 mb-2 block">New Password</label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input 
                                type={showPassword ? "text" : "password"} 
                                required
                                minLength={6}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 pl-12 pr-12 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none border border-slate-200/60 transition-all" 
                                placeholder="Enter a strong password" 
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

                    <button 
                        type="submit" 
                        disabled={loading || !newPassword}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 mt-2 cursor-pointer"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : null}
                        Update Password
                    </button>
                </form>
            )}
        </div>
      </div>
    </div>
  )
}