// adrollsai/adrollsai/adrollsai-builder-app/app/dashboard/profile/page.tsx

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { LogOut, Save, Loader2, Building, Facebook, CheckCircle, Building2, ShieldCheck, User, Camera, Mail, Phone, BadgeCheck, Globe, Award, Lock, Flame, Zap, Crown, Share2, Link as LinkIcon } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { uploadToR2 } from '@/utils/upload-helper'
import { useOrganization } from '@/components/OrganizationWrapper'

// --- LOCAL TYPE DEFINITIONS ---
type OrganizationWithDomain = {
    id: string;
    name: string;
    brand_color: string | null;
    master_logo_url: string | null;
    custom_domain: string | null;
}

type LocalProfile = {
    id: string;
    role: 'admin' | 'agent' | null;
    organization: OrganizationWithDomain | null;
    
    // Core Profile Fields
    business_name: string | null;
    mission_statement: string | null;
    brand_color: string | null;
    contact_number: string | null;
    email: string | null;
    logo_url: string | null;
    
    // Social Fields
    facebook_token: string | null;
    facebook_url: string | null;
    selected_page_id: string | null;
    selected_page_name: string | null;
    selected_page_token: string | null;
    ad_account_id: string | null;
    pixel_id: string | null;
    
    instagram_url: string | null;
    
    // Gamification
    badges: string[] | null;
}

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

