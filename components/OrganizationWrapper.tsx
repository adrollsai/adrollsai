// adrollsai/adrollsai/adrollsai-builder-app-gamification-superuser/components/OrganizationWrapper.tsx

'use client'

import { createContext, useContext, useEffect, useState, Suspense } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useSearchParams } from 'next/navigation'
import { Shield } from 'lucide-react'

type Organization = {
  id: string
  name: string
  master_logo_url: string | null
  brand_color: string | null
}

type OrgContextType = {
  org: Organization | null
  loading: boolean
  isImpersonating: boolean
  userRole: string | null // Added userRole to context
  refreshOrg: () => void
}

const OrgContext = createContext<OrgContextType>({ 
    org: null, 
    loading: true, 
    isImpersonating: false, 
    userRole: null, 
    refreshOrg: () => {} 
})

export const useOrganization = () => useContext(OrgContext)

// 1. INNER COMPONENT: Handles logic and useSearchParams
function OrgContent({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const searchParams = useSearchParams() 
  
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null) // State for Role

  const fetchOrg = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Get Profile AND Role
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .single()
      
      if (profile) {
          setUserRole(profile.role) // Set the role state
      }

      let targetOrgId = profile?.organization_id

      // SUPER USER LOGIC: Check for override
      const overrideId = searchParams.get('impersonate_org')
      
      // Check role (safely handling types)
      if ((profile?.role === 'super_user' || profile?.role === 'admin') && overrideId) {
          // Verify they are actually allowed to impersonate (double check role)
          if(profile.role === 'super_user') {
            targetOrgId = overrideId
            setIsImpersonating(true)
          }
      } else {
          setIsImpersonating(false)
      }

      if (targetOrgId) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', targetOrgId)
          .single()
        
        if (orgData) {
          setOrg(orgData)
        }
      }
    } catch (e) {
      console.error("Org Fetch Error:", e)
    } finally {
      setLoading(false)
    }
  }

  const getContrastColor = (hexColor: string) => {
    if (!hexColor) return '#001D35'
    const hex = hexColor.replace('#', '')
    const r = parseInt(hex.substr(0, 2), 16)
    const g = parseInt(hex.substr(2, 2), 16)
    const b = parseInt(hex.substr(4, 2), 16)
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000
    return yiq >= 128 ? '#001D35' : '#FFFFFF'
  }

  const applyTheme = (color: string | null) => {
    if (!color) return
    const root = document.documentElement
    root.style.setProperty('--primary', color)
    root.style.setProperty('--primary-text', getContrastColor(color))
  }

  useEffect(() => {
    fetchOrg()
  }, [searchParams]) 

  useEffect(() => {
    if (org && org.brand_color) {
        applyTheme(org.brand_color)
    }
  }, [org])

  return (
    <OrgContext.Provider value={{ org, loading, isImpersonating, userRole, refreshOrg: fetchOrg }}>
      {children}
      
      {/* IMPERSONATION BANNER */}
      {isImpersonating && org && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-xs font-bold animate-pulse pointer-events-none">
              <Shield size={14} fill="currentColor"/>
              Viewing as {org.name}
          </div>
      )}
    </OrgContext.Provider>
  )
}

// 2. OUTER COMPONENT: Provides Suspense Boundary
export default function OrganizationWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-slate-50" />}>
      <OrgContent>{children}</OrgContent>
    </Suspense>
  )
}