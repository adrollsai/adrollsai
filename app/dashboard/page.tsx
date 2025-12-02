'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, MapPin, X, Loader2, Share2, Image as ImageIcon, Link as LinkIcon, Filter, LogOut, Check } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

// --- Helper for Price Parsing ---
const parsePrice = (priceStr: string | null) => {
  if (!priceStr) return 0
  return parseInt(priceStr.replace(/[^0-9]/g, '') || '0')
}

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

const PROPERTY_TYPES = ['Residential', 'Commercial', 'Plots']

export default function InventoryPage() {
  const supabase = createClient()
  const router = useRouter()
  
  // --- STATE ---
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  
  // Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]) // Multi-select state
  const [showFilters, setShowFilters] = useState(false)
  
  // UI State
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Form State
  const [newProp, setNewProp] = useState({ 
    title: '', 
    address: '', 
    price: '', 
    description: '',
    property_type: 'Residential' // Default
  })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. SAFE FETCH
  const fetchProperties = async () => {
    try {
      setLoading(true)
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        setAuthError(true)
        setLoading(false)
        return
      }
      
      setCurrentUserId(user.id)

      const { data, error: dbError } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (dbError) throw dbError
      if (data) setProperties(data)

    } catch (error) {
      console.error("Error loading inventory:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProperties() }, [])

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
    if (!newProp.address || !newProp.price || !newProp.title) {
        alert("Please fill in Title, Address and Price.")
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
          user_id: user.id,
          title: newProp.title,
          address: newProp.address,
          price: newProp.price,
          description: newProp.description,
          property_type: newProp.property_type, // Saving the type
          status: 'Active',
          image_url: uploadedUrls[0],
          images: uploadedUrls
        })

      if (error) throw error

      await fetchProperties()
      setShowAddModal(false)
      setNewProp({ title: '', address: '', price: '', description: '', property_type: 'Residential' })
      setSelectedFiles([])
      setPreviews([])

    } catch (error: any) {
      alert('Error adding property: ' + error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Toggle filter type
  const toggleFilterType = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }

  const handleCopyFilteredLink = () => {
    if (!currentUserId) return
    const params = new URLSearchParams()
    if (minPrice) params.set('min', minPrice)
    if (maxPrice) params.set('max', maxPrice)
    if (searchQuery) params.set('q', searchQuery)
    if (selectedTypes.length > 0) params.set('types', selectedTypes.join(',')) // Pass types to URL
    
    const shareUrl = `${window.location.origin}/shared/${currentUserId}?${params.toString()}`
    navigator.clipboard.writeText(shareUrl)
    alert("✅ Link Copied!")
  }

  const handleNativeShare = async (e: React.MouseEvent, prop: Property) => {
    e.stopPropagation()
    
    // 1. Prepare the Caption
    const shareText = `🏡 ${prop.title}\n📍 ${prop.address}\n💰 ${prop.price}\n\n${prop.description || ''}`

    if (navigator.share) {
      try {
        // 2. Fetch the image to create a File object
        const response = await fetch(prop.image_url)
        const blob = await response.blob()
        const file = new File([blob], 'property-image.jpg', { type: blob.type })

        // 3. Check if the device allows sharing files
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: prop.title,
            text: shareText,
          })
        } else {
          // Fallback: Share as Link if files aren't supported
          await navigator.share({ 
            title: prop.title, 
            text: shareText, 
            url: prop.image_url 
          })
        }
      } catch (error) {
        console.warn("Share failed or cancelled:", error)
      }
    } else {
      // Fallback for Desktop (WhatsApp Web)
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText + "\n" + prop.image_url)}`, '_blank')
    }
  }

  // --- FILTER LOGIC ---
  const filteredProperties = properties.filter(p => {
    const priceVal = parsePrice(p.price)
    const min = minPrice ? parseInt(minPrice) : 0
    const max = maxPrice ? parseInt(maxPrice) : Infinity
    
    // Type Filter Logic
    const matchesType = selectedTypes.length === 0 || (p.property_type && selectedTypes.includes(p.property_type))
    
    const matchesPrice = priceVal >= min && priceVal <= max
    const matchesSearch = p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.address.toLowerCase().includes(searchQuery.toLowerCase())
    
    return matchesPrice && matchesSearch && matchesType
  })

  // --- RENDER ---
  if (authError) return <div className="flex h-screen items-center justify-center"><button onClick={handleManualLogout}>Login Again</button></div>
  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>

  return (
    <div className="p-5 max-w-md mx-auto relative min-h-screen pb-24">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 text-xs mt-1">Manage your active listings</p>
        </div>
        <div className="flex gap-2">
            <button onClick={() => setShowFilters(!showFilters)} className={`p-3 rounded-full shadow-md active:scale-95 transition-transform ${showFilters ? 'bg-slate-800 text-white' : 'bg-white text-slate-700'}`}>
              <Filter size={20} />
            </button>
            <button onClick={() => setShowAddModal(true)} className="bg-primary hover:bg-blue-200 text-primary-text p-3 rounded-full shadow-md active:scale-95 transition-transform">
              <Plus size={20} strokeWidth={3} />
            </button>
        </div>
      </div>

      {/* FILTER BAR */}
      {showFilters && (
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4 animate-in slide-in-from-top-2 space-y-3">
            {/* Price Row */}
            <div className="flex gap-3">
                <div className="flex-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Min Price</label>
                    <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0" className="w-full bg-slate-50 p-2 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" />
                </div>
                <div className="flex-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Max Price</label>
                    <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Any" className="w-full bg-slate-50 p-2 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" />
                </div>
            </div>

            {/* Type Row (Multi-select) */}
            <div>
               <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Property Type</label>
               <div className="flex gap-2 flex-wrap">
                 {PROPERTY_TYPES.map(type => {
                   const isSelected = selectedTypes.includes(type)
                   return (
                     <button 
                       key={type} 
                       onClick={() => toggleFilterType(type)}
                       className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 ${isSelected ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}
                     >
                       {type} {isSelected && <Check size={12} />}
                     </button>
                   )
                 })}
               </div>
            </div>

            <button onClick={handleCopyFilteredLink} className="w-full bg-blue-50 text-blue-600 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform border border-blue-100">
                <LinkIcon size={14} /> Copy Link for Client
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
          placeholder="Search properties..." 
          className="w-full bg-white border-none py-3 pl-10 pr-4 rounded-xl shadow-sm text-sm text-slate-700 focus:ring-2 focus:ring-primary outline-none" 
        />
      </div>

      {/* List */}
      <div className="flex flex-col gap-4">
        {filteredProperties.length === 0 ? <div className="text-center py-10 text-slate-400 text-sm">No properties found.</div> : (
          filteredProperties.map((prop) => (
            <div 
              key={prop.id} 
              onClick={() => setSelectedProperty(prop)}
              className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-100 relative group cursor-pointer active:scale-95 transition-transform"
            >
              <div className="relative h-40 w-full rounded-2xl overflow-hidden bg-slate-100 mb-3">
                <img src={prop.image_url} alt="Property" className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 flex gap-1">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-white/90 text-slate-700 backdrop-blur-sm">{prop.status}</span>
                    {prop.property_type && <span className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-slate-900/80 text-white backdrop-blur-sm">{prop.property_type}</span>}
                </div>
              </div>
              <div className="px-1 pb-1 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{prop.title || 'Untitled'}</h3>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{prop.price}</p>
                  <div className="flex items-center gap-1.5 text-slate-500 mt-1">
                    <MapPin size={14} />
                    <span className="text-xs font-medium truncate">{prop.address}</span>
                  </div>
                </div>
                <button onClick={(e) => handleNativeShare(e, prop)} className="bg-green-50 text-green-600 p-3 rounded-full hover:bg-green-100 transition-colors active:scale-90">
                  <Share2 size={20} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ADD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">New Listing</h2>
              <button onClick={() => setShowAddModal(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div onClick={() => fileInputRef.current?.click()} className="w-full h-32 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden">
                  <ImageIcon size={24} className="text-slate-400 mb-2"/>
                  <span className="text-xs font-bold text-slate-400 uppercase">Add Photos</span>
                  <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              </div>
              {previews.length > 0 && <div className="flex gap-2 overflow-x-auto pb-2">{previews.map((src, i) => <img key={i} src={src} className="w-16 h-16 rounded-lg object-cover border border-slate-100" />)}</div>}
              
              {/* Type Selector */}
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Type</label>
                  <div className="flex gap-2">
                      {PROPERTY_TYPES.map(type => (
                          <button 
                            key={type}
                            onClick={() => setNewProp({...newProp, property_type: type})}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${newProp.property_type === type ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-500 border-slate-50'}`}
                          >
                              {type}
                          </button>
                      ))}
                  </div>
              </div>

              <input type="text" value={newProp.title} onChange={(e) => setNewProp({...newProp, title: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Title" />
              <input type="text" value={newProp.address} onChange={(e) => setNewProp({...newProp, address: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Address" />
              <input type="text" value={newProp.price} onChange={(e) => setNewProp({...newProp, price: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Price" />
              <textarea value={newProp.description} onChange={(e) => setNewProp({...newProp, description: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Description..." rows={3} />
              <button onClick={handleAddProperty} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold">{isSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODAL (unchanged but includes property_type display) */}
      {selectedProperty && (
        <div className="fixed inset-0 z-[90] bg-white flex flex-col animate-in slide-in-from-bottom-10">
           <div className="absolute top-4 left-4 z-10"><button onClick={() => setSelectedProperty(null)} className="bg-white/80 backdrop-blur-md p-3 rounded-full shadow-sm text-slate-900"><X size={24} /></button></div>
           <div className="h-[45vh] bg-slate-100 w-full overflow-x-auto flex snap-x snap-mandatory scrollbar-hide">{(selectedProperty.images || [selectedProperty.image_url]).map((img, i) => <img key={i} src={img} className="w-full h-full object-cover flex-shrink-0 snap-center" />)}</div>
           <div className="flex-1 p-6 overflow-y-auto bg-white -mt-6 rounded-t-[2rem] relative z-0">
              <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">{selectedProperty.title}</h2>
                    <p className="text-lg font-bold text-primary-text mt-1">{selectedProperty.price}</p>
                  </div>
                  {selectedProperty.property_type && <span className="px-3 py-1 bg-slate-100 rounded-full text-xs font-bold text-slate-500">{selectedProperty.property_type}</span>}
              </div>
              <div className="flex items-center gap-2 text-slate-500 my-4"><MapPin size={18} /><span className="text-sm">{selectedProperty.address}</span></div>
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{selectedProperty.description}</p>
           </div>
        </div>
      )}

    </div>
  )
}