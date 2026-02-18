'use client'

import { LayoutGrid, Grid3X3, User, Zap, Users, Share2, Building } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOrganization } from '@/components/OrganizationWrapper'

export default function BottomNav() {
  const pathname = usePathname()
  const { userRole, org } = useOrganization() 

  // LOGIC: Check the flag we set in the database
  const showProperties = org?.business_model === 'fractional';

  const navItems = [
    { name: 'Inventory', icon: LayoutGrid, path: '/dashboard' },
    
    // CONDITION: Only show this tab if the model is fractional
    ...(showProperties ? [{ name: 'Properties', icon: Building, path: '/dashboard/properties' }] : []),
    
    { name: 'CRM', icon: Users, path: '/dashboard/crm' },
    { name: 'Ads', icon: Zap, path: '/dashboard/ads' },

    // Distribute: Super User Only
    ...(['super_user'].includes(userRole || '') ? [{ name: 'Distribute', icon: Share2, path: '/dashboard/distribute' }] : []),
    
    { name: 'Assets', icon: Grid3X3, path: '/dashboard/assets' }, 
    { name: 'Profile', icon: User, path: '/dashboard/profile' },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-6 py-3 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-50">
      <div className="flex justify-between items-center max-w-md mx-auto">
        {navItems.map((item) => {
          // Highlight logic: exact match OR sub-path match (except dashboard home)
          const isActive = pathname === item.path || (item.path !== '/dashboard' && pathname.startsWith(item.path))
          
          return (
            <Link 
              key={item.name} 
              href={item.path}
              className="flex flex-col items-center gap-0.5"
            >
              <div className={`
                p-2 rounded-xl transition-all duration-200
                ${isActive ? 'bg-slate-900 text-white scale-105 shadow-sm' : 'text-slate-400 hover:bg-slate-50'}
              `}>
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              
              {isActive && (
                <span className="text-[10px] font-bold text-slate-900">
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