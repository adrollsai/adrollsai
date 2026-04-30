'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  CreditCard, 
  LogOut, 
  ChevronRight, 
  Save, 
  Upload, 
  Loader2, 
  Facebook, 
  CheckCircle, 
  Instagram, 
  Target, 
  Globe,
  CheckCircle2,
  AlertCircle,
  FileText,
  Shield,
  RefreshCw
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import PushManager from '@/components/PushManager'

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

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in ms

// --- DOMAIN MANAGER COMPONENT ---
function DomainManager({ initialDomain, userId, onDomainUpdate }: { initialDomain: string, userId: string | null, onDomainUpdate: (domain: string) => void }) {
  const [domain, setDomain] = useState(initialDomain || '')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (initialDomain) {
        setDomain(initialDomain)
        setStatus('success')
    }
  }, [initialDomain])

  const handleConnect = async () => {
    if (!domain) return
    setLoading(true)
    setStatus('idle')

    try {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
      setDomain(cleanDomain)

      // Assuming your API route is updated to handle both POST and DELETE at /api/domains
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: cleanDomain, userId })
      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to connect domain')
      
      setStatus('success')
      onDomainUpdate(cleanDomain)
      
      // Update local cache quietly
      if (userId) {
          const cacheKey = `profile_cache_${userId}`
          const cached = localStorage.getItem(cacheKey)
          if (cached) {
              const parsed = JSON.parse(cached)
              localStorage.setItem(cacheKey, JSON.stringify({ ...parsed, custom_domain: cleanDomain }))
          }
      }

    } catch (err: any) {
      setStatus('error')
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleUnlink = async () => {
    if (!confirm(`Are you sure you want to unlink ${domain}? Your custom landing page will stop working immediately.`)) return;
    
    setLoading(true)
    setStatus('idle')

    try {
      const res = await fetch('/api/domains', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, userId })
      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to unlink domain')
      
      setDomain('')
      setStatus('idle')
      onDomainUpdate('')
      
      // Update local cache quietly
      if (userId) {
          const cacheKey = `profile_cache_${userId}`
          const cached = localStorage.getItem(cacheKey)
          if (cached) {
              const parsed = JSON.parse(cached)
              localStorage.setItem(cacheKey, JSON.stringify({ ...parsed, custom_domain: null }))
          }
      }

    } catch (err: any) {
      setStatus('error')
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  const isSubdomain = domain.split('.').length > 2

  return (
    <div className="bg-blue-50/60 p-5 rounded-3xl border border-blue-100/50 mt-4 transition-all">
      <label className="text-xs font-bold text-blue-800 ml-1 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
        <Globe size={14} /> Custom Domain (Optional)
      </label>
      
      <div className="flex flex-col sm:flex-row gap-3">
        <input 
          type="text" 
          placeholder="www.yourdomain.com" 
          value={domain} 
          onChange={(e) => setDomain(e.target.value)} 
          disabled={status === 'success'}
          className="w-full bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-blue-100 shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed" 
        />
        
        {status === 'success' ? (
             <button 
                onClick={handleUnlink}
                disabled={loading}
                className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-6 py-3.5 rounded-2xl sm:rounded-full text-sm font-bold whitespace-nowrap active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Unlink Domain'}
              </button>
        ) : (
            <button 
              onClick={handleConnect}
              disabled={loading || !domain}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3.5 rounded-2xl sm:rounded-full text-sm font-bold whitespace-nowrap active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Connect'}
            </button>
        )}
      </div>
      
      {status !== 'success' && (
          <p className="text-xs text-blue-600/80 ml-2 mt-3 leading-tight font-medium">
             Point your domain's CNAME record to <span className="font-mono font-bold bg-blue-100/50 px-1.5 py-0.5 rounded-md text-blue-800">adrolls.in</span>
          </p>
      )}

      {status === 'success' && (
        <div className="mt-4 bg-white p-5 rounded-3xl border border-green-200 shadow-sm animate-in fade-in slide-in-from-top-2">
          <p className="text-sm font-bold text-green-700 flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} /> Domain Linked! Configure DNS:
          </p>
          <div className="space-y-2.5 text-xs text-slate-600 bg-slate-50/80 p-4 rounded-2xl font-mono border border-slate-100">
            {isSubdomain ? (
              <>
                <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="font-bold">Type</span><span>CNAME</span></div>
                <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="font-bold">Name</span><span>{domain.split('.')[0]}</span></div>
                <div className="flex justify-between pt-1"><span className="font-bold">Value</span><span className="text-right break-all">cname.vercel-dns.com</span></div>
              </>
            ) : (
              <>
                <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="font-bold">Type</span><span>A Record</span></div>
                <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="font-bold">Name</span><span>@</span></div>
                <div className="flex justify-between pt-1"><span className="font-bold">Value</span><span>76.76.21.21</span></div>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-3 ml-1 leading-tight">Please allow up to 15 mins for your SSL certificate to generate.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="mt-3 bg-red-50 p-3 rounded-2xl border border-red-100">
           <p className="text-xs font-bold text-red-600 flex items-center gap-1.5"><AlertCircle size={14} /> {errorMessage}</p>
        </div>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()
  
  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  
  // ROLE STATE
  const [role, setRole] = useState<'admin' | 'agent'>('agent')
  
  // Actions
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  
  // Connections
  const [isFacebookConnected, setIsFacebookConnected] = useState(false)
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
  const [initialCustomDomain, setInitialCustomDomain] = useState<string>('')
  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    color: '#D0E8FF',
    contact: '',
    logoUrl: '',
    facebookUrl: '',
    instagramUrl: ''
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- HELPERS ---
  const isValidFacebookToken = (token: string) => token && token.startsWith('EAA')

  const updateLocalCache = (updates: any) => {
      if (!userId) return;
      const cacheKey = `profile_cache_${userId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
          const parsed = JSON.parse(cached);
          localStorage.setItem(cacheKey, JSON.stringify({ ...parsed, ...updates }));
      }
  }

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
    
    updateLocalCache({ selected_page_id: page.id, selected_page_name: page.name, selected_page_token: page.access_token })
  }

  const handleAdAccountSelect = async (adAccountId: string) => {
    if (!userId) return

    setSelectedAdAccountId(adAccountId)
    await supabase.from('profiles').update({
      ad_account_id: adAccountId, 
    }).eq('id', userId)

    updateLocalCache({ ad_account_id: adAccountId })
    fetchPixels(adAccountId)
  }

  const handlePixelSelect = async (pixelId: string) => {
    if (!userId) return
    setSelectedPixelId(pixelId)
    await supabase.from('profiles').update({ pixel_id: pixelId }).eq('id', userId)
    updateLocalCache({ pixel_id: pixelId })
  }

  // --- CORE: Fetch Profile ---
  const fetchProfile = async (force = false) => {
    try {
      if (!force && !userId) setLoading(true)
      if (force) setIsRefreshing(true)

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
        router.push('/')
        return
      }
      setUserId(user.id)

      const cacheKey = `profile_cache_${user.id}`
      const timeKey = `profile_time_${user.id}`

      let profileData = null

      if (!force) {
        const cachedData = localStorage.getItem(cacheKey)
        const lastFetch = localStorage.getItem(timeKey)
        const now = Date.now()

        if (cachedData) {
          profileData = JSON.parse(cachedData)
          setLoading(false)
          if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) {
            // Cache is fresh
          } else {
            profileData = null // Expired, fetch fresh
          }
        }
      }

      if (!profileData) {
        const { data } = await supabase
          .from('profiles')
          .select('*, facebook_token, selected_page_id, ad_account_id, pixel_id, custom_domain, role') 
          .eq('id', user.id)
          .single()

        profileData = data
        if (data) {
           localStorage.setItem(cacheKey, JSON.stringify(data))
           localStorage.setItem(timeKey, Date.now().toString())
        }
      }

      if (profileData) {
        setRole(profileData.role || 'admin') 
        setInitialCustomDomain(profileData.custom_domain || '')

        setFormData({
          businessName: profileData.business_name || '',
          mission: profileData.mission_statement || '',
          color: profileData.brand_color || '#D0E8FF',
          contact: profileData.contact_number || '',
          logoUrl: profileData.logo_url || '',
          facebookUrl: profileData.facebook_url || '',
          instagramUrl: profileData.instagram_url || ''
        })
        
        if (profileData.facebook_token && isValidFacebookToken(profileData.facebook_token)) {
          setIsFacebookConnected(true)
          setFacebookToken(profileData.facebook_token);
          if (profileData.selected_page_id) setSelectedPageId(profileData.selected_page_id)
          else fetchPages()

          if (profileData.ad_account_id) {
              setSelectedAdAccountId(profileData.ad_account_id)
              fetchPixels(profileData.ad_account_id)
          }
          if (profileData.pixel_id) {
              setSelectedPixelId(profileData.pixel_id)
          }
          
          fetchAdAccounts(profileData.facebook_token);
        } else {
           setIsFacebookConnected(false)
           setFacebookToken(null);
           setAdAccounts([]); 
           setPixels([]);
        }
      }

    } catch (error) {
      console.error("Load error:", error)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    fetchProfile(false)
    
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          fetchProfile(true) 
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [router, supabase])

  // --- ACTIONS ---
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

  const handleDisconnectFacebook = async () => {
    if (!confirm("Disconnect Facebook?")) return
    setIsDisconnecting(true)
    if (userId) {
      await supabase.from('profiles').update({ 
        facebook_token: null, selected_page_id: null, selected_page_name: null, selected_page_token: null,
        ad_account_id: null, pixel_id: null
      }).eq('id', userId)
      
      updateLocalCache({ 
          facebook_token: null, selected_page_id: null, selected_page_name: null, selected_page_token: null,
          ad_account_id: null, pixel_id: null
      })
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
      updateLocalCache({ logo_url: publicUrl })

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

    const updates = {
        business_name: formData.businessName,
        mission_statement: formData.mission,
        brand_color: formData.color,
        contact_number: formData.contact,
        logo_url: formData.logoUrl,
        facebook_url: role === 'admin' ? formData.facebookUrl : undefined,
        instagram_url: role === 'admin' ? formData.instagramUrl : undefined,
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)

    if (error) {
      alert(`Error saving: ${error.message}`)
    } else {
      alert("Profile Information Saved!")
      updateLocalCache(updates)
    }
    setIsSaving(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400 gap-4">
          <Loader2 className="animate-spin text-slate-300" size={32} />
          <p className="text-sm font-medium animate-pulse">Loading workspace...</p>
      </div>
  )

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">
      
      {/* FIXED REFRESH BUTTON */}
      <button 
          onClick={() => fetchProfile(true)}
          className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
          title="Refresh Profile"
      >
          <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-8 ml-1">Workspace Settings</h1>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          
          {/* ========================================= */}
          {/* LEFT COLUMN (Profile, Business, Domain) */}
          {/* ========================================= */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Header Identity Card */}
            <div className="bg-white rounded-[2rem] p-8 sm:p-10 shadow-sm border border-slate-200/60 flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left transition-all hover:shadow-md">
              <div 
                onClick={() => !uploadingLogo && fileInputRef.current?.click()} 
                className="w-28 h-28 bg-slate-50/80 rounded-full flex shrink-0 items-center justify-center overflow-hidden relative group cursor-pointer border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 transition-all shadow-sm"
              >
                {uploadingLogo ? (
                  <Loader2 className="animate-spin text-slate-400" size={28}/>
                ) : formData.logoUrl ? (
                  <>
                    <img src={formData.logoUrl} alt="Logo" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                       <Upload size={24} className="text-slate-800 drop-shadow-md" />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-slate-400 group-hover:text-blue-500 transition-colors">
                    <Upload size={24} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Logo</span>
                  </div>
                )}
                <input type="file" ref={fileInputRef} onChange={handleLogoUpload} accept="image/*" className="hidden" />
              </div>
              <div className="flex-1 mt-2">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  {formData.businessName || (role === 'admin' ? 'Your Business' : 'Your Name')}
                </h2>
                <p className="text-slate-500 text-sm leading-relaxed max-w-md">
                  Personalize your workspace. The logo and name you set here will be reflected across your client-facing tools.
                </p>
              </div>
            </div>

            {/* Business Profile Form Card */}
            <div className="bg-white p-6 sm:p-8 rounded-[2rem] shadow-sm border border-slate-200/60 space-y-6 transition-all hover:shadow-md">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-2">
                    <div className="bg-blue-100 text-blue-600 p-2.5 rounded-full">
                        <FileText size={20} />
                    </div>
                    <h3 className="font-bold text-lg text-slate-800">Profile Details</h3>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">
                            {role === 'admin' ? 'Business Name' : 'Full Name'}
                        </label>
                        <input 
                            type="text" 
                            value={formData.businessName} 
                            onChange={(e) => setFormData({...formData, businessName: e.target.value})} 
                            className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" 
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Contact Number</label>
                        <input 
                            type="tel" 
                            value={formData.contact} 
                            onChange={(e) => setFormData({...formData, contact: e.target.value})} 
                            className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" 
                        />
                    </div>
                    
                    {role === 'admin' && (
                        <div className="pt-4 mt-2">
                            <label className="text-xs font-bold text-slate-500 ml-2 block mb-3 uppercase tracking-wider">Public Social Links</label>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="bg-[#1877F2]/10 text-[#1877F2] p-3 rounded-2xl shrink-0">
                                        <Facebook size={20} />
                                    </div>
                                    <input 
                                        type="text" 
                                        placeholder="https://facebook.com/..." 
                                        value={formData.facebookUrl} 
                                        onChange={(e) => setFormData({...formData, facebookUrl: e.target.value})} 
                                        className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" 
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="bg-[#E1306C]/10 text-[#E1306C] p-3 rounded-2xl shrink-0">
                                        <Instagram size={20} />
                                    </div>
                                    <input 
                                        type="text" 
                                        placeholder="https://instagram.com/..." 
                                        value={formData.instagramUrl} 
                                        onChange={(e) => setFormData({...formData, instagramUrl: e.target.value})} 
                                        className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" 
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 mt-2 uppercase tracking-wider">Mission Statement</label>
                        <textarea 
                            rows={3} 
                            value={formData.mission} 
                            onChange={(e) => setFormData({...formData, mission: e.target.value})} 
                            className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white py-4 px-5 rounded-3xl text-slate-800 text-sm font-medium resize-none focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" 
                        />
                    </div>

                    <div className="pb-2">
                        <label className="text-xs font-bold text-slate-500 ml-2 block mb-2 uppercase tracking-wider">Brand Color</label>
                        <div className="flex items-center gap-3 bg-slate-50 hover:bg-slate-100/50 focus-within:bg-white p-2.5 rounded-2xl border border-slate-200/60 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/20 transition-all">
                            <div 
                                className="w-8 h-8 rounded-xl shadow-inner border-2 border-white" 
                                style={{ backgroundColor: formData.color }} 
                            />
                            <input 
                                type="text" 
                                value={formData.color} 
                                onChange={(e) => setFormData({...formData, color: e.target.value})} 
                                className="bg-transparent font-mono text-sm w-full outline-none uppercase text-slate-700 font-medium px-2" 
                            />
                        </div>
                    </div>

                    {/* DOMAIN MANAGER HERE */}
                    {role === 'admin' && (
                        <div className="pt-2 border-t border-slate-100">
                            <DomainManager 
                                initialDomain={initialCustomDomain} 
                                userId={userId} 
                                onDomainUpdate={(newDomain) => setInitialCustomDomain(newDomain)} 
                            />
                        </div>
                    )}
                </div>

                <button 
                    onClick={handleSave} 
                    disabled={isSaving || uploadingLogo} 
                    className="w-full mt-6 bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-[1.5rem] sm:rounded-full text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20 active:scale-95 transition-all disabled:opacity-70 disabled:scale-100"
                >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} 
                    {isSaving ? 'Saving Changes...' : 'Save Profile Details'}
                </button>
            </div>
          </div>

          {/* ========================================= */}
          {/* RIGHT COLUMN (Social, Notification, Setting)*/}
          {/* ========================================= */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Inline Push Manager */}
            <div className="rounded-[2rem] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <PushManager variant="inline" />
            </div>

            {/* Social Accounts (ADMIN ONLY) */}
            {role === 'admin' && (
                <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md">
                    <div className="p-6 sm:p-7">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3.5">
                                <div className="bg-[#1877F2] p-3 rounded-full text-white shadow-md shadow-[#1877F2]/20">
                                    <Facebook size={20} fill="white" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-base text-slate-900">Meta Integrations</h4>
                                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                                        {isFacebookConnected ? 'Connected & Active' : 'Link ad accounts & pages'}
                                    </p>
                                </div>
                            </div>
                            {isFacebookConnected ? (
                                <button onClick={handleDisconnectFacebook} disabled={isDisconnecting} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-full font-bold transition-colors">
                                    {isDisconnecting ? '...' : 'Unlink'}
                                </button>
                            ) : (
                                <button onClick={handleConnectFacebook} className="bg-[#1877F2] hover:bg-[#166FE5] text-white px-5 py-2 rounded-full text-xs font-bold shadow-sm transition-colors">
                                    Connect
                                </button>
                            )}
                        </div>

                        {isFacebookConnected && (
                            <div className="space-y-4 pt-4 border-t border-slate-100 mt-2">
                                {/* Page Selector */}
                                <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-100">
                                    <div className="flex justify-between items-center mb-3 px-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Linked Page</label>
                                        <button onClick={fetchPages} className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-colors">Refresh List</button>
                                    </div>
                                    {isLoadingPages ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-500 py-3 px-2 font-medium">
                                            <Loader2 size={16} className="animate-spin text-blue-500"/> Syncing pages...
                                        </div>
                                    ) : fbPages.length > 0 ? (
                                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                        {fbPages.map(page => (
                                            <button key={page.id} onClick={() => handlePageSelect(page.id)} className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${selectedPageId === page.id ? 'bg-white shadow-sm border border-blue-200 ring-2 ring-blue-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}>
                                            <span className={`text-sm font-bold truncate pr-3 ${selectedPageId === page.id ? 'text-blue-900' : 'text-slate-600'}`}>{page.name}</span>
                                            {selectedPageId === page.id && <CheckCircle size={18} className="text-blue-600 shrink-0" />}
                                            </button>
                                        ))}
                                        </div>
                                    ) : (
                                        <div className="py-3 px-2">
                                            <p className="text-sm text-slate-500 mb-2 font-medium">No pages found.</p>
                                            <button onClick={handleConnectFacebook} className="text-xs text-blue-600 font-bold hover:underline">Update Permissions</button>
                                        </div>
                                    )}
                                </div>
                                
                                {/* AD ACCOUNT SELECTOR */}
                                <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-100">
                                    <div className="flex justify-between items-center mb-3 px-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ad Account</label>
                                        <button onClick={() => facebookToken && fetchAdAccounts(facebookToken)} className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-colors">Refresh List</button>
                                    </div>
                                    {isLoadingAdAccounts ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-500 py-3 px-2 font-medium">
                                            <Loader2 size={16} className="animate-spin text-blue-500"/> Syncing accounts...
                                        </div>
                                    ) : adAccounts.length > 0 ? (
                                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                        {adAccounts.map(account => (
                                            <button key={account.id} onClick={() => handleAdAccountSelect(account.id)} className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${selectedAdAccountId === account.id ? 'bg-white shadow-sm border border-emerald-200 ring-2 ring-emerald-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}>
                                            <span className={`text-sm font-bold truncate pr-3 ${selectedAdAccountId === account.id ? 'text-emerald-900' : 'text-slate-600'}`}>{account.name}</span>
                                            {selectedAdAccountId === account.id && <CheckCircle size={18} className="text-emerald-600 shrink-0" />}
                                            </button>
                                        ))}
                                        </div>
                                    ) : (
                                        <div className="py-3 px-2">
                                            <p className="text-sm text-slate-500 mb-2 font-medium">No Ad Accounts found.</p>
                                            <button onClick={handleConnectFacebook} className="text-xs text-blue-600 font-bold hover:underline">Update Permissions</button>
                                        </div>
                                    )}
                                </div>

                                {/* PIXEL SELECTOR */}
                                <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-100">
                                    <div className="flex justify-between items-center mb-3 px-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data Pixel</label>
                                        <button onClick={() => selectedAdAccountId && fetchPixels(selectedAdAccountId)} className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-colors">Refresh List</button>
                                    </div>
                                    
                                    {!selectedAdAccountId ? (
                                        <div className="py-3 px-2"><p className="text-sm text-slate-500 font-medium">Select an Ad Account first.</p></div>
                                    ) : isLoadingPixels ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-500 py-3 px-2 font-medium">
                                            <Loader2 size={16} className="animate-spin text-blue-500"/> Searching pixels...
                                        </div>
                                    ) : pixels.length > 0 ? (
                                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                        {pixels.map(pixel => (
                                            <button key={pixel.id} onClick={() => handlePixelSelect(pixel.id)} className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-left transition-all ${selectedPixelId === pixel.id ? 'bg-white shadow-sm border border-purple-200 ring-2 ring-purple-500/20' : 'hover:bg-slate-200/50 bg-slate-100/50'}`}>
                                            <div className="flex items-center gap-3 truncate pr-3">
                                                <Target size={16} className={selectedPixelId === pixel.id ? 'text-purple-600 shrink-0' : 'text-slate-400 shrink-0'} />
                                                <span className={`text-sm font-bold truncate ${selectedPixelId === pixel.id ? 'text-purple-900' : 'text-slate-600'}`}>{pixel.name}</span>
                                            </div>
                                            {selectedPixelId === pixel.id && <CheckCircle size={18} className="text-purple-600 shrink-0" />}
                                            </button>
                                        ))}
                                        </div>
                                    ) : (
                                        <div className="py-3 px-2"><p className="text-sm text-slate-500 font-medium">No Pixels found for this account.</p></div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Settings (ADMIN ONLY) */}
            {role === 'admin' && (
                <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200/60 overflow-hidden transition-all hover:shadow-md">
                    <button onClick={() => router.push('/dashboard/billing')} className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors border-b border-slate-100">
                        <div className="flex items-center gap-4">
                            <div className="bg-blue-100 text-blue-600 p-3 rounded-2xl">
                                <CreditCard size={20} />
                            </div>
                            <span className="font-bold text-sm text-slate-900">Subscription & Billing</span>
                        </div>
                        <ChevronRight size={20} className="text-slate-400" />
                    </button>

                    <button onClick={() => router.push('/dashboard/team')} className="w-full p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-4">
                            <div className="bg-emerald-100 text-emerald-600 p-3 rounded-2xl">
                                <Shield size={20} />
                            </div>
                            <span className="font-bold text-sm text-slate-900">Team Management</span>
                        </div>
                        <ChevronRight size={20} className="text-slate-400" />
                    </button>
                </div>
            )}
            
            {/* Sign Out */}
            <div className="bg-white rounded-[2rem] shadow-sm border border-red-100 overflow-hidden transition-all hover:border-red-200 hover:shadow-md">
                <button 
                    onClick={handleSignOut} 
                    className="w-full p-5 flex items-center justify-between bg-red-50/30 hover:bg-red-50 group transition-colors"
                >
                    <div className="flex items-center gap-4">
                        <div className="bg-red-100 text-red-500 p-3 rounded-2xl group-hover:scale-110 group-hover:bg-red-500 group-hover:text-white transition-all duration-300">
                            <LogOut size={20} />
                        </div>
                        <span className="font-bold text-sm text-red-600 group-hover:text-red-700 transition-colors">Sign Out Securely</span>
                    </div>
                </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}