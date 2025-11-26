'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, MapPin, X, Loader2, Share2, Image as ImageIcon, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type Property = {
  id: string
  title: string
  address: string
  price: string
  status: string
  image_url: string // Main thumbnail (fallback)
  images: string[]  // Full gallery
  description?: string
}

export default function InventoryPage() {
  const supabase = createClient()
  
  // --- STATE ---
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  
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

  // 1. Fetch Properties
  const fetchProperties = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (data) setProperties(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchProperties()
  }, [])

  // 2. Handle File Selection
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

  // 3. Add Property (Robust with Finally)
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

      // A. Upload Images
      if (selectedFiles.length > 0) {
        const uploadPromises = selectedFiles.map(async (file) => {
          const fileExt = file.name.split('.').pop()
          // Sanitize filename
          const cleanName = file.name.replace(/[^a-zA-Z0-9]/g, '')
          const fileName = `${user.id}-${Date.now()}-${cleanName}.${fileExt}`
          
          const { error: uploadError } = await supabase.storage
            .from('properties')
            .upload(fileName, file)

          if (uploadError) throw uploadError

          const { data: { publicUrl } } = supabase.storage
            .from('properties')
            .getPublicUrl(fileName)
          
          return publicUrl
        })

        const results = await Promise.all(uploadPromises)
        uploadedUrls.push(...results)
      } else {
          // Fallback Placeholder
          uploadedUrls.push(`https://placehold.co/600x400/e2e8f0/475569?text=${encodeURIComponent(newProp.title)}`)
      }

      // B. Insert into DB
      const { error } = await supabase.from('properties').insert({
          user_id: user.id,
          title: newProp.title,
          address: newProp.address,
          price: newProp.price,
          description: newProp.description,
          status: 'Active',
          image_url: uploadedUrls[0], // Main thumb
          images: uploadedUrls        // Full gallery
        })

      if (error) throw error

      // C. Success Cleanup
      await fetchProperties()
      setShowAddModal(false)
      setNewProp({ title: '', address: '', price: '', description: '' })
      setSelectedFiles([])
      setPreviews([])

    } catch (error: any) {
      alert('Error adding property: ' + error.message)
    } finally {
      // D. KILL SWITCH: Ensures loading stops
      setIsSubmitting(false)
    }
  }

  // 4. Smart Share
  const handleNativeShare = async (e: React.MouseEvent, prop: Property) => {
    e.stopPropagation()
    setSharingId(prop.id)

    try {
      const shareText = `🏠 *${prop.title}* \n\n📍 ${prop.address}\n💰 ${prop.price}\n\n${prop.description || ''}\n\n✨ Contact me for details!`

      if (navigator.share) {
        const imagesToShare = (prop.images && prop.images.length > 0) ? prop.images : [prop.image_url]
        
        // Limit to 3 images for sharing to prevent WhatsApp crashing
        const limitedImages = imagesToShare.slice(0, 3)

        const filePromises = limitedImages.map(async (url, index) => {
            const response = await fetch(url)
            const blob = await response.blob()
            return new File([blob], `listing_${index}.jpg`, { type: "image/jpeg" })
        })

        const files = await Promise.all(filePromises)

        await navigator.share({
          files: files,
          title: prop.title,
          text: shareText
        })
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank')
      }
    } catch (error) {
      console.log("Share cancelled")
    } finally {
      setSharingId(null)
    }
  }

  // Filter Logic
  const filteredProperties = properties.filter(p => 
    p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.address.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="p-5 max-w-md mx-auto relative min-h-screen pb-24">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 text-xs mt-1">Manage your active listings</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="bg-primary hover:bg-blue-200 text-primary-text p-3 rounded-full shadow-md active:scale-95 transition-transform">
          <Plus size={20} strokeWidth={3} />
        </button>
      </div>

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
        {loading ? <div className="text-center py-10 text-slate-400 text-sm">Loading...</div> : 
         filteredProperties.length === 0 ? <div className="text-center py-10 text-slate-400 text-sm">No properties found. Click + to add.</div> : (
          filteredProperties.map((prop) => (
            <div 
              key={prop.id} 
              onClick={() => setSelectedProperty(prop)}
              className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-100 relative group cursor-pointer active:scale-95 transition-transform"
            >
              <div className="relative h-40 w-full rounded-2xl overflow-hidden bg-slate-100 mb-3">
                <img src={prop.image_url} alt="Property" className="w-full h-full object-cover" />
                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-white/90 text-slate-700 backdrop-blur-sm">{prop.status}</span>
                {/* Multi-Image Badge */}
                {prop.images && prop.images.length > 1 && (
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm flex items-center gap-1">
                        <ImageIcon size={10} />
                        +{prop.images.length - 1}
                    </div>
                )}
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
                <button 
                  onClick={(e) => handleNativeShare(e, prop)}
                  disabled={sharingId === prop.id}
                  className="bg-green-50 text-green-600 p-3 rounded-full hover:bg-green-100 transition-colors active:scale-90"
                >
                  {sharingId === prop.id ? <Loader2 size={20} className="animate-spin" /> : <Share2 size={20} />}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* --- ADD MODAL --- */}
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
                  <span className="text-xs font-bold text-slate-400 uppercase">Add Photos (Select Multiple)</span>
                  <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              </div>
              {previews.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                    {previews.map((src, i) => (
                        <div key={i} className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden border border-slate-100">
                            <img src={src} className="w-full h-full object-cover" />
                            <button onClick={() => removeFile(i)} className="absolute top-0 right-0 bg-black/50 text-white p-0.5"><X size={10} /></button>
                        </div>
                    ))}
                </div>
              )}
              <input type="text" value={newProp.title} onChange={(e) => setNewProp({...newProp, title: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Title (e.g. Sunset Villa)" />
              <input type="text" value={newProp.address} onChange={(e) => setNewProp({...newProp, address: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Address" />
              <input type="text" value={newProp.price} onChange={(e) => setNewProp({...newProp, price: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Price" />
              <textarea value={newProp.description} onChange={(e) => setNewProp({...newProp, description: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Description..." rows={3} />
              <button onClick={handleAddProperty} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold">{isSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* --- DETAILS MODAL --- */}
      {selectedProperty && (
        <div className="fixed inset-0 z-[90] bg-white flex flex-col animate-in slide-in-from-bottom-10">
           <div className="absolute top-4 left-4 z-10">
             <button onClick={() => setSelectedProperty(null)} className="bg-white/80 backdrop-blur-md p-3 rounded-full shadow-sm text-slate-900"><X size={24} /></button>
           </div>

           <div className="h-[45vh] bg-slate-100 w-full overflow-x-auto flex snap-x snap-mandatory scrollbar-hide">
             {(selectedProperty.images && selectedProperty.images.length > 0 ? selectedProperty.images : [selectedProperty.image_url]).map((img, i) => (
                <img key={i} src={img} className="w-full h-full object-cover flex-shrink-0 snap-center" />
             ))}
           </div>

           <div className="flex-1 p-6 overflow-y-auto bg-white -mt-6 rounded-t-[2rem] relative z-0">
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
              
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedProperty.title}</h2>
                  <p className="text-lg font-bold text-primary-text mt-1">{selectedProperty.price}</p>
                </div>
                <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold h-fit">
                  {selectedProperty.status}
                </span>
              </div>

              <div className="flex items-center gap-2 text-slate-500 mb-6">
                <MapPin size={18} />
                <span className="text-sm">{selectedProperty.address}</span>
              </div>

              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2">Details</h3>
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">
                {selectedProperty.description || "No description available."}
              </p>
           </div>

           <div className="p-4 bg-white border-t border-slate-100 flex gap-3">
              <button 
                onClick={(e) => handleNativeShare(e, selectedProperty)}
                className="flex-1 bg-green-500 text-white py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-md active:scale-95 transition-transform"
              >
                <Share2 size={18} /> Share
              </button>
           </div>
        </div>
      )}

    </div>
  )
}