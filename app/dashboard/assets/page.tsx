// adrollsai/adrollsai/adrollsai-builder-app/app/dashboard/assets/page.tsx

'use client'

import { useState, useEffect } from 'react'
import { Filter, Download, Facebook, Instagram, X, Loader2, Globe, Linkedin, Youtube, Film, MessageCircle, Share2, Rocket } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useOrganization } from '@/components/OrganizationWrapper'

type Asset = {
  id: string
  type: 'image' | 'video'
  status: string
  url: string
  master_creative_id: string | null 
  property?: {
      marketing_copy_template: string
  }
  master_creative?: {
      caption_template: string
  }
}

type Profile = {
    business_name: string
    contact_number: string
}

const filters = ['All', 'image', 'video']

export default function AssetsPage() {
  const supabase = createClient()
  const { org } = useOrganization()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')
  const [userProfile, setUserProfile] = useState<Profile | null>(null)

  // Modal State
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [caption, setCaption] = useState('')
  const [isPosting, setIsPosting] = useState(false)

  // 1. Fetch Assets
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase.from('profiles').select('business_name, contact_number').eq('id', user.id).single()
      if (profile) setUserProfile(profile as Profile)
      
      // Add a small delay (500ms) to allow eventual consistency to resolve
      await new Promise(resolve => setTimeout(resolve, 500)) 

      // Fetch assets with templates from either Property or Master Creative
      const { data, error } = await supabase
        .from('assets')
        .select(`
            *,
            property:properties ( marketing_copy_template ),
            master_creative:master_creatives ( caption_template )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        console.error("ASSETS FETCH ERROR:", error)
      }
      
      if (data) setAssets(data as unknown as Asset[])
      setLoading(false)
    }
    init()
  }, [])

  // 2. Open & Template Logic
  const handleOpenAsset = (asset: Asset) => {
      setSelectedAsset(asset)
      
      // Determine which template to use (Master Creative specific > Property generic > Default)
      let rawTemplate = asset.master_creative?.caption_template || 
                        asset.property?.marketing_copy_template || 
                        "Check out this property! Call {{Name}} at {{Phone}}."
      
      if (userProfile) {
          rawTemplate = rawTemplate.replace(/{{Name}}/g, userProfile.business_name || 'Agent')
          rawTemplate = rawTemplate.replace(/{{Phone}}/g, userProfile.contact_number || '')
      }
      setCaption(rawTemplate)
  }

  // 3. TRACKING FUNCTION
  const trackShare = async (platform: string) => {
      if (!selectedAsset) return
      // Call the Database RPC function we created in Step 1
      await supabase.rpc('increment_share_stat', { 
          asset_id: selectedAsset.id, 
          platform: platform 
      })
  }

  // 4. Universal Post Handler
  const handleUniversalPost = async () => {
      if (!selectedAsset) return
      setIsPosting(true)
      try {
          const res = await fetch('/api/post-universal', {
              method: 'POST',
              body: JSON.stringify({
                  imageUrl: selectedAsset.url,
                  caption: caption,
                  platforms: ['facebook', 'instagram']
              })
          })
          const data = await res.json()
          
          if (res.ok && data.success) {
              alert("🚀 Successfully posted to Facebook and Instagram!")
              // Track stats for both
              trackShare('facebook')
              trackShare('instagram')
              setSelectedAsset(null) // Close modal on success
          } else {
              // Handle partial success or errors
              let msg = "Posting completed with issues:\n"
              if (data.results) {
                  Object.entries(data.results).forEach(([platform, status]) => {
                      msg += `${platform}: ${status}\n`
                  })
              } else {
                  msg = data.error || "Unknown error occurred."
              }
              alert(msg)
          }
      } catch (e: any) {
          alert("Network error: " + e.message)
      } finally {
          setIsPosting(false)
      }
  }

  // 5. Native Share / WhatsApp
  const handleNativeShare = async () => {
      if (!selectedAsset) return
      await trackShare('whatsapp') // Track as WhatsApp/Native

      if (navigator.share) {
          try {
              const response = await fetch(selectedAsset.url)
              const blob = await response.blob()
              
              // Handle the .jpg extension for stamped images (from the compression fix)
              const fileType = selectedAsset.url.endsWith('.jpg') ? 'image/jpeg' : blob.type
              const fileName = selectedAsset.url.endsWith('.jpg') ? 'property.jpg' : 'property.png'

              const file = new File([blob], fileName, { type: fileType })
              await navigator.share({ title: "Property", text: caption, files: [file] })
          } catch (e) {
              window.open(`https://wa.me/?text=${encodeURIComponent(caption + " " + selectedAsset.url)}`, '_blank')
          }
      } else {
          window.open(`https://wa.me/?text=${encodeURIComponent(caption + " " + selectedAsset.url)}`, '_blank')
      }
  }

  const handleDownload = async () => {
      await trackShare('download')
      const link = document.createElement('a')
      link.href = selectedAsset?.url || ''
      // Use the URL extension for download
      const extension = selectedAsset?.url.split('.').pop()
      link.download = `Asset-${Date.now()}.${extension}`
      link.target = "_blank"
      link.click()
  }

  const filteredAssets = activeFilter === 'All' ? assets : assets.filter(asset => asset.type === activeFilter)

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen relative pb-24">
      <div className="flex justify-between items-end mb-5">
        <div>
            {/* Dynamic Logo integration */}
            <div className="flex items-center gap-2">
               {org?.master_logo_url && <img src={org.master_logo_url} className="w-6 h-6 object-contain" />}
               <h1 className="text-2xl font-bold text-slate-900">My Assets</h1>
            </div>
            <p className="text-slate-500 text-xs mt-1">Ready to share</p>
        </div>
        <div className="p-2.5 bg-white text-slate-700 rounded-full shadow-sm border border-slate-100"><Filter size={18} /></div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-5 -mx-5 px-5 scrollbar-hide">
        {filters.map((filter) => (
          <button key={filter} onClick={() => setActiveFilter(filter)} className={`capitalize px-4 py-2 rounded-full text-xs font-bold transition-all border ${activeFilter === filter ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}>{filter === 'image' ? 'Images' : filter === 'video' ? 'Videos' : filter}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {filteredAssets.map((asset) => (
            <div key={asset.id} onClick={() => handleOpenAsset(asset)} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group cursor-pointer active:scale-95 transition-transform">
              {asset.type === 'video' ? (
                  <div className="w-full h-full bg-slate-800 flex items-center justify-center relative">
                      <video src={asset.url} className="w-full h-full object-cover opacity-80" />
                      <Film className="absolute text-white opacity-50" size={24}/>
                  </div>
              ) : (
                  <img src={asset.url} alt="Asset" className="w-full h-full object-cover" />
              )}
              {/* Status Badge */}
              <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500 border border-white shadow-sm" />
            </div>
          ))}
          {filteredAssets.length === 0 && <div className="col-span-3 text-center py-10 text-xs text-slate-400">No assets generated yet.<br/>Go to "Feed" to claim new ones.</div>}
        </div>
      )}

      {selectedAsset && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-800">Share Asset</h2>
              <button onClick={() => setSelectedAsset(null)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20}/></button>
            </div>

            <div className="rounded-2xl overflow-hidden bg-slate-100 mb-4 border border-slate-100 relative">
               {selectedAsset.type === 'video' ? (
                   <video src={selectedAsset.url} controls className="w-full max-h-[300px] object-contain bg-black" />
               ) : (
                   <img src={selectedAsset.url} className="w-full max-h-[300px] object-contain" />
               )}
            </div>

            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Caption</label>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} className="w-full bg-slate-50 p-3 rounded-xl text-xs focus:ring-2 focus:ring-primary outline-none resize-none" rows={3} />
            </div>

            <div className="flex flex-col gap-3">
               {/* UNIVERSAL POST BUTTON */}
               <button 
                 onClick={handleUniversalPost}
                 disabled={isPosting} 
                 className="w-full bg-gradient-to-r from-blue-600 to-pink-600 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform"
               >
                 {isPosting ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />} 
                 {isPosting ? 'Posting...' : 'Universal Post (FB + Insta)'}
               </button>

               {/* WHATSAPP / NATIVE SHARE BUTTON */}
               <button onClick={handleNativeShare} className="w-full bg-[#25D366] text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-100 active:scale-95 transition-transform">
                 <MessageCircle size={18} /> Share on WhatsApp
               </button>

               {/* Standalone Actions */}
               <div className="flex gap-2">
                 <button onClick={() => trackShare('facebook')} className="flex-1 bg-blue-600 text-white py-3 rounded-xl flex justify-center shadow-sm active:scale-95 transition-transform" title="Facebook Only"><Facebook size={18} /></button>
                 <button onClick={() => trackShare('instagram')} className="flex-1 bg-pink-600 text-white py-3 rounded-xl flex justify-center shadow-sm active:scale-95 transition-transform" title="Instagram Only"><Instagram size={18} /></button>
                 <button onClick={handleDownload} className="flex-1 bg-slate-800 text-white py-3 rounded-xl flex justify-center shadow-sm active:scale-95 transition-transform" title="Download"><Download size={18} /></button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}