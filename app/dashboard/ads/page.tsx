'use client'

import { useState, useEffect, useRef } from 'react'
import { Zap, Plus, X, Loader2, Building2, Image as ImageIcon, Upload, RefreshCw, ExternalLink, ShoppingBag, LayoutGrid, List } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useOrganization } from '@/components/OrganizationWrapper'

// --- TYPES ---
type Property = {
  id: string
  title: string
  price: string
  image_url: string
  description?: string
}

type Asset = {
    id: string
    type: 'image' | 'video'
    url: string
}

type Campaign = {
    id: string
    name: string
    status: string 
    objective: string
}

type MarketplaceAd = {
  id: string
  title: string
  description: string
  price: number
  image_url: string
}

const GENDERS = ['All', 'Male', 'Female']

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // 1. GET USER ROLE FROM CONTEXT
  const { org, userRole } = useOrganization()
  
  // --- TABS STATE ---
  const [activeTab, setActiveTab] = useState<'campaigns' | 'market'>('campaigns')

  // --- CORE STATE ---
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [adCredits, setAdCredits] = useState<number>(0) // NEW: Credits State

  // --- DATA STATE ---
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
  const [marketAds, setMarketAds] = useState<MarketplaceAd[]>([]) 
  const [properties, setProperties] = useState<Property[]>([])
  const [assets, setAssets] = useState<Asset[]>([]) 
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string | null>(null)
  const [facebookToken, setFacebookToken] = useState<string | null>(null)

  // --- FORM STATE ---
  const [adForm, setAdForm] = useState({
    sourceType: 'inventory' as 'inventory' | 'asset' | 'localUpload', 
    selectedSourceIds: [] as string[], 
    targetLocation: '',
    gender: 'All',
    dailyBudgetINR: 500,
    pageId: '', 
    linkUrl: 'https://yourbusiness.com', 
    privacyPolicyUrl: '', 
  })
  
  const [localCreatives, setLocalCreatives] = useState<File[]>([]);
  const [localCreativePreviews, setLocalCreativePreviews] = useState<string[]>([]);

  const isVideoFile = (file: File) => file.type.startsWith('video/');

  // --- DATA FETCHING ---
  const fetchCampaigns = async () => {
      try {
          const res = await fetch('/api/meta-ads/campaigns');
          const data = await res.json();
          if (data.campaigns) setCampaigns(data.campaigns);
      } catch (e) {
          console.error("Failed to load campaigns", e);
      }
  }

  const fetchMarketAds = async () => {
    const { data, error } = await supabase.from('ads').select('*')
    if (error) console.error("Error fetching market ads:", error)
    else setMarketAds(data || [])
  }

  // --- HANDLERS ---
  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      setTogglingId(id);
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));

      try {
          const res = await fetch('/api/meta-ads/update-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaignId: id, newStatus })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
      } catch (error: any) {
          alert(`Failed to update status: ${error.message}`);
          setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: currentStatus } : c));
      } finally {
          setTogglingId(null);
      }
  }

  const handleBuyMarketAd = async (ad: MarketplaceAd) => {
    setBuyingId(ad.id)
    try {
      const response = await fetch('/api/phonepe/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            amount: ad.price,
            adId: ad.id // Passing Ad ID for fulfillment
        }),
      })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert('Payment initiation failed. Check console.')
      }
    } catch (error) {
      console.error(error)
      alert('Payment Error')
    } finally {
      setBuyingId(null)
    }
  }

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // 1. Fetch Profile + Role + Credits
      const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token, ad_account_id, selected_page_id, role, ad_credits') 
        .eq('id', user.id)
        .single()
      
      if (profile) {
        setFacebookToken(profile.facebook_token)
        setSelectedAdAccountId(profile.ad_account_id)
        setAdForm(prev => ({...prev, pageId: profile.selected_page_id || ''}))
        setAdCredits(profile.ad_credits || 0) // Set Credits
        
        // 2. Fetch Market Ads only if Agent
        if (profile.role === 'agent') {
            await fetchMarketAds();
        }

        if (profile.ad_account_id) await fetchCampaigns();
      }

      const [propsRes, assetsRes] = await Promise.all([
          supabase.from('properties').select('id, title, price, image_url, description').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('assets').select('id, type, url').eq('user_id', user.id).order('created_at', { ascending: false })
      ])

      if (propsRes.data) setProperties(propsRes.data)
      if (assetsRes.data) setAssets(assetsRes.data as Asset[])

      setLoading(false)
    }
    loadData()
    return () => { localCreativePreviews.forEach(url => URL.revokeObjectURL(url)); };
  }, [])
  
  // --- CAMPAIGN LAUNCH HANDLER ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files).slice(0, 3); 
        localCreativePreviews.forEach(url => URL.revokeObjectURL(url));
        setLocalCreatives(files);
        setLocalCreativePreviews(files.map(file => URL.createObjectURL(file)));
        setAdForm(prev => ({...prev, sourceType: 'localUpload', selectedSourceIds: []}))
    }
  }

  const handleSourceIdChange = (id: string) => {
    setAdForm(prev => ({...prev, selectedSourceIds: id ? [id] : []}));
  }

  const handleLaunchCampaign = async () => {
    if (isSubmitting) return
    if (!adForm.pageId) { alert("Please ensure a Facebook Page is selected in Profile."); return }
    if (!selectedAdAccountId) { alert("Please select an Ad Account in the Profile tab."); return }
    
    if (adForm.sourceType === 'localUpload' && localCreatives.length === 0) {
        alert("Please select at least one file to upload."); return;
    }
    if (adForm.sourceType !== 'localUpload' && adForm.selectedSourceIds.length === 0) {
        alert("Please select a Property or Asset."); return;
    }
    if (!adForm.targetLocation || adForm.dailyBudgetINR < 100) { alert("Please set a target location and a reasonable budget."); return }
    if (!adForm.privacyPolicyUrl) { alert("A Privacy Policy URL is required."); return; }
    
    // NEW: Check Credits before Launching
    if (userRole === 'agent' && adCredits < adForm.dailyBudgetINR) {
        alert(`Insufficient Credits. You need ₹${adForm.dailyBudgetINR} but have ₹${adCredits}. Please buy a package from the Marketplace.`);
        setActiveTab('market'); // Redirect to Market
        return;
    }
    
    setIsSubmitting(true)
    
    const formPayload = new FormData();
    formPayload.append('adAccountId', selectedAdAccountId);
    formPayload.append('facebookToken', facebookToken || '');
    formPayload.append('pageId', adForm.pageId);
    formPayload.append('sourceType', adForm.sourceType);
    formPayload.append('targetLocation', adForm.targetLocation);
    formPayload.append('gender', adForm.gender);
    formPayload.append('dailyBudgetINR', (adForm.dailyBudgetINR * 100).toString()); 
    formPayload.append('linkUrl', adForm.linkUrl);
    formPayload.append('privacyPolicyUrl', adForm.privacyPolicyUrl);

    adForm.selectedSourceIds.forEach((id) => {
        formPayload.append('selectedSourceIds', id);
    });

    localCreatives.forEach((file, index) => {
        formPayload.append(`creativeFiles[${index}]`, file, file.name); 
    });

    try {
      const res = await fetch('/api/meta-ads/launch-campaign', {
        method: 'POST',
        body: formPayload, 
      })

      const data = await res.json()

      if (res.ok) {
        alert(`${data.message}`);
        setIsModalOpen(false)
        setAdForm(prev => ({ ...prev, selectedSourceIds: [], targetLocation: '', dailyBudgetINR: 500 })) 
        setLocalCreatives([]);
        setLocalCreativePreviews([]);
        fetchCampaigns();
      } else {
        throw new Error(data.error || 'Ad Campaign Failed to Start');
      }
      
    } catch (e: any) {
      console.error(e);
      alert('Launch Failed: ' + e.message);
    } finally {
      setIsSubmitting(false)
    }
  }

  const activePreviewUrl = (adForm.sourceType === 'inventory' && adForm.selectedSourceIds.length > 0)
    ? properties.find(p => p.id === adForm.selectedSourceIds[0])?.image_url
    : (adForm.sourceType === 'asset' && adForm.selectedSourceIds.length > 0)
    ? assets.find(a => a.id === adForm.selectedSourceIds[0])?.url
    : null;

  return (
    <div className="p-5 max-w-4xl mx-auto min-h-screen pb-24">
      {/* HEADER */}
      <div className="flex justify-between items-end mb-6">
        <div>
            <div className="flex items-center gap-2">
               {org?.master_logo_url && <img src={org.master_logo_url} className="w-6 h-6 object-contain" />}
               <h1 className="text-2xl font-bold text-slate-900">Ads Center</h1>
            </div>
            
            <div className="flex gap-4 items-center mt-1">
                <p className="text-slate-500 text-xs">Manage campaigns & Buy ad slots</p>
                {/* CREDIT DISPLAY */}
                {userRole === 'agent' && (
                    <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                        Available Credits: ₹{adCredits}
                    </div>
                )}
            </div>
        </div>
        <div className="flex gap-2">
            <button onClick={() => { fetchCampaigns(); if(userRole==='agent') fetchMarketAds(); }} className="bg-white text-slate-500 p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform"><RefreshCw size={20} /></button>
            {activeTab === 'campaigns' && (
              <button onClick={() => setIsModalOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white p-3 rounded-full shadow-md active:scale-95 transition-transform">
                <Plus size={20} strokeWidth={3} />
              </button>
            )}
        </div>
      </div>

      {/* VISIBILITY CHECK: Hide Marketplace for non-agents */}
      {userRole === 'agent' ? (
          <div className="flex p-1 bg-slate-100 rounded-xl mb-6 w-fit">
            <button 
              onClick={() => setActiveTab('campaigns')}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'campaigns' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List size={16} /> My Campaigns
            </button>
            <button 
              onClick={() => setActiveTab('market')}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'market' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutGrid size={16} /> Marketplace
            </button>
          </div>
      ) : (
          <div className="mb-6"><h2 className="font-bold text-slate-800">Your Campaigns</h2></div>
      )}

      {/* --- CONTENT: CAMPAIGNS TAB --- */}
      {activeTab === 'campaigns' && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300"> 
          {campaigns.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-100">
                  No active campaigns. <br/>Tap '+' to launch a new Lead Gen campaign.
              </div>
          ) : (
              campaigns.map(campaign => (
                  <div key={campaign.id} className="bg-white p-5 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 transition-all hover:border-blue-200">
                      <div className="flex justify-between items-start mb-3">
                          <div className="max-w-[65%]">
                              <h3 className="text-sm font-bold text-slate-800 truncate leading-tight">{campaign.name}</h3>
                              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{campaign.objective.replace('OUTCOME_', '')}</p>
                          </div>
                          <div className="flex items-center gap-2">
                              {togglingId === campaign.id && <Loader2 size={12} className="animate-spin text-slate-400" />}
                              <button onClick={() => handleToggleStatus(campaign.id, campaign.status)} className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out ${campaign.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-200'}`}>
                                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${campaign.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} />
                              </button>
                          </div>
                      </div>
                      <div className="flex justify-between items-center text-xs text-slate-500 pt-3 border-t border-slate-50">
                          <span className="font-mono text-[10px] opacity-60">ID: {campaign.id.slice(-6)}</span>
                          <a href={`https://adsmanager.facebook.com/ads/manager/account/campaigns/`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline">Ads Manager <ExternalLink size={10} /></a>
                      </div>
                  </div>
              ))
          )}
        </div>
      )}

      {/* --- CONTENT: MARKETPLACE TAB --- */}
      {activeTab === 'market' && userRole === 'agent' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
           {marketAds.length === 0 ? (
             <div className="col-span-full text-center py-10 text-slate-400">No ad packages available right now.</div>
           ) : (
             marketAds.map((ad) => (
                <div key={ad.id} className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-all">
                  <div className="h-40 bg-slate-100 relative">
                     {ad.image_url ? (
                       <img src={ad.image_url} alt={ad.title} className="w-full h-full object-cover" />
                     ) : (
                       <div className="flex items-center justify-center h-full text-slate-300"><ImageIcon size={32} /></div>
                     )}
                  </div>
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-2">
                       <h3 className="font-bold text-slate-900">{ad.title}</h3>
                       <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs font-bold">₹{ad.price}</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-4 line-clamp-2">{ad.description}</p>
                    <button 
                      onClick={() => handleBuyMarketAd(ad)}
                      disabled={buyingId === ad.id}
                      className="w-full bg-slate-900 text-white py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-70"
                    >
                      {buyingId === ad.id ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />}
                      {buyingId === ad.id ? 'Processing...' : 'Buy Now'}
                    </button>
                  </div>
                </div>
             ))
           )}
        </div>
      )}
      
      {/* --- NEW CAMPAIGN MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">New Campaign</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
            
            <div className="space-y-4">
              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                  <button onClick={() => { setAdForm(prev => ({...prev, sourceType: 'inventory', selectedSourceIds: []})); setLocalCreatives([]); }} className={`flex-1 flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${adForm.sourceType === 'inventory' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}> <Building2 size={12} /> Inventory </button>
                  <button onClick={() => { setAdForm(prev => ({...prev, sourceType: 'asset', selectedSourceIds: []})); setLocalCreatives([]); }} className={`flex-1 flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${adForm.sourceType === 'asset' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}> <ImageIcon size={12} /> Assets </button>
                  <button onClick={() => { fileInputRef.current?.click(); setAdForm(prev => ({...prev, sourceType: 'localUpload', selectedSourceIds: []}));}} className={`flex-1 flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${adForm.sourceType === 'localUpload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}> <Upload size={12} /> Upload </button>
              </div>
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*" className="hidden" multiple /> 

              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Select Source</label>
                  {adForm.sourceType !== 'localUpload' && (
                      <select value={adForm.selectedSourceIds[0] || ''} onChange={(e) => handleSourceIdChange(e.target.value)} className="w-full bg-slate-50 border border-slate-100 text-slate-700 text-sm rounded-xl py-2.5 pl-4 pr-4 appearance-none focus:ring-2 focus:ring-primary outline-none">
                          <option value="">-- Select {adForm.sourceType === 'inventory' ? 'Property' : 'Asset'} --</option>
                          {adForm.sourceType === 'inventory' ? properties.map(p => <option key={p.id} value={p.id}>{p.title} ({p.price})</option>) : assets.map(a => <option key={a.id} value={a.id}>{a.type.toUpperCase()} Asset {a.id.slice(-4)}</option>)}
                      </select>
                  )}
                  {adForm.sourceType === 'localUpload' && (
                    <div className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm">{localCreatives.length > 0 ? `${localCreatives.length} file(s) selected` : "Select files..."}</div>
                  )}
                  <div className='flex gap-2 mt-2'>
                    {localCreativePreviews.map((url, index) => (
                      <div key={index} className='h-16 w-16 rounded-xl overflow-hidden bg-slate-200 border border-slate-300 relative'>
                        {isVideoFile(localCreatives[index]) ? <video src={url} className='w-full h-full object-cover' /> : <img src={url} className='w-full h-full object-cover' />}
                      </div>
                    ))}
                    {!adForm.sourceType.includes('local') && activePreviewUrl && (
                        <div className='h-16 w-16 rounded-xl overflow-hidden bg-slate-200 border border-slate-300'><img src={activePreviewUrl} className='w-full h-full object-cover' /></div>
                    )}
                  </div>
              </div>

              <h3 className="pt-2 border-t border-slate-100 text-[10px] font-bold text-slate-400 uppercase ml-1">Campaign Settings</h3>
              <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Website URL</label><input type="url" value={adForm.linkUrl} onChange={(e) => setAdForm(prev => ({...prev, linkUrl: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://yourwebsite.com" /></div>
              <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Privacy Policy URL <span className="text-red-400">*</span></label><input type="url" value={adForm.privacyPolicyUrl} onChange={(e) => setAdForm(prev => ({...prev, privacyPolicyUrl: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://yourwebsite.com/privacy" /></div>
              <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Target Location</label><input type="text" value={adForm.targetLocation} onChange={(e) => setAdForm(prev => ({...prev, targetLocation: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. Mohali, Tricity Area" /></div>

              <div className="flex gap-4">
                  <div className="flex-1"><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Gender</label><select value={adForm.gender} onChange={(e) => setAdForm(prev => ({...prev, gender: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none">{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                  <div className="flex-1"><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Budget (₹)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span><input type="number" min="100" step="100" value={adForm.dailyBudgetINR} onChange={(e) => setAdForm(prev => ({...prev, dailyBudgetINR: parseInt(e.target.value) || 0}))} className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" /></div></div>
              </div>

              <button onClick={handleLaunchCampaign} disabled={isSubmitting || !adForm.targetLocation || !adForm.privacyPolicyUrl} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70">
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 
                  {isSubmitting ? 'AI Launching...' : 'Launch Lead Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}