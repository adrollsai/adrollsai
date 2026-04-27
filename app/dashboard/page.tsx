'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, X, Loader2, Share2, Image as ImageIcon, Link as LinkIcon, Filter, MoreHorizontal, LayoutGrid, FileText } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

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
}

// NEW TYPE FOR ASSETS TAB
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
  const [authError, setAuthError] = useState(false)
  
  // RBAC & Ownership State
  const [role, setRole] = useState<'admin' | 'agent'>('admin')
  const [ownerId, setOwnerId] = useState<string | null>(null) // Replaces currentUserId to support Agent viewing Admin's catalog
  
  // Sharing State
  const [isSharingId, setIsSharingId] = useState<string | null>(null)

  // Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  
  // UI State
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // NEW VIEW MODAL STATE (TABS & ASSETS)
  const [modalTab, setModalTab] = useState<'details' | 'assets'>('details')
  const [propertyAssets, setPropertyAssets] = useState<Asset[]>([])
  const [isLoadingAssets, setIsLoadingAssets] = useState(false)
  
  // Form State - Simplified for Generic Business
  const [newProp, setNewProp] = useState({ 
    title: '', 
    description: ''
  })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. SAFE FETCH WITH RBAC
  const fetchProperties = async () => {
    try {
      setLoading(true)
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        setAuthError(true)
        setLoading(false)
        return
      }

      // 1. Get Role & Parent ID
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, parent_id')
        .eq('id', user.id)
        .single()

      const currentRole = profile?.role || 'admin'
      setRole(currentRole)

      // 2. Determine whose catalog to load
      // If agent, load parent's catalog. If admin, load own catalog.
      const targetUserId = (currentRole === 'agent' && profile?.parent_id) ? profile.parent_id : user.id
      setOwnerId(targetUserId)

      // 3. Fetch Catalog
      const { data, error: dbError } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })

      if (dbError) throw dbError
      if (data) setProperties(data)

    } catch (error) {
      console.error("Error loading products:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProperties() }, [])

  // NEW EFFECT: Fetch linked assets when a property is selected
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
      // Always reset to details tab when opening a new property
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

  const handleAddProperty = async () => {
    if (!newProp.title) {
        alert("Please enter a Product/Service Name.")
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
          user_id: user.id, // Only admins can reach here, so user.id is correct
          title: newProp.title,
          description: newProp.description,
          address: '', 
          price: '', 
          property_type: 'Generic', 
          status: 'Active',
          image_url: uploadedUrls[0],
          images: uploadedUrls
        })

      if (error) throw error

      await fetchProperties()
      setShowAddModal(false)
      setNewProp({ title: '', description: '' })
      setSelectedFiles([])
      setPreviews([])

    } catch (error: any) {
      alert('Error adding product: ' + error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyFilteredLink = () => {
    if (!ownerId) return // Uses ownerId so agents share the Admin's link
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    
    const shareUrl = `${window.location.origin}/shared/${ownerId}?${params.toString()}`
    navigator.clipboard.writeText(shareUrl)
    alert("✅ Link Copied!")
  }

  const handleNativeShare = async (e: React.MouseEvent, prop: Property) => {
    e.stopPropagation()
    if (isSharingId) return 

    setIsSharingId(prop.id)

    try {
      const shareTitle = `${prop.title}`
      const shareText = `${shareTitle}\n\n${prop.description || ''}`

      let imageUrls = (prop.images && prop.images.length > 0) ? prop.images : [prop.image_url];
      imageUrls = imageUrls.slice(0, 10);

      const filesArray: File[] = [];
      if (typeof navigator.canShare === 'function') {
        try {
            await Promise.all(imageUrls.map(async (url, index) => {
                const response = await fetch(url);
                const blob = await response.blob();
                const mimeType = blob.type || 'image/jpeg';
        
                const ext = mimeType.split('/')[1] || 'jpg';
                const file = new File([blob], `product_${prop.id}_${index}.${ext}`, { type: mimeType });
                filesArray.push(file);
            }));
        } catch (fetchErr) {
            console.error("Failed to fetch images for sharing", fetchErr);
        }
      }

      if (filesArray.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files: filesArray })) {
        await navigator.share({
            files: filesArray,
            title: shareTitle,
            text: shareText
        });
      } else {
        if (navigator.share) {
            await navigator.share({ 
                title: shareTitle, 
                text: shareText, 
                url: prop.image_url 
            });
        } else {
            window.open(`https://wa.me/?text=${encodeURIComponent(shareText + "\n\n" + prop.image_url)}`, '_blank');
        }
      }

    } catch (error) { 
      console.log("Share cancelled or failed", error) 
    } finally {
        setIsSharingId(null)
    }
  }

  // --- FILTER LOGIC ---
  const filteredProperties = properties.filter(p => {
    const matchesSearch = p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.description?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  // --- RENDER ---
  if (authError) return <div className="flex h-screen items-center justify-center"><button onClick={handleManualLogout}>Login Again</button></div>
  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>

  return (
    <div className="p-5 max-w-md mx-auto relative min-h-screen pb-24">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Products & Services</h1>
          <p className="text-slate-500 text-xs mt-1">Manage your catalog</p>
        </div>
        <div className="flex gap-2">
            <button onClick={() => setShowFilters(!showFilters)} className={`p-3 rounded-full shadow-md active:scale-95 transition-transform ${showFilters ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'}`}>
              <MoreHorizontal size={20} />
            </button>
            
            {/* ONLY ADMINS SEE THE ADD BUTTON */}
            {role === 'admin' && (
              <button onClick={() => setShowAddModal(true)} className="bg-primary hover:bg-blue-200 text-primary-text p-3 rounded-full shadow-md active:scale-95 transition-transform">
                <Plus size={20} strokeWidth={3} />
              </button>
            )}
        </div>
      </div>

      {/* OPTIONS BAR */}
      {showFilters && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4 animate-in slide-in-from-top-2">
            <button onClick={handleCopyFilteredLink} className="w-full bg-blue-50 text-blue-600 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform border border-blue-100">
                <LinkIcon size={14} /> Copy Public Link
            </button>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative mb-6">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"><Search size={18} /></div>
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products..." 
          className="w-full bg-white border-none py-3 pl-10 pr-4 rounded-xl shadow-sm text-sm text-slate-700 focus:ring-2 focus:ring-primary outline-none" 
        />
      </div>

      {/* List */}
      <div className="flex flex-col gap-4">
        {filteredProperties.length === 0 ? <div className="text-center py-10 text-slate-400 text-sm">No products found.</div> : (
          filteredProperties.map((prop) => (
            <div 
              key={prop.id} 
              onClick={() => setSelectedProperty(prop)}
              className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-100 relative group cursor-pointer active:scale-95 transition-transform"
            >
              <div className="relative h-48 w-full rounded-2xl overflow-hidden bg-slate-100 mb-3">
                <img src={prop.image_url} alt="Product" className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 flex gap-1">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-white/90 text-slate-700 backdrop-blur-sm">
                       {prop.status}
                    </span>
                </div>
              </div>
              <div className="px-2 pb-1 flex justify-between items-start">
                <div className="flex-1 pr-2">
                  <h3 className="text-lg font-bold text-slate-800 leading-tight">{prop.title || 'Untitled'}</h3>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                    {prop.description || 'No description provided.'}
                  </p>
                </div>
                <button 
                    onClick={(e) => handleNativeShare(e, prop)} 
                    disabled={isSharingId === prop.id}
                    className="bg-green-50 text-green-600 p-3 rounded-full hover:bg-green-100 transition-colors active:scale-90 flex-shrink-0"
                >
                  {isSharingId === prop.id ? <Loader2 size={20} className="animate-spin"/> : <Share2 size={20} />}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ADD MODAL (Only rendered if admin somehow triggers it) */}
      {role === 'admin' && showAddModal && (
        <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">Add Product</h2>
              <button onClick={() => setShowAddModal(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
 
            <div className="space-y-4">
              {/* Image Picker */}
              <div onClick={() => fileInputRef.current?.click()} className="w-full h-40 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden group">
                  <ImageIcon size={32} className="text-slate-400 mb-2 group-hover:scale-110 transition-transform"/>
                  <span className="text-xs font-bold text-slate-400 uppercase">Upload Photos</span>
                  <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              </div>
              
              {/* Previews */}
              {previews.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {previews.map((src, i) => (
                    <img key={i} src={src} className="w-20 h-20 rounded-lg object-cover border border-slate-100 flex-shrink-0" />
                  ))}
                </div>
              )}
              
              {/* Simple Inputs */}
              <input 
                type="text" 
                value={newProp.title} 
                onChange={(e) => setNewProp({...newProp, title: e.target.value})} 
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none font-bold text-slate-700" 
                placeholder="Product / Service Name" 
              />
              
              <textarea 
                value={newProp.description} 
                onChange={(e) => setNewProp({...newProp, description: e.target.value})} 
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" 
                placeholder="Description, features, details..." 
                rows={5} 
              />
              
              <button onClick={handleAddProperty} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all">
                {isSubmitting ? 'Saving...' : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODAL WITH NEW TABS (Visible to both Admin and Agents) */}
      {selectedProperty && (
        <div className="fixed inset-0 z-[90] bg-slate-50 flex flex-col animate-in slide-in-from-bottom-10">
           {/* Top Navigation */}
           <div className="bg-white px-4 py-3 border-b border-slate-200 flex items-center justify-between shadow-sm sticky top-0 z-20">
               <h2 className="text-lg font-bold text-slate-800 truncate pr-4">{selectedProperty.title}</h2>
               <button onClick={() => setSelectedProperty(null)} className="bg-slate-100 p-2 rounded-full text-slate-600"><X size={20} /></button>
           </div>

           {/* Tab System */}
           <div className="flex bg-white border-b border-slate-200">
               <button onClick={() => setModalTab('details')} className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${modalTab === 'details' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>
                   <FileText size={16} /> Details
               </button>
               <button onClick={() => setModalTab('assets')} className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${modalTab === 'assets' ? 'border-primary text-primary' : 'border-transparent text-slate-500'}`}>
                   <LayoutGrid size={16} /> Creatives
               </button>
           </div>
           
           <div className="flex-1 overflow-y-auto">
               {modalTab === 'details' ? (
                   // TAB 1: DETAILS
                   <div className="p-4 space-y-6">
                       <div className="flex gap-2 overflow-x-auto snap-x scrollbar-hide pb-2">
                         {(selectedProperty.images || [selectedProperty.image_url]).map((img, i) => (
                           <img key={i} src={img} className="w-[80vw] h-64 rounded-2xl object-cover flex-shrink-0 snap-center border border-slate-200" />
                         ))}
                       </div>
                       <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                          <h3 className="font-bold text-slate-800 mb-2">Description</h3>
                          <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{selectedProperty.description}</p>
                       </div>
                   </div>
               ) : (
                   // TAB 2: CREATIVES (ASSETS)
                   <div className="p-4">
                       {isLoadingAssets ? (
                           <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-slate-400" /></div>
                       ) : propertyAssets.length === 0 ? (
                           <div className="text-center py-20">
                               <ImageIcon size={48} className="mx-auto text-slate-300 mb-3" />
                               <p className="text-slate-500 text-sm font-medium">No creatives generated yet.</p>
                               <button onClick={() => { setSelectedProperty(null); router.push('/dashboard/creation'); }} className="mt-4 text-primary text-sm font-bold">Go to Creator</button>
                           </div>
                       ) : (
                           <div className="grid grid-cols-2 gap-3">
                               {propertyAssets.map(asset => (
                                   <div key={asset.id} className="aspect-square bg-slate-200 rounded-xl overflow-hidden relative shadow-sm border border-slate-200">
                                       {asset.type === 'video' ? (
                                           <video src={asset.url} className="w-full h-full object-cover" />
                                       ) : (
                                           <img src={asset.url} className="w-full h-full object-cover" />
                                       )}
                                       <div className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full border-2 border-white ${asset.status === 'Published' ? 'bg-green-500' : 'bg-amber-500'}`} />
                                   </div>
                               ))}
                           </div>
                       )}
                   </div>
               )}
           </div>
        </div>
      )}

    </div>
  )
}