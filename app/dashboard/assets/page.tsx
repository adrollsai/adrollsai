'use client'

import { useState, useEffect } from 'react'
import { Filter, Download, Facebook, Instagram, X, Loader2, Globe, Linkedin, Youtube, Film } from 'lucide-react'
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
  const [title, setTitle] = useState('') 

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
  const handlePostFacebook = async () => {
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
      if (response.ok) { alert('Successfully posted to Facebook Page!'); setSelectedAsset(null) } 
      else { alert('Error: ' + (data.error || 'Failed to post')) }
    } catch (e) { alert('Network error') } finally { setIsPosting(false) }
  }

  // 3. Handle Post to Instagram
  const handlePostInstagram = async () => {
    if (!selectedAsset) return
    setIsPosting(true)
    try {
      const response = await fetch('/api/post-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: selectedAsset.url,
          caption: caption || 'Created with AI ✨ #RealEstate'
        })
      })
      const data = await response.json()
      if (response.ok) { alert('Successfully posted to Instagram!'); setSelectedAsset(null) } 
      else { alert('Error: ' + (data.error || 'Failed to post')) }
    } catch (e) { alert('Network error') } finally { setIsPosting(false) }
  }

  // 4. Handle Post to LinkedIn
  const handlePostLinkedin = async () => {
    if (!selectedAsset) return
    setIsPosting(true)
    try {
      const response = await fetch('/api/post-linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: selectedAsset.url,
          caption: caption || 'Check this out! 🚀'
        })
      })
      const data = await response.json()
      if (response.ok) { alert('Successfully posted to LinkedIn!'); setSelectedAsset(null) } 
      else { alert('Error: ' + (data.error || 'Failed to post')) }
    } catch (e) { alert('Network error') } finally { setIsPosting(false) }
  }

  // 5. Handle Post to YouTube (Video Only)
  const handlePostYouTube = async () => {
    if (!selectedAsset) return
    
    // Prevent Image Uploads
    if (selectedAsset.type !== 'video') {
        alert("YouTube upload is only available for video assets.")
        return
    }
    
    setIsPosting(true)
    try {
        const payload = { 
            videoUrl: selectedAsset.url, 
            title: title || "New Listing Video", 
            description: caption || "Check out this amazing property! #RealEstate",
            type: 'video'
        }

        const response = await fetch('/api/post-youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        const data = await response.json()
        if (response.ok) { 
            alert('Successfully uploaded to YouTube!')
            setSelectedAsset(null) 
        } else { 
            alert('Error: ' + (data.error || 'Failed to upload')) 
        }
    } catch (e) {
        alert('Network error')
    } finally {
        setIsPosting(false)
    }
  }

  // Helper for Dimensions
  const getImageDimensions = (url: string): Promise<{ width: number, height: number, ratio: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.width, height: img.height, ratio: img.width / img.height })
      img.onerror = () => reject(new Error(`Failed to load image.`))
      img.src = url
    })
  }

  // 6. Handle Universal Post
  const handleUniversalPost = async () => {
    if (!selectedAsset) return
    setIsPosting(true)

    // Default targets
    let targets = ['facebook', 'instagram', 'linkedin', 'youtube'] 

    // FILTER: Remove YouTube if it's an Image
    if (selectedAsset.type === 'image') {
        targets = targets.filter(t => t !== 'youtube')
        console.log("Skipping YouTube for image asset in universal post.")
    }

    try {
      // Dimension Check for IG (Images only)
      if (selectedAsset.type === 'image') {
        const { ratio } = await getImageDimensions(selectedAsset.url)
        const isIgSafe = ratio >= 0.8 && ratio <= 1.91
        
        if (!isIgSafe) {
          const proceed = confirm(`⚠️ DIMENSION WARNING\n\nAspect Ratio: ${ratio.toFixed(2)}.\nInstagram Feed supports 0.8 to 1.91.\n\nSkip Instagram and post to others?`)
          if (proceed) { targets = targets.filter(t => t !== 'instagram') } 
          else { setIsPosting(false); return }
        }
      }

      const response = await fetch('/api/post-universal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: selectedAsset.url, 
          caption: caption || 'Automated Post via AdRolls AI 🚀',
          title: title || 'New Asset', 
          type: selectedAsset.type,
          platforms: targets
        })
      })

      const data = await response.json()
      
      if (response.ok) {
        alert(`Broadcast Complete! \n\n${JSON.stringify(data.results, null, 2)}`)
        setSelectedAsset(null)
      } else {
        alert('Partial Error: ' + JSON.stringify(data))
      }

    } catch (error: any) {
      console.error(error)
      alert(error.message || 'Failed.')
    } finally {
      setIsPosting(false)
    }
  }

  const filteredAssets = activeFilter === 'All' ? assets : assets.filter(asset => asset.type === activeFilter)

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen relative">
      <div className="flex justify-between items-end mb-5">
        <div><h1 className="text-2xl font-bold text-slate-900">Library</h1><p className="text-slate-500 text-xs mt-1">Your marketing assets</p></div>
        <div className="p-2.5 bg-white text-slate-700 rounded-full shadow-sm border border-slate-100"><Filter size={18} /></div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-5 -mx-5 px-5 scrollbar-hide">
        {filters.map((filter) => (
          <button key={filter} onClick={() => setActiveFilter(filter)} className={`capitalize whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all border ${activeFilter === filter ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>{filter === 'image' ? 'Images' : filter === 'video' ? 'Videos' : filter}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 mb-24">
          {filteredAssets.map((asset) => (
            <div key={asset.id} onClick={() => { setSelectedAsset(asset); setTitle(''); setCaption(''); }} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group cursor-pointer active:scale-95 transition-transform">
              {asset.type === 'video' ? (
                  <div className="w-full h-full bg-slate-800 flex items-center justify-center relative">
                      <video src={asset.url} className="w-full h-full object-cover opacity-80" />
                      <div className="absolute inset-0 flex items-center justify-center"><Film className="text-white opacity-50" size={24}/></div>
                  </div>
              ) : (
                  <img src={asset.url} alt="Asset" className="w-full h-full object-cover" />
              )}
              <div className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-white ${asset.status === 'Published' ? 'bg-green-400' : 'bg-amber-400'}`} />
            </div>
          ))}
        </div>
      )}

      {selectedAsset && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-5 shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-800">Share Asset</h2>
              <button onClick={() => setSelectedAsset(null)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={20} /></button>
            </div>

            <div className="rounded-2xl overflow-hidden bg-slate-100 mb-4 border border-slate-100">
               {selectedAsset.type === 'video' ? (
                   <video src={selectedAsset.url} controls className="w-full max-h-[300px] object-contain bg-black" />
               ) : (
                   <img src={selectedAsset.url} className="w-full max-h-[300px] object-contain" alt="Preview" />
               )}
            </div>

            {/* Title Input (Only for Videos now) */}
            {selectedAsset.type === 'video' && (
                <div className="mb-3">
                    <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Video Title (YouTube)</label>
                    <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Video Title..." className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" />
                </div>
            )}

            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Caption / Description</label>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption..." className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none resize-none" rows={2} />
            </div>

            <div className="flex flex-col gap-3">
               {/* Socials Grid */}
               <div className="flex gap-2">
                 <button onClick={handlePostFacebook} disabled={isPosting} className="flex-1 bg-[#1877F2] text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#166fe5]">
                   {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Facebook size={16} fill="white" />}
                 </button>
                 <button onClick={handlePostInstagram} disabled={isPosting} className="flex-1 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90">
                   {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Instagram size={16} />}
                 </button>
                 <button onClick={handlePostLinkedin} disabled={isPosting} className="flex-1 bg-[#0077b5] text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#006097]">
                   {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Linkedin size={16} fill="white" />}
                 </button>
               </div>

                {/* YouTube Button (Video Only) */}
               {selectedAsset.type === 'video' && (
                   <button onClick={handlePostYouTube} disabled={isPosting} className="w-full bg-[#FF0000] text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-600">
                        {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Youtube size={16} fill="white" />}
                        Upload to YouTube
                   </button>
               )}

               <button onClick={handleUniversalPost} disabled={isPosting} className="w-full bg-slate-800 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-200 hover:bg-slate-900">
                 {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                 Post Everywhere
               </button>

               <a href={selectedAsset.url} download={`asset.${selectedAsset.type === 'video' ? 'mp4' : 'png'}`} target="_blank" rel="noopener noreferrer" className="w-full bg-slate-100 text-slate-700 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors">
                 <Download size={14} /> Download High-Res
               </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}