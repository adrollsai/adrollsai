'use client'

import { useState, useEffect } from 'react'
import { Filter, Download, Facebook, Instagram, Sparkles, X, Loader2, Globe, Film, Package, CheckCircle2, Image as ImageIcon, RefreshCw, Maximize2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import ImagePreviewModal from '@/components/ImagePreviewModal'
import { toast } from 'sonner'

type Asset = {
    id: string
    type: 'image' | 'video'
    status: string
    url: string
    property_id?: string
    master_creative_id?: string
    caption?: string
}

type Property = {
    id: string
    title: string
}

const filters = ['All', 'image', 'video', 'Campaign Ready']

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
    const [userRole, setUserRole] = useState<string | null>(null)

    // Single Tap Download State
    const [isDownloading, setIsDownloading] = useState(false)

    // Image Preview Modal
    const [previewImage, setPreviewImage] = useState<{ isOpen: boolean, url: string, title: string }>({ isOpen: false, url: '', title: '' })

    // 1. SAFE FETCH WITH LOCAL CACHING
    const fetchAssets = async (force = false) => {
        try {
            if (!force && assets.length === 0) setLoading(true)
            if (force) setIsRefreshing(true)

            // 1. Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser()
            if (userError || !user) return

            // Fetch profile to check role and parent_id
            const { data: profile } = await supabase.from('profiles').select('role, parent_id').eq('id', user.id).single()
            if (profile) setUserRole(profile.role)

            const targetUserId = (profile?.role === 'agent' && profile?.parent_id) ? profile.parent_id : user.id

            // 2. Fetch assets for the organization (Admin's user_id)
            const { data: assetData, error: assetError } = await supabase
                .from('assets')
                .select('*')
                .eq('user_id', targetUserId)
                .order('created_at', { ascending: false })

            const { data: propData } = await supabase
                .from('properties')
                .select('id, title')
                .eq('user_id', targetUserId)
                .order('created_at', { ascending: false })

            if (assetError) throw assetError

            if (assetData) {
                // Filter out distributed assets to keep the library clean
                const cleanAssets = assetData.filter(asset => asset.status !== 'Distributed')
                setAssets(cleanAssets)
            }

            if (propData) {
                setProperties(propData)
            }

            // Removed redundant profile fetch as it's now done at the start of fetchAssets

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

        console.log("🟢 WhatsApp Share triggered for:", selectedAsset.url);
        const textFallback = `${caption ? caption + '\n\n' : ''}${selectedAsset.url}`;

        // Video fallback (WhatsApp API doesn't support direct video file sharing via link)
        if (selectedAsset.type === 'video') {
            console.log("📹 Video detected, using link sharing...");
            window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}`;
            return;
        }

        const sharePromise = async () => {
            setIsDownloading(true);
            try {
                // 1. Fetch the image file
                const proxyUrl = `/api/fetch-image?url=${encodeURIComponent(selectedAsset.url)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error("Failed to fetch image for sharing.");

                const blob = await response.blob();
                const mimeType = blob.type || 'image/jpeg';
                const ext = mimeType.split('/')[1] || 'jpg';
                const file = new File([blob], `marketing-asset-${Date.now()}.${ext}`, { type: mimeType });

                const shareData = {
                    title: 'Marketing Asset',
                    text: caption || '',
                    files: [file]
                };

                // 2. Try to share the ACTUAL FILE
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    console.log("📱 Sharing actual file via native share sheet...");
                    await navigator.share(shareData);
                    return "Shared successfully!";
                } else {
                    // 3. Fallback to link if file sharing is unsupported
                    console.warn("⚠️ File sharing not supported on this browser/platform. Falling back to link...");
                    window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}`;
                    return "Shared via link (File sharing unsupported on desktop)";
                }

            } catch (error: any) {
                console.error("❌ Share failed:", error);
                if (error.name !== 'AbortError') {
                    // Last resort fallback
                    window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}`;
                    return "Shared via link due to error";
                }
                throw error;
            } finally {
                setIsDownloading(false);
            }
        };

        toast.promise(sharePromise(), {
            loading: 'Downloading image for WhatsApp...',
            success: (msg) => msg,
            error: 'Could not prepare image for sharing.'
        });
    }

    // Helper for Dimensions
    const getImageDimensions = (url: string): Promise<{ width: number, height: number, ratio: number }> => {
        return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => resolve({ width: img.width, height: img.height, ratio: img.width / img.height })
            img.onerror = () => reject(new Error(`Failed to load image.`))
            img.src = fixR2Url(url)
        })
    }

    // Helper: Fix R2 URL structure if bucket name is missing
    const fixR2Url = (url: string) => {
        if (!url) return ''
        if (url.includes('.r2.dev') && !url.includes('/adrolls-storage/')) {
            return url.replace('.r2.dev/', '.r2.dev/adrolls-storage/')
        }
        return url
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

    const handleDownload = async () => {
        if (!selectedAsset) return;

        // 1. Platform Detection
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        console.log("💾 Download triggered. Platform: ", isMobile ? "Mobile" : "Desktop");

        const downloadPromise = async () => {
            setIsDownloading(true);
            try {
                // Fetch the file through our proxy to handle CORS
                const proxyUrl = `/api/fetch-image?url=${encodeURIComponent(selectedAsset.url)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error("Failed to fetch asset file.");

                const blob = await response.blob();
                const mimeType = blob.type || (selectedAsset.type === 'video' ? 'video/mp4' : 'image/png');
                const ext = mimeType.split('/')[1] || (selectedAsset.type === 'video' ? 'mp4' : 'png');
                const fileName = `adrolls-asset-${Date.now()}.${ext}`;
                const file = new File([blob], fileName, { type: mimeType });

                // 2. Platform-Specific Logic
                // On Mobile/PWA: Use Share API to allow "Save to Photos"
                // On Desktop: Use traditional download to avoid "User Gesture" errors and share sheet confusion
                if (isMobile && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        console.log("📱 Mobile detected, using Share API...");
                        await navigator.share({
                            files: [file],
                            title: 'Save Asset',
                            text: 'Save this to your device'
                        });
                        return "Share menu opened!";
                    } catch (shareError: any) {
                        // If sharing was cancelled or failed (e.g. gesture lost), fallback to direct download
                        if (shareError.name === 'NotAllowedError' || shareError.name === 'AbortError') {
                            console.warn("Share failed or was blocked, falling back to direct download...");
                            triggerBlobDownload(blob, fileName);
                            return "Download started!";
                        }
                        throw shareError;
                    }
                } else {
                    // Desktop or Share API not supported
                    console.log("💻 Desktop/Standard environment, using blob download...");
                    triggerBlobDownload(blob, fileName);
                    return "Download started!";
                }
            } catch (error: any) {
                console.error("❌ Download Error:", error);
                throw error;
            } finally {
                setIsDownloading(false);
            }
        };

        // Helper to trigger the actual download
        const triggerBlobDownload = (blob: Blob, fileName: string) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }, 100);
        };

        toast.promise(downloadPromise(), {
            loading: 'Preparing high-res file...',
            success: (msg) => msg,
            error: 'Failed to download asset.'
        });
    }

    // Apply active filters
    const filteredAssets = assets.filter(asset => {
        let matchesType = activeFilter === 'All' || asset.type === activeFilter;
        if (activeFilter === 'Campaign Ready') matchesType = !!asset.master_creative_id;

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
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </div>
                    </div>

                    {/* Media Type Filters */}
                    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 md:pb-0">
                        {filters.map((filter) => (
                            <button
                                key={filter}
                                onClick={() => setActiveFilter(filter)}
                                className={`capitalize whitespace-nowrap px-6 py-3.5 rounded-2xl text-sm font-bold transition-all ${activeFilter === filter
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
                ) : activeFilter === 'Campaign Ready' ? (
                    <div className="space-y-8">
                        {Array.from(new Set(filteredAssets.map(a => a.master_creative_id).filter(id => !!id))).map(batchId => {
                            const batchAssets = filteredAssets.filter(a => a.master_creative_id === batchId);
                            const sampleAsset = batchAssets[0];
                            const property = properties.find(p => p.id === sampleAsset.property_id);
                            
                            // Create a readable label from the first asset's date
                            const batchDate = (sampleAsset as any).created_at ? new Date((sampleAsset as any).created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Recent';
                            
                            return (
                                <div key={batchId} className="bg-white rounded-[2.5rem] p-8 border border-slate-200/60 shadow-sm">
                                    <div className="flex justify-between items-center mb-6">
                                        <div>
                                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                                <Sparkles size={20} className="text-yellow-500" /> {property?.title || 'Creative Group'}
                                            </h3>
                                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-tighter bg-blue-50 px-2 py-0.5 rounded-md inline-block mt-1">Batch ID: {batchId?.slice(-6).toUpperCase()}</p>
                                            <span className="text-[10px] text-slate-400 font-bold ml-2 uppercase">{batchDate}</span>
                                        </div>
                                        <div className="bg-slate-900 text-white px-4 py-2 rounded-full text-xs font-bold">
                                            {batchAssets.length} Variations
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                                        {batchAssets.map((asset) => (
                                            <div
                                                key={asset.id}
                                                className="relative aspect-square rounded-[1.5rem] overflow-hidden bg-slate-50 border border-slate-200/40 group cursor-pointer active:scale-95 transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
                                            >
                                                <img src={fixR2Url(asset.url)} alt="Asset" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                    <div className="flex gap-2">
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setPreviewImage({ isOpen: true, url: asset.url, title: property?.title || 'Asset Preview' });
                                                            }}
                                                            className="bg-white/90 backdrop-blur-sm p-2 rounded-full text-slate-900 shadow-xl hover:bg-white transition-all"
                                                        >
                                                            <Maximize2 size={18} />
                                                        </button>
                                    {userRole !== 'agent' && (
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedAsset(asset);
                                                setCaption(asset.caption || '');
                                            }}
                                            className="bg-white/90 backdrop-blur-sm p-2 rounded-full text-blue-600 shadow-xl hover:bg-white transition-all"
                                        >
                                            <Globe size={18} />
                                        </button>
                                    )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                        {filteredAssets.length === 0 && (
                            <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-[2rem] border border-slate-200/60 border-dashed">
                                <ImageIcon size={48} className="text-slate-200 mb-4" />
                                <p className="text-base font-bold text-slate-600">No Campaign Ready groups found</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
                        {filteredAssets.map((asset) => (
                            <div
                                key={asset.id}
                                className="relative aspect-square rounded-[1.5rem] sm:rounded-[2rem] overflow-hidden bg-white shadow-sm border border-slate-200/40 group cursor-pointer active:scale-95 transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
                            >
                                {asset.type === 'video' ? (
                                    <div className="w-full h-full bg-slate-900 flex items-center justify-center relative">
                                        <video src={asset.url} className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity" />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-transparent transition-colors">
                                            <div className="bg-white/20 backdrop-blur-md p-3 rounded-full shadow-sm">
                                                <Film className="text-white" size={24} />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <img src={fixR2Url(asset.url)} alt="Asset" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                )}

                                {/* Overlay Actions */}
                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setPreviewImage({ isOpen: true, url: asset.url, title: 'Asset Preview' });
                                            }}
                                            className="bg-white p-3 rounded-full text-slate-900 shadow-xl hover:scale-110 transition-all"
                                        >
                                            <Maximize2 size={20} />
                                        </button>
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedAsset(asset);
                                                setCaption(asset.caption || '');
                                            }}
                                            className="bg-white p-3 rounded-full text-blue-600 shadow-xl hover:scale-110 transition-all"
                                        >
                                            <Globe size={20} />
                                        </button>
                                    </div>
                                </div>

                                {/* Status Badge */}
                                <div className="absolute top-4 right-4 shadow-md z-10">
                                    {asset.status === 'Published' ? (
                                        <div className="bg-emerald-500 text-white p-1.5 rounded-full border-2 border-white" title="Published">
                                            <CheckCircle2 size={14} strokeWidth={3} />
                                        </div>
                                    ) : (
                                        <div className="bg-amber-400 w-4 h-4 rounded-full border-2 border-white" title="Draft / Unused" />
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
                                        <img src={fixR2Url(selectedAsset.url)} className="w-full max-h-[250px] object-contain" alt="Preview" />
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
                                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                                                </svg>
                                                <span>Direct WhatsApp Share</span>
                                            </>
                                        )}
                                    </button>

                                    {/* Download Action */}
                                    <button
                                        onClick={handleDownload}
                                        disabled={isPosting || isDownloading}
                                        className="w-full bg-slate-50 text-slate-700 py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-100 border border-slate-200/60 transition-colors mt-2 active:scale-95 disabled:opacity-50"
                                    >
                                        {isDownloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                        {isDownloading ? 'Downloading...' : 'Download High-Res File'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <ImagePreviewModal 
                isOpen={previewImage.isOpen} 
                onClose={() => setPreviewImage(prev => ({ ...prev, isOpen: false }))} 
                imageUrl={previewImage.url} 
                title={previewImage.title} 
            />
        </div>
    )
}