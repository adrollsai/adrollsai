'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import BottomNav from '@/components/BottomNav'
import PushManager from '@/components/PushManager'
import { Loader2, XCircle } from 'lucide-react'
import QuotaManager from '@/components/QuotaManager'
import { UploadProvider } from '@/utils/UploadContext'
import { planValidityNotice, type PlanNotice } from '@/lib/automation/plan-validity'

function ImpersonationBanner() {
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const impersonateId = searchParams.get('impersonate')

    if (!impersonateId) return null

    const handleExit = () => {
        window.location.href = pathname // Full reload without query params to clean up state
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
  const supabase = useState(() => createClient())[0]
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(true)
  const [subscriptionExpiredAlert, setSubscriptionExpiredAlert] = useState(false)
  const [dismissExpiredAlert, setDismissExpiredAlert] = useState(false)
  // Pre-expiry warning. The expired banner above only appears once the plan has ALREADY ended, so an
  // owner used to discover the problem when a campaign stopped. This one gives them the days before.
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(null)
  const [dismissPlanNotice, setDismissPlanNotice] = useState(false)

  useEffect(() => {
    const enforcePaywall = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) {
          router.push('/login')
          return
        }

        // Read the profile, RETRYING briefly. On a brand-new signup the row may not exist for a moment
        // (the signup trigger is still committing), and the old code treated that as "no problem",
        // authorised the layout, rendered the whole dashboard, and only caught the missing subscription
        // on a later run — which is exactly the "it let me in, then showed the paywall a moment later"
        // behaviour the owner hit. A money gate must never be decided from data it failed to read.
        let userProfile: any = null
        for (let attempt = 0; attempt < 6; attempt++) {
          const { data } = await supabase
            .from('profiles')
            .select('subscription_status, subscription_valid_until, email, role, parent_id, agency_id, onboarding_completed, accepted_terms, client_features')
            .eq('id', session.user.id)
            .maybeSingle()
          if (data) {
            userProfile = data
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 400))
        }

        // Check if user account is disabled by admin
        const isAccountDisabled = session.user.user_metadata?.is_disabled === true
        if (isAccountDisabled) {
          await supabase.auth.signOut()
          router.push('/login?disabled=true')
          return
        }

        // Resolve Primary User for subscription check
        let subscriptionStatus = userProfile?.subscription_status?.toLowerCase() || ''
        let subscriptionValidUntil = userProfile?.subscription_valid_until
        let onboardingCompleted = userProfile?.onboarding_completed
        let parentEmail = ''
        let parentProfile: {
          email?: string | null
          subscription_status?: string | null
          subscription_valid_until?: string | null
          onboarding_completed?: boolean | null
          // `paywall_skipped` was removed from this shape on purpose: it used to be read as
          // entitlement. Leaving it declared invites the bug back, so a future use is a type error.
        } | null = null
        const parentId = userProfile?.parent_id || userProfile?.agency_id
        if (parentId) {
            const { data } = await supabase
              .from('profiles')
              .select('email, subscription_status, subscription_valid_until, onboarding_completed, client_features')
              .eq('id', parentId)
              .single()
            parentProfile = data
            parentEmail = parentProfile?.email?.toLowerCase() || ''
            subscriptionStatus = parentProfile?.subscription_status?.toLowerCase() || ''
            subscriptionValidUntil = parentProfile?.subscription_valid_until
            onboardingCompleted = parentProfile?.onboarding_completed
        }

        // Whitelisted emails that do not get trapped by subscription expiry
        const whitelistedEmails = [
          'rchopra489@gmail.com',
          'infobluesquareinfra@gmail.com',
          'khushiramrealtor@gmail.com',
          'rajivkumaraggarwal81@gmail.com',
          'gnrhomes97@gmail.com',
          'alpinenesthomes01@gmail.com',
          'meta-reviewer@nobogent.com',
          'pawan@pipixel.io'
        ]
        const userEmail = userProfile?.email?.toLowerCase() || ''
        const isWhitelisted = whitelistedEmails.includes(userEmail) || (parentEmail && whitelistedEmails.includes(parentEmail))

        // Check if validity has expired
        const isExpiredChronologically = !!(subscriptionValidUntil && new Date(subscriptionValidUntil) < new Date())
        if (isExpiredChronologically || subscriptionStatus === 'expired') {
          setSubscriptionExpiredAlert(true)
        }

        // Warn BEFORE the date arrives, from the pure decision in lib/automation/plan-validity so the
        // boundaries (ends today, 3 days, 7 days) are tested rather than discovered by a customer.
        setPlanNotice(
          planValidityNotice({
            status: subscriptionStatus,
            validUntil: subscriptionValidUntil,
            now: new Date(),
          })
        )

        // Dynamic chronological check (non-whitelisted users get set to expired)
        if (isExpiredChronologically && !isWhitelisted) {
            subscriptionStatus = 'expired'
        }

        // `client_features.paywall_skipped` used to count as "paid" here, so a new signup could walk
        // past the paywall and use the whole product for free. The onboarding page no longer writes
        // that flag, and it is deliberately not read as entitlement any more.
        const isPaid = isWhitelisted || 
                     subscriptionStatus === 'active' || 
                     subscriptionStatus === 'trialing' || 
                     subscriptionStatus === 'pro' || 
                     subscriptionStatus === 'enterprise'

      const isBillingPage = pathname === '/dashboard/billing'
      const isProfilePage = pathname === '/dashboard/profile'
      const isOnboardingPage = pathname === '/dashboard/onboarding'
      const isAdminLike = ['super_admin', 'agency', 'admin', 'client', 'agent'].includes(userProfile?.role || '')
      const isTeamMemberEarly = !!(userProfile?.parent_id || userProfile?.agency_id)
      if (!userProfile) {
        console.warn('[DashboardLayout] profile row still unreadable after retries — treating as unpaid')
      }

      // 0. PAYWALL FIRST, AND IT CANNOT BE SKIPPED.
      //
      // Deliberately ROLE-AGNOSTIC. It used to require isAdminLike, which is false whenever the role
      // has not loaded yet — so a brand-new signup sailed past the gate and only met it after the
      // profile arrived. Payment is the first thing a customer meets, and onboarding (profile,
      // integrations, templates) runs only after they have bought.
      //
      // Exemptions are narrow and explicit: the platform's own whitelisted accounts, and team members
      // whose agency pays for them. NOTE there is no role test here at all — a profile with no role set
      // yet would otherwise satisfy neither branch and slip through, which is the same fail-open shape
      // as the original bug.
      const mustPay = !isPaid && !isWhitelisted && !isTeamMemberEarly
      if (mustPay && !isOnboardingPage && !isBillingPage && !isProfilePage) {
        router.replace('/dashboard/onboarding')
        return
      }

      // 1. Onboarding Check: Ensure new users and accounts with incomplete onboarding go through onboarding first
      if (!onboardingCompleted && isAdminLike) {
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

      // If onboarding is NOT completed, direct them to onboarding page!
      if (!onboardingCompleted && !isOnboardingPage && isAdminLike) {
        router.push('/dashboard/onboarding')
        return
      }

      // Allow unpaid/expired users to view billing, profile, and onboarding pages
      if (!isPaid && !isBillingPage && !isProfilePage && !isOnboardingPage && isAdminLike) {
        router.push('/dashboard/billing')
        return
      }

      // Restrict GBP Suite & GBP Audit strictly to super_admin
      if ((pathname.startsWith('/dashboard/gbp')) && userProfile?.role !== 'super_admin' && userEmail !== 'rchopra489@gmail.com') {
        router.push('/dashboard')
        return
      }

      // Enforce client_features access controls for client accounts
      if (userProfile?.role === 'client' && Array.isArray(userProfile?.client_features)) {
        const allowed = userProfile.client_features
        if (pathname.startsWith('/dashboard/analytics') && !allowed.includes('analytics')) {
          router.push('/dashboard')
          return
        }
        if (pathname.startsWith('/dashboard/creation') && !allowed.includes('creation')) {
          router.push('/dashboard')
          return
        }
        if (pathname.startsWith('/dashboard/ads') && !allowed.includes('ads')) {
          router.push('/dashboard')
          return
        }
        if (pathname.startsWith('/dashboard/crm') && !allowed.includes('crm')) {
          router.push('/dashboard')
          return
        }
        if (pathname.startsWith('/dashboard/whatsapp') && !allowed.includes('whatsapp')) {
          router.push('/dashboard')
          return
        }
        if (pathname.startsWith('/dashboard/voice') && !allowed.includes('voice_agent')) {
          router.push('/dashboard')
          return
        }
        if (pathname.startsWith('/dashboard/flows') && !allowed.includes('flows')) {
          router.push('/dashboard')
          return
        }
        if (pathname.startsWith('/dashboard/team') && !allowed.includes('team')) {
          router.push('/dashboard')
          return
        }
      }
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
          const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
          if (count === 1) {
            await supabase
              .from('profiles')
              .update({ role: 'admin' })
              .eq('id', session.user.id);
          }
        }
        const isTeamMember = !!(userProfile?.parent_id || userProfile?.agency_id || userProfile?.role === 'team_member')
        setAcceptedTerms(isTeamMember || userProfile?.accepted_terms !== false)
        setIsAuthorized(true)
      } catch (err) {
        // FAIL CLOSED. This used to authorise the layout on any error, so a failed profile read or a
        // flaky network was enough to walk straight into the product. Now an unreadable check sends the
        // user to the paywall page, which is the one place that can always resolve it — and never into
        // the dashboard on a guess.
        console.error('[DashboardLayout enforcePaywall error]:', err)
        setAcceptedTerms(true)
        if (!pathname.startsWith('/dashboard/onboarding') && !pathname.startsWith('/dashboard/login')) {
          router.replace('/dashboard/onboarding')
        }
        // Keep the layout in its loading state: the redirect above is what moves the user on.
        return
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

        {/* Subscription Expired Alert Banner (Non-blocking for whitelisted clients) */}
        {subscriptionExpiredAlert && !dismissExpiredAlert && pathname !== '/dashboard/billing' && (
          <div className="bg-gradient-to-r from-amber-50 via-amber-100/50 to-orange-50 border-b border-amber-200 px-4 py-2.5 text-center flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 mx-auto sm:mx-0">
              <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
              <span>
                <strong>Plan Validity Expired:</strong> Your plan has ended. 72-hour grace period active to preserve your dedicated Indian Vobiz caller ID and active campaigns. Please recharge now.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 mx-auto sm:mx-0">
              <button 
                onClick={() => router.push('/dashboard/billing')}
                className="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-1 rounded-full text-[11px] font-bold tracking-wide transition-all active:scale-95 shadow-sm cursor-pointer whitespace-nowrap"
              >
                Recharge Now
              </button>
              <button
                onClick={() => setDismissExpiredAlert(true)}
                className="text-amber-700 hover:text-amber-900 px-2 py-0.5 rounded text-xs font-bold cursor-pointer transition-colors"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Pre-expiry warning (the banner above only covers a plan that has ALREADY ended) */}
        {planNotice && planNotice.level !== 'expired' && !dismissPlanNotice && pathname !== '/dashboard/billing' && (
          <div
            className={`border-b px-4 py-2.5 text-center flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs animate-in slide-in-from-top duration-300 ${
              planNotice.level === 'critical'
                ? 'bg-gradient-to-r from-rose-50 via-rose-100/60 to-orange-50 border-rose-200'
                : 'bg-gradient-to-r from-sky-50 via-sky-100/50 to-indigo-50 border-sky-200'
            }`}
          >
            <div
              className={`flex items-center gap-2 text-xs font-semibold mx-auto sm:mx-0 ${
                planNotice.level === 'critical' ? 'text-rose-900' : 'text-sky-900'
              }`}
            >
              <span
                className={`flex h-2 w-2 rounded-full animate-pulse shrink-0 ${
                  planNotice.level === 'critical' ? 'bg-rose-500' : 'bg-sky-500'
                }`}
              />
              <span>{planNotice.message}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 mx-auto sm:mx-0">
              <button
                onClick={() => router.push('/dashboard/billing')}
                className={`px-3.5 py-1 rounded-full text-[11px] font-bold tracking-wide transition-all active:scale-95 shadow-sm cursor-pointer whitespace-nowrap text-white ${
                  planNotice.level === 'critical'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-sky-600 hover:bg-sky-700'
                }`}
              >
                {planNotice.actionLabel}
              </button>
              <button
                onClick={() => setDismissPlanNotice(true)}
                className={`px-2 py-0.5 rounded text-xs font-bold cursor-pointer transition-colors ${
                  planNotice.level === 'critical'
                    ? 'text-rose-700 hover:text-rose-900'
                    : 'text-sky-700 hover:text-sky-900'
                }`}
                title="Dismiss"
                aria-label="Dismiss plan notice"
              >
                ✕
              </button>
            </div>
          </div>
        )}

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

        {/* Hide the navigation bar on billing, onboarding, video-editor, agent harness, and full-screen flow builder / automations */}
        {pathname !== '/dashboard/billing' && 
         pathname !== '/dashboard/onboarding' && 
         !pathname?.includes('/dashboard/video-editor') && 
         !pathname?.includes('/dashboard/flows') && 
         !pathname?.includes('/dashboard/automations') && 
         !pathname?.includes('/dashboard/agent') && 
         <BottomNav />}
      </div>
    </UploadProvider>
  )
}