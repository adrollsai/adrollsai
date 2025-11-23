'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, MapPin, X, Loader2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// Define the shape of a Property
type Property = {
  id: string
  address: string
  price: string
  status: string
  image_url: string
}

export default function InventoryPage() {
  const supabase = createClient()
  
  // State
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Form State
  const [newProp, setNewProp] = useState({ address: '', price: '' })

  // 1. Fetch Properties on Load
  const fetchProperties = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
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

  // 2. Add New Property
  const handleAddProperty = async () => {
    if (!newProp.address || !newProp.price) return
    setIsSubmitting(true)

    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // We generate a fake image URL for now based on the address text
      const fakeImage = `https://placehold.co/600x400/e2e8f0/475569?text=${encodeURIComponent(newProp.address)}`

      const { error } = await supabase
        .from('properties')
        .insert({
          user_id: user.id,
          address: newProp.address,
          price: newProp.price,
          status: 'Draft',
          image_url: fakeImage
        })

      if (!error) {
        // Refresh list and close modal
        await fetchProperties()
        setShowModal(false)
        setNewProp({ address: '', price: '' })
      } else {
        alert('Error adding property')
      }
    }
    setIsSubmitting(false)
  }

  return (
    <div className="p-5 max-w-md mx-auto relative">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-slate-500 text-xs mt-1">Manage your active listings</p>
        </div>
        
        {/* Plus Button - Opens Modal */}
        <button 
          onClick={() => setShowModal(true)}
          className="bg-primary hover:bg-blue-200 text-primary-text p-3 rounded-full shadow-md active:scale-95 transition-transform"
        >
          <Plus size={20} strokeWidth={3} />
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          <Search size={18} />
        </div>
        <input 
          type="text" 
          placeholder="Search address..." 
          className="w-full bg-white border-none py-3 pl-10 pr-4 rounded-xl shadow-sm text-sm text-slate-700 focus:ring-2 focus:ring-primary outline-none"
        />
      </div>

      {/* Property List */}
      <div className="flex flex-col gap-4 pb-24">
        {loading ? (
           <div className="text-center py-10 text-slate-400 text-sm">Loading properties...</div>
        ) : properties.length === 0 ? (
           <div className="text-center py-10 text-slate-400 text-sm">
             No properties yet. Click <b>+</b> to add one.
           </div>
        ) : (
          properties.map((prop) => (
            <div key={prop.id} className="bg-white p-3 rounded-[1.5rem] shadow-sm border border-slate-100">
              
              {/* Image */}
              <div className="relative h-32 w-full rounded-2xl overflow-hidden bg-slate-100 mb-3">
                <img 
                  src={prop.image_url} 
                  alt="Property" 
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm bg-slate-100 text-slate-600">
                  {prop.status}
                </span>
              </div>

              {/* Info */}
              <div className="px-1 pb-1">
                <h3 className="text-lg font-bold text-slate-800">{prop.price}</h3>
                <div className="flex items-center gap-1.5 text-slate-500 mt-0.5">
                  <MapPin size={14} />
                  <span className="text-xs font-medium">{prop.address}</span>
                </div>
              </div>

            </div>
          ))
        )}
      </div>

      {/* --- ADD PROPERTY MODAL --- */}
      {showModal && (
        <div className="fixed inset-0 z-[80] bg-black/20 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10">
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">New Listing</h2>
              <button onClick={() => setShowModal(false)} className="bg-slate-100 p-2 rounded-full text-slate-500">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Address</label>
                <input 
                  type="text" 
                  autoFocus
                  value={newProp.address}
                  onChange={(e) => setNewProp({...newProp, address: e.target.value})}
                  placeholder="e.g. 123 Main St"
                  className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Price</label>
                <input 
                  type="text" 
                  value={newProp.price}
                  onChange={(e) => setNewProp({...newProp, price: e.target.value})}
                  placeholder="e.g. $1,500,000"
                  className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none"
                />
              </div>

              <button 
                onClick={handleAddProperty}
                disabled={isSubmitting}
                className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 mt-2 active:scale-95 transition-transform"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Property'
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}