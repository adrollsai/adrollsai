'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import BottomNav from '@/components/BottomNav'
import PushManager from '@/components/PushManager'
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

      const currentStatus = data?.subscription_status?.toLowerCase() || ''
      const isPaid = currentStatus === 'active' || currentStatus === 'trialing' || currentStatus === 'pro'
      const isBillingPage = pathname === '/dashboard/billing'

      // If they haven't paid, and they aren't already on the billing page, trap them!
      if (!isPaid && !isBillingPage && data?.role === 'admin') {
        router.push('/dashboard/billing')
      } else {
        setIsAuthorized(true)
      }
    }

    enforcePaywall()
  }, [pathname, router, supabase])

  if (!isAuthorized) {
    return <div className="flex h-screen items-center justify-center bg-[#F8FAFC]"><Loader2 className="animate-spin text-blue-600" size={32} /></div>
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* PushManager deployed as a banner. It auto-hides if enabled or dismissed */}
      <PushManager variant="banner" />
      
      {children}
      
      {/* Hide the navigation bar if they are trapped on the billing page */}
      {pathname !== '/dashboard/billing' && <BottomNav />}
    </div>
  )
}