'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import BottomNav from '@/components/BottomNav'
import PushManager from '@/components/PushManager'
import { Loader2, XCircle } from 'lucide-react'
import QuotaManager from '@/components/QuotaManager'
import { UploadProvider } from '@/utils/UploadContext'

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
        <>
            <div className="fixed top-0 left-0 right-0 z-[100] bg-slate-900 text-white px-4 py-2 flex items-center justify-center gap-4 shadow-xl animate-in slide-in-from-top duration-300">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Viewing Client Account</span>
                <button 
                    onClick={handleExit}
                    className="bg-white text-slate-900 px-3 py-1 rounded-full text-[10px] font-black hover:bg-slate-200 transition-colors flex items-center gap-1.5"
                >
                    <XCircle size={14} /> Exit
                </button>
            </div>
            <div className="h-[38px] flex-shrink-0" />
        </>
    )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(true)

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
        .select('subscription_status, role, parent_id, agency_id, onboarding_completed, accepted_terms')
        .eq('id', session.user.id)
        .single()

      // Resolve Primary User for subscription check
      let subscriptionStatus = userProfile?.subscription_status?.toLowerCase() || ''
      let onboardingCompleted = userProfile?.onboarding_completed
      const parentId = userProfile?.parent_id || userProfile?.agency_id
      if (parentId) {
          const { data: parentProfile } = await supabase
            .from('profiles')
            .select('subscription_status, onboarding_completed')
            .eq('id', parentId)
            .single()
          subscriptionStatus = parentProfile?.subscription_status?.toLowerCase() || ''
          onboardingCompleted = parentProfile?.onboarding_completed
      }

      const isPaid = subscriptionStatus === 'active' || subscriptionStatus === 'trialing' || subscriptionStatus === 'pro'
      const isBillingPage = pathname === '/dashboard/billing'
      const isOnboardingPage = pathname === '/dashboard/onboarding'
      const isAdminLike = ['super_admin', 'agency', 'admin', 'client', 'agent'].includes(userProfile?.role || '')

      // If they haven't paid, and they aren't already on the billing page, trap them!
      if (!isPaid && !isBillingPage && isAdminLike) {
        router.push('/dashboard/billing')
        return
      }

      // Check if they are an existing client who already has properties or assets
      if (isPaid && !onboardingCompleted && !isBillingPage && isAdminLike) {
        const primaryUserId = parentId || session.user.id
        
        // Count products/properties
        const { count: propCount } = await supabase
          .from('properties')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', primaryUserId)
          
        // Count assets
        const { count: assetCount } = await supabase
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', primaryUserId)

        if ((propCount && propCount > 0) || (assetCount && assetCount > 0)) {
          onboardingCompleted = true
          
          await supabase
            .from('profiles')
            .update({ onboarding_completed: true })
            .eq('id', session.user.id)
            
          if (parentId) {
            await supabase
              .from('profiles')
              .update({ onboarding_completed: true })
              .eq('id', parentId)
          }
        }
      }

      if (isPaid && !onboardingCompleted && !isOnboardingPage && !isBillingPage && isAdminLike) {
        router.push('/dashboard/onboarding')
      } else {
        // AUTO-FIX: If they are 'agent'/'client' but have no parent_id/agency_id, they are a self-registered business owner -> Admin/Agency
        if ((userProfile?.role === 'agent' || userProfile?.role === 'client') && !userProfile?.parent_id && !userProfile?.agency_id) {
          console.log("🛠️ Auto-upgrading self-registered user to admin...");
          await supabase
            .from('profiles')
            .update({ role: 'admin' })
            .eq('id', session.user.id);
        }

        // If user logs in but has no role assigned, default to admin to bypass onboarding deadlock
        if (userProfile && !userProfile.role) {
          const { data: allUsers } = await supabase.from('profiles').select('id');
          if (allUsers && allUsers.length === 1) {
            await supabase
              .from('profiles')
              .update({ role: 'admin' })
              .eq('id', session.user.id);
          }
        }
        setAcceptedTerms(userProfile?.accepted_terms !== false)
        setIsAuthorized(true)
      }
    }

    enforcePaywall()
  }, [pathname, router, supabase])

  if (!isAuthorized) {
    return <div className="flex h-screen items-center justify-center bg-[#F8FAFC]"><Loader2 className="animate-spin text-blue-600" size={32} /></div>
  }

  return (
    <UploadProvider>
      <div className="min-h-screen bg-[#F8FAFC] overflow-x-hidden">
        <Suspense fallback={null}>
          <ImpersonationBanner />
        </Suspense>
        
        {/* PushManager deployed as a banner. It auto-hides if enabled or dismissed */}
        <PushManager variant="banner" />

        {/* Global Plan and Add-on limit checks */}
        <QuotaManager />

        {!acceptedTerms && pathname !== '/dashboard/profile' && (
          <div className="bg-red-50 border-b border-red-100 px-4 py-3 text-center flex flex-col sm:flex-row items-center justify-center gap-3 shadow-sm animate-in slide-in-from-top duration-300">
            <span className="text-xs font-bold text-red-700 flex items-center gap-1.5 justify-center">
              ⚠️ Action Required: Kindly accept the updated Terms & Conditions and Privacy Policy to keep your account active and in compliance.
            </span>
            <button 
              onClick={() => router.push('/dashboard/profile')}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-full text-[10px] font-black tracking-wide transition-all active:scale-95 shadow-sm cursor-pointer whitespace-nowrap"
            >
              Review & Accept
            </button>
          </div>
        )}

        {children}

        {/* Hide the navigation bar if they are on the billing page, onboarding page or the video editor page */}
        {pathname !== '/dashboard/billing' && pathname !== '/dashboard/onboarding' && !pathname?.includes('/dashboard/video-editor') && <BottomNav />}
      </div>
    </UploadProvider>
  )
}