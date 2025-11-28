'use client'

import { useState, useEffect, useRef } from 'react'
import { CreditCard, LogOut, ChevronRight, Save, Upload, Phone, Loader2, Facebook, CheckCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

type FBPage = {
  id: string
  name: string
  access_token: string
  category: string
}

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()
  
  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  
  // Actions
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  
  // Facebook Data
  const [isFacebookConnected, setIsFacebookConnected] = useState(false)
  const [fbPages, setFbPages] = useState<FBPage[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [isLoadingPages, setIsLoadingPages] = useState(false)

  // Profile Data
  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    color: '#D0E8FF',
    contact: '',
    logoUrl: ''
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- HELPER: Fetch Facebook Pages ---
  const fetchPages = async () => {
    setIsLoadingPages(true)
    try {
      const res = await fetch('/api/facebook/pages')
      const data = await res.json()
      if (data.pages && Array.isArray(data.pages)) {
        setFbPages(data.pages)
      } else {
        console.log("No pages returned or invalid format:", data)
        setFbPages([])
      }
    } catch (e) {
      console.error("Error fetching pages:", e)
      setFbPages([])
    } finally {
      setIsLoadingPages(false)
    }
  }

  // --- HELPER: Save Selected Page ---
  const handlePageSelect = async (pageId: string) => {
    const page = fbPages.find(p => p.id === pageId)
    if (!page || !userId) return

    setSelectedPageId(pageId)
    
    await supabase.from('profiles').update({
      selected_page_id: page.id,
      selected_page_name: page.name,
      selected_page_token: page.access_token
    }).eq('id', userId)
  }

  // --- CORE: Load Data (With "Kill Switch") ---
  useEffect(() => {
    let isMounted = true

    const init = async () => {
      try {
        // 1. Check Session
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user

        if (!user) {
          if (isMounted) router.push('/')
          return
        }
        if (isMounted) setUserId(user.id)

        // 2. Capture Token if just returned from FB
        const currentToken = session?.provider_token
        if (currentToken) {
          console.log("Capturing fresh FB token...")
          await supabase
            .from('profiles')
            .update({ facebook_token: currentToken })
            .eq('id', user.id)
        }

        // 3. Fetch Profile from DB
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()

        if (profile && isMounted) {
          setFormData({
            businessName: profile.business_name || '',
            mission: profile.mission_statement || '',
            color: profile.brand_color || '#D0E8FF',
            contact: profile.contact_number || '',
            logoUrl: profile.logo_url || ''
          })
          
          // Check FB Status
          if (profile.facebook_token) {
            setIsFacebookConnected(true)
            if (profile.selected_page_id) {
              setSelectedPageId(profile.selected_page_id)
            } else {
              fetchPages()
            }
          } else if (currentToken) {
             setIsFacebookConnected(true)
             fetchPages()
          }
        }

      } catch (error) {
        console.error("Load error:", error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    init()

    // 4. "KILL SWITCH"
    const timer = setTimeout(() => {
      if (isMounted) setLoading(false)
    }, 2500)

    // 5. Auth Listener
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        const token = session?.provider_token
        if (token && session?.user?.id) {
           await supabase.from('profiles').update({ facebook_token: token }).eq('id', session.user.id)
           if (isMounted) {
             setIsFacebookConnected(true)
             fetchPages()
           }
        }
      }
    })

    return () => {
      isMounted = false
      clearTimeout(timer)
      authListener.subscription.unsubscribe()
    }
  }, [router, supabase])

  // --- ACTIONS ---

  const handleConnectFacebook = async () => {
    const { error } = await supabase.auth.linkIdentity({
      provider: 'facebook',
      options: {
        scopes: 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,business_management',
        redirectTo: window.location.origin + '/dashboard/profile',
        queryParams: {
          auth_type: 'rerequest'
        }
      }
    })
    if (error) alert("Link error: " + error.message)
  }

  const handleDisconnectFacebook = async () => {
    if (!confirm("Disconnect Facebook?")) return
    
    setIsDisconnecting(true)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const fbIdentity = user?.identities?.find(id => id.provider === 'facebook')
      
      // FIX: Pass the ENTIRE IDENTITY OBJECT, not just the ID string
      if (fbIdentity) {
        await supabase.auth.unlinkIdentity(fbIdentity)
      }
    } catch (e) {
      console.warn("Auth unlink warning:", e)
    }

    if (userId) {
      await supabase.from('profiles').update({ 
        facebook_token: null,
        selected_page_id: null,
        selected_page_name: null,
        selected_page_token: null
      }).eq('id', userId)
    }

    setIsFacebookConnected(false)
    setFbPages([])
    setSelectedPageId('')
    setIsDisconnecting(false)
  }

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      setUploadingLogo(true)
      if (!userId) return

      const file = event.target.files[0]
      const fileExt = file.name.split('.').pop()
      const fileName = `${userId}-${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, file)
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName)

      setFormData(prev => ({ ...prev, logoUrl: publicUrl }))
      await supabase.from('profiles').update({ logo_url: publicUrl }).eq('id', userId)

    } catch (error) {
      alert('Error uploading logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        email: user.email,
        business_name: formData.businessName,
        mission_statement: formData.mission,
        brand_color: formData.color,
        contact_number: formData.contact,
        logo_url: formData.logoUrl 
      })

    if (error) alert(`Error saving: ${error.message}`)
    setIsSaving(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm animate-pulse">Loading settings...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32">
      
      {/* Header */}
      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6 flex flex-col items-center text-center">
        <div onClick={() => !uploadingLogo && fileInputRef.current?.click()} className="w-24 h-24 bg-slate-50 rounded-full mb-3 flex items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-200 hover:border-primary transition-all">
          {uploadingLogo ? <Loader2 className="animate-spin text-slate-400" /> : formData.logoUrl ? <img src={formData.logoUrl} alt="Logo" className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-1"><Upload size={20} className="text-slate-300" /><span className="text-[8px] text-slate-400 font-bold uppercase">Upload</span></div>}
          <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">{formData.businessName || 'Your Business'}</h2>
        <p className="text-slate-400 text-xs">Tap circle to add logo</p>
      </div>

      {/* Social Accounts */}
      <div className="mb-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Social Accounts</h3>
        <div className="bg-white rounded-[2rem] shadow-sm border border-blue-100 overflow-hidden p-5">
          
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-[#1877F2] p-2 rounded-full text-white"><Facebook size={18} fill="white" /></div>
              <div><h4 className="font-bold text-sm text-slate-800">Facebook</h4><p className="text-[10px] text-slate-400">{isFacebookConnected ? 'Account Linked' : 'Connect to automate'}</p></div>
            </div>
            {isFacebookConnected ? (
              <button onClick={handleDisconnectFacebook} disabled={isDisconnecting} className="text-[10px] text-red-400 font-bold hover:underline">{isDisconnecting ? '...' : 'Disconnect'}</button>
            ) : (
              <button onClick={handleConnectFacebook} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold">Connect</button>
            )}
          </div>

          {isFacebookConnected && (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <div className="flex justify-between items-center mb-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Posting Page</label>
                <button onClick={fetchPages} className="text-[10px] text-blue-500 font-bold">Refresh</button>
              </div>
              {isLoadingPages ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 size={14} className="animate-spin"/> Syncing...</div>
              ) : fbPages.length > 0 ? (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {fbPages.map(page => (
                    <button key={page.id} onClick={() => handlePageSelect(page.id)} className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-all ${selectedPageId === page.id ? 'bg-white shadow-sm border border-green-200 ring-1 ring-green-100' : 'hover:bg-slate-200/50'}`}>
                      <span className={`text-xs font-bold truncate ${selectedPageId === page.id ? 'text-slate-800' : 'text-slate-500'}`}>{page.name}</span>
                      {selectedPageId === page.id && <CheckCircle size={16} className="text-green-500 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-2">
                  <p className="text-xs text-slate-400 mb-2">No pages found.</p>
                  <button onClick={handleConnectFacebook} className="text-[10px] text-blue-500 hover:underline">Update Permissions / Refresh List</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI Form */}
      <div className="mb-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">AI Knowledge Base</h3>
        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-blue-100 space-y-4">
            <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Business Name</label><input type="text" value={formData.businessName} onChange={(e) => setFormData({...formData, businessName: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none" /></div>
            <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Contact Number</label><input type="tel" value={formData.contact} onChange={(e) => setFormData({...formData, contact: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none" /></div>
            <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Mission / Info</label><textarea rows={3} value={formData.mission} onChange={(e) => setFormData({...formData, mission: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm resize-none focus:ring-2 focus:ring-primary outline-none" /></div>
            <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Brand Color</label><div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl"><div className="w-6 h-6 rounded-md shadow-sm border border-slate-200" style={{ backgroundColor: formData.color }} /><input type="text" value={formData.color} onChange={(e) => setFormData({...formData, color: e.target.value})} className="bg-transparent font-mono text-xs w-full outline-none uppercase" /></div></div>
            <button onClick={handleSave} disabled={isSaving || uploadingLogo} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70">{isSaving ? 'Saving...' : ( <><Save size={16} /> Save Business Info</> )}</button>
        </div>
      </div>

      {/* Settings */}
      <div>
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Settings</h3>
        <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden">
          <button className="w-full p-4 flex items-center justify-between hover:bg-slate-50 border-b border-slate-50"><div className="flex items-center gap-3"><div className="bg-blue-50 p-2 rounded-full text-blue-600"><CreditCard size={18} /></div><span className="font-bold text-sm text-slate-700">Subscription</span></div><ChevronRight size={18} className="text-slate-300" /></button>
          <button onClick={handleSignOut} className="w-full p-4 flex items-center justify-between hover:bg-red-50 group"><div className="flex items-center gap-3"><div className="bg-red-50 p-2 rounded-full text-red-500 group-hover:bg-red-100"><LogOut size={18} /></div><span className="font-bold text-sm text-red-500">Sign Out</span></div></button>
        </div>
      </div>

    </div>
  )
}