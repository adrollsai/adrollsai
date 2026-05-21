'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import BottomNav from '@/components/BottomNav'
import PushManager from '@/components/PushManager'
import { Loader2, XCircle } from 'lucide-react'

function ImpersonationBanner() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const pathname = usePathname()
    const impersonateId = searchParams.get('impersonate')

    if (!impersonateId) return null

    const handleExit = () => {
        router.push(pathname) // Push the same path without query params
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-slate-900 text-white px-4 py-2 flex items-center justify-center gap-4 shadow-xl animate-in slide-in-from-top duration-300">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Viewing Client Account</span>
            <button 
                onClick={handleExit}
                className="bg-white text-slate-900 px-3 py-1 rounded-full text-[10px] font-black hover:bg-slate-200 transition-colors flex items-center gap-1.5"
            >
                <XCircle size={14} /> Exit
            </button>
        </div>
    )
}

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

      // Check user's profile
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('subscription_status, role, parent_id, agency_id')
        .eq('id', session.user.id)
        .single()

      // Resolve Primary User for subscription check
      let subscriptionStatus = userProfile?.subscription_status?.toLowerCase() || ''
      const parentId = userProfile?.parent_id || userProfile?.agency_id
      if (parentId) {
          const { data: parentProfile } = await supabase
            .from('profiles')
            .select('subscription_status')
            .eq('id', parentId)
            .single()
          subscriptionStatus = parentProfile?.subscription_status?.toLowerCase() || ''
      }

      const isPaid = subscriptionStatus === 'active' || subscriptionStatus === 'trialing' || subscriptionStatus === 'pro'
      const isBillingPage = pathname === '/dashboard/billing'
      const isAdminLike = ['super_admin', 'agency', 'admin', 'client', 'agent'].includes(userProfile?.role || '')

      // If they haven't paid, and they aren't already on the billing page, trap them!
      // This applies to primary accounts
      if (!isPaid && !isBillingPage && isAdminLike) {
        router.push('/dashboard/billing')
      } else {
        // AUTO-FIX: If they are 'agent'/'client' but have no parent_id/agency_id, they are a self-registered business owner -> Admin/Agency
        if ((userProfile?.role === 'agent' || userProfile?.role === 'client') && !userProfile?.parent_id && !userProfile?.agency_id) {
          console.log("🛠️ Auto-upgrading self-registered user to admin...");
          await supabase
            .from('profiles')
            .update({ role: 'admin' })
            .eq('id', session.user.id);
        }
        setIsAuthorized(true)
      }
    }

    enforcePaywall()
  }, [pathname, router, supabase])

  if (!isAuthorized) {
    return <div className="flex h-screen items-center justify-center bg-[#F8FAFC]"><Loader2 className="animate-spin text-blue-600" size={32} /></div>
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] overflow-x-hidden">
      <Suspense fallback={null}>
        <ImpersonationBanner />
      </Suspense>

      {/* PushManager deployed as a banner. It auto-hides if enabled or dismissed */}
      <PushManager variant="banner" />

      {children}

      {/* Hide the navigation bar if they are trapped on the billing page */}
      {pathname !== '/dashboard/billing' && <BottomNav />}
    </div>
  )
}