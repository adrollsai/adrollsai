'use client'

import { useState, useEffect, useRef } from 'react'
// Fixed Import: Added 'X' back to this list 👇
import { Plus, Search, MapPin, X, Loader2, Share2, Image as ImageIcon, Link as LinkIcon, Filter, RefreshCw, LogOut } from 'lucide-react'
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
  user_id: string 
}

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
  const [showFilters, setShowFilters] = useState(false)
  
  // UI State
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sharingId, setSharingId] = useState<string | null>(null)
  
  // Form State
  const [newProp, setNewProp] = useState({ title: '', address: '', price: '', description: '' })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. SAFE FETCH (No Auto-Redirects)
  const fetchProperties = async () => {
    try {
      setLoading(true)
      
      // A. Check User
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        console.warn("Session issue detected:", userError)
        setAuthError(true)
        setLoading(false)
        return
      }
      
      setCurrentUserId(user.id)

      // B. Fetch Inventory
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

  useEffect(() => {
    fetchProperties()
  }, [])

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

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    setPreviews(prev => prev.filter((_, i) => i !== index))
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
          const cleanName = file.name.replace(/[^a-zA-Z0-9]/g, '')
          const fileName = `${user.id}-${Date.now()}-${cleanName}.${fileExt}`
          
          const { error: uploadError } = await supabase.storage
            .from('properties')
            .upload(fileName, file)

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
          status: 'Active',
          image_url: uploadedUrls[0],
          images: uploadedUrls
        })

      if (error) throw error

      await fetchProperties()
      setShowAddModal(false)
      setNewProp({ title: '', address: '', price: '', description: '' })
      setSelectedFiles([])
      setPreviews([])

    } catch (error: any) {
      alert('Error adding property: ' + error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyFilteredLink = () => {
    if (!currentUserId) {
        alert("Error: User ID not found.")
        return
    }
    const params = new URLSearchParams()
    if (minPrice) params.set('min', minPrice)
    if (maxPrice) params.set('max', maxPrice)
    if (searchQuery) params.set('q', searchQuery)
    const shareUrl = `${window.location.origin}/shared/${currentUserId}?${params.toString()}`
    navigator.clipboard.writeText(shareUrl)
    alert("✅ Link Copied!")
  }

  const handleNativeShare = async (e: React.MouseEvent, prop: Property) => {
    e.stopPropagation()
    setSharingId(prop.id)
    try {
      const shareText = `🏡 ${prop.title}\n📍 ${prop.address}\n💰 ${prop.price}`
      if (navigator.share) {
        await navigator.share({ title: prop.title, text: shareText, url: prop.image_url })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (error) { console.log("Share cancelled") } 
    finally { setSharingId(null) }
  }

  // --- FILTER LOGIC ---
  const filteredProperties = properties.filter(p => {
    const priceVal = parsePrice(p.price)
    const min = minPrice ? parseInt(minPrice) : 0
    const max = maxPrice ? parseInt(maxPrice) : Infinity
    const matchesPrice = priceVal >= min && priceVal <= max
    const matchesSearch = p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.address.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesPrice && matchesSearch
  })

  // --- RENDER ---

  if (authError) {
    return (
        <div className="flex h-screen items-center justify-center flex-col gap-4 p-5 text-center">
            <div className="bg-red-50 p-4 rounded-full"><LogOut className="text-red-500" size={32} /></div>
            <h2 className="text-lg font-bold text-slate-800">Session Expired</h2>
            <p className="text-sm text-slate-500 max-w-xs">Your login session has ended. Please sign in again to continue.</p>
            <button 
                onClick={handleManualLogout} 
                className="bg-slate-900 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg hover:scale-105 transition-transform"
            >
                Return to Login
            </button>
        </div>
    )
  }

  if (loading) return (
    <div className="flex h-screen items-center justify-center flex-col gap-4 p-5">
        <Loader2 className="animate-spin text-slate-400" size={32} />
    </div>
  )

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
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4 animate-in slide-in-from-top-2">
            <div className="flex gap-3 mb-3">
                <div className="flex-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Min Price</label>
                    <input type="number" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0" className="w-full bg-slate-50 p-2 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" />
                </div>
                <div className="flex-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Max Price</label>
                    <input type="number" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="Any" className="w-full bg-slate-50 p-2 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" />
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
                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-white/90 text-slate-700 backdrop-blur-sm">{prop.status}</span>
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

      {/* MODALS */}
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
              <input type="text" value={newProp.title} onChange={(e) => setNewProp({...newProp, title: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Title" />
              <input type="text" value={newProp.address} onChange={(e) => setNewProp({...newProp, address: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Address" />
              <input type="text" value={newProp.price} onChange={(e) => setNewProp({...newProp, price: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Price" />
              <textarea value={newProp.description} onChange={(e) => setNewProp({...newProp, description: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Description..." rows={3} />
              <button onClick={handleAddProperty} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold">{isSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {selectedProperty && (
        <div className="fixed inset-0 z-[90] bg-white flex flex-col animate-in slide-in-from-bottom-10">
           <div className="absolute top-4 left-4 z-10"><button onClick={() => setSelectedProperty(null)} className="bg-white/80 backdrop-blur-md p-3 rounded-full shadow-sm text-slate-900"><X size={24} /></button></div>
           <div className="h-[45vh] bg-slate-100 w-full overflow-x-auto flex snap-x snap-mandatory scrollbar-hide">{(selectedProperty.images || [selectedProperty.image_url]).map((img, i) => <img key={i} src={img} className="w-full h-full object-cover flex-shrink-0 snap-center" />)}</div>
           <div className="flex-1 p-6 overflow-y-auto bg-white -mt-6 rounded-t-[2rem] relative z-0">
              <h2 className="text-2xl font-bold text-slate-900">{selectedProperty.title}</h2>
              <p className="text-lg font-bold text-primary-text mt-1">{selectedProperty.price}</p>
              <div className="flex items-center gap-2 text-slate-500 my-4"><MapPin size={18} /><span className="text-sm">{selectedProperty.address}</span></div>
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{selectedProperty.description}</p>
           </div>
        </div>
      )}

    </div>
  )
}