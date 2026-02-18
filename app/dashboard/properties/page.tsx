'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Building2, ArrowRight, Loader2 } from 'lucide-react'
import Link from 'next/link'

export default function PropertiesListPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState<any[]>([])

  useEffect(() => {
    const fetchProps = async () => {
      // Fetch existing properties (inventory)
      const { data } = await supabase
        .from('properties')
        .select('id, title, address, image_url, price')
        .order('created_at', { ascending: false })
      
      setProperties(data || [])
      setLoading(false)
    }
    fetchProps()
  }, [])

  return (
    <div className="p-6 pb-32 max-w-lg mx-auto min-h-screen">
      <h1 className="text-2xl font-black text-slate-900 mb-2">Real Estate Assets</h1>
      <p className="text-slate-500 mb-6">Manage fractional ownership units.</p>

      {loading ? (
        <Loader2 className="animate-spin text-slate-400 mx-auto" />
      ) : (
        <div className="space-y-4">
          {properties.map(prop => (
            <Link 
              href={`/dashboard/properties/${prop.id}`} 
              key={prop.id}
              className="block bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:scale-[0.98] transition-transform"
            >
              <div className="flex gap-4">
                {/* Image */}
                <div className="w-20 h-20 bg-slate-100 rounded-xl overflow-hidden shrink-0">
                  {prop.image_url ? (
                    <img src={prop.image_url} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <Building2 size={24} />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                   <h3 className="font-bold text-slate-900 truncate">{prop.title}</h3>
                   <p className="text-xs text-slate-500 truncate mb-2">{prop.address}</p>
                   <div className="inline-flex items-center text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full self-start">
                      Manage Fractions <ArrowRight size={10} className="ml-1"/>
                   </div>
                </div>
              </div>
            </Link>
          ))}

          {properties.length === 0 && (
            <div className="text-center py-10 text-slate-400 text-sm">
              No properties found. <br/> Add properties in the "Inventory" tab first.
            </div>
          )}
        </div>
      )}
    </div>
  )
}