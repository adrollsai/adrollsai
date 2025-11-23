'use client'

import { useState, useEffect } from 'react'
import { Filter, Download, Facebook, X, Loader2, Share2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

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

  // Modal State
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [isPosting, setIsPosting] = useState(false)
  const [caption, setCaption] = useState('')

  // 1. Fetch Assets
  useEffect(() => {
    const fetchAssets = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (data) setAssets(data)
      setLoading(false)
    }
    fetchAssets()
  }, [])

  // 2. Handle Post to Facebook
  const handlePost = async () => {
    if (!selectedAsset) return
    setIsPosting(true)

    try {
      const response = await fetch('/api/post-social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: selectedAsset.url,
          caption: caption || 'Check out this new listing! 🏡 #RealEstate'
        })
      })

      const data = await response.json()

      if (response.ok) {
        alert('Successfully posted to Facebook Page!')
        setSelectedAsset(null) // Close modal
      } else {
        alert('Error: ' + (data.error || 'Failed to post'))
      }
    } catch (e) {
      alert('Network error')
    } finally {
      setIsPosting(false)
    }
  }

  const filteredAssets = activeFilter === 'All' 
    ? assets 
    : assets.filter(asset => asset.type === activeFilter)

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen relative">
      
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
              onClick={() => setSelectedAsset(asset)} // Open Modal on Click
              className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group cursor-pointer active:scale-95 transition-transform"
            >
              <img 
                src={asset.url} 
                alt="Asset" 
                className="w-full h-full object-cover"
              />
              <div className={`
                absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-white
                ${asset.status === 'Published' ? 'bg-green-400' : 'bg-amber-400'}
              `} />
            </div>
          ))}
        </div>
      )}

      {/* --- POSTING MODAL --- */}
      {selectedAsset && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-800">Share Asset</h2>
              <button onClick={() => setSelectedAsset(null)} className="bg-slate-100 p-2 rounded-full text-slate-500">
                <X size={20} />
              </button>
            </div>

            {/* Image Preview */}
            <div className="rounded-2xl overflow-hidden bg-slate-100 mb-4 border border-slate-100">
               <img src={selectedAsset.url} className="w-full max-h-[300px] object-contain" />
            </div>

            {/* Caption Input */}
            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Caption</label>
              <textarea 
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write a caption..."
                className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none resize-none"
                rows={2}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
               {/* Download Button */}
               <a 
                 href={selectedAsset.url} 
                 download="asset.png"
                 target="_blank"
                 className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
               >
                 <Download size={16} />
                 Save
               </a>

               {/* Facebook Post Button */}
               <button 
                 onClick={handlePost}
                 disabled={isPosting}
                 className="flex-[2] bg-[#1877F2] text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
               >
                 {isPosting ? (
                   <>
                     <Loader2 size={16} className="animate-spin" />
                     Posting...
                   </>
                 ) : (
                   <>
                     <Facebook size={16} fill="white" />
                     Post to Page
                   </>
                 )}
               </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}