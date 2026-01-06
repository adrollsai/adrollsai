'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  const [mounted, setMounted] = useState(false)
  
  // Tracking which platform is currently posting (null, 'universal', 'facebook', 'instagram')
  const [postingState, setPostingState] = useState<string | null>(null)

  // 1. Fetch Assets
  useEffect(() => {
    setMounted(true)
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
      await supabase.rpc('increment_share_stat', { 
          asset_id: selectedAsset.id, 
          platform: platform 
      })
  }

  // 4. POST HANDLER (Universal & Individual)
  const handlePost = async (targetPlatforms: string[], stateKey: string) => {
    if (!selectedAsset) return
    setPostingState(stateKey)

    try {
        const res = await fetch('/api/post-universal', {
            method: 'POST',
            body: JSON.stringify({
                imageUrl: selectedAsset.url,
                caption: caption,
                platforms: targetPlatforms
            })
        })
        const data = await res.json()
        
        if (res.ok && data.success) {
            // Check for partial failures
            const failures = Object.entries(data.results || {})
                .filter(([_, status]) => (status as string).startsWith('Failed'))
                .map(([platform, status]) => `${platform}: ${status}`);

            if (failures.length > 0) {
                alert(`⚠️ Posted with issues:\n${failures.join('\n')}`);
            } else {
                const prettyNames = targetPlatforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' & ')
                alert(`🚀 Successfully posted to ${prettyNames}!`)
                if (targetPlatforms.length > 1) setSelectedAsset(null) // Close only on universal success
            }

            // Track stats for successes
            if (data.results?.facebook === 'success') trackShare('facebook')
            if (data.results?.instagram === 'success') trackShare('instagram')

        } else {
            // Handle total failure
            let msg = "Posting failed:\n"
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
        setPostingState(null)
    }
  }

  // 5. Native Share / WhatsApp
  const handleNativeShare = async () => {
      if (!selectedAsset) return
      await trackShare('whatsapp') 

      if (navigator.share) {
          try {
              const response = await fetch(selectedAsset.url)
              const blob = await response.blob()
              
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
      const extension = selectedAsset?.url.split('.').pop()
      link.download = `Asset-${Date.now()}.${extension}`
      link.target = "_blank"
      link.click()
  }

  const filteredAssets = activeFilter === 'All' ? assets : assets.filter(asset => asset.type === activeFilter)

  // Portal Helper
  const ModalPortal = ({ children }: { children: React.ReactNode }) => {
    if (!mounted) return null
    return createPortal(children, document.body)
  }

  return (
    // FIX: Changed max-w-md to max-w-7xl
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      
      {/* HEADER - Removed Logo */}
      <div className="flex justify-between items-end">
        <div>
            <h1 className="text-2xl font-bold text-slate-900">My Assets</h1>
            <p className="text-slate-500 text-xs mt-1">Ready to share</p>
        </div>
        <div className="p-2.5 bg-white text-slate-700 rounded-full shadow-sm border border-slate-100"><Filter size={18} /></div>
      </div>

      {/* FILTER TABS */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {filters.map((filter) => (
          <button key={filter} onClick={() => setActiveFilter(filter)} className={`capitalize px-5 py-2.5 rounded-full text-sm font-bold transition-all border ${activeFilter === filter ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>{filter === 'image' ? 'Images' : filter === 'video' ? 'Videos' : filter}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredAssets.map((asset) => (
            <div key={asset.id} onClick={() => handleOpenAsset(asset)} className="relative aspect-square rounded-2xl overflow-hidden bg-slate-100 group cursor-pointer active:scale-95 transition-all shadow-sm hover:shadow-md border border-slate-100 hover:border-slate-200">
              {asset.type === 'video' ? (
                  <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
                      <video src={asset.url} className="w-full h-full object-cover opacity-70" />
                      <Film className="absolute text-white opacity-80" size={32}/>
                  </div>
              ) : (
                  <img src={asset.url} alt="Asset" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              )}
              {/* Status Badge */}
              <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-green-500 border-2 border-white shadow-sm" />
            </div>
          ))}
          {filteredAssets.length === 0 && <div className="col-span-full text-center py-20 text-sm text-slate-400">No assets generated yet.<br/>Go to "Feed" to claim new ones.</div>}
        </div>
      )}

      {selectedAsset && (
        <ModalPortal>
            <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-5 shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-slate-800">Share Asset</h2>
                <button onClick={() => setSelectedAsset(null)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200"><X size={20}/></button>
                </div>

                <div className="rounded-2xl overflow-hidden bg-slate-100 mb-4 border border-slate-100 relative shadow-inner">
                {selectedAsset.type === 'video' ? (
                    <video src={selectedAsset.url} controls className="w-full max-h-[300px] object-contain bg-black" />
                ) : (
                    <img src={selectedAsset.url} className="w-full max-h-[300px] object-contain" />
                )}
                </div>

                <div className="mb-4">
                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Caption</label>
                <textarea value={caption} onChange={(e) => setCaption(e.target.value)} className="w-full bg-slate-50 p-3 rounded-xl text-xs focus:ring-2 focus:ring-blue-100 outline-none resize-none border border-slate-100" rows={3} />
                </div>

                <div className="flex flex-col gap-3">
                {/* UNIVERSAL POST BUTTON */}
                <button 
                    onClick={() => handlePost(['facebook', 'instagram'], 'universal')}
                    disabled={!!postingState} 
                    className="w-full bg-gradient-to-r from-blue-600 to-pink-600 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform disabled:opacity-70"
                >
                    {postingState === 'universal' ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />} 
                    {postingState === 'universal' ? 'Posting...' : 'Universal Post (FB + Insta)'}
                </button>

                {/* WHATSAPP / NATIVE SHARE BUTTON */}
                <button onClick={handleNativeShare} className="w-full bg-[#25D366] text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-100 active:scale-95 transition-transform">
                    <MessageCircle size={18} /> Share on WhatsApp
                </button>

                {/* Standalone Actions */}
                <div className="flex gap-2">
                    {/* FACEBOOK ONLY POST */}
                    <button 
                        onClick={() => handlePost(['facebook'], 'facebook')} 
                        disabled={!!postingState}
                        className="flex-1 bg-blue-600 text-white py-3 rounded-xl flex justify-center shadow-sm active:scale-95 transition-transform disabled:opacity-70" 
                        title="Post to Facebook Only"
                    >
                        {postingState === 'facebook' ? <Loader2 size={18} className="animate-spin" /> : <Facebook size={18} />}
                    </button>
                    
                    {/* INSTAGRAM ONLY POST */}
                    <button 
                        onClick={() => handlePost(['instagram'], 'instagram')} 
                        disabled={!!postingState}
                        className="flex-1 bg-pink-600 text-white py-3 rounded-xl flex justify-center shadow-sm active:scale-95 transition-transform disabled:opacity-70" 
                        title="Post to Instagram Only"
                    >
                        {postingState === 'instagram' ? <Loader2 size={18} className="animate-spin" /> : <Instagram size={18} />}
                    </button>
                    
                    {/* DOWNLOAD */}
                    <button onClick={handleDownload} className="flex-1 bg-slate-800 text-white py-3 rounded-xl flex justify-center shadow-sm active:scale-95 transition-transform" title="Download">
                        <Download size={18} />
                    </button>
                </div>
                </div>
            </div>
            </div>
        </ModalPortal>
      )}
    </div>
  )
}