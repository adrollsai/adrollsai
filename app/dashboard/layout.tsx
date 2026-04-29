// app/dashboard/layout.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import BottomNav from '@/components/BottomNav'
import PushManager from '@/components/PushManager'
import FloatingAgent from '@/components/FloatingAgent' // <--- IMPORT THE AGENT HERE
import { Loader2 } from 'lucide-react'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [isAuthorized, setIsAuthorized] = useState(false)

  useEffect(() => {
    const enforcePaywall = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/login')
        return
      }

      // Check user's subscription status
      const { data } = await supabase
        .from('profiles')
        .select('subscription_status, role')
        .eq('id', session.user.id)
        .single()

      const isPaid = data?.subscription_status === 'active'
      const isBillingPage = pathname === '/dashboard/billing'

      // If they haven't paid, and they aren't already on the billing page, trap them!
      if (!isPaid && !isBillingPage && data?.role === 'admin') {
        router.push('/dashboard/billing')
      } else {
        setIsAuthorized(true)
      }
    }

    enforcePaywall()
  }, [pathname, router])

  if (!isAuthorized) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-[#003D6F]" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* PushManager initialized here so it only triggers for logged-in users */}
      <PushManager />
      
      {children}
      
      {/* Show Bottom Nav and Floating Agent ONLY if not trapped on the billing page */}
      {pathname !== '/dashboard/billing' && (
        <>
          <FloatingAgent />
          <BottomNav />
        </>
      )}
    </div>
  )
}