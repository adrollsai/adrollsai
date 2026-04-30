'use client'

import { useState, useEffect } from 'react'
import { Filter, Download, Facebook, Instagram, X, Loader2, Globe, Film, Package, CheckCircle2, Image as ImageIcon, RefreshCw } from 'lucide-react'
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
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in ms

export default function AssetsPage() {
  const supabase = createClient()
  
  // --- STATE ---
  const [assets, setAssets] = useState<Asset[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  // Filtering State
  const [activeFilter, setActiveFilter] = useState('All')
  const [selectedPropFilter, setSelectedPropFilter] = useState<string>('all')

  // Modal State
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [isPosting, setIsPosting] = useState(false)
  const [caption, setCaption] = useState('')

  // Single Tap Download State
  const [isDownloading, setIsDownloading] = useState(false)

  // 1. SAFE FETCH WITH LOCAL CACHING
  const fetchAssets = async (force = false) => {
    try {
      if (!force && assets.length === 0) setLoading(true)
      if (force) setIsRefreshing(true)

      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) return

      const cacheKey = `assets_cache_${user.id}`
      const timeKey = `assets_time_${user.id}`
      const propCacheKey = `inventory_cache_${user.id}`

      // Check Local Cache
      if (!force) {
          const cachedData = localStorage.getItem(cacheKey)
          const lastFetch = localStorage.getItem(timeKey)
          const now = Date.now()

          if (cachedData) {
              setAssets(JSON.parse(cachedData))
              setLoading(false)
              
              // Load properties from cache so dropdown works instantly
              const cachedProps = localStorage.getItem(propCacheKey)
              if (cachedProps) setProperties(JSON.parse(cachedProps))

              if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) {
                  // If properties aren't cached locally yet, quietly fetch them
                  if (!cachedProps) {
                      const { data: propData } = await supabase.from('properties').select('id, title').eq('user_id', user.id).order('created_at', { ascending: false })
                      if (propData) setProperties(propData)
                  }
                  return; // Cache is fresh, stop here.
              }
          }
      }

      // Fetch Fresh Data
      const { data: assetData, error: assetError } = await supabase
        .from('assets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      const { data: propData } = await supabase
        .from('properties')
        .select('id, title')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (assetError) throw assetError

      if (assetData) {
        // Filter out distributed assets to keep the library clean
        const cleanAssets = assetData.filter(asset => asset.status !== 'Distributed')
        setAssets(cleanAssets)
        localStorage.setItem(cacheKey, JSON.stringify(cleanAssets))
        localStorage.setItem(timeKey, Date.now().toString())
      }
      
      if (propData) {
        setProperties(propData)
        localStorage.setItem(propCacheKey, JSON.stringify(propData))
      }

    } catch (error) {
      console.error("Fetch Error:", error)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  // Trigger fetch on mount
  useEffect(() => {
    fetchAssets()
  }, [supabase])

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
          fetchAssets(true) // Update status locally
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
          fetchAssets(true) // Update status locally
      } else { 
          alert('Error: ' + (data.error || 'Failed to post')) 
      }
    } catch (e) { 
        alert('Network error') 
    } finally { 
        setIsPosting(false) 
    }
  }

 // 4. Handle WhatsApp Share (SINGLE-TAP WITH PROXY & FALLBACK)
  const handleShareWhatsApp = async () => {
    if (!selectedAsset) return;
    const textFallback = `${caption ? caption + '\n\n' : ''}${selectedAsset.url}`;

    if (selectedAsset.type === 'video') {
         window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}`;
         return;
    }

    try {
      setIsDownloading(true);
      const proxyUrl = `/api/fetch-image?url=${encodeURIComponent(selectedAsset.url)}`;
      const response = await fetch(proxyUrl);
      
      if (!response.ok) throw new Error("Network error fetching image through proxy.");
      
      const blob = await response.blob();
      const mimeType = blob.type || 'image/jpeg';
      const ext = mimeType.split('/')[1] || 'jpg';
      const file = new File([blob], `marketing-asset.${ext}`, { type: mimeType });
      const shareData = {
          title: 'Marketing Asset',
          text: caption || '',
          files: [file]
      };
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share(shareData);
      } else {
          window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}`;
      }

    } catch (error: any) {
      console.error("Share failed:", error);
      if (error.name !== 'AbortError') {
          window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}`;
      }
    } finally {
      setIsDownloading(false);
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
        fetchAssets(true) // Update status locally
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

  // Apply active filters
  const filteredAssets = assets.filter(asset => {
    const matchesType = activeFilter === 'All' || asset.type === activeFilter;
    const matchesProp = selectedPropFilter === 'all' ||
                        (selectedPropFilter === 'unassigned' && !asset.property_id) || 
                        asset.property_id === selectedPropFilter;
    return matchesType && matchesProp;
  });

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">
      
      {/* FIXED REFRESH BUTTON */}
      <button 
          onClick={() => fetchAssets(true)}
          className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
          title="Refresh Assets"
      >
          <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
            <div>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight ml-1">Asset Library</h1>
                <p className="text-slate-500 text-sm sm:text-base mt-1 font-medium ml-1">Manage and distribute your marketing creatives</p>
            </div>
            
            <div className="hidden md:flex items-center gap-3 bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-200/60 text-sm font-medium text-slate-600">
                <ImageIcon size={18} className="text-blue-500" /> {assets.length} Total Assets
            </div>
        </div>

        {/* BUBBLY FILTER CONTROLS */}
        <div className="flex flex-col md:flex-row gap-4 mb-8 bg-white p-4 rounded-[2rem] shadow-sm border border-slate-200/60">
            
            {/* Project Filter */}
            <div className="relative w-full md:max-w-xs">
                <Package size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <select 
                    value={selectedPropFilter}
                    onChange={(e) => setSelectedPropFilter(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200/60 text-slate-700 text-sm font-bold rounded-2xl py-3.5 pl-11 pr-4 appearance-none focus:ring-4 focus:ring-blue-500/20 outline-none transition-all cursor-pointer"
                >
                    <option value="all">All Products</option>
                    <option value="unassigned">Unassigned / General</option>
                    {properties.map(p => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
            </div>

            {/* Media Type Filters */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 md:pb-0">
                {filters.map((filter) => (
                    <button 
                        key={filter} 
                        onClick={() => setActiveFilter(filter)} 
                        className={`capitalize whitespace-nowrap px-6 py-3.5 rounded-2xl text-sm font-bold transition-all ${
                            activeFilter === filter 
                            ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20' 
                            : 'bg-slate-50 text-slate-600 border border-slate-200/60 hover:bg-slate-100/80 hover:text-slate-800'
                        }`}
                    >
                        {filter === 'image' ? 'Images' : filter === 'video' ? 'Videos' : filter}
                    </button>
                ))}
            </div>
        </div>

        {/* ASSETS GRID */}
        {loading ? (
            <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 gap-4">
                <Loader2 size={32} className="animate-spin text-slate-300" />
                <p className="text-sm font-medium animate-pulse">Loading gallery...</p>
            </div>
        ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                {filteredAssets.map((asset) => (
                    <div 
                        key={asset.id} 
                        onClick={() => { 
                            setSelectedAsset(asset); 
                            setCaption(asset.caption || ''); 
                        }} 
                        className="relative aspect-square rounded-[1.5rem] sm:rounded-[2rem] overflow-hidden bg-white shadow-sm border border-slate-200/40 group cursor-pointer active:scale-95 transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
                    >
                        {asset.type === 'video' ? (
                            <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
                                <video src={asset.url} className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity" />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-transparent transition-colors">
                                    <div className="bg-white/20 backdrop-blur-md p-3 rounded-full shadow-sm">
                                        <Film className="text-white" size={24}/>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <img src={asset.url} alt="Asset" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        )}
                        
                        {/* Status Badge */}
                        <div className="absolute top-3 right-3 shadow-md">
                            {asset.status === 'Published' ? (
                                <div className="bg-emerald-500 text-white p-1 rounded-full border-2 border-white" title="Published">
                                    <CheckCircle2 size={12} strokeWidth={3} />
                                </div>
                            ) : (
                                <div className="bg-amber-400 w-3.5 h-3.5 rounded-full border-2 border-white" title="Draft / Unused" />
                            )}
                        </div>
                    </div>
                ))}
                {filteredAssets.length === 0 && (
                    <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-[2rem] border border-slate-200/60 border-dashed">
                        <ImageIcon size={48} className="text-slate-200 mb-4" />
                        <p className="text-base font-bold text-slate-600">No assets found</p>
                        <p className="text-sm font-medium mt-1">Try adjusting your filters or use the AI Creator.</p>
                    </div>
                )}
            </div>
        )}

        {/* SHARE MODAL (Responsive Bottom Sheet / Centered Card) */}
        {selectedAsset && (
            <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
                <div className="bg-white w-full max-w-lg rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
                    
                    {/* MODAL HEADER */}
                    <div className="flex justify-between items-center p-6 bg-white border-b border-slate-100 flex-shrink-0">
                        <h2 className="text-xl font-bold text-slate-900">Share Asset</h2>
                        <button onClick={() => setSelectedAsset(null)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    {/* MODAL BODY (Scrollable) */}
                    <div className="p-6 overflow-y-auto custom-scrollbar">
                        
                        {/* Media Preview */}
                        <div className="rounded-[1.5rem] overflow-hidden bg-slate-100 mb-6 border border-slate-200/60 shadow-inner">
                            {selectedAsset.type === 'video' ? (
                                <video src={selectedAsset.url} controls className="w-full max-h-[250px] object-contain bg-black" />
                            ) : (
                                <img src={selectedAsset.url} className="w-full max-h-[250px] object-contain" alt="Preview" />
                            )}
                        </div>

                        {/* Caption Area */}
                        <div className="mb-6">
                            <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Asset Caption</label>
                            <textarea 
                                value={caption} 
                                onChange={(e) => setCaption(e.target.value)} 
                                placeholder="Write a compelling caption..." 
                                className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none resize-none border border-slate-200/60 focus:border-blue-400 transition-all" 
                                rows={4} 
                            />
                        </div>

                        {/* Actions Grid */}
                        <div className="flex flex-col gap-3">
                            
                            {/* Meta Socials Grid */}
                            <div className="flex gap-3">
                                <button 
                                    onClick={handlePostFacebook} 
                                    disabled={isPosting || isDownloading} 
                                    className="flex-1 bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2] hover:text-white py-3.5 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                                >
                                    <Facebook size={18} className="currentColor" /> Facebook
                                </button>
                                <button 
                                    onClick={handlePostInstagram} 
                                    disabled={isPosting || isDownloading} 
                                    className="flex-1 bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white opacity-90 hover:opacity-100 py-3.5 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 transition-opacity shadow-sm disabled:opacity-50"
                                >
                                    <Instagram size={18} /> Instagram
                                </button>
                            </div>

                            {/* Universal Post */}
                            <button 
                                onClick={handleUniversalPost} 
                                disabled={isPosting || isDownloading} 
                                className="w-full bg-slate-900 text-white py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all disabled:opacity-50 active:scale-95"
                            >
                                {isPosting ? <Loader2 size={18} className="animate-spin" /> : <Globe size={18} />}
                                Publish Everywhere
                            </button>

                            <div className="relative py-2 flex items-center">
                                <div className="flex-grow border-t border-slate-200/80"></div>
                                <span className="flex-shrink-0 mx-4 text-xs font-bold text-slate-400 uppercase tracking-widest">or share manually</span>
                                <div className="flex-grow border-t border-slate-200/80"></div>
                            </div>

                            {/* WhatsApp Direct Share */}
                            <button 
                                onClick={handleShareWhatsApp} 
                                disabled={isPosting || isDownloading} 
                                className="w-full bg-[#25D366] hover:bg-[#1ebe57] text-white py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#25D366]/20 transition-all disabled:opacity-50 active:scale-95"
                            >
                                {isDownloading ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        <span>Preparing Asset...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                                        </svg>
                                        <span>Direct WhatsApp Share</span>
                                    </>
                                )}
                            </button>

                            {/* Download Action */}
                            <a 
                                href={selectedAsset.url} 
                                download={`asset.${selectedAsset.type === 'video' ? 'mp4' : 'png'}`} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="w-full bg-slate-50 text-slate-700 py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-100 border border-slate-200/60 transition-colors mt-2"
                            >
                                <Download size={18} /> Download High-Res File
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  )
}