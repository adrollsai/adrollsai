/* adrollsai/adrollsai/adrollsai-builder-app/components/OrganizationWrapper.tsx */
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

type Organization = {
  id: string
  name: string
  master_logo_url: string | null
  brand_color: string | null
}

type OrgContextType = {
  org: Organization | null
  loading: boolean
  refreshOrg: () => void
}

const OrgContext = createContext<OrgContextType>({ org: null, loading: true, refreshOrg: () => {} })

export const useOrganization = () => useContext(OrgContext)

export default function OrganizationWrapper({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchOrg = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profile?.organization_id) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .single()
        
        if (orgData) {
          setOrg(orgData)
          // Theme is applied via the useEffect below now
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
    // Remove # if present
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

  // 1. Initial Load
  useEffect(() => {
    fetchOrg()
  }, [])

  // 2. React to changes (Crucial for "Save" to work instantly)
  useEffect(() => {
    if (org && org.brand_color) {
        applyTheme(org.brand_color)
    }
  }, [org])

  return (
    <OrgContext.Provider value={{ org, loading, refreshOrg: fetchOrg }}>
      {children}
    </OrgContext.Provider>
  )
}