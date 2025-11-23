'use client'

import { useState, useEffect, useRef } from 'react'
import { CreditCard, LogOut, ChevronRight, Save, Upload, Phone, Loader2, Facebook } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  
  // State to track if user has linked Facebook
  const [isFacebookConnected, setIsFacebookConnected] = useState(false)

  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    color: '#D0E8FF',
    contact: '',
    logoUrl: ''
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 1. Fetch Data
  useEffect(() => {
    const getData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/')
        return
      }
      setUserId(user.id)

      // A. Fetch Profile Data
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profile) {
        setFormData({
          businessName: profile.business_name || '',
          mission: profile.mission_statement || '',
          color: profile.brand_color || '#D0E8FF',
          contact: profile.contact_number || '',
          logoUrl: profile.logo_url || ''
        })
      }

      // B. Check for Facebook Connection
      // Supabase stores linked accounts in the user object
      const facebookIdentity = user.identities?.find(id => id.provider === 'facebook')
      if (facebookIdentity) {
        setIsFacebookConnected(true)
      }

      setLoading(false)
    }
    getData()
  }, [router, supabase])

  // 2. Handle Facebook Connection (FIXED: Uses linkIdentity)
  const handleConnectFacebook = async () => {
    // This connects Facebook to your CURRENT account instead of creating a new one
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'facebook',
      options: {
        // Permissions needed for auto-posting later
        scopes: 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish',
        redirectTo: window.location.origin + '/dashboard/profile'
      }
    })

    if (error) {
      alert("Error linking account: " + error.message)
    }
  }

  // 3. Handle Logo Upload (Auto-Saves to DB)
  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || event.target.files.length === 0) return
      setUploadingLogo(true)
      
      // Safety check
      if (!userId) return;

      const file = event.target.files[0]
      const fileExt = file.name.split('.').pop()
      const fileName = `${userId}-${Date.now()}.${fileExt}`

      // A. Upload
      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, file)

      if (uploadError) throw uploadError

      // B. Get URL
      const { data: { publicUrl } } = supabase.storage
        .from('logos')
        .getPublicUrl(fileName)

      // C. Update State
      setFormData(prev => ({ ...prev, logoUrl: publicUrl }))

      // D. Update Database Immediately
      await supabase
        .from('profiles')
        .update({ logo_url: publicUrl })
        .eq('id', userId)

    } catch (error) {
      alert('Error uploading logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  // 4. Save Text Data
  const handleSave = async () => {
    setIsSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        business_name: formData.businessName,
        mission_statement: formData.mission,
        brand_color: formData.color,
        contact_number: formData.contact,
        logo_url: formData.logoUrl 
      })

    if (error) {
      alert(`Error saving: ${error.message}`)
    } else {
      // Optional: alert('Saved!')
    }
    
    setIsSaving(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm">Loading settings...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32">
      
      {/* HEADER WITH LOGO */}
      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6 flex flex-col items-center text-center">
        <div 
          onClick={() => !uploadingLogo && fileInputRef.current?.click()}
          className="w-24 h-24 bg-slate-50 rounded-full mb-3 flex items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-200 hover:border-primary transition-all"
        >
          {uploadingLogo ? (
            <Loader2 className="animate-spin text-slate-400" />
          ) : formData.logoUrl ? (
            <img src={formData.logoUrl} alt="Logo" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1">
               <Upload size={20} className="text-slate-300" />
               <span className="text-[8px] text-slate-400 font-bold uppercase">Upload</span>
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">{formData.businessName || 'Your Business'}</h2>
        <p className="text-slate-400 text-xs">Tap circle to add logo</p>
      </div>

      {/* SOCIAL ACCOUNTS SECTION */}
      <div className="mb-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Social Accounts
        </h3>
        <div className="bg-white rounded-[2rem] shadow-sm border border-blue-100 overflow-hidden">
          
          <div className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-[#1877F2] p-2 rounded-full text-white">
                <Facebook size={18} fill="white" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-slate-800">Facebook & Instagram</h4>
                <p className="text-[10px] text-slate-400">Required for auto-posting</p>
              </div>
            </div>

            {isFacebookConnected ? (
              <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[10px] font-bold">
                Connected
              </span>
            ) : (
              <button 
                onClick={handleConnectFacebook}
                className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold hover:bg-slate-700 transition-colors"
              >
                Connect
              </button>
            )}
          </div>

        </div>
      </div>

      {/* AI KNOWLEDGE BASE FORM */}
      <div className="mb-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          AI Knowledge Base
        </h3>
        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-blue-100 space-y-4">
            {/* Business Name */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Business Name</label>
              <input 
                type="text" 
                value={formData.businessName}
                onChange={(e) => setFormData({...formData, businessName: e.target.value})}
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            
            {/* Contact */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Contact Number</label>
              <div className="relative">
                <Phone size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="tel" 
                  value={formData.contact}
                  onChange={(e) => setFormData({...formData, contact: e.target.value})}
                  className="w-full bg-slate-50 py-3 pl-10 pr-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
            </div>

            {/* Mission */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Mission / Info</label>
              <textarea 
                rows={3}
                value={formData.mission}
                onChange={(e) => setFormData({...formData, mission: e.target.value})}
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm resize-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>

            {/* Color */}
            <div>
                 <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Brand Color</label>
                 <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl">
                   <div className="w-6 h-6 rounded-md shadow-sm border border-slate-200" style={{ backgroundColor: formData.color }} />
                   <input 
                      type="text" 
                      value={formData.color}
                      onChange={(e) => setFormData({...formData, color: e.target.value})}
                      className="bg-transparent font-mono text-xs w-full outline-none uppercase"
                   />
                 </div>
            </div>

            {/* Save Button */}
            <button 
              onClick={handleSave}
              disabled={isSaving || uploadingLogo}
              className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70"
            >
              {isSaving ? 'Saving...' : ( <><Save size={16} /> Save Business Info</> )}
            </button>
        </div>
      </div>

      {/* SETTINGS LINKS */}
      <div>
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Settings</h3>
        <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden">
          <button className="w-full p-4 flex items-center justify-between hover:bg-slate-50 border-b border-slate-50">
            <div className="flex items-center gap-3">
              <div className="bg-blue-50 p-2 rounded-full text-blue-600"><CreditCard size={18} /></div>
              <span className="font-bold text-sm text-slate-700">Subscription</span>
            </div>
            <ChevronRight size={18} className="text-slate-300" />
          </button>
          <button onClick={handleSignOut} className="w-full p-4 flex items-center justify-between hover:bg-red-50 group">
            <div className="flex items-center gap-3">
              <div className="bg-red-50 p-2 rounded-full text-red-500 group-hover:bg-red-100"><LogOut size={18} /></div>
              <span className="font-bold text-sm text-red-500">Sign Out</span>
            </div>
          </button>
        </div>
      </div>

    </div>
  )
}