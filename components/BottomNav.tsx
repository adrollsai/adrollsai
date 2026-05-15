'use client'

import { LayoutGrid, Sparkles, Grid3X3, User, Zap, Users, Share2, Rss, Shield } from 'lucide-react'
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

  if (!role) return null;

  const allNavItems = [
    { name: 'Inventory', icon: LayoutGrid, path: '/dashboard' },
    { name: 'Feed', icon: Rss, path: '/dashboard/feed' },
    { name: 'Creation', icon: Sparkles, path: '/dashboard/creation' },
    { name: 'CRM', icon: Users, path: '/dashboard/crm' },
    { name: 'Ads', icon: Zap, path: '/dashboard/ads' },
    ...(showDistribute ? [{ name: 'Distribute', icon: Share2, path: '/dashboard/distribute' }] : []),
    { name: 'Assets', icon: Grid3X3, path: '/dashboard/assets' },
    { name: 'Accounts', icon: Share2, path: '/dashboard/accounts' },
    { name: 'Team', icon: Shield, path: '/dashboard/team' },
    { name: 'Profile', icon: User, path: '/dashboard/profile' },
  ]

  const navItems = allNavItems.filter(item => {
    // Hide Accounts from non-admin/non-agency
    if (item.name === 'Accounts') {
      return ['super_admin', 'agency', 'admin'].includes(role)
    }

    // Team visibility
    if (item.name === 'Team') {
      return ['super_admin', 'agency', 'admin'].includes(role)
    }

    if (role === 'agent') {
      return ['Inventory', 'CRM', 'Assets', 'Profile'].includes(item.name)
    }
    return true
  })

  return (
    <div className="fixed bottom-0 sm:bottom-6 left-0 right-0 z-50 flex justify-center pointer-events-none">

      <div className="bg-white/90 backdrop-blur-xl border-t sm:border border-slate-200/60 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] sm:shadow-2xl w-full sm:w-auto sm:rounded-[2.5rem] px-2 sm:px-6 py-2 sm:py-3 pointer-events-auto transition-all">

        <div className="flex items-center justify-start sm:justify-center gap-1 sm:gap-2 overflow-x-auto scrollbar-hide pb-4 sm:pb-0 px-4 sm:px-0">

          {navItems.map((item) => {
            const isActive = item.path === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.path || pathname.startsWith(`${item.path}/`)

            const href = impersonateId ? `${item.path}?impersonate=${impersonateId}` : item.path

            return (
              <Link
                key={item.name}
                href={href}
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