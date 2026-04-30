'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Lock, Loader2, Sparkles, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

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
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">AdRolls AI</h1>
            <p className="text-slate-500 font-medium mt-2">Securely set your new password</p>
        </div>

        {/* Main Card */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/40 border border-slate-100">
            {isSuccess ? (
                <div className="flex flex-col items-center justify-center text-center py-6">
                   <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                       <CheckCircle2 className="text-green-500" size={32} />
                   </div>
                   <h3 className="text-lg font-bold text-slate-800 mb-2">Password Updated!</h3>
                   <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">Your password has been changed successfully. You can now access your dashboard.</p>
                   <button 
                      onClick={() => router.push('/dashboard')}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold shadow-md transition-all"
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
                                type="password" 
                                required
                                minLength={6}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 pl-12 pr-4 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none border border-slate-200/60 transition-all" 
                                placeholder="Enter a strong password" 
                            />
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        disabled={loading || !newPassword}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 mt-2"
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