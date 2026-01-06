'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, ArrowRight, CheckCircle2, AlertCircle, LayoutGrid, Building2 } from 'lucide-react'

function UpdatePasswordForm() {
  const supabase = createClient()
  const router = useRouter()
  
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: "Passwords do not match" })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      })

      if (error) throw error

      setMessage({ type: 'success', text: "Password updated successfully!" })
      
      // Redirect to dashboard after short delay
      setTimeout(() => {
        router.push('/dashboard')
      }, 2000)

    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    } finally {
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
            <div className="w-16 h-16 bg-white rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg p-2">
               <Building2 size={28} className="text-slate-900"/>
            </div>
            
            <h1 className="text-2xl font-black text-white tracking-tight">
              Update Password
            </h1>
            <p className="text-slate-400 text-sm mt-1 font-medium">
              Enter your new secure password below
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-8 space-y-6">
           
           {message && (
             <div className={`p-3 rounded-xl flex gap-2 items-center text-xs font-bold ${
               message.type === 'success' 
                 ? 'bg-green-50 border border-green-100 text-green-700' 
                 : 'bg-red-50 border border-red-100 text-red-600'
             }`}>
               {message.type === 'success' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>} 
               {message.text}
             </div>
           )}

           <form onSubmit={handleUpdatePassword} className="space-y-4">
             <div>
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">New Password</label>
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
             
             <div>
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Confirm Password</label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input 
                    type="password" 
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
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
                    Update Password
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
           </form>
        </div>
      </div>
    </div>
  )
}

export default function UpdatePasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400 w-8 h-8" />
      </div>
    }>
      <UpdatePasswordForm />
    </Suspense>
  )
}