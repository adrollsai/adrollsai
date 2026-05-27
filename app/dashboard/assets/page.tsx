'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Filter, Download, Facebook, Instagram, Linkedin, Sparkles, X, Loader2, Globe, Film, Package, CheckCircle2, Image as ImageIcon, RefreshCw, Maximize2, Check, Trash2, Upload, Copy } from 'lucide-react'
import JSZip from 'jszip'
import { analyzeMediaAction } from './actions'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/utils/supabase/client'
import { uploadToR2 } from '@/utils/upload-helper'
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
    created_at?: string
    metadata?: any
}

type Property = {
    id: string
    title: string
}

const filters = ['All', 'image', 'video', 'Campaign Ready']

export default function AssetsPage() {
    const supabase = createClient()
    const router = useRouter()

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

    // AI Captions State for Share Modal
    const [headline, setHeadline] = useState('')
    const [primaryText, setPrimaryText] = useState('')
    const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false)

    useEffect(() => {
        if (!selectedAsset) {
            setHeadline('');
            setPrimaryText('');
        }
    }, [selectedAsset])

    const handleGenerateAICaptions = async () => {
        if (!selectedAsset) return;
        setIsGeneratingCaptions(true);

        const generatePromise = async () => {
            try {
                const response = await fetch('/api/assets/generate-caption', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: selectedAsset.url,
                        type: selectedAsset.type
                    })
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Failed to generate captions.");

                if (data.success && data.captions) {
                    setCaption(data.captions.social_post_description || '');
                    setHeadline(data.captions.headline || '');
                    setPrimaryText(data.captions.primary_text || '');
                    return "AI Captions generated successfully!";
                } else {
                    throw new Error("No captions returned from AI.");
                }
            } catch (err: any) {
                console.error("AI Caption generation failed:", err);
                throw err;
            } finally {
                setIsGeneratingCaptions(false);
            }
        };

        toast.promise(generatePromise(), {
            loading: 'AI is analyzing your media to write copy...',
            success: (msg) => msg,
            error: (err) => `Failed: ${err.message}`
        });
    };

    // Image Preview Modal
    const [previewImage, setPreviewImage] = useState<{ isOpen: boolean, url: string, title: string, type?: 'image' | 'video' }>({ isOpen: false, url: '', title: '', type: 'image' })

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [isZipping, setIsZipping] = useState(false)

    // Direct Post Upload State
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [directPostData, setDirectPostData] = useState<{
        file: File | null;
        previewUrl: string | null;
        caption: string;
        headline: string;
        selectedPlatforms: ('facebook' | 'instagram' | 'whatsapp')[];
    } | null>(null);
    const [isUploading, setIsUploading] = useState(false);

    // 1. SAFE FETCH WITH LOCAL CACHING
    const fetchAssets = async (force = false) => {
        try {
            if (!force && assets.length === 0) setLoading(true)
            if (force) setIsRefreshing(true)

            // 1. Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser()
            if (userError || !user) return

            // Fetch profile to check role and parent_id
            const { data: profile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single()
            if (profile) setUserRole(profile.role)

            const urlParams = new URLSearchParams(window.location.search)
            const impersonateId = urlParams.get('impersonate')

            let targetUserId = user.id
            if (['admin', 'agent'].includes(profile?.role || '') && (profile?.parent_id || profile?.agency_id)) {
                targetUserId = (profile?.parent_id || profile?.agency_id) as string
            }

            // Impersonation Logic
            if (impersonateId && (['super_admin', 'agency', 'admin', 'agent'].includes(profile?.role || ''))) {
                if (profile?.role !== 'super_admin') {
                    const { data: subAccount } = await supabase
                        .from('profiles')
                        .select('id')
                        .eq('id', impersonateId)
                        .eq('agency_id', user.id)
                        .single()
                    if (subAccount) targetUserId = impersonateId
                } else {
                    targetUserId = impersonateId
                }
            }

            // 2. Fetch assets for the organization securely via server API
            const response = await fetch(`/api/assets${impersonateId ? `?impersonate=${impersonateId}` : ''}`)
            const assetData = await response.json()
            if (assetData.error) throw new Error(assetData.error)

            const { data: propData } = await supabase
                .from('properties')
                .select('id, title')
                .eq('user_id', targetUserId)
                .order('created_at', { ascending: false })

            if (assetData && Array.isArray(assetData)) {
                // Filter out distributed assets to keep the library clean
                const cleanAssets = (assetData as Asset[]).filter((asset: Asset) => asset.status !== 'Distributed')
                
                // Sort active 'Processing' or 'Rendering' tasks to the very top, preserving created_at order for the rest
                const sortedAssets = [...cleanAssets].sort((a, b) => {
                    const aActive = ['Processing', 'Rendering'].includes(a.status);
                    const bActive = ['Processing', 'Rendering'].includes(b.status);
                    
                    if (aActive && !bActive) return -1;
                    if (!aActive && bActive) return 1;
                    
                    // If both are active or both are inactive, maintain original order (chronological desc by created_at)
                    return 0;
                });
                
                setAssets(sortedAssets)
            }

            if (propData) {
                setProperties(propData)
            }

            // Cleanup stuck assets in background
            fetch('/api/assets/cleanup', { method: 'POST' }).catch(e => console.error("Cleanup trigger failed", e));

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

    // Background polling for assets that are still in "Processing" or "Rendering" state
    useEffect(() => {
        const hasActiveTasks = assets.some(asset => ['Processing', 'Rendering'].includes(asset.status))
        if (!hasActiveTasks) return

        const interval = setInterval(async () => {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const impersonateId = urlParams.get('impersonate');
                const syncUrl = impersonateId ? `/api/video/sync?impersonate=${impersonateId}` : '/api/video/sync';

                // Proactively trigger self-healing sync in case webhook callback failed (e.g. ngrok tunnel down)
                await fetch(syncUrl, { method: 'POST' });
            } catch (err) {
                console.error("[Assets Polling] Active video tasks sync failed:", err);
            }
            fetchAssets(true) // force refresh in background
        }, 8000) // Poll every 8 seconds for active rendering/processing

        return () => clearInterval(interval)
    }, [assets])

    // 2. Handle Post to Facebook
    const handlePostFacebook = async () => {
        if (!selectedAsset) return
        setIsPosting(true)
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        try {
            const response = await fetch(`/api/post-social${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
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
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        try {
            const response = await fetch(`/api/post-instagram${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
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

    // 3.5 Handle Post to LinkedIn
    const handlePostLinkedin = async () => {
        if (!selectedAsset) return
        setIsPosting(true)
        const urlParams = new URLSearchParams(window.location.search)
        const impersonateId = urlParams.get('impersonate')
        try {
            const response = await fetch(`/api/post/linkedin${impersonateId ? `?impersonate=${impersonateId}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assetUrl: selectedAsset.url,
                    text: caption || 'Shared via AdRolls AI Professional 🚀',
                    type: selectedAsset.type
                })
            })
            const data = await response.json()
            if (response.ok) {
                toast.success('Successfully posted to LinkedIn!')
                setSelectedAsset(null)
                fetchAssets(true)
            } else {
                toast.error('LinkedIn Error: ' + (data.error || 'Failed to post'))
            }
        } catch (e) {
            toast.error('Network error connecting to LinkedIn')
        } finally {
            setIsPosting(false)
        }
    }

    // 4. Handle Delete Asset
    const handleDeleteAsset = async (id: string) => {
        if (!confirm('Are you sure you want to delete this asset? This cannot be undone.')) return;
        
        try {
            const { error } = await supabase.from('assets').delete().eq('id', id);
            if (error) throw error;
            toast.success('Asset deleted successfully');
            setAssets(prev => prev.filter(a => a.id !== id));
        } catch (e: any) {
            toast.error('Delete failed: ' + e.message);
        }
    }

    // Direct Upload Analysis
    const handleDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const previewUrl = URL.createObjectURL(file);
        setDirectPostData({
            file,
            previewUrl,
            caption: "",
            headline: "",
            selectedPlatforms: ['facebook']
        });
    };
    
    const handleLibraryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsUploading(true);
        const uploadPromises = Array.from(files).map(async (file) => {
            try {
                // 1. Get current user for ownerId
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) throw new Error("Authentication required");

                // Check role for targetUserId resolution
                const { data: profile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
                let targetUserId = user.id;
                if (['admin', 'agent'].includes(profile?.role || '') && (profile?.parent_id || profile?.agency_id)) {
                    targetUserId = (profile?.parent_id || profile?.agency_id) as string;
                }

                // 2. Upload to Cloudflare R2
                const publicUrl = await uploadToR2(file, 'library');

                // 3. Insert into assets table
                const { data: insertedAsset, error: insertError } = await supabase
                    .from('assets')
                    .insert({
                        user_id: targetUserId,
                        type: file.type.startsWith('video') ? 'video' : 'image',
                        url: publicUrl,
                        status: 'Ready',
                        caption: `Uploaded: ${file.name}`
                    })
                    .select()
                    .single();

                if (insertError) throw insertError;
                return insertedAsset as Asset;
            } catch (err: any) {
                console.error("Upload error:", err);
                toast.error(`Failed to upload ${file.name}: ${err.message}`);
                return null;
            }
        });

        const results = await Promise.all(uploadPromises);
        const uploadedAssets = results.filter((item): item is Asset => !!item);
        
        if (uploadedAssets.length > 0) {
            toast.success(`Successfully uploaded ${uploadedAssets.length} assets!`);
            await fetchAssets(true); // Refresh library
            
            // Automatically open sharing modal for the first newly uploaded asset
            const newAsset = uploadedAssets[0];
            setSelectedAsset(newAsset);
            setCaption(newAsset.caption || '');
        }
        
        setIsUploading(false);
        // Clear input
        e.target.value = '';
    };

    const runAIAnalysis = async () => {
        if (!directPostData?.file) return;
        const file = directPostData.file;

        const uploadPromise = async () => {
            setIsAnalyzing(true);
            try {
                let mediaUrl = "";
                // Direct-to-R2 Upload
                const signRes = await fetch('/api/upload/sign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileName: file.name,
                        fileType: file.type,
                        folder: 'temp/direct-post'
                    })
                });

                if (!signRes.ok) throw new Error("Failed to get secure upload link.");
                const { signedUrl, publicUrl } = await signRes.json();

                const uploadRes = await fetch(signedUrl, {
                    method: 'PUT',
                    body: file,
                    headers: { 'Content-Type': file.type }
                });

                if (!uploadRes.ok) throw new Error("Cloud upload failed.");
                mediaUrl = publicUrl;

                const data = await analyzeMediaAction(mediaUrl);
                if (!data.success) throw new Error(data.error || "AI analysis failed.");

                setDirectPostData({
                    ...directPostData,
                    caption: data.variation.primary_text || "",
                    headline: data.variation.headline || "",
                });

                return "AI Analysis Complete!";
            } catch (error: any) {
                console.error("Analysis error:", error);
                throw error;
            } finally {
                setIsAnalyzing(false);
            }
        };

        toast.promise(uploadPromise(), {
            loading: `Analyzing ${file.type.split('/')[0]}...`,
            success: (msg) => msg,
            error: (err) => err.message
        });
    };

    // Direct Post Finalization
    const handleDirectPostSubmit = async () => {
        if (!directPostData || !directPostData.file) return;
        
        // Handle WhatsApp separately via Share API if selected
        if (directPostData.selectedPlatforms.includes('whatsapp')) {
            try {
                if (navigator.share && directPostData.file) {
                    await navigator.share({
                        title: directPostData.headline,
                        text: directPostData.caption,
                        files: [directPostData.file]
                    });
                } else {
                    // Fallback for desktop or non-supported
                    toast.info("Opening WhatsApp for sharing...");
                    window.open(`https://wa.me/?text=${encodeURIComponent(directPostData.caption)}`, '_blank');
                }
            } catch (e) {
                console.warn("Share failed:", e);
            }
            
            // If only WhatsApp was selected, we're done
            if (directPostData.selectedPlatforms.length === 1) {
                setDirectPostData(null);
                return;
            }
        }

        const remainingPlatforms = directPostData.selectedPlatforms.filter(p => p !== 'whatsapp');
        if (remainingPlatforms.length === 0) return;

        setIsPosting(true);
        try {
            const formData = new FormData();
            formData.append('file', directPostData.file);
            formData.append('caption', directPostData.caption);
            formData.append('headline', directPostData.headline);
            formData.append('platforms', JSON.stringify(remainingPlatforms));

            const response = await fetch('/api/assets/direct-post', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Posting failed.");
            
            toast.success(`Successfully posted to ${remainingPlatforms.join(' & ')}!`);
            setDirectPostData(null);
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setIsPosting(false);
        }
    };

    // 5. Handle WhatsApp Share (SINGLE-TAP WITH PROXY & FALLBACK)
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
                    platforms: [...targets, 'linkedin'] // Always try LinkedIn if connected
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

    // --- MULTI-SELECT LOGIC ---
    const toggleSelection = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const clearSelection = () => {
        setSelectedIds(new Set());
    };

    const handleDownloadSelected = async () => {
        if (selectedIds.size === 0) return;

        const downloadBatchPromise = async () => {
            setIsZipping(true);
            const zip = new JSZip();
            const selectedAssets = assets.filter(a => selectedIds.has(a.id));
            
            try {
                const fetchPromises = selectedAssets.map(async (asset, index) => {
                    const proxyUrl = `/api/fetch-image?url=${encodeURIComponent(asset.url)}`;
                    const response = await fetch(proxyUrl);
                    if (!response.ok) throw new Error(`Failed to fetch asset ${index + 1}`);
                    
                    const blob = await response.blob();
                    const mimeType = blob.type || (asset.type === 'video' ? 'video/mp4' : 'image/png');
                    const ext = mimeType.split('/')[1] || (asset.type === 'video' ? 'mp4' : 'png');
                    const fileName = `asset-${index + 1}-${Date.now()}.${ext}`;
                    
                    zip.file(fileName, blob);
                });

                await Promise.all(fetchPromises);
                
                const content = await zip.generateAsync({ type: 'blob' });
                const zipFileName = `adrolls-assets-${Date.now()}.zip`;
                
                // Use the existing triggerBlobDownload helper
                const url = window.URL.createObjectURL(content);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = zipFileName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                }, 100);

                return `Downloaded ${selectedAssets.length} assets as ZIP!`;
            } catch (error: any) {
                console.error("❌ Batch Download Error:", error);
                throw error;
            } finally {
                setIsZipping(false);
                clearSelection();
            }
        };

        toast.promise(downloadBatchPromise(), {
            loading: `Packaging ${selectedIds.size} assets...`,
            success: (msg) => msg,
            error: 'Failed to create ZIP.'
        });
    };

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

                    {userRole !== 'agent' && (
                        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                            <input 
                                type="file" 
                                className="hidden" 
                                id="direct-post-upload"
                                accept="image/*,video/*"
                                onChange={handleDirectUpload}
                            />
                            <input 
                                type="file" 
                                className="hidden" 
                                id="library-upload"
                                multiple
                                accept="image/*,video/*"
                                onChange={handleLibraryUpload}
                            />
                            <button
                                onClick={() => document.getElementById('library-upload')?.click()}
                                disabled={isUploading}
                                className="bg-slate-900 text-white px-6 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50"
                            >
                                {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                                {isUploading ? 'Uploading...' : 'Upload Assets'}
                            </button>
                        </div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                        <button onClick={() => fetchAssets(true)} className="bg-white text-slate-700 border border-slate-200/60 px-6 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-all active:scale-95">
                            <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
                            Refresh
                        </button>
                    </div>
                    <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl shadow-sm border border-slate-200/60 text-sm font-medium text-slate-600">
                        <ImageIcon size={18} className="text-blue-500" /> {assets.length} Total Assets
                    </div>
                    {filteredAssets.length > 0 && (
                        <div className="flex gap-2">
                            <button 
                                onClick={() => {
                                    const allIds = new Set(filteredAssets.map(a => a.id));
                                    setSelectedIds(allIds);
                                }}
                                className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors"
                            >
                                Select All Filtered
                            </button>
                            {selectedIds.size > 0 && (
                                <button 
                                    onClick={clearSelection}
                                    className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors"
                                >
                                    Clear ({selectedIds.size})
                                </button>
                            )}
                        </div>
                    )}
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
                                                onClick={() => toggleSelection(asset.id)}
                                                className={`relative aspect-square rounded-[1.5rem] overflow-hidden bg-slate-50 border group cursor-pointer active:scale-95 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${selectedIds.has(asset.id) ? 'ring-4 ring-blue-500 border-transparent' : 'border-slate-200/40'}`}
                                            >
                                                <img src={fixR2Url(asset.url)} alt="Asset" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                                
                                                {/* Selection Checkbox */}
                                                <div className={`absolute top-3 left-3 z-20 w-6 h-6 rounded-full flex items-center justify-center transition-all ${selectedIds.has(asset.id) ? 'bg-blue-600 scale-110 shadow-lg' : 'bg-white/40 backdrop-blur-md opacity-0 group-hover:opacity-100 border border-white/50'}`}>
                                                    {selectedIds.has(asset.id) && <Check size={14} className="text-white" strokeWidth={4} />}
                                                </div>

                                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                    <div className="flex gap-2">
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setPreviewImage({ isOpen: true, url: asset.url, title: property?.title || 'Asset Preview', type: asset.type });
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
                                onClick={() => toggleSelection(asset.id)}
                                className={`relative aspect-square rounded-[1.5rem] sm:rounded-[2rem] overflow-hidden bg-white shadow-sm border group cursor-pointer active:scale-95 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${selectedIds.has(asset.id) ? 'ring-4 ring-blue-500 border-transparent' : 'border-slate-200/40'}`}
                            >
                                {/* Selection Checkbox */}
                                <div className={`absolute top-4 left-4 z-20 w-7 h-7 rounded-full flex items-center justify-center transition-all ${selectedIds.has(asset.id) ? 'bg-blue-600 scale-110 shadow-lg' : 'bg-white/40 backdrop-blur-md opacity-0 group-hover:opacity-100 border border-white/50'}`}>
                                    {selectedIds.has(asset.id) && <Check size={16} className="text-white" strokeWidth={4} />}
                                </div>

                                {['Processing', 'Rendering'].includes(asset.status) ? (
                                    <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center p-4 text-center">
                                        <div className="relative">
                                            <Loader2 size={28} className={`animate-spin ${asset.status === 'Rendering' ? 'text-blue-500' : 'text-purple-500'}`} />
                                            <Sparkles size={12} className="absolute -top-1 -right-1 text-amber-400 animate-pulse" />
                                        </div>
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] mt-3">
                                            {asset.status === 'Rendering' ? 'AI EDITING...' : 'AI Designing...'}
                                        </p>
                                        <p className="text-[9px] text-slate-400 font-medium mt-1">
                                            {asset.status === 'Rendering' ? 'Compiling subtitles & outro' : 'Check back in a bit'}
                                        </p>
                                        {asset.status !== 'Rendering' && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeleteAsset(asset.id); }}
                                                className="mt-3 text-[9px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-widest"
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                ) : asset.status === 'Failed' ? (
                                    <div className="w-full h-full bg-red-50 flex flex-col items-center justify-center p-4 text-center relative">
                                        <div className="bg-red-100 p-3 rounded-full mb-2">
                                            <X className="text-red-500" size={24} />
                                        </div>
                                        <p className="text-[10px] font-black text-red-600 uppercase tracking-widest">Failed</p>
                                        <p 
                                            className="text-[9px] text-red-400 font-medium mt-1 max-w-[120px] line-clamp-2"
                                            title={asset.metadata?.error || "AI generation failed"}
                                        >
                                            {asset.metadata?.error || "AI generation failed"}
                                        </p>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleDeleteAsset(asset.id); }}
                                            className="mt-3 bg-red-500 text-white px-4 py-1.5 rounded-full text-[10px] font-bold hover:bg-red-600 transition-all shadow-sm"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : asset.type === 'video' ? (
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
                                {asset.status !== 'Processing' ? (
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                        <div className="flex gap-3">
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPreviewImage({ isOpen: true, url: asset.url, title: 'Asset Preview', type: asset.type });
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
                                            
                                            {userRole !== 'agent' && (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteAsset(asset.id);
                                                    }}
                                                    className="bg-white p-3 rounded-full text-red-500 shadow-xl hover:scale-110 transition-all"
                                                >
                                                    <Trash2 size={20} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ) : null}

                                {/* Status Badge */}
                                <div className="absolute top-4 right-4 shadow-md z-10">
                                    {['Processing', 'Rendering'].includes(asset.status) ? (
                                        <div className={`text-white p-1.5 rounded-full border-2 border-white animate-pulse ${asset.status === 'Rendering' ? 'bg-blue-500' : 'bg-purple-500'}`} title={asset.status}>
                                            <Sparkles size={14} />
                                        </div>
                                    ) : asset.status === 'Published' ? (
                                        <div className="bg-emerald-500 text-white p-1.5 rounded-full border-2 border-white" title="Published">
                                            <CheckCircle2 size={14} strokeWidth={3} />
                                        </div>
                                    ) : asset.status === 'Failed' ? (
                                        <div className="bg-red-500 text-white p-1.5 rounded-full border-2 border-white" title="Failed">
                                            <X size={14} strokeWidth={3} />
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
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-bold text-slate-500 ml-2 block uppercase tracking-wider">Asset Caption</label>
                                        <button
                                            type="button"
                                            onClick={handleGenerateAICaptions}
                                            disabled={isGeneratingCaptions || isPosting}
                                            className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/80 px-3 py-1.5 rounded-xl transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {isGeneratingCaptions ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                            {isGeneratingCaptions ? 'Generating...' : 'Generate AI Captions'}
                                        </button>
                                    </div>
                                    <textarea
                                        value={caption}
                                        onChange={(e) => setCaption(e.target.value)}
                                        placeholder="Write a compelling caption..."
                                        className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none resize-none border border-slate-200/60 focus:border-blue-400 transition-all"
                                        rows={4}
                                    />
                                </div>

                                {/* AI Generated Ad Fields (Headline & Primary Text) */}
                                {(headline || primaryText) && (
                                    <div className="mb-6 space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-200/60 animate-in fade-in duration-300">
                                        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-600 uppercase tracking-widest">
                                            <Sparkles size={14} className="text-blue-500" />
                                            <span>AI Ad Copy (Headline & Primary Text)</span>
                                        </div>
                                        
                                        {/* Headline Field */}
                                        {headline && (
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ad Headline</span>
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(headline);
                                                            toast.success("Headline copied to clipboard!");
                                                        }}
                                                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-all"
                                                    >
                                                        <Copy size={12} /> Copy
                                                    </button>
                                                </div>
                                                <div className="bg-white border border-slate-200 px-4 py-3 rounded-xl text-sm font-semibold text-slate-800 select-all">
                                                    {headline}
                                                </div>
                                            </div>
                                        )}

                                        {/* Primary Text Field */}
                                        {primaryText && (
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ad Primary Text</span>
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(primaryText);
                                                            toast.success("Primary Text copied to clipboard!");
                                                        }}
                                                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-all"
                                                    >
                                                        <Copy size={12} /> Copy
                                                    </button>
                                                </div>
                                                <div className="bg-white border border-slate-200 px-4 py-3 rounded-xl text-sm font-medium text-slate-700 select-all">
                                                    {primaryText}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Actions Grid */}
                                <div className="flex flex-col gap-3">
                                    {userRole !== 'agent' && (
                                        <div className="grid grid-cols-3 gap-3 mb-4">
                                            <button
                                                onClick={handlePostFacebook}
                                                disabled={isPosting || isDownloading}
                                                className="bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2] hover:text-white py-3.5 rounded-[1.25rem] text-[11px] font-bold flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50"
                                            >
                                                <Facebook size={18} /> FB
                                            </button>
                                            <button
                                                onClick={handlePostInstagram}
                                                disabled={isPosting || isDownloading}
                                                className="bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888] text-white opacity-90 hover:opacity-100 py-3.5 rounded-[1.25rem] text-[11px] font-bold flex flex-col items-center justify-center gap-2 transition-opacity shadow-sm disabled:opacity-50"
                                            >
                                                <Instagram size={18} /> Insta
                                            </button>
                                            <button
                                                onClick={handlePostLinkedin}
                                                disabled={isPosting || isDownloading}
                                                className="bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2] hover:text-white py-3.5 rounded-[1.25rem] text-[11px] font-bold flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50"
                                            >
                                                <Linkedin size={18} /> LinkedIn
                                            </button>
                                        </div>
                                    )}

                                    {/* Universal Post */}
                                    {userRole !== 'agent' && (
                                        <button
                                            onClick={handleUniversalPost}
                                            disabled={isPosting || isDownloading}
                                            className="w-full bg-slate-900 text-white py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all disabled:opacity-50 active:scale-95"
                                        >
                                            {isPosting ? <Loader2 size={18} className="animate-spin" /> : <Globe size={18} />}
                                            Publish Everywhere
                                        </button>
                                    )}

                                    {userRole !== 'agent' && (
                                        <div className="relative py-2 flex items-center">
                                            <div className="flex-grow border-t border-slate-200/80"></div>
                                            <span className="flex-shrink-0 mx-4 text-xs font-bold text-slate-400 uppercase tracking-widest">or share manually</span>
                                            <div className="flex-grow border-t border-slate-200/80"></div>
                                        </div>
                                    )}

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

                                    {/* AI Video Editor Action */}
                                    {selectedAsset.type === 'video' && userRole === 'super_admin' && (
                                        <button
                                            onClick={() => {
                                                const urlParams = new URLSearchParams(window.location.search);
                                                const impersonateId = urlParams.get('impersonate');
                                                if (impersonateId) {
                                                    router.push(`/dashboard/video-editor/${selectedAsset.id}?impersonate=${impersonateId}`);
                                                } else {
                                                    router.push(`/dashboard/video-editor/${selectedAsset.id}`);
                                                }
                                            }}
                                            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all mt-2 active:scale-95"
                                        >
                                            <Sparkles size={18} />
                                            <span>AI Video Edit</span>
                                        </button>
                                    )}

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
                type={previewImage.type}
            />

            {/* FLOATING BATCH ACTION BAR */}
            <AnimatePresence mode="wait">
                {selectedIds.size > 0 && (
                    <div className="fixed bottom-[calc(6.8rem+env(safe-area-inset-bottom))] sm:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-0 right-0 z-[140] flex justify-center pointer-events-none px-4">
                        <motion.div 
                            initial={{ y: 100, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 100, opacity: 0 }}
                            className="w-full max-w-2xl pointer-events-auto"
                        >
                            <div className="bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 rounded-[1.5rem] sm:rounded-[2rem] p-2.5 sm:p-4 shadow-2xl flex items-center justify-between gap-2 sm:gap-4">
                                <div className="flex items-center gap-2 sm:gap-4 ml-1 sm:ml-2">
                                    <div className="bg-blue-500 text-white w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center font-bold text-sm sm:text-base shadow-lg shadow-blue-500/20 shrink-0">
                                        {selectedIds.size}
                                    </div>
                                    <div className="hidden sm:block">
                                        <p className="text-white font-bold text-sm">Assets Selected</p>
                                        <button onClick={clearSelection} className="text-slate-400 hover:text-white text-[11px] font-bold uppercase tracking-wider transition-colors">
                                            Clear Selection
                                        </button>
                                    </div>
                                    <div className="sm:hidden flex flex-col">
                                        <p className="text-white font-bold text-xs leading-none">Selected</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                    <button
                                        onClick={clearSelection}
                                        className="sm:hidden bg-slate-800 text-slate-300 p-2.5 rounded-xl hover:bg-slate-700 transition-all shrink-0"
                                        title="Clear Selection"
                                    >
                                        <X size={18} />
                                    </button>
                                    <button
                                        onClick={handleDownloadSelected}
                                        disabled={isZipping}
                                        className="bg-white text-slate-900 px-4 py-2.5 sm:px-6 sm:py-3.5 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 sm:gap-2 hover:bg-blue-50 hover:text-blue-600 transition-all active:scale-95 disabled:opacity-50 shrink-0"
                                    >
                                        {isZipping ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                        <span>Download ZIP</span>
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* DIRECT POST REVIEW MODAL */}
            {directPostData && (
                <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-lg rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
                        
                        {/* MODAL HEADER */}
                        <div className="flex justify-between items-center p-6 bg-white border-b border-slate-100 flex-shrink-0">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <Sparkles className="text-blue-600" size={20} />
                                Review AI Post
                            </h2>
                            <button onClick={() => setDirectPostData(null)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* MODAL BODY */}
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            
                            {/* Media Preview / Upload Area */}
                            <div 
                                onClick={() => !directPostData.file && document.getElementById('direct-post-upload')?.click()}
                                className={`rounded-[1.5rem] overflow-hidden mb-6 border border-slate-200/60 shadow-inner flex flex-col items-center justify-center min-h-[200px] transition-all ${!directPostData.file ? 'bg-slate-50 border-dashed cursor-pointer hover:bg-slate-100' : 'bg-black'}`}
                            >
                                {directPostData.file ? (
                                    directPostData.file.type.startsWith('video') ? (
                                        <video src={directPostData.previewUrl!} controls className="w-full max-h-[250px] object-contain" />
                                    ) : (
                                        <img src={directPostData.previewUrl!} className="w-full max-h-[250px] object-contain" alt="Preview" />
                                    )
                                ) : (
                                    <div className="flex flex-col items-center gap-3 text-slate-400">
                                        <div className="bg-white p-4 rounded-full shadow-sm border border-slate-100">
                                            <Upload size={24} className="text-blue-500" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-bold text-slate-600">Select Image or Video</p>
                                            <p className="text-[10px] font-medium mt-1">Tap to upload your ad creative</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* AI GENERATE BUTTON (Only if file is present but headline/caption empty) */}
                            {directPostData.file && !directPostData.headline && !directPostData.caption && (
                                <button
                                    onClick={runAIAnalysis}
                                    disabled={isAnalyzing}
                                    className="w-full mb-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-xl shadow-blue-500/20 hover:shadow-blue-500/40 transition-all active:scale-95"
                                >
                                    {isAnalyzing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                                    Generate AI Ad Copy
                                </button>
                            )}

                            {/* Headline */}
                            <div className={`mb-4 transition-opacity ${!directPostData.file ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                                <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Headline</label>
                                <input
                                    type="text"
                                    value={directPostData.headline}
                                    onChange={(e) => setDirectPostData({ ...directPostData, headline: e.target.value })}
                                    className="w-full bg-slate-50 hover:bg-slate-100/50 px-4 py-3.5 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all"
                                    placeholder="Enter your ad headline..."
                                />
                            </div>

                            {/* Caption */}
                            <div className={`mb-6 transition-opacity ${!directPostData.file ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                                <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Caption / Primary Text</label>
                                <textarea
                                    value={directPostData.caption}
                                    onChange={(e) => setDirectPostData({ ...directPostData, caption: e.target.value })}
                                    rows={4}
                                    className="w-full bg-slate-50 hover:bg-slate-100/50 p-4 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none resize-none border border-slate-200/60 focus:border-blue-400 transition-all"
                                    placeholder="What do you want to say?"
                                />
                            </div>

                            {/* Platform Selection */}
                            <div className={`mb-6 transition-opacity ${!directPostData.file ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                                <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Select Meta Platforms</label>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => {
                                            const platforms = new Set(directPostData.selectedPlatforms);
                                            if (platforms.has('facebook')) platforms.delete('facebook');
                                            else platforms.add('facebook');
                                            setDirectPostData({ ...directPostData, selectedPlatforms: Array.from(platforms) });
                                        }}
                                        className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all font-bold text-sm ${directPostData.selectedPlatforms.includes('facebook') ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}
                                    >
                                        <Facebook size={18} /> Facebook
                                    </button>
                                    <button
                                        onClick={() => {
                                            const platforms = new Set(directPostData.selectedPlatforms);
                                            if (platforms.has('instagram')) platforms.delete('instagram');
                                            else platforms.add('instagram');
                                            setDirectPostData({ ...directPostData, selectedPlatforms: Array.from(platforms) });
                                        }}
                                        className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all font-bold text-sm ${directPostData.selectedPlatforms.includes('instagram') ? 'border-pink-600 bg-pink-50 text-pink-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}
                                    >
                                        <Instagram size={18} /> Instagram
                                    </button>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className={`flex flex-col gap-3 transition-opacity ${!directPostData.file || (!directPostData.headline && !directPostData.caption) ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                                <button
                                    onClick={handleDirectPostSubmit}
                                    disabled={isPosting || directPostData.selectedPlatforms.filter(p => p !== 'whatsapp').length === 0}
                                    className="w-full bg-slate-900 text-white py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all disabled:opacity-50 active:scale-95"
                                >
                                    {isPosting ? <Loader2 size={18} className="animate-spin" /> : <Globe size={18} />}
                                    Publish to Socials
                                </button>

                                <div className="relative py-2 flex items-center">
                                    <div className="flex-grow border-t border-slate-200/80"></div>
                                    <span className="flex-shrink-0 mx-4 text-xs font-bold text-slate-400 uppercase tracking-widest">or share manually</span>
                                    <div className="flex-grow border-t border-slate-200/80"></div>
                                </div>

                                <button
                                    onClick={() => {
                                        const originalPlatforms = directPostData.selectedPlatforms;
                                        setDirectPostData({ ...directPostData, selectedPlatforms: ['whatsapp'] });
                                        setTimeout(() => {
                                            handleDirectPostSubmit();
                                        }, 100);
                                    }}
                                    disabled={isPosting}
                                    className="w-full bg-[#25D366] hover:bg-[#1ebe57] text-white py-4 rounded-[1.25rem] text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#25D366]/20 transition-all disabled:opacity-50 active:scale-95"
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                                    </svg>
                                    Direct WhatsApp Share
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}