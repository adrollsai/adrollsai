'use client'

import { useState, useEffect, useRef } from 'react'
import { CreditCard, LogOut, ChevronRight, Save, Upload, Loader2, Facebook, Linkedin, CheckCircle, Youtube, Instagram, Globe, Target, Building2, ShieldCheck, User, Camera, Mail, Phone, Building, Palette } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { uploadToR2 } from '@/utils/upload-helper'
import { useOrganization } from '@/components/OrganizationWrapper'

type FBPage = {
  id: string
  name: string
  access_token: string
  category: string
}

type AdAccount = {
  id: string
  name: string
}

type Pixel = {
  id: string
  name: string
}

type ProfileData = {
    role: 'admin' | 'agent'
    organization?: { name: string }
    business_name: string
    contact_number: string
    email: string
}

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()
  const { org, refreshOrg } = useOrganization()
  
  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<'admin' | 'agent'>('agent')
  const [orgName, setOrgName] = useState<string>('')
  
  // Actions
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  
  // Connections
  const [isFacebookConnected, setIsFacebookConnected] = useState(false)
  const [isLinkedinConnected, setIsLinkedinConnected] = useState(false)
  const [isGoogleConnected, setIsGoogleConnected] = useState(false)
  const [isYoutubeConnected, setIsYoutubeConnected] = useState(false) 
  
  const [facebookToken, setFacebookToken] = useState<string | null>(null); 
  
  const [fbPages, setFbPages] = useState<FBPage[]>([])
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]) 
  const [pixels, setPixels] = useState<Pixel[]>([]) 

  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string>('') 
  const [selectedPixelId, setSelectedPixelId] = useState<string>('') 

  const [isLoadingPages, setIsLoadingPages] = useState(false)
  const [isLoadingAdAccounts, setIsLoadingAdAccounts] = useState(false) 
  const [isLoadingPixels, setIsLoadingPixels] = useState(false)

  // Profile Data
  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    color: '#D0E8FF',
    contact: '',
    logoUrl: '',
    facebookUrl: '',
    instagramUrl: '',
    linkedinUrl: '',
    youtubeUrl: ''
  })

  // New Org Form State
  const [orgForm, setOrgForm] = useState({ name: '', color: '#D0E8FF', logo: '' })
  const [isSavingOrg, setIsSavingOrg] = useState(false)
  const orgLogoInputRef = useRef<HTMLInputElement>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- HELPERS ---
  const isValidFacebookToken = (token: string) => token && token.startsWith('EAA')

  // 1. Fetch Pages
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

  // 2. Fetch Ad Accounts
  const fetchAdAccounts = async (token: string) => {
    setIsLoadingAdAccounts(true);
    try {
        const res = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name&access_token=${token}`);
        const data = await res.json();
        
        const formattedAccounts = data.data?.map((acc: any) => ({
            id: acc.id,
            name: acc.name,
        })) || [];

        if (formattedAccounts.length > 0) {
            setAdAccounts(formattedAccounts);
        } else {
            setAdAccounts([]);
        }
    } catch (e) {
        console.error("Network error fetching ad accounts:", e);
        setAdAccounts([]);
    } finally {
        setIsLoadingAdAccounts(false);
    }
  }

  // 3. Fetch Pixels
  const fetchPixels = async (adAccountId: string) => {
    setIsLoadingPixels(true)
    try {
        const res = await fetch('/api/facebook/pixels', {
            method: 'POST',
            body: JSON.stringify({ adAccountId })
        })
        const data = await res.json()
        if (data.pixels) {
            setPixels(data.pixels)
            if (data.pixels.length === 1 && !selectedPixelId) {
                handlePixelSelect(data.pixels[0].id)
            }
        } else {
            setPixels([])
        }
    } catch (e) { 
        console.error(e) 
        setPixels([])
    } 
    finally { setIsLoadingPixels(false) }
  }

  // --- SELECTION HANDLERS ---

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

  const handleAdAccountSelect = async (adAccountId: string) => {
    if (!userId) return

    setSelectedAdAccountId(adAccountId)
    await supabase.from('profiles').update({
      ad_account_id: adAccountId, 
    }).eq('id', userId)

    fetchPixels(adAccountId)
  }

  const handlePixelSelect = async (pixelId: string) => {
    if (!userId) return
    setSelectedPixelId(pixelId)
    await supabase.from('profiles').update({ pixel_id: pixelId }).eq('id', userId)
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

        // UPDATED: Fetch Organization and Role
        const { data: profile } = await supabase
          .from('profiles')
          .select('*, organization:organizations(name, id)') 
          .eq('id', user.id)
          .single()

        if (profile && isMounted) {
          setUserRole(profile.role || 'agent')
          // @ts-ignore
          setOrgName(profile.organization?.name || 'Independent')
          
          setFormData({
            businessName: profile.business_name || '',
            mission: profile.mission_statement || '',
            color: profile.brand_color || '#D0E8FF',
            contact: profile.contact_number || '',
            logoUrl: profile.logo_url || '',
            facebookUrl: profile.facebook_url || '',
            instagramUrl: profile.instagram_url || '',
            linkedinUrl: profile.linkedin_url || '',
            youtubeUrl: profile.youtube_url || ''
          })
          
          // Facebook Logic
          if (profile.facebook_token && isValidFacebookToken(profile.facebook_token)) {
            setIsFacebookConnected(true)
            setFacebookToken(profile.facebook_token); 
            
            if (profile.selected_page_id) setSelectedPageId(profile.selected_page_id)
            else fetchPages()

            if (profile.ad_account_id) {
                setSelectedAdAccountId(profile.ad_account_id)
                fetchPixels(profile.ad_account_id)
            }
            if (profile.pixel_id) setSelectedPixelId(profile.pixel_id)
            
            fetchAdAccounts(profile.facebook_token); 
            
          } else {
             setIsFacebookConnected(false)
             setFacebookToken(null);
             setAdAccounts([]); 
             setPixels([]);
          }

          if (profile.linkedin_token) setIsLinkedinConnected(true)
          if (profile.google_business_token) setIsGoogleConnected(true)
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

  // Load Org Data into Form when context is ready
  useEffect(() => {
    if (org) {
      setOrgForm({
        name: org.name || '',
        color: org.brand_color || '#D0E8FF',
        logo: org.master_logo_url || ''
      })
    }
  }, [org])

  // --- ACTIONS (Connect/Disconnect) ---
  const handleConnectFacebook = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        scopes: 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,business_management,ads_management, pages_manage_ads, leads_retrieval',
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

  const handleDisconnectFacebook = async () => {
    if (!confirm("Disconnect Facebook?")) return
    setIsDisconnecting(true)
    if (userId) {
      await supabase.from('profiles').update({ 
        facebook_token: null, selected_page_id: null, selected_page_name: null, selected_page_token: null,
        ad_account_id: null, pixel_id: null
      }).eq('id', userId)
    }
    setIsFacebookConnected(false)
    setFacebookToken(null)
    setFbPages([])
    setAdAccounts([]) 
    setPixels([])
    setSelectedPageId('')
    setSelectedAdAccountId('') 
    setSelectedPixelId('')
    setIsDisconnecting(false)
  }

  const handleDisconnectLinkedIn = async () => {
    if (!confirm("Disconnect LinkedIn?")) return
    setIsDisconnecting(true)
    if (userId) await supabase.from('profiles').update({ linkedin_token: null, linkedin_urn: null }).eq('id', userId)
    setIsLinkedinConnected(false)
    setIsDisconnecting(false)
  }

  const handleDisconnectGoogleBusiness = async () => {
    if (!confirm("Disconnect Google Business?")) return
    setIsDisconnecting(true)
    if (userId) await supabase.from('profiles').update({ google_business_token: null, google_business_refresh_token: null, google_business_location_id: null }).eq('id', userId)
    setIsGoogleConnected(false)
    setIsDisconnecting(false)
  }

  const handleDisconnectYouTube = async () => {
    if (!confirm("Disconnect YouTube?")) return
    setIsDisconnecting(true)
    if (userId) await supabase.from('profiles').update({ youtube_token: null, youtube_refresh_token: null }).eq('id', userId)
    setIsYoutubeConnected(false)
    setIsDisconnecting(false)
  }

  // --- FILE UPLOADS & SAVING (UPDATED) ---

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      setUploadingLogo(true)
      if (!userId) return

      // R2 UPLOAD
      const file = event.target.files[0]
      const publicUrl = await uploadToR2(file, 'logos')

      setFormData(prev => ({ ...prev, logoUrl: publicUrl }))
      await supabase.from('profiles').update({ logo_url: publicUrl }).eq('id', userId)
      alert("Logo updated!")

    } catch (error: any) {
      alert('Error uploading logo: ' + error.message)
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('profiles').update({
        business_name: formData.businessName,
        mission_statement: formData.mission,
        brand_color: formData.color,
        contact_number: formData.contact,
        logo_url: formData.logoUrl,
        facebook_url: formData.facebookUrl,
        instagram_url: formData.instagramUrl,
        linkedin_url: formData.linkedinUrl,
        youtube_url: formData.youtubeUrl
      }).eq('id', user.id)

    if (error) alert(`Error saving: ${error.message}`)
    else alert("Profile saved successfully!")
    setIsSaving(false)
  }

  const handleSaveOrg = async () => {
    // @ts-ignore
    if (userRole !== 'admin' || !orgName) return
    if (!org?.id) return;

    setIsSavingOrg(true)
    
    // UPDATED: Added .select() to verify the update actually happened
    const { data, error } = await supabase
      .from('organizations')
      .update({
        name: orgForm.name,
        brand_color: orgForm.color,
        master_logo_url: orgForm.logo
      })
      .eq('id', org.id)
      .select() 

    if (error) {
        alert("Failed to update organization: " + error.message)
    } else if (!data || data.length === 0) {
        alert("Update failed: You might not have permission to edit this organization.")
    } else {
        alert("Organization settings saved!")
        // Explicitly await the refresh to ensure data is synced before UI updates
        await refreshOrg() 
    }
    setIsSavingOrg(false)
  }

  const handleOrgLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
       try {
         const url = await uploadToR2(e.target.files[0], 'logos')
         setOrgForm(prev => ({...prev, logo: url}))
       } catch(err) { alert("Upload failed") }
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm animate-pulse">Loading settings...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Your Profile</h1>

      {/* 1. IDENTITY CARD */}
      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-r from-slate-900 to-slate-800 z-0"></div>
          
          <div className="relative z-10 flex flex-col items-center">
              {/* Logo / Avatar */}
              <div className="relative group cursor-pointer" onClick={() => !uploadingLogo && fileInputRef.current?.click()}>
                  <div className="w-24 h-24 rounded-full bg-white border-4 border-white shadow-lg flex items-center justify-center overflow-hidden">
                      {uploadingLogo ? <Loader2 className="animate-spin text-slate-400"/> : formData.logoUrl ? (
                          <img src={formData.logoUrl} className="w-full h-full object-contain" />
                      ) : (
                          <User size={40} className="text-slate-300" />
                      )}
                  </div>
                  <div className="absolute bottom-0 right-0 bg-blue-600 text-white p-2 rounded-full shadow-md group-hover:scale-110 transition-transform">
                      <Camera size={14} />
                  </div>
                  <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
              </div>
              
              <h2 className="mt-3 font-bold text-lg text-slate-900">{formData.businessName || 'Your Business'}</h2>
              <p className="text-xs text-slate-500">{orgName}</p>
              
              <div className="flex items-center gap-2 mt-2">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${userRole === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {userRole}
                  </span>
              </div>
          </div>
      </div>

      {/* NEW: ORGANIZATION SETTINGS (Admin Only) */}
      {userRole === 'admin' && (
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6 relative overflow-hidden">
           <div className="absolute top-0 right-0 p-4 opacity-5"><Building size={100}/></div>
           <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><Building size={18}/> Organization Settings</h3>
           
           <div className="space-y-4 relative z-10">
              {/* Logo Upload */}
              <div className="flex items-center gap-4">
                  <div onClick={() => orgLogoInputRef.current?.click()} className="w-16 h-16 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-blue-300 transition-colors overflow-hidden">
                      {orgForm.logo ? <img src={orgForm.logo} className="w-full h-full object-contain"/> : <Camera size={20} className="text-slate-400"/>}
                  </div>
                  <div>
                      <p className="text-xs font-bold text-slate-700">Company Logo</p>
                      <p className="text-[10px] text-slate-400">Appears in top bar</p>
                  </div>
                  <input type="file" ref={orgLogoInputRef} onChange={handleOrgLogoUpload} className="hidden"/>
              </div>

              {/* Company Name */}
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Company Name</label>
                  <input type="text" value={orgForm.name} onChange={e => setOrgForm({...orgForm, name: e.target.value})} className="w-full bg-slate-50 px-4 py-3 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-primary"/>
              </div>

              {/* Brand Color */}
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Brand Theme Color</label>
                  <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl">
                      <input type="color" value={orgForm.color} onChange={e => setOrgForm({...orgForm, color: e.target.value})} className="w-10 h-10 rounded-lg cursor-pointer border-none bg-transparent"/>
                      <span className="text-xs font-mono text-slate-500">{orgForm.color}</span>
                  </div>
              </div>

              <button onClick={handleSaveOrg} disabled={isSavingOrg} className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                 {isSavingOrg ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Save Organization
              </button>
           </div>
        </div>
      )}

      {/* 2. BRANDING KIT */}
      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6">
          <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><ShieldCheck size={18}/> Branding Kit</h3>
          <p className="text-xs text-slate-500 mb-4 leading-relaxed bg-blue-50 p-3 rounded-xl border border-blue-100">
             These details will be <b>automatically stamped</b> onto every marketing creative you generate from the Feed.
          </p>

          <div className="space-y-4">
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Business Name (On Image)</label>
                  <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/>
                      <input 
                        type="text" 
                        value={formData.businessName} 
                        onChange={e => setFormData({...formData, businessName: e.target.value})}
                        className="w-full bg-slate-50 pl-10 pr-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-slate-200 outline-none font-bold text-slate-700" 
                        placeholder="e.g. Rahul Realtors"
                      />
                  </div>
              </div>

              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Contact Number (On Image)</label>
                  <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/>
                      <input 
                        type="tel" 
                        value={formData.contact} 
                        onChange={e => setFormData({...formData, contact: e.target.value})}
                        className="w-full bg-slate-50 pl-10 pr-4 py-3 rounded-xl text-sm focus:ring-2 focus:ring-slate-200 outline-none font-bold text-slate-700" 
                        placeholder="+91 98765 43210"
                      />
                  </div>
              </div>

              <button onClick={handleSave} disabled={isSaving} className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                 {isSaving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Save Branding
              </button>
          </div>
      </div>

      {/* 3. SOCIAL ACCOUNTS */}
      <div className="mb-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Social Accounts</h3>
        <div className="bg-white rounded-[2rem] shadow-sm border border-blue-100 overflow-hidden p-5 space-y-4">
          
          {/* FACEBOOK */}
          <div>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                <div className="bg-[#1877F2] p-2 rounded-full text-white"><Facebook size={18} fill="white" /></div>
                <div><h4 className="font-bold text-sm text-slate-800">Facebook & Instagram</h4><p className="text-[10px] text-slate-400">{isFacebookConnected ? 'Account Linked' : 'Connect to automate'}</p></div>
                </div>
                {isFacebookConnected ? (
                <button onClick={handleDisconnectFacebook} disabled={isDisconnecting} className="text-[10px] text-red-400 font-bold hover:underline">{isDisconnecting ? '...' : 'Disconnect'}</button>
                ) : (
                <button onClick={handleConnectFacebook} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold">Connect</button>
                )}
            </div>

            {isFacebookConnected && (
                <div className="space-y-4 pt-3">
                    
                    {/* Page Selector */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-11">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Posting Page</label>
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
                            <div className="py-2"><p className="text-xs text-slate-400 mb-2">No pages found.</p></div>
                        )}
                    </div>
                    
                    {/* ADMIN ONLY: ADS & PIXELS */}
                    {userRole === 'admin' && (
                        <>
                            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-11">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ad Account</label>
                                    <button onClick={() => facebookToken && fetchAdAccounts(facebookToken)} className="text-[10px] text-blue-500 font-bold">Refresh</button>
                                </div>
                                {isLoadingAdAccounts ? (
                                    <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 size={14} className="animate-spin"/> Syncing...</div>
                                ) : adAccounts.length > 0 ? (
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                    {adAccounts.map(account => (
                                        <button key={account.id} onClick={() => handleAdAccountSelect(account.id)} className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-all ${selectedAdAccountId === account.id ? 'bg-white shadow-sm border border-green-200 ring-1 ring-green-100' : 'hover:bg-slate-200/50'}`}>
                                        <span className={`text-xs font-bold truncate ${selectedAdAccountId === account.id ? 'text-slate-800' : 'text-slate-500'}`}>{account.name}</span>
                                        {selectedAdAccountId === account.id && <CheckCircle size={16} className="text-green-500 flex-shrink-0" />}
                                        </button>
                                    ))}
                                    </div>
                                ) : (
                                    <div className="py-2"><p className="text-xs text-slate-400">No Ad Accounts.</p></div>
                                )}
                            </div>

                            {selectedAdAccountId && (
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-11">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Pixel</label>
                                        <button onClick={() => fetchPixels(selectedAdAccountId)} className="text-[10px] text-blue-500 font-bold">Refresh</button>
                                    </div>
                                    {isLoadingPixels ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 size={14} className="animate-spin"/> Searching...</div>
                                    ) : pixels.length > 0 ? (
                                        <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {pixels.map(pixel => (
                                            <button key={pixel.id} onClick={() => handlePixelSelect(pixel.id)} className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-all ${selectedPixelId === pixel.id ? 'bg-white shadow-sm border border-green-200 ring-1 ring-green-100' : 'hover:bg-slate-200/50'}`}>
                                            <span className={`text-xs font-bold truncate ${selectedPixelId === pixel.id ? 'text-slate-800' : 'text-slate-500'}`}>{pixel.name}</span>
                                            {selectedPixelId === pixel.id && <CheckCircle size={16} className="text-green-500 flex-shrink-0" />}
                                            </button>
                                        ))}
                                        </div>
                                    ) : (
                                        <div className="py-2"><p className="text-xs text-slate-400">No Pixels found.</p></div>
                                    )}
                                </div>
                            )}
                        </>
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

      {/* ADDITIONAL SETTINGS */}
      <div>
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account Settings</h3>
        <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden">
          <div className="p-4 flex items-center justify-between border-b border-slate-50">
               <div className="flex items-center gap-3">
                   <Mail size={18} className="text-slate-400"/>
                   <span className="text-sm text-slate-600 truncate max-w-[200px]">{userRole} account</span>
               </div>
          </div>
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