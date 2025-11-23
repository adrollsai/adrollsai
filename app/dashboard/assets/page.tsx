'use client'

import { useState, useEffect } from 'react'
import { Filter, Download, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// Define the Asset shape
type Asset = {
  id: string
  type: 'image' | 'video'
  status: string
  url: string
}

const filters = ['All', 'image', 'video']

export default function AssetsPage() {
  const supabase = createClient()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')

  // 1. Fetch Assets
  useEffect(() => {
    const fetchAssets = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (data) setAssets(data)
      setLoading(false)
    }
    fetchAssets()
  }, [])

  // 2. Filter Logic
  const filteredAssets = activeFilter === 'All' 
    ? assets 
    : assets.filter(asset => asset.type === activeFilter)

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Library</h1>
          <p className="text-slate-500 text-xs mt-1">Your marketing assets</p>
        </div>
        <div className="p-2.5 bg-white text-slate-700 rounded-full shadow-sm border border-slate-100">
          <Filter size={18} />
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 overflow-x-auto pb-5 -mx-5 px-5 scrollbar-hide">
        {filters.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`
              capitalize whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all border
              ${activeFilter === filter 
                ? 'bg-slate-900 text-white border-slate-900 shadow-md' 
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}
            `}
          >
            {filter === 'image' ? 'Images' : filter === 'video' ? 'Videos' : filter}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-20 text-slate-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 mb-24">
          {filteredAssets.map((asset) => (
            <div 
              key={asset.id} 
              className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group"
            >
              <img 
                src={asset.url} 
                alt="Asset" 
                className="w-full h-full object-cover"
              />
              
              {/* Status Dot */}
              <div className={`
                absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-white
                ${asset.status === 'Published' ? 'bg-green-400' : 'bg-amber-400'}
              `} />

              {/* Download Icon (Show on Hover) */}
              <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                 <button className="bg-white p-1.5 rounded-full shadow-sm">
                   <Download size={14} className="text-slate-900" />
                 </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filteredAssets.length === 0 && (
        <div className="text-center py-20">
          <p className="text-slate-400 text-sm">No assets found.</p>
        </div>
      )}

    </div>
  )
}