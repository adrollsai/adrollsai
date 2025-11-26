'use client'

import { LayoutGrid, Sparkles, Grid3X3, MessageCircle, User } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function BottomNav() {
  const pathname = usePathname()

  const navItems = [
    { name: 'Inventory', icon: LayoutGrid, path: '/dashboard' },
    { name: 'Creation', icon: Sparkles, path: '/dashboard/creation' },
    { name: 'Assets', icon: Grid3X3, path: '/dashboard/assets' },
    { name: 'Profile', icon: User, path: '/dashboard/profile' },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-6 py-3 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-50">
      <div className="flex justify-between items-center max-w-md mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.path
          
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className="flex flex-col items-center gap-0.5"
            >
              {/* Smaller Bubble (p-2 instead of p-3), Smaller Icon (20 instead of 24) */}
              <div className={`
                p-2 rounded-xl transition-all duration-200
                ${isActive ? 'bg-primary text-primary-text scale-105 shadow-sm' : 'text-slate-400 hover:bg-slate-50'}
              `}>
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              
              {/* Tiny label */}
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