// --- BADGE CONFIGURATION ---
const ALL_BADGES = [
    { id: 'streak_7', name: 'Week Warrior', desc: '7 Day Streak', icon: Flame, color: 'text-orange-500', bg: 'bg-orange-100' },
    { id: 'streak_30', name: 'Consistency King', desc: '30 Day Streak', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-100' },
    { id: 'streak_100', name: 'Century Club', desc: '100 Day Streak', icon: Crown, color: 'text-purple-500', bg: 'bg-purple-100' },
    { id: 'social_connected', name: 'Connected', desc: '1 Social Linked', icon: LinkIcon, color: 'text-blue-400', bg: 'bg-blue-50' },
    { id: 'social_networker', name: 'Networker', desc: '2 Socials Linked', icon: Share2, color: 'text-indigo-500', bg: 'bg-indigo-50' },
    { id: 'social_king', name: 'Omnichannel King', desc: 'All Socials Linked', icon: Globe, color: 'text-green-500', bg: 'bg-green-100' },
]

const DEFAULT_APP_HOST = process.env.NEXT_PUBLIC_DEFAULT_HOST || 'app.adrollsai.com' 

export default function ProfilePage() {
  const router = useRouter()
  const supabase = createClient()
  
  const { org: rawOrg, refreshOrg } = useOrganization()
  const org = rawOrg as unknown as OrganizationWithDomain | null

  // --- STATE ---
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<'admin' | 'agent'>('agent')
  const [orgName, setOrgName] = useState<string>('')
  
  // Actions
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  
  // Custom Domain State
  const [customDomainInput, setCustomDomainInput] = useState('')
  const [isSavingCustomDomain, setIsSavingCustomDomain] = useState(false)
  const [saveDomainStatus, setSaveDomainStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  
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

  // Profile Data Form
  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    color: '#D0E8FF',
    contact: '',
    email: '', 
    logoUrl: '',
    facebookUrl: '',
    instagramUrl: ''
  })
  
  // Gamification State
  const [myBadges, setMyBadges] = useState<string[]>([])

  // New Org Form State
  const [orgForm, setOrgForm] = useState({ name: '', color: '#D0E8FF', logo: '' })
  const [isSavingOrg, setIsSavingOrg] = useState(false)
  const orgLogoInputRef = useRef<HTMLInputElement>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- HELPERS ---
  const isValidFacebookToken = (token: string) => token && token.startsWith('EAA')
  
  const getAgentInviteLink = useCallback(() => {
    if (!org?.id) return 'N/A'
    const domain = org.custom_domain || DEFAULT_APP_HOST
    return `https://${domain}/?invite_org=${org.id}`
  }, [org])

  // --- GAMIFICATION CHECK ---
  const checkSocialRewards = async () => {
    try {
        const res = await fetch('/api/gamification/check-socials', { method: 'POST' })
        const data = await res.json()
        
        // Only alert if they earned something NEW
        if (data.success && data.xpGained > 0) {
            let msg = `🎉 Social Connected!`
            msg += `\n\n✨ +${data.xpGained} XP Earned!`
            if (data.earnedBadges && data.earnedBadges.length > 0) {
                msg += `\n🏅 Badge Unlocked: ${data.earnedBadges.join(', ')}`
            }
            if (data.newLevel) {
                 msg += `\n🏆 LEVEL UP! You are now Level ${data.newLevel}!`
            }
            alert(msg)
            
            // Refresh local badge state
            if (data.earnedBadges) {
                // Since API returns names, we might want to just re-fetch profile or update locally if we knew IDs
                // Ideally, re-fetch profile to be safe
                const { data: { user } } = await supabase.auth.getUser()
                if (user) {
                   const { data: p } = await supabase.from('profiles').select('badges').eq('id', user.id).single()
                   if (p?.badges) setMyBadges(p.badges)
                }
            }
        }
    } catch (e) {
        console.error("Gamification check failed:", e)
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

        const { data: rawProfileData, error: profileError } = await supabase
          .from('profiles')
          .select('*, organization:organizations(name, id, custom_domain)') 
          .eq('id', user.id)
          .single()

        if (profileError) throw profileError;

        const profile = rawProfileData as unknown as LocalProfile;

        if (profile && isMounted) {
          setUserRole(profile.role || 'agent')
          setOrgName(profile.organization?.name || 'Independent')
          setMyBadges(profile.badges || [])
          
          setCustomDomainInput(profile.organization?.custom_domain || '') 
          
          setFormData({
            businessName: profile.business_name || '',
            mission: profile.mission_statement || '',
            color: profile.brand_color || '#D0E8FF',
            contact: profile.contact_number || '',
            email: profile.email || user.email || '', 
            logoUrl: profile.logo_url || '',
            facebookUrl: profile.facebook_url || '',
            instagramUrl: profile.instagram_url || ''
          })
          
          // Facebook Logic
          if (profile.facebook_token && isValidFacebookToken(profile.facebook_token)) {
            setIsFacebookConnected(true)
            setFacebookToken(profile.facebook_token); 
            
            // Trigger Gamification Check
            checkSocialRewards() 
            
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
      setCustomDomainInput(org.custom_domain || '') 
    }
  }, [org])

  // --- CUSTOM DOMAIN HANDLER ---
  const handleSaveCustomDomain = async (e: React.FormEvent) => { 
    e.preventDefault()
    if (userRole !== 'admin' || !org?.id) return

    setIsSavingCustomDomain(true)
    setSaveDomainStatus('idle')
    
    const normalizedDomain = customDomainInput.trim().toLowerCase()
    
    if (normalizedDomain === DEFAULT_APP_HOST) {
        alert(`Cannot use the default application host (${DEFAULT_APP_HOST}) as a custom domain.`)
        setIsSavingCustomDomain(false)
        setSaveDomainStatus('error')
        return
    }

    try {
      const response = await fetch('/api/domains/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: normalizedDomain })
      })

      const data = await response.json()

      if (!response.ok) {
          throw new Error(data.error || 'Failed to add domain')
      }

      setCustomDomainInput(data.domain)
      await refreshOrg() 
      setSaveDomainStatus('saved')
      
      if (data.configured === false) {
          alert(`Domain added! To finish, go to your DNS provider (GoDaddy, Namecheap, etc.) and add a CNAME record for "${data.domain}" pointing to "cname.vercel-dns.com".`)
      } else {
          setTimeout(() => setSaveDomainStatus('idle'), 3000)
      }

    } catch (error: any) {
      console.error('Error saving custom domain:', error.message)
      alert('Failed to save custom domain: ' + error.message)
      setSaveDomainStatus('error')
    } finally {
      setIsSavingCustomDomain(false)
    }
  }

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

  // --- FILE UPLOADS & SAVING ---

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!event.target.files || !event.target.files.length) return
      setUploadingLogo(true)
      if (!userId) return

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
        instagram_url: formData.instagramUrl
      }).eq('id', user.id)

    if (error) alert(`Error saving: ${error.message}`)
    else alert("Profile saved successfully!")
    setIsSaving(false)
  }

  const handleSaveOrg = async () => {
    if (userRole !== 'admin' || !org?.id) return;

    setIsSavingOrg(true)
    
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
  
  const isCustomDomainSet = !!org?.custom_domain; 
  const domainButtonText = 
    isSavingCustomDomain ? 'Saving...' : 
    saveDomainStatus === 'saved' ? 'Domain Saved!' : 
    'Save Custom Domain'
    

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Your Profile</h1>

      {/* --- ACTIVE ORGANIZATION BADGE --- */}
      {org && (
          <div className="bg-slate-900 text-white p-5 rounded-2xl flex items-center gap-4 relative overflow-hidden shadow-lg mb-6">
              <div className="absolute right-[-10px] top-[-10px] opacity-10 rotate-12 pointer-events-none">
                  <Building2 size={120}/>
              </div>
              
              <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center overflow-hidden shrink-0 shadow-sm border border-slate-100 z-10">
                  {org.master_logo_url ? (
                      <img src={org.master_logo_url} className="w-full h-full object-contain p-2" alt={org.name} />
                  ) : (
                      <Building2 className="text-slate-900" size={32}/>
                  )}
              </div>

              <div className="z-10">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Active Organization</p>
                  <h2 className="text-xl font-bold leading-tight">{org.name}</h2>
                  <div className="flex items-center gap-1.5 mt-2">
                      <span className="bg-blue-500/20 text-blue-200 text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 border border-blue-500/30">
                          <BadgeCheck size={10} /> {userRole === 'admin' ? 'Administrator' : 'Authorized Agent'}
                      </span>
                  </div>
              </div>
          </div>
      )}

      {/* 1. IDENTITY CARD (AGENT BRANDING) */}
      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-r from-slate-900 to-slate-800 z-0"></div>
          
          <div className="relative z-10 flex flex-col items-center">
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
              <p className="text-xs text-slate-500">Agent @ {orgName}</p>
          </div>
      </div>
      
      {/* --- NEW: TROPHY CABINET --- */}
      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><Award size={18}/> Trophy Cabinet</h3>
              <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded-full text-slate-500">
                  {myBadges.length} / {ALL_BADGES.length} Unlocked
              </span>
          </div>
          
          <div className="grid grid-cols-3 gap-3">
              {ALL_BADGES.map(badge => {
                  const isUnlocked = myBadges.includes(badge.id)
                  const Icon = badge.icon
                  
                  return (
                      <div key={badge.id} className={`flex flex-col items-center p-3 rounded-xl border text-center transition-all ${isUnlocked ? `${badge.bg} border-${badge.color.split('-')[1]}-200` : 'bg-slate-50 border-slate-100 opacity-60 grayscale'}`}>
                          <div className={`p-2 rounded-full mb-2 ${isUnlocked ? 'bg-white shadow-sm' : 'bg-slate-200'}`}>
                              {isUnlocked ? <Icon size={16} className={badge.color}/> : <Lock size={16} className="text-slate-400"/>}
                          </div>
                          <p className={`text-[10px] font-bold leading-tight ${isUnlocked ? 'text-slate-900' : 'text-slate-400'}`}>{badge.name}</p>
                          <p className="text-[9px] text-slate-500 mt-1">{badge.desc}</p>
                      </div>
                  )
              })}
          </div>
      </div>

      {/* ORGANIZATION SETTINGS (Admin Only) */}
      {userRole === 'admin' && org && ( 
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
           
           {/* --- CUSTOM DOMAIN SECTION --- */}
            <div className="border-t border-slate-200 mt-6 pt-6">
                <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2 text-base"><Globe size={18}/> Custom Sign-in Domain</h4>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed bg-yellow-50 p-3 rounded-xl border border-yellow-100">
                    For agents to sign in at a custom URL (e.g., <code className="bg-white p-0.5 rounded text-slate-800">agents.yourcompany.com</code>), enter it below. This requires setting up a **CNAME record** in your DNS.
                </p>
                
                <form onSubmit={handleSaveCustomDomain} className="space-y-4">
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Agent Sign-in Domain</label>
                        <input 
                            type="text" 
                            value={customDomainInput} 
                            onChange={e => setCustomDomainInput(e.target.value)} 
                            placeholder="agents.mycompany.com"
                            disabled={isSavingCustomDomain}
                            className="w-full bg-slate-50 px-4 py-3 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <button type="submit" disabled={isSavingCustomDomain} className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                        isSavingCustomDomain
                            ? 'bg-blue-400 cursor-not-allowed'
                            : saveDomainStatus === 'saved'
                                ? 'bg-green-600 text-white'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}>
                        {isSavingCustomDomain ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} 
                        {domainButtonText}
                    </button>
                </form>

                <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <h5 className="font-bold text-sm text-slate-800 mb-2">Agent Invitation Link</h5>
                    <p className="text-[10px] text-slate-500 mb-2">Share this dynamic link. It redirects agents to sign in on the correct domain.</p>
                    <code className="block p-3 bg-white rounded-lg text-xs break-all text-blue-600 border border-slate-100">
                        <a href={getAgentInviteLink()} target="_blank" rel="noopener noreferrer">
                            {getAgentInviteLink()}
                        </a>
                    </code>
                    {isCustomDomainSet && <p className="text-[10px] text-green-600 mt-2">Currently using custom domain: <span className="font-bold">{org.custom_domain}</span></p>}
                    {!isCustomDomainSet && <p className="text-[10px] text-slate-500 mt-2">Currently using default host: <span className="font-bold">{DEFAULT_APP_HOST}</span></p>}
                </div>
            </div>
        </div>
      )}

      {/* 2. PROFILE & BRANDING */}
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
              
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Email Address (Login)</label>
                  <div className="relative opacity-60">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/>
                      <input 
                        type="email" 
                        value={formData.email} 
                        disabled
                        className="w-full bg-slate-100 pl-10 pr-4 py-3 rounded-xl text-sm outline-none font-bold text-slate-500 cursor-not-allowed" 
                      />
                  </div>
              </div>

              <button onClick={handleSave} disabled={isSaving} className="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
                 {isSaving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Save Branding
              </button>
          </div>
      </div>

      {/* 3. SOCIAL ACCOUNTS (Filtered for Facebook/Insta Only) */}
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