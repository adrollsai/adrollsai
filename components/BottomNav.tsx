'use client'

import { LayoutGrid, Sparkles, Grid3X3, User, Zap, Users, Share2 } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function BottomNav() {
  const pathname = usePathname()
  const supabase = createClient()
  const [showDistribute, setShowDistribute] = useState(false)

  useEffect(() => {
    const checkProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data } = await supabase.from('profiles').select('enable_distribution').eq('id', session.user.id).single()
        if (data?.enable_distribution) setShowDistribute(true)
      }
    }
    checkProfile()
  }, [])

  const navItems = [
    { name: 'Inventory', icon: LayoutGrid, path: '/dashboard' },
    { name: 'Creation', icon: Sparkles, path: '/dashboard/creation' },
    { name: 'CRM', icon: Users, path: '/dashboard/crm' },
    { name: 'Ads', icon: Zap, path: '/dashboard/ads' },
    // Conditionally insert Distribute
    ...(showDistribute ? [{ name: 'Distribute', icon: Share2, path: '/dashboard/distribute' }] : []),
    { name: 'Assets', icon: Grid3X3, path: '/dashboard/assets' },
    { name: 'Profile', icon: User, path: '/dashboard/profile' },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-2 py-3 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-50">
      <div className="flex justify-between items-center max-w-md mx-auto overflow-x-auto scrollbar-hide">
        {navItems.map((item) => {
          const isActive = pathname === item.path
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className="flex flex-col items-center gap-0.5 min-w-[60px]"
            >
              <div className={`
                p-2 rounded-xl transition-all duration-200
                ${isActive ? 'bg-primary text-primary-text scale-105 shadow-sm' : 'text-slate-400 hover:bg-slate-50'}
              `}>
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              {isActive && (
                <span className="text-[10px] font-bold text-primary-text">
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