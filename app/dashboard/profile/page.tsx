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
  Share2,
  BellRing,
  UserPlus,
  Clock,
  Globe,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

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

// --- DOMAIN MANAGER COMPONENT ---
function DomainManager({ initialDomain, userId }: { initialDomain: string, userId: string | null }) {
  const [domain, setDomain] = useState(initialDomain || '')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (initialDomain) setDomain(initialDomain)
  }, [initialDomain])

  const handleConnect = async () => {
    if (!domain) return
    setLoading(true)
    setStatus('idle')

    try {
      // Clean up the input (remove https://, spaces, paths)
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase()
      setDomain(cleanDomain)

      const res = await fetch('/api/domains/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: cleanDomain })
      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to connect domain')
      
      setStatus('success')
    } catch (err: any) {
      setStatus('error')
      setErrorMessage(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Check if it's a subdomain (e.g., has more than one dot, like app.domain.com)
  const isSubdomain = domain.split('.').length > 2

  return (
    <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
      <label className="text-[10px] font-bold text-blue-800 ml-1 block mb-1 flex items-center gap-1">
        <Globe size={10} /> Custom Domain (Optional)
      </label>
      
      <div className="flex gap-2">
        <input 
          type="text" 
          placeholder="www.yourdomain.com" 
          value={domain} 
          onChange={(e) => setDomain(e.target.value)} 
          className="w-full bg-white py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none border border-blue-100" 
        />
        <button 
          onClick={handleConnect}
          disabled={loading || !domain}
          className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'Connect'}
        </button>
      </div>
      
      <p className="text-[9px] text-blue-600/70 ml-1 mt-1 leading-tight">
         Point your domain's CNAME record to <span className="font-mono font-bold">adrolls.in</span>
      </p>

      {status === 'success' && (
        <div className="mt-3 bg-white p-3 rounded-xl border border-green-200">
          <p className="text-xs font-bold text-green-700 flex items-center gap-1 mb-2">
            <CheckCircle2 size={14} /> Domain Linked! Now configure your DNS:
          </p>
          <div className="space-y-2 text-[10px] text-slate-600 bg-slate-50 p-2 rounded-lg font-mono">
            {isSubdomain ? (
              <>
                <div className="flex justify-between border-b border-slate-200 pb-1"><span className="font-bold">Type</span><span>CNAME</span></div>
                <div className="flex justify-between border-b border-slate-200 pb-1"><span className="font-bold">Name</span><span>{domain.split('.')[0]}</span></div>
                <div className="flex justify-between"><span className="font-bold">Value</span><span>cname.vercel-dns.com</span></div>
              </>
            ) : (
              <>
                <div className="flex justify-between border-b border-slate-200 pb-1"><span className="font-bold">Type</span><span>A Record</span></div>
                <div className="flex justify-between border-b border-slate-200 pb-1"><span className="font-bold">Name</span><span>@</span></div>
                <div className="flex justify-between"><span className="font-bold">Value</span><span>76.76.21.21</span></div>
              </>
            )}
          </div>
          <p className="text-[9px] text-slate-400 mt-2 leading-tight">Please allow up to 15 mins for your SSL certificate to generate.</p>
        </div>
      )}

      {status === 'error' && (
        <p className="text-[10px] font-bold text-red-500 mt-2 flex items-center gap-1"><AlertCircle size={12} /> {errorMessage}</p>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()
  
  // --- STATE ---
  const [loading, setLoading] = useState(true)
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

  // Distribution Toggle States
  const [enableDistribution, setEnableDistribution] = useState(false)
  const [isTogglingDist, setIsTogglingDist] = useState(false)
  
  // Testing States
  const [isTestingPush, setIsTestingPush] = useState(false)

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

        const { data: profile } = await supabase
          .from('profiles')
          .select('*, facebook_token, selected_page_id, ad_account_id, pixel_id, custom_domain, role') 
          .eq('id', user.id)
          .single()

        if (profile && isMounted) {
          setRole(profile.role || 'admin') 
          setInitialCustomDomain(profile.custom_domain || '')

          setFormData({
            businessName: profile.business_name || '',
            mission: profile.mission_statement || '',
            color: profile.brand_color || '#D0E8FF',
            contact: profile.contact_number || '',
            logoUrl: profile.logo_url || '',
            facebookUrl: profile.facebook_url || '',
            instagramUrl: profile.instagram_url || ''
          })
          
          setEnableDistribution(profile.enable_distribution || false)

          if (profile.facebook_token && isValidFacebookToken(profile.facebook_token)) {
            setIsFacebookConnected(true)
            setFacebookToken(profile.facebook_token); 
            
            if (profile.selected_page_id) setSelectedPageId(profile.selected_page_id)
            else fetchPages()

            if (profile.ad_account_id) {
                setSelectedAdAccountId(profile.ad_account_id)
                fetchPixels(profile.ad_account_id)
            }
            if (profile.pixel_id) {
                setSelectedPixelId(profile.pixel_id)
            }
            
            fetchAdAccounts(profile.facebook_token); 
            
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

    } catch (error) {
      alert('Error uploading logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleToggleDistribution = async () => {
    if (!userId) return
    const newState = !enableDistribution
    
    setEnableDistribution(newState)
    setIsTogglingDist(true)

    try {
        const { error } = await supabase
            .from('profiles')
            .update({ enable_distribution: newState })
            .eq('id', userId)

        if (error) throw error
        setTimeout(() => window.location.reload(), 500)
    } catch (e: any) {
        setEnableDistribution(!newState)
        alert("Failed to save setting: " + e.message)
    } finally {
        setIsTogglingDist(false)
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
        facebook_url: role === 'admin' ? formData.facebookUrl : undefined,
        instagram_url: role === 'admin' ? formData.instagramUrl : undefined,
      }).eq('id', user.id)

    if (error) {
      alert(`Error saving: ${error.message}`)
    } else {
      alert("Profile Information Saved!")
    }
    setIsSaving(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // --- TESTING FUNCTIONS ---

  const testInstantPush = async () => {
    setIsTestingPush(true)
    try {
        const res = await fetch('/api/test-notification', { method: 'POST' });
        if (res.ok) {
            alert("Push request sent! You should receive it instantly.");
        } else {
            const data = await res.json()
            alert("Failed to send push: " + data.error);
        }
    } catch(e: any) { 
        alert("Error testing push: " + e.message); 
    } finally {
        setIsTestingPush(false)
    }
  }

  const testSimulateLead = async () => {
      if (!userId) return;
      const dummyName = "Tester " + Math.floor(Math.random() * 1000);
      
      const { error } = await supabase.from('leads').insert({
          user_id: userId,
          name: dummyName,
          phone: "9999999999",
      });

      if (!error) {
          alert(`Dummy lead '${dummyName}' added successfully to CRM!`);
      } else {
          alert("Error simulating lead: " + error.message);
      }
  }

  const testScheduleReminder = async () => {
      if (!userId) return;
      
      const oneMinFromNow = new Date(Date.now() + 60000).toISOString();

      const { error } = await supabase.from('leads').insert({
          user_id: userId,
          name: "Reminder Bot",
          phone: "8888888888",
          next_followup: oneMinFromNow
      });

      if (!error) {
          alert("Reminder successfully scheduled! Please wait 1 to 2 minutes for Cron-job.org to trigger your webhook.");
      } else {
          alert("Error scheduling reminder: " + error.message);
      }
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm animate-pulse">Loading settings...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32">
      
      {/* Header */}
      <div className="w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-lg border border-blue-50 flex flex-col items-center text-center">
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
        <h2 className="text-xl font-bold text-slate-800">
          {formData.businessName || (role === 'admin' ? 'Your Business' : 'Your Name')}
        </h2>
        <p className="text-slate-400 text-xs">Tap circle to add photo/logo</p>
      </div>

      {/* Social Accounts (ADMIN ONLY) */}
      {role === 'admin' && (
        <div className="mb-6 mt-6">
          <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Social Accounts</h3>
          <div className="bg-white rounded-[2rem] shadow-sm border border-blue-100 overflow-hidden p-5 space-y-4">
            
            {/* FACEBOOK */}
            <div>
              <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-[#1877F2] p-2 rounded-full text-white">
                      <Facebook size={18} fill="white" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-slate-800">Facebook & Instagram</h4>
                      <p className="text-[10px] text-slate-400">
                        {isFacebookConnected ? 'Account Linked' : 'Connect to automate'}
                      </p>
                    </div>
                  </div>
                  {isFacebookConnected ? (
                  <button onClick={handleDisconnectFacebook} disabled={isDisconnecting} className="text-[10px] text-red-400 font-bold hover:underline">
                    {isDisconnecting ? '...' : 'Disconnect'}
                  </button>
                  ) : (
                  <button onClick={handleConnectFacebook} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-bold">
                    Connect
                  </button>
                  )}
              </div>

              {isFacebookConnected && (
                  <div className="space-y-4 pt-3">
                      
                      {/* Page Selector */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-11">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Posting Page</label>
                            <button onClick={fetchPages} className="text-[10px] text-blue-500 font-bold">Refresh</button>
                        </div>
                        {isLoadingPages ? (
                            <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                              <Loader2 size={14} className="animate-spin"/> Syncing pages...
                            </div>
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
                      
                      {/* AD ACCOUNT SELECTOR */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-11">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Ad Account</label>
                            <button onClick={() => facebookToken && fetchAdAccounts(facebookToken)} className="text-[10px] text-blue-500 font-bold">Refresh</button>
                        </div>
                        {isLoadingAdAccounts ? (
                            <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                              <Loader2 size={14} className="animate-spin"/> Syncing accounts...
                            </div>
                        ) : adAccounts.length > 0 ? (
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                            {adAccounts.map(account => (
                                <button key={account.id} onClick={() => handleAdAccountSelect(account.id)} className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-all ${selectedAdAccountId === account.id ? 'bg-white shadow-sm border border-green-200 ring-1 ring-green-100' : 'hover:bg-slate-200/50'}`}>
                                <span className={`text-xs font-bold truncate ${selectedAdAccountId === account.id ? 'text-slate-800' : 'text-slate-500'}`}>{account.name} ({account.id})</span>
                                {selectedAdAccountId === account.id && <CheckCircle size={16} className="text-green-500 flex-shrink-0" />}
                                </button>
                            ))}
                            </div>
                        ) : (
                            <div className="py-2">
                              <p className="text-xs text-slate-400 mb-2">No Ad Accounts found.</p>
                              <button onClick={handleConnectFacebook} className="text-[10px] text-blue-500 hover:underline">Update Permissions</button>
                            </div>
                        )}
                      </div>

                      {/* PIXEL SELECTOR */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 ml-11">
                          <div className="flex justify-between items-center mb-2">
                              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Select Data Pixel</label>
                              <button onClick={() => selectedAdAccountId && fetchPixels(selectedAdAccountId)} className="text-[10px] text-blue-500 font-bold">Refresh</button>
                          </div>
                          
                          {!selectedAdAccountId ? (
                              <div className="py-2"><p className="text-xs text-slate-400">Select an Ad Account first.</p></div>
                          ) : isLoadingPixels ? (
                              <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                                <Loader2 size={14} className="animate-spin"/> Searching pixels...
                              </div>
                          ) : pixels.length > 0 ? (
                              <div className="space-y-2 max-h-40 overflow-y-auto">
                              {pixels.map(pixel => (
                                  <button key={pixel.id} onClick={() => handlePixelSelect(pixel.id)} className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-all ${selectedPixelId === pixel.id ? 'bg-white shadow-sm border border-green-200 ring-1 ring-green-100' : 'hover:bg-slate-200/50'}`}>
                                  <div className="flex items-center gap-2">
                                      <Target size={14} className={selectedPixelId === pixel.id ? 'text-green-500' : 'text-slate-400'} />
                                      <span className={`text-xs font-bold truncate ${selectedPixelId === pixel.id ? 'text-slate-800' : 'text-slate-500'}`}>{pixel.name}</span>
                                  </div>
                                  {selectedPixelId === pixel.id && <CheckCircle size={16} className="text-green-500 flex-shrink-0" />}
                                  </button>
                              ))}
                              </div>
                          ) : (
                              <div className="py-2"><p className="text-xs text-slate-400">No Pixels found for this account.</p></div>
                          )}
                      </div>
                  </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Business Profile Form */}
      <div className="mb-6 mt-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Business Profile</h3>
        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-blue-100 space-y-4">
            
            {/* INJECTED DOMAIN MANAGER HERE */}
            {role === 'admin' && (
               <DomainManager initialDomain={initialCustomDomain} userId={userId} />
            )}

            {/* Basic Info */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">
                {role === 'admin' ? 'Business Name' : 'Full Name'}
              </label>
              <input 
                type="text" 
                value={formData.businessName} 
                onChange={(e) => setFormData({...formData, businessName: e.target.value})} 
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none" 
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Contact Number</label>
              <input 
                type="tel" 
                value={formData.contact} 
                onChange={(e) => setFormData({...formData, contact: e.target.value})} 
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm font-medium focus:ring-2 focus:ring-primary outline-none" 
              />
            </div>
            
            {role === 'admin' && (
              <div className="pt-4 border-t border-slate-50 mt-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-3 block">Public Social Links</label>
                  <div className="space-y-3">
                      <div className="flex items-center gap-2">
                          <div className="bg-blue-50 p-2 rounded-lg text-blue-600 flex-shrink-0">
                            <Facebook size={16} />
                          </div>
                          <input 
                            type="text" 
                            placeholder="https://facebook.com/..." 
                            value={formData.facebookUrl} 
                            onChange={(e) => setFormData({...formData, facebookUrl: e.target.value})} 
                            className="w-full bg-slate-50 py-2.5 px-3 rounded-xl text-xs outline-none focus:ring-2 focus:ring-primary" 
                          />
                      </div>
                      <div className="flex items-center gap-2">
                          <div className="bg-pink-50 p-2 rounded-lg text-pink-600 flex-shrink-0">
                            <Instagram size={16} />
                          </div>
                          <input 
                            type="text" 
                            placeholder="https://instagram.com/..." 
                            value={formData.instagramUrl} 
                            onChange={(e) => setFormData({...formData, instagramUrl: e.target.value})} 
                            className="w-full bg-slate-50 py-2.5 px-3 rounded-xl text-xs outline-none focus:ring-2 focus:ring-primary" 
                          />
                      </div>
                  </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1 mt-2">Mission / Info</label>
              <textarea 
                rows={3} 
                value={formData.mission} 
                onChange={(e) => setFormData({...formData, mission: e.target.value})} 
                className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm resize-none focus:ring-2 focus:ring-primary outline-none" 
              />
            </div>

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
                  className="bg-transparent font-mono text-xs w-full outline-none uppercase" 
                />
              </div>
            </div>

            <button 
              onClick={handleSave} 
              disabled={isSaving || uploadingLogo} 
              className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70"
            >
              {isSaving ? 'Saving...' : ( <><Save size={16} /> Save Profile Info</> )}
            </button>
        </div>
      </div>

      {/* Settings (ADMIN ONLY) */}
      {role === 'admin' && (
        <div className="mb-6">
          <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Settings</h3>
          <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden">
            
            <div className="p-4 flex items-center justify-between border-b border-slate-50">
              <div className="flex items-center gap-3">
                  <div className="bg-purple-50 p-2 rounded-full text-purple-600">
                    <Share2 size={18} />
                  </div>
                  <div>
                      <span className="font-bold text-sm text-slate-700 block">Distribution Mode</span>
                      <span className="text-[10px] text-slate-400">Enable Agent Distribution Tab</span>
                  </div>
              </div>
              
              <button 
                  onClick={handleToggleDistribution}
                  disabled={isTogglingDist}
                  className={`w-10 h-6 rounded-full p-1 transition-colors relative ${enableDistribution ? 'bg-purple-600' : 'bg-slate-200'}`}
              >
                  {isTogglingDist ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 size={12} className="animate-spin text-white" />
                      </div>
                  ) : (
                      <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${enableDistribution ? 'translate-x-4' : 'translate-x-0'}`} />
                  )}
              </button>
            </div>

            <button className="w-full p-4 flex items-center justify-between hover:bg-slate-50 border-b border-slate-50">
              <div className="flex items-center gap-3">
                <div className="bg-blue-50 p-2 rounded-full text-blue-600">
                  <CreditCard size={18} />
                </div>
                <span className="font-bold text-sm text-slate-700">Subscription</span>
              </div>
              <ChevronRight size={18} className="text-slate-300" />
            </button>
          </div>
        </div>
      )}

      {/* Notification & Developer Testing */}
      <div className="mb-6">
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Developer & Testing</h3>
        <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden p-5 space-y-3">
           
           <button 
              onClick={testInstantPush} 
              disabled={isTestingPush}
              className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
           >
              <div className="bg-blue-100 text-blue-600 p-2 rounded-lg">
                  {isTestingPush ? <Loader2 size={16} className="animate-spin"/> : <BellRing size={16}/>}
              </div>
              <div className="text-left">
                  <p className="text-sm font-bold text-slate-800">Test Push Notification</p>
                  <p className="text-[10px] text-slate-500">Fires instantly to verify delivery</p>
              </div>
           </button>

           <button 
              onClick={testSimulateLead} 
              className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
           >
              <div className="bg-green-100 text-green-600 p-2 rounded-lg">
                  <UserPlus size={16}/>
              </div>
              <div className="text-left">
                  <p className="text-sm font-bold text-slate-800">Simulate New Lead</p>
                  <p className="text-[10px] text-slate-500">Injects a dummy lead into your CRM</p>
              </div>
           </button>

           <button 
              onClick={testScheduleReminder} 
              className="w-full flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
           >
              <div className="bg-orange-100 text-orange-600 p-2 rounded-lg">
                  <Clock size={16}/>
              </div>
              <div className="text-left">
                  <p className="text-sm font-bold text-slate-800">Test 1-Min Reminder</p>
                  <p className="text-[10px] text-slate-500">Schedules a dummy lead for exactly 1 min</p>
              </div>
           </button>

        </div>
      </div>
      
      {/* Sign Out (Everyone) */}
      <div>
        <h3 className="ml-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account Actions</h3>
        <div className="bg-white rounded-[2rem] shadow-sm overflow-hidden">
          <button 
            onClick={handleSignOut} 
            className="w-full p-4 flex items-center justify-between hover:bg-red-50 group"
          >
            <div className="flex items-center gap-3">
              <div className="bg-red-50 p-2 rounded-full text-red-500 group-hover:bg-red-100">
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