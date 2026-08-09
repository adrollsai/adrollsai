'use client'

import { LayoutGrid, Sparkles, Grid3X3, User, Zap, Users, Share2, Rss, Shield, Globe, MessageCircle, BarChart2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function BottomNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [showDistribute, setShowDistribute] = useState(false)
  const [role, setRole] = useState<'super_admin' | 'agency' | 'client' | 'admin' | 'agent' | null>(null)
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)

  useEffect(() => {
    const checkIsInputActive = () => {
      if (typeof document === 'undefined') return
      const active = document.activeElement as HTMLElement | null
      let isInput = false
      if (active) {
        const tag = active.tagName ? active.tagName.toLowerCase() : ''
        isInput = active.isContentEditable || tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes((active as HTMLInputElement).type || ''))
      }
      const isViewportShrunk = (typeof window !== 'undefined' && window.visualViewport) ? window.visualViewport.height < window.innerHeight * 0.85 : false
      setIsKeyboardOpen(isInput || isViewportShrunk)
    }

    const interval = setInterval(checkIsInputActive, 200)
    window.addEventListener('focusin', checkIsInputActive)
    window.addEventListener('focusout', checkIsInputActive)
    window.addEventListener('resize', checkIsInputActive)
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', checkIsInputActive)
      window.visualViewport.addEventListener('scroll', checkIsInputActive)
    }

    return () => {
      clearInterval(interval)
      window.removeEventListener('focusin', checkIsInputActive)
      window.removeEventListener('focusout', checkIsInputActive)
      window.removeEventListener('resize', checkIsInputActive)
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', checkIsInputActive)
        window.visualViewport.removeEventListener('scroll', checkIsInputActive)
      }
    }
  }, [])

  const impersonateId = searchParams.get('impersonate')
  useEffect(() => {
    let isMounted = true;

    const checkProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('enable_distribution, role')
        .eq('id', session.user.id)
        .single()

      if (!isMounted) return;

      if (error) {
        setRole('admin')
        return;
      }

      const fetchedRole = data?.role?.toLowerCase() as any

      setRole(fetchedRole || 'admin')

      if (data?.enable_distribution) {
        setShowDistribute(true)
      }
    }

    checkProfile()

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        checkProfile()
      } else if (event === 'SIGNED_OUT') {
        if (isMounted) setRole(null)
      }
    })

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe()
    }
  }, [supabase])

  if (!role || isKeyboardOpen) return null;

  const allNavItems = [
    { name: 'Analytics', icon: BarChart2, path: '/dashboard/analytics' },
    { name: 'Inventory', icon: LayoutGrid, path: '/dashboard' },
    // { name: 'Feed', icon: Rss, path: '/dashboard/feed' },
    { name: 'Creation', icon: Sparkles, path: '/dashboard/creation' },
    { name: 'Ads', icon: Zap, path: '/dashboard/ads' },
    { name: 'CRM', icon: Users, path: '/dashboard/crm' },
    { name: 'WhatsApp', icon: MessageCircle, path: '/dashboard/whatsapp' },
    ...(showDistribute ? [{ name: 'Distribute', icon: Share2, path: '/dashboard/distribute' }] : []),
    { name: 'Assets', icon: Grid3X3, path: '/dashboard/assets' },
    { name: 'Profile', icon: User, path: '/dashboard/profile' },
  ]

  const navItems = allNavItems.filter(item => {
    // Hide Accounts from non-admin/non-agency
    if (item.name === 'Accounts') {
      return ['super_admin', 'agency'].includes(role)
    }

    // Hide Pages from non-agency/non-super_admin
    if (item.name === 'Pages') {
      return ['super_admin', 'agency'].includes(role)
    }

    // Hide Distribute from admin accounts
    if (item.name === 'Distribute') {
      return ['super_admin', 'agency'].includes(role)
    }

    // Team visibility
    if (item.name === 'Team') {
      return ['super_admin', 'agency', 'admin'].includes(role)
    }

    if (role === 'agent') {
      return ['Analytics', 'Inventory', 'CRM', 'Assets', 'Profile', 'WhatsApp'].includes(item.name)
    }
    return true
  })

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[70] flex justify-center pointer-events-none bg-white/95 sm:bg-transparent backdrop-blur-2xl sm:backdrop-blur-none border-t sm:border-t-0 border-slate-200/80 shadow-[0_-4px_25px_rgba(0,0,0,0.06)] sm:shadow-none pb-[env(safe-area-inset-bottom)]">
      <div className="bg-transparent sm:bg-white/95 sm:backdrop-blur-2xl sm:border border-slate-200/60 sm:shadow-2xl w-full sm:w-auto sm:max-w-[95%] sm:mb-6 sm:rounded-[2.5rem] px-2 sm:px-6 py-1.5 sm:py-3 pointer-events-auto transition-all">
        <div className="flex items-center justify-start sm:justify-center gap-1 sm:gap-2 overflow-x-auto scrollbar-hide px-3 sm:px-0">

          {navItems.map((item) => {
            const isActive = item.path === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.path || pathname.startsWith(`${item.path}/`)

            const href = impersonateId ? `${item.path}?impersonate=${impersonateId}` : item.path

            return (
              <Link
                key={item.name}
                href={href}
                prefetch={true}
                className="flex flex-col items-center gap-1.5 min-w-[64px] xs:min-w-[72px] sm:min-w-[84px] group pt-2 pb-1 shrink-0"
              >
                <div className={`
                  px-4 xs:px-5 py-1.5 rounded-full transition-all duration-300 ease-out flex items-center justify-center
                  ${isActive ? 'bg-blue-100 shadow-inner scale-105' : 'bg-transparent group-hover:bg-slate-100'}
                `}>
                  <item.icon
                    size={20}
                    strokeWidth={isActive ? 2.5 : 2}
                    className={`transition-colors duration-300 ${isActive ? 'text-blue-700 animate-in zoom-in' : 'text-slate-500 group-hover:text-slate-700'}`}
                  />
                </div>

                <span className={`text-[9px] xs:text-[10px] sm:text-xs font-bold transition-all duration-300 ${isActive ? 'text-blue-700' : 'text-slate-500 group-hover:text-slate-700'}`}>
                  {item.name}
                </span>
              </Link>
            )
          })}

        </div>
      </div>
    </div>
  )
}