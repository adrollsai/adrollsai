'use client'

import { createClient } from '@/utils/supabase/client'
import { Sparkles, User, Loader2 } from 'lucide-react' 
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// --- 1. ROBUST URL HELPER ---
const getURL = () => {
  let url =
    process.env.NEXT_PUBLIC_SITE_URL ?? 
    process.env.NEXT_PUBLIC_VERCEL_URL ?? 
    'http://localhost:3000/'
  
  url = url.startsWith('http') ? url : `https://${url}`
  url = url.endsWith('/') ? url : `${url}/`
  return url
}

export default function LoginPage() {
  const supabase = createClient()
  const router = useRouter()
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  // Check if already logged in
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.push('/dashboard')
      }
    }
    checkUser()
  }, [router, supabase])

  const handleGoogleLogin = async () => {
    const redirectUrl = `${getURL()}auth/callback`
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl },
    })
  }

  // --- NEW: Handle Agent Demo Login ---
  const handleAgentDemo = async () => {
    setIsLoggingIn(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: 'agent@demo.com',
        password: 'password123'
      })
      if (error) throw error
      router.push('/dashboard')
    } catch (error: any) {
      alert("Demo Login Failed: " + error.message)
      setIsLoggingIn(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      
      {/* Bubbly Card Container */}
      <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-xl border border-blue-50 flex flex-col items-center text-center">
        
        {/* Icon/Logo Area */}
        <div className="bg-slate-900 h-20 w-20 rounded-3xl flex items-center justify-center mb-6 text-white shadow-lg shadow-slate-200">
          <Sparkles size={40} />
        </div>

        {/* Text Hierarchy */}
        <h1 className="text-3xl font-black text-slate-800 mb-3 tracking-tight">
          AdRolls AI
        </h1>
        <p className="text-slate-500 mb-10 text-lg leading-relaxed font-medium">
          Automate your real estate marketing with just a few clicks.
        </p>

        {/* Google Button */}
        <button
          onClick={handleGoogleLogin}
          className="w-full bg-white hover:bg-slate-50 border border-slate-200 transition-all py-4 rounded-2xl flex items-center justify-center gap-3 text-slate-700 font-bold text-base shadow-sm active:scale-95 duration-200 mb-4"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        {/* Demo Agent Button */}
        <button
          onClick={handleAgentDemo}
          disabled={isLoggingIn}
          className="w-full bg-slate-900 hover:bg-slate-800 transition-colors py-4 rounded-2xl flex items-center justify-center gap-3 text-white font-bold text-base shadow-lg shadow-slate-200 active:scale-95 duration-200"
        >
          {isLoggingIn ? <Loader2 className="animate-spin" size={20}/> : <User size={20} />}
          {isLoggingIn ? 'Signing in...' : 'Agent Demo Login'}
        </button>

        <p className="mt-8 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          v2.0.0 Enterprise Build
        </p>
      </div>
    </main>
  )
}