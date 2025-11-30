'use client'

import { useState, useEffect, useRef } from 'react'
import { CreditCard, LogOut, ChevronRight, Save, Upload, Loader2, Facebook, Linkedin, CheckCircle, Youtube } from 'lucide-react'
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
  
  // Connections
  const [isFacebookConnected, setIsFacebookConnected] = useState(false)
  const [isLinkedinConnected, setIsLinkedinConnected] = useState(false)
  const [isGoogleConnected, setIsGoogleConnected] = useState(false)
  const [isYoutubeConnected, setIsYoutubeConnected] = useState(false) 
  
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

  // --- HELPERS ---
  const isValidFacebookToken = (token: string) => token && token.startsWith('EAA')

  const fetchPages = async () => {
    setIsLoadingPages(true)
    try {
      const res = await fetch('/api/facebook/pages')
      const data = await res.json()
      if (data.pages && Array.isArray(data.pages)) {
        setFbPages(data.pages)
      } else {
        setFbPages([])
      }
    } catch (e) {
      console.error("Error fetching pages:", e)
      setFbPages([])
    } finally {
      setIsLoadingPages(false)
    }
  }

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

  // --- CORE: Load Data ---
  useEffect(() => {
    let isMounted = true

    const init = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const errorMsg = params.get('error')

        if (errorMsg) {
          alert(`⚠️ Connection Failed: ${errorMsg}`)
          router.replace('/dashboard/profile')
          return 
        }

        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user

        if (!user) {
          if (isMounted) router.push('/')
          return
        }
        if (isMounted) setUserId(user.id)

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
          
          // Facebook
          if (profile.facebook_token && isValidFacebookToken(profile.facebook_token)) {
            setIsFacebookConnected(true)
            if (profile.selected_page_id) {
              setSelectedPageId(profile.selected_page_id)
            } else {
              fetchPages()
            }
          } else {
             setIsFacebookConnected(false)
          }

          // LinkedIn
          if (profile.linkedin_token) setIsLinkedinConnected(true)

          // Google Business
          if (profile.google_business_token) setIsGoogleConnected(true)

          // YouTube (Check for youtube_token)
          if (profile.youtube_token) setIsYoutubeConnected(true)
        }

      } catch (error) {
        console.error("Load error:", error)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    init()
    
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
         if (isMounted) init() 
      }
    })

    return () => {
      isMounted = false
      authListener.subscription.unsubscribe()
    }
  }, [router, supabase])

  // --- ACTIONS ---

  const handleConnectFacebook = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        scopes: 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,business_management',
        redirectTo: window.location.origin + '/auth/callback?next=/dashboard/profile&provider=facebook',
      }
    })
    if (error) alert("Connection error: " + error.message)
  }

  const handleConnectLinkedIn = async () => {
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'linkedin_oidc',
      options: {
        scopes: 'openid profile email w_member_social',
        redirectTo: window.location.origin + '/auth/callback?next=/dashboard/profile&provider=linkedin_oidc',
      }
    })
    if (data?.url) window.location.href = data.url
    if (error) alert("Connection error: " + error.message)
  }

  const handleConnectGoogleBusiness = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/business.manage',
        queryParams: { access_type: 'offline', prompt: 'consent' },
        redirectTo: window.location.origin + '/auth/callback?next=/dashboard/profile&provider=google_business',
      }
    })
    if (error) alert("Connection error: " + error.message)
  }

  const handleConnectYouTube = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google', 
      options: {
        scopes: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
        redirectTo: window.location.origin + '/auth/callback?next=/dashboard/profile&provider=youtube',
      }
    })
    if (error) alert("Connection error: " + error.message)
  }

  // --- DISCONNECT HANDLERS ---

  const handleDisconnectFacebook = async () => {
    if (!confirm("Disconnect Facebook?")) return
    setIsDisconnecting(true)
    if (userId) {
      await supabase.from('profiles').update({ 
        facebook_token: null, selected_page_id: null, selected_page_name: null, selected_page_token: null
      }).eq('id', userId)
    }
    setIsFacebookConnected(false)
    setFbPages([])
    setSelectedPageId('')
    setIsDisconnecting(false)
  }

  const handleDisconnectLinkedIn = async () => {
    if (!confirm("Disconnect LinkedIn?")) return
    setIsDisconnecting(true)
    if (userId) {
      await supabase.from('profiles').update({ 
        linkedin_token: null, linkedin_urn: null 
      }).eq('id', userId)
    }
    setIsLinkedinConnected(false)
    setIsDisconnecting(false)
  }

  const handleDisconnectGoogleBusiness = async () => {
    if (!confirm("Disconnect Google Business?")) return
    setIsDisconnecting(true)
    if (userId) {
      await supabase.from('profiles').update({ 
        google_business_token: null, google_business_refresh_token: null, google_business_location_id: null
      }).eq('id', userId)
    }
    setIsGoogleConnected(false)
    setIsDisconnecting(false)
  }

  const handleDisconnectYouTube = async () => {
    if (!confirm("Disconnect YouTube? This will allow you to select a different channel on reconnect.")) return
    setIsDisconnecting(true)
    if (userId) {
      await supabase.from('profiles').update({ 
        youtube_token: null, youtube_refresh_token: null
      }).eq('id', userId)
    }
    setIsYoutubeConnected(false)
    setIsDisconnecting(false)
  }

  // --- FILE UPLOADS & SAVING ---

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
        <div className="bg-white rounded-[2rem] shadow-sm border border-blue-100 overflow-hidden p-5 space-y-4">
          
          {/* FACEBOOK */}
          <div>
            <div className="flex items-center justify-between mb-2">
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
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-11">
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

          {/* LINKEDIN */}
          <div className="border-t border-slate-50 pt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-[#0077b5] p-2 rounded-full text-white"><Linkedin size={18} fill="white" /></div>
                    <div>
                        <h4 className="font-bold text-sm text-slate-800">LinkedIn</h4>
                        <p className="text-[10px] text-slate-400">{isLinkedinConnected ? 'Account Linked' : 'Connect to automate'}</p>
                    </div>
                </div>
                {isLinkedinConnected ? (
                    <button onClick={handleDisconnectLinkedIn} disabled={isDisconnecting} className="text-[10px] text-red-400 font-bold hover:underline">{isDisconnecting ? '...' : 'Disconnect'}</button>
                ) : (
                    <button onClick={handleConnectLinkedIn} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold">Connect</button>
                )}
            </div>
          </div>

          {/* YOUTUBE */}
          <div className="border-t border-slate-50 pt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-[#FF0000] p-2 rounded-full text-white"><Youtube size={18} fill="white" /></div>
                    <div>
                        <h4 className="font-bold text-sm text-slate-800">YouTube</h4>
                        <p className="text-[10px] text-slate-400">{isYoutubeConnected ? 'Shorts & Videos Ready' : 'Connect Channel'}</p>
                    </div>
                </div>
                {isYoutubeConnected ? (
                    <button onClick={handleDisconnectYouTube} disabled={isDisconnecting} className="text-[10px] text-red-400 font-bold hover:underline">{isDisconnecting ? '...' : 'Disconnect'}</button>
                ) : (
                    <button onClick={handleConnectYouTube} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold">Connect</button>
                )}
            </div>
          </div>

          {/* GOOGLE BUSINESS */}
          <div className="border-t border-slate-50 pt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-white border border-slate-200 p-2 rounded-full text-slate-900">
                        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    </div>
                    <div>
                        <h4 className="font-bold text-sm text-slate-800">Google Business</h4>
                        <p className="text-[10px] text-slate-400">{isGoogleConnected ? 'Account Linked' : 'Connect to automate'}</p>
                    </div>
                </div>
                {isGoogleConnected ? (
                    <button onClick={handleDisconnectGoogleBusiness} disabled={isDisconnecting} className="text-[10px] text-red-400 font-bold hover:underline">{isDisconnecting ? '...' : 'Disconnect'}</button>
                ) : (
                    <button onClick={handleConnectGoogleBusiness} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold">Connect</button>
                )}
            </div>
          </div>

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