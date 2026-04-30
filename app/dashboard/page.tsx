'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, X, Loader2, Image as ImageIcon, Link as LinkIcon, MoreHorizontal, LayoutGrid, FileText, Sparkles, RefreshCw, Trash2, AlertTriangle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner' 

// Custom WhatsApp SVG Icon
const WhatsAppIcon = ({ size = 24, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
  </svg>
)

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

type Property = {
  id: string
  title: string
  address: string
  price: string
  status: string
  image_url: string
  images: string[]
  description?: string
  property_type?: string
  user_id: string 
  auto_generate?: boolean 
}

type Asset = {
  id: string
  type: 'image' | 'video'
  url: string
  status: string
}

export default function ProductsPage() {
  const supabase = createClient()
  const router = useRouter()
  
  // --- STATE ---
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [authError, setAuthError] = useState(false)
  
  // RBAC & Ownership State
  const [role, setRole] = useState<'admin' | 'agent'>('admin')
  const [ownerId, setOwnerId] = useState<string | null>(null) 
  
  // Interaction State
  const [isSharingId, setIsSharingId] = useState<string | null>(null)
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null) 
  const [generatingProps, setGeneratingProps] = useState<string[]>([]) 

  // Deletion State
  const [propertyToDelete, setPropertyToDelete] = useState<Property | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  
  // UI State
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // View Modal State
  const [modalTab, setModalTab] = useState<'details' | 'assets'>('details')
  const [propertyAssets, setPropertyAssets] = useState<Asset[]>([])
  const [isLoadingAssets, setIsLoadingAssets] = useState(false)
  
  // Form State
  const [newProp, setNewProp] = useState({ title: '', description: '' })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. SAFE FETCH WITH LOCAL CACHING
  const fetchProperties = async (force = false) => {
    try {
      if (!force && properties.length === 0) setLoading(true)
      if (force) setIsRefreshing(true)

      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        setAuthError(true)
        setLoading(false)
        return
      }

      const cacheKey = `inventory_cache_${user.id}`
      const timeKey = `inventory_time_${user.id}`

      if (!force) {
          const cachedData = localStorage.getItem(cacheKey)
          const lastFetch = localStorage.getItem(timeKey)
          const now = Date.now()

          if (cachedData) {
              setProperties(JSON.parse(cachedData))
              setLoading(false)
              if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) {
                  const { data: profile } = await supabase.from('profiles').select('role, parent_id').eq('id', user.id).single()
                  const currentRole = profile?.role || 'admin'
                  setRole(currentRole)
                  setOwnerId((currentRole === 'agent' && profile?.parent_id) ? profile.parent_id : user.id)
                  return; 
              }
          }
      }

      const { data: profile } = await supabase.from('profiles').select('role, parent_id').eq('id', user.id).single()
      const currentRole = profile?.role || 'admin'
      setRole(currentRole)

      const targetUserId = (currentRole === 'agent' && profile?.parent_id) ? profile.parent_id : user.id
      setOwnerId(targetUserId)

      const { data, error: dbError } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })

      if (dbError) throw new Error(dbError.message || JSON.stringify(dbError))
      
      if (data) {
          setProperties(data)
          localStorage.setItem(cacheKey, JSON.stringify(data))
          localStorage.setItem(timeKey, Date.now().toString())
      }

    } catch (error: any) {
      console.error("Error loading products:", error.message || error)
      toast.error("Failed to load products: " + (error.message || "Unknown error"))
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => { fetchProperties() }, [])

  // 2. Fetch Assets when a property is selected
  useEffect(() => {
    if (selectedProperty) {
      const fetchAssets = async () => {
        setIsLoadingAssets(true)
        const { data } = await supabase
            .from('assets')
            .select('id, type, url, status')
            .eq('property_id', selectedProperty.id)
            .order('created_at', { ascending: false })
        
        if (data) setPropertyAssets(data)
        setIsLoadingAssets(false)
      }
      fetchAssets()
      setModalTab('details') 
    }
  }, [selectedProperty, supabase])

  // --- ACTIONS ---
  const handleManualLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)
      setSelectedFiles(prev => [...prev, ...newFiles])
      const newPreviews = newFiles.map(file => URL.createObjectURL(file))
      setPreviews(prev => [...prev, ...newPreviews])
    }
  }

  const handleDeleteProperty = async () => {
      if (!propertyToDelete) return;
      setIsDeleting(true);

      try {
          const { error } = await supabase
              .from('properties')
              .delete()
              .eq('id', propertyToDelete.id);

          if (error) throw error;

          // Optimistic UI Update & Cache Update
          const updatedProps = properties.filter(p => p.id !== propertyToDelete.id);
          setProperties(updatedProps);
          
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
              localStorage.setItem(`inventory_cache_${user.id}`, JSON.stringify(updatedProps));
          }

          toast.success("Product deleted successfully.");
          setPropertyToDelete(null);
          setSelectedProperty(null); // Close view modal if it was open
      } catch (error: any) {
          toast.error("Failed to delete product.", { description: error.message });
      } finally {
          setIsDeleting(false);
      }
  }

  const handleBackgroundGeneration = async (e: React.MouseEvent, prop: Property) => {
    e.stopPropagation()
    if (generatingProps.includes(prop.id)) {
      toast.info("Already Generating", { description: "An asset is currently being generated for this product." })
      return
    }

    setGeneratingProps(prev => [...prev, prop.id])
    toast.success("AI Generation Started ✨", { description: `Creating a poster for ${prop.title}. You can safely lock your phone or close the app.` })

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Unauthenticated")

      const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      let propImages = (prop.images && prop.images.length > 0) ? prop.images.slice(0, 2) : [prop.image_url]

      const payload = {
          userInstructions: "Generate a high-quality, luxurious promotional social media poster for this product.",
          propertyDescription: prop.description || "",
          propertyTitle: prop.title || "",
          contactNumber: profile?.contact_number || "",
          logoUrl: profile?.logo_url || "",
          propImages: propImages,
          templateUrl: null,
          aspectRatio: '1:1',
          model: 'google/nano-banana-2'
      }

      fetch('/api/background-worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, propId: prop.id, propertyTitle: prop.title, payload })
      }).then(async (res) => {
           const data = await res.json();
           if (!res.ok) throw new Error(data.error);
           toast.success(`Creative Ready! 🎉`, { description: `Your AI asset for ${prop.title} is waiting in the linked creatives tab.` })
      }).catch(err => {
           console.error("Worker error:", err);
      }).finally(() => {
           setGeneratingProps(prev => prev.filter(id => id !== prop.id))
      });

    } catch (error: any) {
      toast.error(`Failed to start generation for ${prop.title}`, { description: error.message })
      setGeneratingProps(prev => prev.filter(id => id !== prop.id))
    }
  }

  const handleToggleAutoGenerate = async (e: React.MouseEvent, propId: string, currentStatus: boolean) => {
    e.stopPropagation()
    setIsTogglingId(propId)
    const newStatus = !currentStatus

    try {
      const { error } = await supabase.from('properties').update({ auto_generate: newStatus }).eq('id', propId)
      if (error) throw error
      
      const updated = properties.map(p => p.id === propId ? { ...p, auto_generate: newStatus } : p)
      setProperties(updated)
      
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
          localStorage.setItem(`inventory_cache_${user.id}`, JSON.stringify(updated))
      }
    } catch (error: any) {
      toast.error("Failed to update auto-generation status: " + error.message)
    } finally {
      setIsTogglingId(null)
    }
  }

  const handleAddProperty = async () => {
    if (!newProp.title) {
        toast.error("Please enter a Product/Service Name.")
        return
    }
    setIsSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const uploadedUrls: string[] = []

      if (selectedFiles.length > 0) {
        const uploadPromises = selectedFiles.map(async (file) => {
          const fileExt = file.name.split('.').pop()
          const fileName = `${user.id}-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
         
          const { error: uploadError } = await supabase.storage.from('properties').upload(fileName, file)
          if (uploadError) throw uploadError
          const { data: { publicUrl } } = supabase.storage.from('properties').getPublicUrl(fileName)
          return publicUrl
        })
        const results = await Promise.all(uploadPromises)
        uploadedUrls.push(...results)
      } else {
          uploadedUrls.push(`https://placehold.co/600x400/e2e8f0/475569?text=${encodeURIComponent(newProp.title)}`)
      }

      const { error } = await supabase.from('properties').insert({
          user_id: user.id, title: newProp.title, description: newProp.description, address: '', price: '', 
          property_type: 'Generic', status: 'Active', image_url: uploadedUrls[0], images: uploadedUrls, auto_generate: false 
        })

      if (error) throw error

      await fetchProperties(true)
      setShowAddModal(false)
      setNewProp({ title: '', description: '' })
      setSelectedFiles([])
      setPreviews([])

    } catch (error: any) {
      toast.error('Error adding product', { description: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyFilteredLink = () => {
    if (!ownerId) return 
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    const shareUrl = `${window.location.origin}/shared/${ownerId}?${params.toString()}`
    navigator.clipboard.writeText(shareUrl)
    toast.success("✅ Link Copied!")
  }

  const handleNativeShare = async (e: React.MouseEvent, prop: Property) => {
    e.stopPropagation()
  
    if (isSharingId) return 
    setIsSharingId(prop.id)

    const shareTitle = prop.title
    const shareText = `${shareTitle}\n\n${prop.description || ''}`
    let imageUrls = (prop.images && prop.images.length > 0) ? prop.images : [prop.image_url]
    imageUrls = imageUrls.slice(0, 4) 

    const textFallback = `${shareText}\n\n*Product Images:*\n${imageUrls.join('\n\n')}`

    try {
      const fetchPromises = imageUrls.map(async (url, index) => {
        const proxyUrl = `/api/fetch-image?url=${encodeURIComponent(url)}`
        const response = await fetch(proxyUrl)
        if (!response.ok) throw new Error(`Network error fetching image ${index}`)
        const blob = await response.blob()
        const mimeType = blob.type || 'image/jpeg'
        const ext = mimeType.split('/')[1] || 'jpg'
        return new File([blob], `product_${prop.id}_${index + 1}.${ext}`, { type: mimeType })
      })

      const filesArray = await Promise.all(fetchPromises)

      if (navigator.canShare && navigator.canShare({ files: filesArray })) {
          await navigator.share({ title: shareTitle, text: shareText, files: filesArray })
      } else {
          window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}`
      }
    } catch (error: any) { 
      console.error("Share failed", error) 
      if (error.name !== 'AbortError') { window.location.href = `whatsapp://send?text=${encodeURIComponent(textFallback)}` }
    } finally {
        setIsSharingId(null)
    }
  }

  const filteredProperties = properties.filter(p => {
    return p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  })

  // --- RENDER ---
  if (authError) return <div className="flex h-screen items-center justify-center"><button onClick={handleManualLogout} className="text-blue-600 font-bold bg-blue-50 px-6 py-3 rounded-full">Session Expired. Login Again</button></div>
  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen pb-24 pt-16 relative">
      
      {/* FIXED REFRESH BUTTON */}
      <button 
          onClick={() => fetchProperties(true)}
          className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
          title="Refresh Catalog"
      >
          <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      {/* Desktop/Tablet Responsive Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 mt-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">Products & Services</h1>
          <p className="text-slate-500 mt-1 sm:text-lg font-medium">Manage your catalog and assets.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
            {/* Search Bar */}
            <div className="relative flex-1 sm:min-w-[300px]">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products..." 
                className="w-full bg-white border border-slate-200 py-3.5 pl-12 pr-4 rounded-[1.25rem] shadow-sm text-sm text-slate-700 font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all" 
              />
            </div>
            
            <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowFilters(!showFilters)} 
                  className={`flex items-center justify-center p-3.5 rounded-[1.25rem] shadow-sm border transition-all active:scale-95 ${showFilters ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                  title="More Options"
                >
                  <MoreHorizontal size={20} />
                </button>
                
                {role === 'admin' && (
                  <button 
                    onClick={() => setShowAddModal(true)} 
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3.5 px-6 rounded-[1.25rem] shadow-md transition-all active:scale-95 font-bold text-sm"
                  >
                    <Plus size={18} strokeWidth={3} />
                    <span className="sm:hidden lg:inline">Add Product</span>
                  </button>
                )}
            </div>
        </div>
      </div>

      {/* OPTIONS BAR */}
      {showFilters && (
        <div className="bg-white p-4 rounded-[1.5rem] shadow-sm border border-slate-200 mb-8 animate-in slide-in-from-top-2 flex flex-wrap gap-4">
            <button onClick={handleCopyFilteredLink} className="bg-blue-50 text-blue-700 hover:bg-blue-100 py-3 px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all">
                <LinkIcon size={16} /> Copy Public Catalog Link
            </button>
        </div>
      )}

      {/* Responsive Grid List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredProperties.length === 0 ? (
          <div className="col-span-full text-center py-24 bg-white rounded-[2rem] border border-slate-200/60 border-dashed">
            <ImageIcon className="mx-auto h-12 w-12 text-slate-300 mb-3" />
            <p className="text-slate-500 font-bold">No products found matching your search.</p>
          </div>
        ) : (
          filteredProperties.map((prop) => (
            <div 
              key={prop.id} 
              onClick={() => setSelectedProperty(prop)}
              className="bg-white rounded-[1.5rem] shadow-sm hover:shadow-xl border border-slate-200/60 transition-all cursor-pointer group hover:-translate-y-1 flex flex-col overflow-hidden relative"
            >
              
              {/* DELETE BUTTON (Admin Only, visible on hover or always on mobile) */}
              {role === 'admin' && (
                  <button 
                      onClick={(e) => { e.stopPropagation(); setPropertyToDelete(prop); }}
                      className="absolute top-3 right-3 z-10 p-2 bg-white/80 hover:bg-red-50 text-slate-400 hover:text-red-500 backdrop-blur-md rounded-full opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-sm border border-slate-200/50"
                      title="Delete Product"
                  >
                      <Trash2 size={16} />
                  </button>
              )}

              <div className="relative h-56 w-full bg-slate-100 overflow-hidden">
                <img src={prop.image_url} alt="Product" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute top-3 left-3 flex gap-2">
                    <span className="px-3 py-1.5 rounded-full text-xs font-bold shadow-sm bg-white/95 text-slate-800 backdrop-blur-md border border-white/20">
                       {prop.status}
                    </span>
                    {generatingProps.includes(prop.id) && (
                        <span className="px-3 py-1.5 rounded-full text-xs font-bold shadow-sm bg-purple-600/95 text-white backdrop-blur-md border border-white/20 flex items-center gap-1.5 animate-in fade-in zoom-in duration-300">
                           <Loader2 size={12} className="animate-spin" /> Generating...
                        </span>
                    )}
                </div>
              </div>
              <div className="p-5 flex flex-col flex-1">
                <div className="flex justify-between items-start mb-2 gap-2">
                  <h3 className="text-lg font-bold text-slate-900 leading-tight line-clamp-1">{prop.title || 'Untitled'}</h3>
                  
                  {/* Action Buttons Row */}
                  <div className="flex items-center gap-2 shrink-0">
                      <button 
                          onClick={(e) => handleBackgroundGeneration(e, prop)} 
                          disabled={generatingProps.includes(prop.id)}
                          className="bg-purple-50 text-purple-600 p-2.5 rounded-full hover:bg-purple-600 hover:text-white transition-colors flex-shrink-0 disabled:opacity-50 disabled:hover:bg-purple-50 disabled:hover:text-purple-600"
                          title="Generate AI Poster"
                      >
                         {generatingProps.includes(prop.id) ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                      </button>
                      <button 
                          onClick={(e) => handleNativeShare(e, prop)} 
                          disabled={isSharingId === prop.id}
                          className="bg-[#25D366]/10 text-[#25D366] p-2.5 rounded-full hover:bg-[#25D366] hover:text-white transition-colors flex-shrink-0"
                          title="Share via WhatsApp"
                      >
                         {isSharingId === prop.id ? <Loader2 size={18} className="animate-spin"/> : <WhatsAppIcon size={18} />}
                      </button>
                  </div>
                </div>
                
                <p className="text-sm text-slate-500 font-medium line-clamp-2 leading-relaxed flex-1">
                  {prop.description || 'No description provided.'}
                </p>

                {/* Auto Generate Toggle */}
                <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
                  <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
                    <Sparkles size={14} className={prop.auto_generate ? "text-amber-500" : "text-slate-400"} />
                    Auto-Gen Daily
                  </span>
                  <button
                    onClick={(e) => handleToggleAutoGenerate(e, prop.id, !!prop.auto_generate)}
                    disabled={isTogglingId === prop.id}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${prop.auto_generate ? 'bg-blue-600' : 'bg-slate-300'} ${isTogglingId === prop.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-300 ease-out ${prop.auto_generate ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

              </div>
            </div>
          ))
        )}
      </div>

      {/* CONFIRMATION MODAL FOR DELETION */}
      {propertyToDelete && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 sm:p-8 shadow-2xl animate-in zoom-in-95 duration-200 text-center">
                <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-red-50">
                    <AlertTriangle size={28} strokeWidth={2.5} />
                </div>
                <h3 className="text-xl font-black text-slate-900 mb-2">Delete Product?</h3>
                <p className="text-sm text-slate-500 font-medium mb-8 leading-relaxed">
                    Are you sure you want to permanently delete <strong className="text-slate-800">"{propertyToDelete.title}"</strong>? This action cannot be undone and will remove it from your public catalog.
                </p>
                <div className="flex gap-3">
                    <button 
                        onClick={() => setPropertyToDelete(null)}
                        disabled={isDeleting}
                        className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3.5 rounded-2xl text-sm font-bold transition-all disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleDeleteProperty}
                        disabled={isDeleting}
                        className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3.5 rounded-2xl text-sm font-bold shadow-lg shadow-red-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isDeleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />} Delete
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* ADD MODAL */}
      {role === 'admin' && showAddModal && (
        <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-[2rem] sm:rounded-3xl p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-extrabold text-slate-900">Add Product</h2>
              <button onClick={() => setShowAddModal(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={20} /></button>
            </div>
 
            <div className="space-y-5">
              <div onClick={() => fileInputRef.current?.click()} className="w-full h-44 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-50/50 hover:border-blue-400 transition-colors relative overflow-hidden group">
                  <ImageIcon size={36} className="text-slate-400 mb-3 group-hover:scale-110 group-hover:text-blue-500 transition-transform"/>
                  <span className="text-sm font-bold text-slate-500 group-hover:text-blue-600">Upload Product Photos</span>
                  <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              </div>
              
              {previews.length > 0 && (
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                  {previews.map((src, i) => (
                    <img key={i} src={src} className="w-20 h-20 rounded-xl object-cover border border-slate-200 flex-shrink-0 shadow-sm" alt="Preview" />
                  ))}
                </div>
              )}
               
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Title</label>
                <input 
                  type="text" 
                  value={newProp.title} 
                  onChange={(e) => setNewProp({...newProp, title: e.target.value})} 
                  className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 py-3.5 px-4 rounded-xl text-sm focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none font-bold text-slate-900 transition-all" 
                  placeholder="e.g. Luxury Villa Setup" 
                />
              </div>
              
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Details</label>
                <textarea 
                  value={newProp.description} 
                  onChange={(e) => setNewProp({...newProp, description: e.target.value})} 
                  className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 py-3.5 px-4 rounded-xl text-sm font-medium focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all resize-none" 
                  placeholder="Features, pricing, or specifications..." 
                  rows={4} 
                />
              </div>
              
              <button onClick={handleAddProperty} disabled={isSubmitting} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] text-sm font-bold shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all flex items-center justify-center mt-4 disabled:opacity-50 disabled:scale-100">
                {isSubmitting ? <><Loader2 size={18} className="animate-spin mr-2" /> Saving...</> : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODAL WITH NEW TABS */}
      {selectedProperty && !propertyToDelete && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm sm:p-6 animate-in fade-in duration-200">
           <div className="bg-slate-50 w-full sm:max-w-5xl h-[95vh] sm:h-[85vh] rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 border border-slate-100">
               
               {/* Top Navigation */}
               <div className="bg-white px-6 py-5 border-b border-slate-200 flex items-center justify-between shadow-sm shrink-0">
                   <h2 className="text-xl font-extrabold text-slate-900 truncate pr-4">{selectedProperty.title}</h2>
                   <div className="flex items-center gap-2">
                       {role === 'admin' && (
                           <button 
                               onClick={() => setPropertyToDelete(selectedProperty)}
                               className="p-2.5 rounded-full text-red-500 bg-red-50 hover:bg-red-100 transition-colors shrink-0"
                               title="Delete Product"
                           >
                               <Trash2 size={20} />
                           </button>
                       )}
                       <button onClick={() => setSelectedProperty(null)} className="bg-slate-100 p-2.5 rounded-full text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors shrink-0">
                         <X size={20} />
                       </button>
                   </div>
               </div>

               <div className="flex bg-white border-b border-slate-200 shrink-0 px-2 sm:px-6">
                   <button 
                      onClick={() => setModalTab('details')} 
                      className={`flex-1 sm:flex-none sm:px-8 py-3.5 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${modalTab === 'details' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                       <FileText size={16} /> Details
                   </button>
                   <button 
                      onClick={() => setModalTab('assets')} 
                      className={`flex-1 sm:flex-none sm:px-8 py-3.5 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${modalTab === 'assets' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                       <LayoutGrid size={16} /> Linked Creatives
                   </button>
               </div>
              
               {/* Scrollable Content Area */}
               <div className="flex-1 overflow-y-auto">
                   {modalTab === 'details' ? (
                       <div className="p-4 sm:p-8 space-y-8 max-w-4xl mx-auto">
                           <div className="flex gap-4 overflow-x-auto snap-x scrollbar-hide pb-2 pt-2">
                             {(selectedProperty.images || [selectedProperty.image_url]).map((img, i) => (
                               <img key={i} src={img} className="w-[85vw] sm:w-[600px] h-64 sm:h-[400px] rounded-[1.5rem] sm:rounded-[2rem] object-cover flex-shrink-0 snap-center border border-slate-200 shadow-sm" alt="Gallery item" />
                             ))}
                           </div>
                           
                           <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-100">
                              <h3 className="font-extrabold text-lg text-slate-900 mb-3 flex items-center gap-2">
                                 <FileText size={18} className="text-blue-600"/> About this Product
                              </h3>
                              <p className="text-slate-600 text-sm sm:text-base leading-relaxed whitespace-pre-line font-medium">
                                 {selectedProperty.description || "No specific details provided for this item."}
                              </p>
                           </div>
                       </div>
                   ) : (
                       <div className="p-4 sm:p-8">
                           {isLoadingAssets ? (
                               <div className="flex justify-center py-20"><Loader2 size={32} className="animate-spin text-slate-400" /></div>
                           ) : propertyAssets.length === 0 ? (
                               <div className="text-center py-20 max-w-sm mx-auto bg-white rounded-[2rem] border border-slate-100 shadow-sm p-8">
                                   <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                     <ImageIcon size={28} className="text-blue-500" />
                                   </div>
                                   <h4 className="text-lg font-bold text-slate-900 mb-2">No creatives yet</h4>
                                   <p className="text-slate-500 text-sm font-medium mb-6">Use the AI Creator to generate posters or videos linked directly to this product.</p>
                                   <button onClick={() => { setSelectedProperty(null); router.push('/dashboard/creation'); }} className="w-full bg-blue-600 text-white py-3.5 rounded-xl text-sm font-bold shadow-md hover:bg-blue-700 transition-colors">
                                     Open AI Creator
                                   </button>
                               </div>
                           ) : (
                               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                   {propertyAssets.map(asset => (
                                       <div key={asset.id} className="aspect-square bg-slate-200 rounded-[1.5rem] overflow-hidden relative shadow-sm border border-slate-200 group">
                                           {asset.type === 'video' ? (
                                               <video src={asset.url} className="w-full h-full object-cover" />
                                           ) : (
                                               <img src={asset.url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Creative" />
                                           )}
                                           <div className={`absolute top-2.5 right-2.5 w-3 h-3 rounded-full border-2 border-white shadow-sm ${asset.status === 'Published' ? 'bg-green-500' : 'bg-amber-400'}`} title={`Status: ${asset.status}`} />
                                       </div>
                                   ))}
                               </div>
                           )}
                       </div>
                   )}
               </div>
           </div>
        </div>
      )}

    </div>
  )
}