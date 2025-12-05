'use client'

import { authClient } from '@/lib/auth-client'
import { Sparkles, Loader2, Facebook, Linkedin } from 'lucide-react' 
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  const handleLogin = async (provider: 'google' | 'facebook' | 'linkedin') => {
    setLoading(provider)
    await authClient.signIn.social({
      provider: provider,
      callbackURL: "/dashboard",
    }, {
      onSuccess: () => {
        router.push('/dashboard')
      },
      onError: (ctx) => {
        alert("Login failed: " + ctx.error.message)
        setLoading(null)
      }
    })
  }

  return (
    <main className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-lg border border-blue-50 flex flex-col items-center text-center">
        
        <div className="bg-primary h-20 w-20 rounded-3xl flex items-center justify-center mb-6 text-primary-text">
          <Sparkles size={40} />
        </div>

        <h1 className="text-3xl font-bold text-slate-800 mb-3 tracking-tight">
          Welcome
        </h1>
        <p className="text-slate-500 mb-8 text-lg leading-relaxed">
          Automate your marketing with just a few clicks.
        </p>

        <div className="w-full space-y-3">
            {/* Google */}
            <button
              onClick={() => handleLogin('google')}
              disabled={!!loading}
              className="w-full bg-white border border-slate-200 hover:bg-slate-50 transition-colors py-4 rounded-2xl flex items-center justify-center gap-3 text-slate-700 font-bold text-base shadow-sm active:scale-95 duration-200 disabled:opacity-70"
            >
              {loading === 'google' ? <Loader2 className="animate-spin" size={20}/> : (
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              )}
              Continue with Google
            </button>

            {/* Facebook */}
            <button
              onClick={() => handleLogin('facebook')}
              disabled={!!loading}
              className="w-full bg-[#1877F2] hover:bg-[#166fe5] transition-colors py-4 rounded-2xl flex items-center justify-center gap-3 text-white font-bold text-base shadow-sm active:scale-95 duration-200 disabled:opacity-70"
            >
              {loading === 'facebook' ? <Loader2 className="animate-spin" size={20}/> : <Facebook size={20} fill="white" />}
              Continue with Facebook
            </button>

            {/* LinkedIn */}
            <button
              onClick={() => handleLogin('linkedin')}
              disabled={!!loading}
              className="w-full bg-[#0077b5] hover:bg-[#006097] transition-colors py-4 rounded-2xl flex items-center justify-center gap-3 text-white font-bold text-base shadow-sm active:scale-95 duration-200 disabled:opacity-70"
            >
              {loading === 'linkedin' ? <Loader2 className="animate-spin" size={20}/> : <Linkedin size={20} fill="white" />}
              Continue with LinkedIn
            </button>
        </div>

        <p className="mt-8 text-xs text-slate-400 font-medium uppercase tracking-wider">
          Secure & Private
        </p>
      </div>
    </main>
  )
}