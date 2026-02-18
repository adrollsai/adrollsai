'use client'

import { Home, Calendar, Users, User } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function PortalNav() {
  const pathname = usePathname()

  const navItems = [
    { name: 'Portfolio', icon: Home, path: '/portal' },
    { name: 'Bookings', icon: Calendar, path: '/portal/bookings' },
    { name: 'Community', icon: Users, path: '/portal/community' },
    { name: 'Profile', icon: User, path: '/portal/profile' },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 px-6 py-4 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-50">
      <div className="flex justify-between items-center max-w-md mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.path
          
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className="flex flex-col items-center gap-1"
            >
              <div className={`
                p-2 rounded-full transition-all duration-300
                ${isActive ? 'bg-slate-900 text-white shadow-lg shadow-slate-200' : 'text-slate-400 hover:bg-slate-50'}
              `}>
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              
              <span className={`text-[10px] font-bold tracking-wide transition-colors ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                {item.name}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}