'use client'

import { useState, useEffect } from 'react'
import { Filter, Download, Facebook, Instagram, X, Loader2, Globe, Film, Package } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type Asset = {
  id: string
  type: 'image' | 'video'
  status: string
  url: string
  property_id?: string
  caption?: string
}

type Property = {
  id: string
  title: string
}

const filters = ['All', 'image', 'video']

export default function AssetsPage() {
  const supabase = createClient()
  const [assets, setAssets] = useState<Asset[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  
  // Filtering State
  const [activeFilter, setActiveFilter] = useState('All')
  const [selectedPropFilter, setSelectedPropFilter] = useState<string>('all')

  // Modal State
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [isPosting, setIsPosting] = useState(false)
  const [caption, setCaption] = useState('')

  // 1. Fetch Assets & Properties
  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Fetch Assets
      const { data: assetData } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      // Fetch Properties for the filter dropdown
      const { data: propData } = await supabase
        .from('properties')
        .select('id, title')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (assetData) {
        const cleanAssets = assetData.filter(asset => asset.status !== 'Distributed')
        setAssets(cleanAssets)
      }
      
      if (propData) {
        setProperties(propData)
      }
      
      setLoading(false)
    }
    fetchData()
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
      if (response.ok) { 
          alert('Successfully posted to Facebook Page!')
          setSelectedAsset(null) 
      } else { 
          alert('Error: ' + (data.error || 'Failed to post')) 
      }
    } catch (e) { 
        alert('Network error') 
    } finally { 
        setIsPosting(false) 
    }
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
      if (response.ok) { 
          alert('Successfully posted to Instagram!')
          setSelectedAsset(null) 
      } else { 
          alert('Error: ' + (data.error || 'Failed to post')) 
      }
    } catch (e) { 
        alert('Network error') 
    } finally { 
        setIsPosting(false) 
    }
  }

  // 4. Handle WhatsApp Share (FILE SHARE API)
  const handleShareWhatsApp = async () => {
    if (!selectedAsset) return;

    // Convert image URL to a File Object to share the actual image payload
    if (selectedAsset.type === 'image') {
      try {
        setIsPosting(true);
        // Fetch the image data
        const response = await fetch(selectedAsset.url);
        const blob = await response.blob();
        
        // Create a File object from the blob
        const file = new File([blob], 'marketing-asset.png', { type: blob.type });

        // Native Web Share API (Passes physical file to OS Share Sheet -> WhatsApp)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Marketing Asset',
            text: caption || ''
          });
        } else {
           // Fallback for Desktop/Unsupported browsers: Share link text
           const textToShare = `${caption ? caption + '\n\n' : ''}${selectedAsset.url}`;
           window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(textToShare)}`, '_blank');
        }
      } catch (error) {
        console.error("Error sharing image:", error);
        alert("Direct image sharing failed. Try downloading it first.");
      } finally {
        setIsPosting(false);
      }
    } else {
      // For videos, browser sharing API often fails due to size limits, fallback to link
      const textToShare = `${caption ? caption + '\n\n' : ''}${selectedAsset.url}`;
      window.open(`whatsapp://send?text=${encodeURIComponent(textToShare)}`, '_blank');
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

  // 5. Handle Universal Post
  const handleUniversalPost = async () => {
    if (!selectedAsset) return
    setIsPosting(true)

    let targets = ['facebook', 'instagram'] 

    try {
      if (selectedAsset.type === 'image') {
        const { ratio } = await getImageDimensions(selectedAsset.url)
        const isIgSafe = ratio >= 0.8 && ratio <= 1.91
        
        if (!isIgSafe) {
          const proceed = confirm(`⚠️ DIMENSION WARNING\n\nAspect Ratio: ${ratio.toFixed(2)}.\nInstagram Feed supports 0.8 to 1.91.\n\nSkip Instagram and post to Facebook only?`)
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

  const filteredAssets = assets.filter(asset => {
    const matchesType = activeFilter === 'All' || asset.type === activeFilter;
    const matchesProp = selectedPropFilter === 'all' || 
                        (selectedPropFilter === 'unassigned' && !asset.property_id) || 
                        asset.property_id === selectedPropFilter;
    return matchesType && matchesProp;
  });

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen relative pb-24">
      <div className="flex justify-between items-end mb-5">
        <div><h1 className="text-2xl font-bold text-slate-900">Library</h1><p className="text-slate-500 text-xs mt-1">Your marketing assets</p></div>
        <div className="p-2.5 bg-white text-slate-700 rounded-full shadow-sm border border-slate-100"><Filter size={18} /></div>
      </div>

      {/* FILTER CONTROLS */}
      <div className="flex flex-col gap-3 mb-5">
          <div className="relative w-full">
             <Package size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
             <select 
                value={selectedPropFilter}
                onChange={(e) => setSelectedPropFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-xl py-2.5 pl-9 pr-4 appearance-none focus:ring-2 focus:ring-primary outline-none shadow-sm"
             >
                <option value="all">All Products</option>
                <option value="unassigned">Unassigned / General</option>
                {properties.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                ))}
             </select>
          </div>

          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {filters.map((filter) => (
              <button 
                key={filter} 
                onClick={() => setActiveFilter(filter)} 
                className={`capitalize whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all border ${activeFilter === filter ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
              >
                {filter === 'image' ? 'Images' : filter === 'video' ? 'Videos' : filter}
              </button>
            ))}
          </div>
      </div>

      {/* ASSETS GRID */}
      {loading ? (
        <div className="flex justify-center py-20 text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 mb-24">
          {filteredAssets.map((asset) => (
            <div 
                key={asset.id} 
                onClick={() => { 
                    setSelectedAsset(asset); 
                    setCaption(asset.caption || ''); 
                }} 
                className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group cursor-pointer active:scale-95 transition-transform"
            >
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
          {filteredAssets.length === 0 && (
              <div className="col-span-3 text-center py-10 text-slate-400 text-sm">
                  No assets found for this selection.
              </div>
          )}
        </div>
      )}

      {/* SHARE MODAL */}
      {selectedAsset && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col overflow-hidden">
            
            {/* FIXED HEADER */}
            <div className="flex justify-between items-center p-5 bg-white border-b border-slate-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-800">Share Asset</h2>
              <button onClick={() => setSelectedAsset(null)} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* SCROLLABLE BODY */}
            <div className="p-5 overflow-y-auto">
              <div className="rounded-2xl overflow-hidden bg-slate-100 mb-4 border border-slate-100">
                {selectedAsset.type === 'video' ? (
                    <video src={selectedAsset.url} controls className="w-full max-h-[300px] object-contain bg-black" />
                ) : (
                    <img src={selectedAsset.url} className="w-full max-h-[300px] object-contain" alt="Preview" />
                )}
              </div>

              <div className="mb-4">
                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Caption / Description</label>
                <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption..." className="w-full bg-slate-50 p-3 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none resize-none" rows={10} />
              </div>

              <div className="flex flex-col gap-3">
                {/* Socials Grid */}
                <div className="flex gap-2">
                  <button onClick={handlePostFacebook} disabled={isPosting} className="flex-1 bg-[#1877F2] text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#166fe5]">
                    {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Facebook size={16} fill="white" />}
                    Facebook
                  </button>
                  <button onClick={handlePostInstagram} disabled={isPosting} className="flex-1 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90">
                    {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Instagram size={16} />}
                    Instagram
                  </button>
                </div>

                {/* Post Everywhere Toggle */}
                <button onClick={handleUniversalPost} disabled={isPosting} className="w-full bg-slate-800 text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-200 hover:bg-slate-900">
                  {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                  Post Everywhere (FB & IG)
                </button>

                {/* WhatsApp Button */}
                <button onClick={handleShareWhatsApp} disabled={isPosting} className="w-full bg-[#25D366] text-white py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-100 hover:bg-[#1ebe57]">
                  {isPosting ? <Loader2 size={14} className="animate-spin" /> : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                    </svg>
                  )}
                  Share to WhatsApp
                </button>

                <a href={selectedAsset.url} download={`asset.${selectedAsset.type === 'video' ? 'mp4' : 'png'}`} target="_blank" rel="noopener noreferrer" className="w-full bg-slate-100 text-slate-700 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors">
                  <Download size={14} /> Download High-Res
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}