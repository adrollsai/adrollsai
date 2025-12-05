'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Search, Tag, X, Loader2, Share2, Image as ImageIcon, Link as LinkIcon, Filter, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

// --- Helper for Price Parsing ---
const parsePrice = (priceStr: string | null) => {
  if (!priceStr) return 0
  return parseInt(priceStr.replace(/[^0-9]/g, '') || '0')
}

// Data Type (Keys match DB, but we treat them generically)
type Item = {
  id: string
  title: string
  address: string // Used as Subtitle/Location
  price: string
  status: string
  imageUrl: string 
  images: string[]
  description?: string
  propertyType?: string // Used as Category
  userId: string 
}

// Generic Categories
const CATEGORIES = ['Product', 'Service', 'Other']

export default function InventoryPage() {
  const router = useRouter()
  
  // --- AUTH STATE ---
  const { data: session, isPending: isAuthLoading } = authClient.useSession()

  // --- DATA STATE ---
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  
  // Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [selectedCats, setSelectedCats] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  
  // UI State
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Form State
  const [newItem, setNewItem] = useState({ 
    title: '', 
    subtitle: '', // Maps to 'address'
    price: '', 
    description: '',
    category: 'Product' // Maps to 'property_type'
  })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. FETCH ITEMS
  const fetchItems = async () => {
    if (!session?.user) return
    try {
      setLoading(true)
      // We still hit the existing API endpoint
      const res = await fetch('/api/properties')
      if (res.ok) {
        const data = await res.json()
        setItems(data)
      }
    } catch (error) {
      console.error("Error loading inventory:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { 
    if (session?.user) fetchItems()
  }, [session])

  // --- ACTIONS ---
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)
      setSelectedFiles(prev => [...prev, ...newFiles])
      const newPreviews = newFiles.map(file => URL.createObjectURL(file))
      setPreviews(prev => [...prev, ...newPreviews])
    }
  }

  const handleAddItem = async () => {
    // Basic Validation
    if (!newItem.subtitle || !newItem.price || !newItem.title) {
        alert("Please fill in Title, Subtitle and Price.")
        return
    }
    setIsSubmitting(true)

    try {
      const uploadedUrls: string[] = []

      // Upload Images
      if (selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          const formData = new FormData()
          formData.append('file', file)

          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          })

          if (!uploadRes.ok) throw new Error('Failed to upload image')
          
          const data = await uploadRes.json()
          uploadedUrls.push(data.url)
        }
      } else {
        uploadedUrls.push(`https://placehold.co/600x400/e2e8f0/475569?text=${encodeURIComponent(newItem.title)}`)
      }

      // Save to DB
      const res = await fetch('/api/properties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newItem.title,
            address: newItem.subtitle, // Mapping subtitle -> address DB field
            price: newItem.price,
            description: newItem.description,
            property_type: newItem.category, // Mapping category -> property_type DB field
            image_url: uploadedUrls[0],
            images: uploadedUrls
          })
      })

      if (!res.ok) throw new Error("Failed to save item")

      await fetchItems()
      setShowAddModal(false)
      setNewItem({ title: '', subtitle: '', price: '', description: '', category: 'Product' })
      setSelectedFiles([])
      setPreviews([])

    } catch (error: any) {
      alert('Error: ' + error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleFilterCat = (cat: string) => {
    setSelectedCats(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const handleCopyFilteredLink = () => {
    if (!session?.user) return
    const params = new URLSearchParams()
    if (minPrice) params.set('min', minPrice)
    if (maxPrice) params.set('max', maxPrice)
    if (searchQuery) params.set('q', searchQuery)
    if (selectedCats.length > 0) params.set('types', selectedCats.join(','))
    
    const shareUrl = `${window.location.origin}/shared/${session.user.id}?${params.toString()}`
    navigator.clipboard.writeText(shareUrl)
    alert("✅ Link Copied!")
  }

  // --- RENDER ---
  
  if (isAuthLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
  
  if (!session) return (
    <div className="flex h-screen items-center justify-center flex-col gap-4">
        <p className="text-slate-500">Please sign in to view dashboard</p>
        <button onClick={() => router.push('/')} className="bg-primary px-4 py-2 rounded-xl text-primary-text font-bold">Go to Login</button>
    </div>
  )

  const filteredItems = items.filter(item => {
    const priceVal = parsePrice(item.price)
    const min = minPrice ? parseInt(minPrice) : 0
    const max = maxPrice ? parseInt(maxPrice) : Infinity
    
    const matchesCat = selectedCats.length === 0 || (item.propertyType && selectedCats.includes(item.propertyType))
    const matchesPrice = priceVal >= min && priceVal <= max
    const matchesSearch = item.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.address.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesPrice && matchesSearch && matchesCat
  })

  return (
    <div className="p-5 max-w-md mx-auto relative min-h-screen pb-24">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 text-xs mt-1">Manage your products & services</p>
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
            <div>
               <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Category</label>
               <div className="flex gap-2 flex-wrap">
                 {CATEGORIES.map(cat => {
                   const isSelected = selectedCats.includes(cat)
                   return (
                     <button 
                       key={cat} 
                       onClick={() => toggleFilterCat(cat)}
                       className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 ${isSelected ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}
                     >
                       {cat} {isSelected && <Check size={12} />}
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
          placeholder="Search items..." 
          className="w-full bg-white border-none py-3 pl-10 pr-4 rounded-xl shadow-sm text-sm text-slate-700 focus:ring-2 focus:ring-primary outline-none" 
        />
      </div>

      {/* List */}
      <div className="flex flex-col gap-4">
        {loading ? <div className="text-center py-10 text-slate-400"><Loader2 className="animate-spin inline mr-2"/> Loading...</div> : 
         filteredItems.length === 0 ? <div className="text-center py-10 text-slate-400 text-sm">No items found.</div> : (
          filteredItems.map((item) => (
            <div 
              key={item.id} 
              onClick={() => setSelectedItem(item)}
              className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-100 relative group cursor-pointer active:scale-95 transition-transform"
            >
              <div className="relative h-40 w-full rounded-2xl overflow-hidden bg-slate-100 mb-3">
                <img src={item.imageUrl} alt="Item" className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 flex gap-1">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-white/90 text-slate-700 backdrop-blur-sm">{item.status}</span>
                    {item.propertyType && <span className="px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-slate-900/80 text-white backdrop-blur-sm">{item.propertyType}</span>}
                </div>
              </div>
              <div className="px-1 pb-1 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{item.title || 'Untitled'}</h3>
                  <p className="text-sm font-bold text-slate-900 mt-0.5">{item.price}</p>
                  <div className="flex items-center gap-1.5 text-slate-500 mt-1">
                    <Tag size={14} />
                    <span className="text-xs font-medium truncate">{item.address}</span>
                  </div>
                </div>
                <div className="bg-green-50 text-green-600 p-3 rounded-full">
                  <Share2 size={20} />
                </div>
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
              <h2 className="text-xl font-bold text-slate-800">New Item</h2>
              <button onClick={() => setShowAddModal(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div onClick={() => fileInputRef.current?.click()} className="w-full h-32 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors relative overflow-hidden">
                  <ImageIcon size={24} className="text-slate-400 mb-2"/>
                  <span className="text-xs font-bold text-slate-400 uppercase">Add Photos</span>
                  <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
              </div>
              {previews.length > 0 && <div className="flex gap-2 overflow-x-auto pb-2">{previews.map((src, i) => <img key={i} src={src} className="w-16 h-16 rounded-lg object-cover border border-slate-100" />)}</div>}
              
              {/* Category Selector */}
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Category</label>
                  <div className="flex gap-2">
                      {CATEGORIES.map(cat => (
                          <button 
                            key={cat}
                            onClick={() => setNewItem({...newItem, category: cat})}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${newItem.category === cat ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-500 border-slate-50'}`}
                          >
                              {cat}
                          </button>
                      ))}
                  </div>
              </div>

              <input type="text" value={newItem.title} onChange={(e) => setNewItem({...newItem, title: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Item Name" />
              <input type="text" value={newItem.subtitle} onChange={(e) => setNewItem({...newItem, subtitle: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Subtitle / Details" />
              <input type="text" value={newItem.price} onChange={(e) => setNewItem({...newItem, price: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Price" />
              <textarea value={newItem.description} onChange={(e) => setNewItem({...newItem, description: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Description..." rows={3} />
              <button onClick={handleAddItem} disabled={isSubmitting} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold">{isSubmitting ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {selectedItem && (
        <div className="fixed inset-0 z-[90] bg-white flex flex-col animate-in slide-in-from-bottom-10">
           <div className="absolute top-4 left-4 z-10"><button onClick={() => setSelectedItem(null)} className="bg-white/80 backdrop-blur-md p-3 rounded-full shadow-sm text-slate-900"><X size={24} /></button></div>
           <div className="h-[45vh] bg-slate-100 w-full overflow-x-auto flex snap-x snap-mandatory scrollbar-hide">{(selectedItem.images || [selectedItem.imageUrl]).map((img, i) => <img key={i} src={img} className="w-full h-full object-cover flex-shrink-0 snap-center" />)}</div>
           <div className="flex-1 p-6 overflow-y-auto bg-white -mt-6 rounded-t-[2rem] relative z-0">
              <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">{selectedItem.title}</h2>
                    <p className="text-lg font-bold text-primary-text mt-1">{selectedItem.price}</p>
                  </div>
                  {selectedItem.propertyType && <span className="px-3 py-1 bg-slate-100 rounded-full text-xs font-bold text-slate-500">{selectedItem.propertyType}</span>}
              </div>
              <div className="flex items-center gap-2 text-slate-500 my-4"><Tag size={18} /><span className="text-sm">{selectedItem.address}</span></div>
              <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">{selectedItem.description}</p>
           </div>
        </div>
      )}

    </div>
  )
}