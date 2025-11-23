'use client'

import { useState, useEffect } from 'react'
import { CreditCard, LogOut, ChevronRight, Save, Upload } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    color: '#D0E8FF'
  })
  const [isSaving, setIsSaving] = useState(false)

  // 1. Fetch Data on Load
  useEffect(() => {
    const getData = async () => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/')
        return
      }
      setUserId(user.id)

      // Get profile data from DB
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) {
        setFormData({
          businessName: data.business_name || '',
          mission: data.mission_statement || '',
          color: data.brand_color || '#D0E8FF'
        })
      }
      // Even if no data found (error), we stop loading so user can type and 'Upsert'
      setLoading(false)
    }
    getData()
  }, [router, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // 2. Save Data to DB (The Fixed "Upsert" Logic)
  const handleSave = async () => {
    setIsSaving(true)
    
    // Check user again for safety
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert("No user logged in!")
      setIsSaving(false)
      return
    }

    // We use .upsert() -> Updates if exists, Creates if missing
    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id, // ID is required to create a new row
        email: user.email,
        business_name: formData.businessName,
        mission_statement: formData.mission,
        brand_color: formData.color
      })

    if (error) {
      console.error("Supabase Error:", error)
      alert(`Error saving: ${error.message}`)
    } else {
      // Optional: Visual feedback
      // alert('Saved successfully!') 
    }
    
    setIsSaving(false)
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm">Loading settings...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32">
      
      {/* Header Profile Card Compact */}
      <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 mb-6 flex flex-col items-center text-center relative overflow-hidden">
        {/* Avatar */}
        <div className="w-20 h-20 bg-slate-100 rounded-full mb-3 flex items-center justify-center text-3xl overflow-hidden relative group cursor-pointer">
          <span className="group-hover:opacity-0 transition-opacity">🏢</span>
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Upload size={18} className="text-white" />
          </div>
        </div>
        <h2 className="text-xl font-bold text-slate-800">{formData.businessName || 'Your Business'}</h2>
        <p className="text-slate-400 text-xs">Real Estate Agent</p>
      </div>

      <div className="mb-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          AI Knowledge Base
        </h3>
        
        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-blue-100">
          <div className="space-y-4">
            
            {/* Business Name */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Business Name</label>
              <input 
                type="text" 
                value={formData.businessName}
                onChange={(e) => setFormData({...formData, businessName: e.target.value})}
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none"
                placeholder="e.g. Sunny Isles Realty"
              />
            </div>

            {/* Mission Statement */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Mission / Tagline</label>
              <textarea 
                rows={3}
                value={formData.mission}
                onChange={(e) => setFormData({...formData, mission: e.target.value})}
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm resize-none focus:ring-2 focus:ring-primary outline-none"
                placeholder="Briefly describe your business..."
              />
              <p className="text-[10px] text-blue-400 mt-1 ml-2">The AI uses this to match your tone.</p>
            </div>

            {/* Brand Color */}
            <div>
                 <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Brand Color</label>
                 <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl">
                   <div 
                     className="w-6 h-6 rounded-md shadow-sm border border-slate-200" 
                     style={{ backgroundColor: formData.color }} 
                   />
                   <input 
                      type="text" 
                      value={formData.color}
                      onChange={(e) => setFormData({...formData, color: e.target.value})}
                      className="bg-transparent font-mono text-xs w-full outline-none"
                   />
                 </div>
            </div>

            {/* Save Button */}
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70"
            >
              {isSaving ? 'Saving...' : (
                <>
                  <Save size={16} />
                  Save Business Info
                </>
              )}
            </button>

          </div>
        </div>
      </div>

      {/* Settings Links */}
      <div>
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Settings
        </h3>
        <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden">
          
          <button className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-50">
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-2 rounded-full text-blue-600">
                <CreditCard size={18} />
              </div>
              <span className="font-bold text-sm text-slate-700">Subscription</span>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </button>

          <button 
            onClick={handleSignOut}
            className="w-full p-4 flex items-center justify-between hover:bg-red-50 group transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="bg-red-50 p-2 rounded-full text-red-500 group-hover:bg-red-100 transition-colors">
                <LogOut size={18} />
              </div>
              <span className="font-bold text-sm text-red-500">Sign Out</span>
            </div>
          </button>

        </div>
      </div>

    </div>
  )
}