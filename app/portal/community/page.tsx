'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Users, Shield, Building2, Loader2 } from 'lucide-react'

export default function CommunityPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [coOwners, setCoOwners] = useState<any[]>([])
  const [propertyTitle, setPropertyTitle] = useState('')

  useEffect(() => {
    const fetchCoOwners = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 1. Find out which property this user owns
      const { data: myHolding } = await supabase
        .from('customer_holdings')
        .select('fraction_id, fractions(property_id, properties(title))')
        .eq('user_id', user.id)
        .single()

      if (myHolding && myHolding.fractions) {
        // FIX: We cast to 'any' to handle if Supabase returns an array or object
        const frac = myHolding.fractions as any
        const propTitle = frac.properties?.title || frac.properties?.[0]?.title
        
        const propId = frac.property_id
        setPropertyTitle(propTitle || 'Your Property')

        // 2. Fetch all owners for this property
        if (propId) {
            const { data: owners } = await supabase
                .from('customer_holdings')
                .select(`
                    id,
                    fractions!inner (
                        fraction_number,
                        property_id
                    ),
                    profiles (
                        business_name,
                        email,
                        logo_url
                    )
                `)
                .eq('fractions.property_id', propId)
                .order('fraction_number', { foreignTable: 'fractions', ascending: true })

            setCoOwners(owners || [])
        }
      }
      setLoading(false)
    }
    fetchCoOwners()
  }, [])

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-300"/></div>

  return (
    <div className="p-6 pb-32 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Co-Owners</h1>
        <p className="text-xs text-slate-500 flex items-center gap-1">
            <Building2 size={12}/>
            {propertyTitle}
        </p>
      </div>

      <div className="space-y-3">
        {coOwners.map((owner: any) => {
            // Safe access for nested fraction data
            const fractionNum = owner.fractions?.fraction_number || '?'
            
            return (
                <div key={owner.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center gap-4 shadow-sm">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-lg overflow-hidden">
                        {owner.profiles?.logo_url ? (
                            <img src={owner.profiles.logo_url} className="w-full h-full object-cover"/>
                        ) : (
                            owner.profiles?.business_name?.[0] || 'U'
                        )}
                    </div>

                    {/* Details */}
                    <div className="flex-1">
                        <h3 className="text-sm font-bold text-slate-900">
                            {owner.profiles?.business_name || 'Anonymous Investor'}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-100">
                                Share #{fractionNum}
                            </span>
                            <span className="text-[10px] text-slate-400">Owner</span>
                        </div>
                    </div>

                    <Shield size={16} className="text-emerald-500"/>
                </div>
            )
        })}

        {!loading && coOwners.length === 0 && (
            <div className="text-center p-10 text-slate-400 text-sm">
                No other owners found yet.
            </div>
        )}
      </div>
    </div>
  )
}