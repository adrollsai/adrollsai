'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Loader2 } from 'lucide-react'
import WhatsAppSettings from '@/components/WhatsAppSettings'

function WhatsAppAutomationPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState<string | null>(null)

  useEffect(() => {
    async function loadAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/')
        return
      }
      setUserId(user.id)
      setTargetUserId(impersonateId || user.id)
      setLoading(false)
    }
    loadAuth()
  }, [impersonateId, router, supabase])

  if (loading || !targetUserId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-slate-300" size={32} />
        <p className="text-sm font-medium animate-pulse">Loading WhatsApp Automation...</p>
      </div>
    )
  }

  const handleBack = () => {
    router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-8 ml-1">
          WhatsApp Automation
        </h1>
        <WhatsAppSettings 
          userId={targetUserId} 
          onBack={handleBack} 
        />
      </div>
    </div>
  )
}

export default function WhatsAppAutomationPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-slate-300" size={32} />
      </div>
    }>
      <WhatsAppAutomationPageContent />
    </Suspense>
  )
}
