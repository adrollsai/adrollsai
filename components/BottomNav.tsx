'use client'

import { LayoutGrid, Sparkles, Grid3X3, User, Zap, Users, Share2, Shield } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function BottomNav() {
  const pathname = usePathname()
  const supabase = createClient()
  
  const [showDistribute, setShowDistribute] = useState(false)
  const [role, setRole] = useState<'admin' | 'agent' | null>(null) 

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
          // Failsafe: If DB errors out, don't lock out the main user
          setRole('admin') 
          return;
      }

      // Convert to lowercase to be completely safe
      const fetchedRole = data?.role?.toLowerCase()

      if (fetchedRole === 'agent') {
          setRole('agent') 
      } else {
          setRole('admin') 
      }

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

  // Define ALL possible navigation items
  const allNavItems = [
    { name: 'Inventory', icon: LayoutGrid, path: '/dashboard' },
    { name: 'Creation', icon: Sparkles, path: '/dashboard/creation' },
    { name: 'CRM', icon: Users, path: '/dashboard/crm' },
    { name: 'Ads', icon: Zap, path: '/dashboard/ads' },
    ...(showDistribute ? [{ name: 'Distribute', icon: Share2, path: '/dashboard/distribute' }] : []),
    { name: 'Assets', icon: Grid3X3, path: '/dashboard/assets' },
    { name: 'Team', icon: Shield, path: '/dashboard/team' },
    { name: 'Profile', icon: User, path: '/dashboard/profile' },
  ]

  // Filter Nav Items Based on Role
  const navItems = allNavItems.filter(item => {
      if (role === 'agent') {
          return ['Inventory', 'CRM', 'Assets', 'Profile'].includes(item.name)
      }
      return true
  })

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-2 py-3 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-50">
      <div className="flex justify-between items-center max-w-md mx-auto overflow-x-auto scrollbar-hide gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.path || pathname.startsWith(`${item.path}/`)
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className="flex flex-col items-center gap-0.5 min-w-[50px] sm:min-w-[60px]"
            >
              <div className={`
                p-2 rounded-xl transition-all duration-200
                ${isActive ? 'bg-primary text-primary-text scale-105 shadow-sm' : 'text-slate-400 hover:bg-slate-50'}
              `}>
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              {isActive && (
                <span className="text-[9px] sm:text-[10px] font-bold text-primary-text">
                  {item.name}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}