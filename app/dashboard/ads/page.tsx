// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/dashboard/ads/page.tsx

'use client'

import { useState, useEffect, useRef } from 'react'
import { Zap, Plus, X, Loader2, DollarSign, Building2, Image as ImageIcon, Upload, Film, RefreshCw, Circle, ExternalLink } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

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
    status: string // 'ACTIVE', 'PAUSED', 'ARCHIVED'
    objective: string
}

const GENDERS = ['All', 'Male', 'Female']

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null) 
  
  // --- CORE STATE ---
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null) // To show spinner on specific toggle

  // --- DATA STATE ---
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
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

  // --- TOGGLE CAMPAIGN STATUS ---
  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      setTogglingId(id);

      // 1. Optimistic UI Update (Make it feel instant)
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));

      try {
          // 2. Call API
          const res = await fetch('/api/meta-ads/update-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaignId: id, newStatus })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error);

      } catch (error: any) {
          // 3. Revert if failed
          alert(`Failed to update status: ${error.message}`);
          setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: currentStatus } : c));
      } finally {
          setTogglingId(null);
      }
  }

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token, ad_account_id, selected_page_id') 
        .eq('id', user.id)
        .single()
      
      if (profile) {
        setFacebookToken(profile.facebook_token)
        setSelectedAdAccountId(profile.ad_account_id)
        setAdForm(prev => ({...prev, pageId: profile.selected_page_id || ''})) 
      }

      const [propsRes, assetsRes] = await Promise.all([
          supabase.from('properties').select('id, title, price, image_url, description').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('assets').select('id, type, url').eq('user_id', user.id).order('created_at', { ascending: false })
      ])

      if (propsRes.data) setProperties(propsRes.data)
      if (assetsRes.data) setAssets(assetsRes.data as Asset[])

      if (profile?.ad_account_id) {
          await fetchCampaigns();
      }

      setLoading(false)
    }
    loadData()
    
    return () => {
        localCreativePreviews.forEach(url => URL.revokeObjectURL(url));
    };
  }, [])
  
  // --- HANDLERS ---
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

    adForm.selectedSourceIds.forEach((id, index) => {
        formPayload.append(`selectedSourceIds[${index}]`, id);
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
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24">
      <div className="flex justify-between items-end mb-6">
        <div>
            <h1 className="text-2xl font-bold text-slate-900">Meta Ads AI</h1>
            <p className="text-slate-500 text-xs mt-1">AI-optimized Lead Gen campaigns</p>
        </div>
        <div className="flex gap-2">
            <button onClick={fetchCampaigns} className="bg-white text-slate-500 p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform"><RefreshCw size={20} /></button>
            <button onClick={() => setIsModalOpen(true)} className="bg-primary hover:bg-blue-200 text-primary-text p-3 rounded-full shadow-md active:scale-95 transition-transform">
            <Plus size={20} strokeWidth={3} />
            </button>
        </div>
      </div>

      {/* CAMPAIGN LIST */}
      <div className="flex flex-col gap-4"> 
        {campaigns.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-100">
                No campaigns found. <br/>Tap '+' to launch a new Lead Gen campaign.
            </div>
        ) : (
            campaigns.map(campaign => (
                <div 
                    key={campaign.id} 
                    // UPDATED CARD STYLING: Deeper shadow (shadow-lg), stronger border (border-slate-200)
                    className="bg-white p-5 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 transition-all hover:border-blue-200"
                >
                    <div className="flex justify-between items-start mb-3">
                        <div className="max-w-[65%]">
                            <h3 className="text-sm font-bold text-slate-800 truncate leading-tight">{campaign.name}</h3>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">{campaign.objective.replace('OUTCOME_', '')}</p>
                        </div>
                        
                        {/* TOGGLE SWITCH */}
                        <div className="flex items-center gap-2">
                            {togglingId === campaign.id && <Loader2 size={12} className="animate-spin text-slate-400" />}
                            <button 
                                onClick={() => handleToggleStatus(campaign.id, campaign.status)}
                                className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out ${campaign.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-200'}`}
                            >
                                <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${campaign.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs text-slate-500 pt-3 border-t border-slate-50">
                        <span className="font-mono text-[10px] opacity-60">ID: {campaign.id.slice(-6)}</span>
                        <a 
                            href={`https://adsmanager.facebook.com/ads/manager/account/campaigns/`} 
                            target="_blank" 
                            rel="noreferrer"
                            className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline"
                        >
                            Ads Manager <ExternalLink size={10} />
                        </a>
                    </div>
                </div>
            ))
        )}
      </div>
      
      {/* LAUNCH MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">New Campaign</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
            
            <div className="space-y-4">
              {/* Form Content (Unchanged) */}
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
              
              <div>
                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Website URL</label>
                <input type="url" value={adForm.linkUrl} onChange={(e) => setAdForm(prev => ({...prev, linkUrl: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://yourwebsite.com" />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Privacy Policy URL <span className="text-red-400">*</span></label>
                <input type="url" value={adForm.privacyPolicyUrl} onChange={(e) => setAdForm(prev => ({...prev, privacyPolicyUrl: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://yourwebsite.com/privacy" />
              </div>

              <div>
                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Target Location</label>
                  <input type="text" value={adForm.targetLocation} onChange={(e) => setAdForm(prev => ({...prev, targetLocation: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. Mohali, Tricity Area" />
              </div>

              <div className="flex gap-4">
                  <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Gender</label>
                      <select value={adForm.gender} onChange={(e) => setAdForm(prev => ({...prev, gender: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none">
                          {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                  </div>
                  <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Budget (₹)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <input type="number" min="100" step="100" value={adForm.dailyBudgetINR} onChange={(e) => setAdForm(prev => ({...prev, dailyBudgetINR: parseInt(e.target.value) || 0}))} className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" />
                      </div>
                  </div>
              </div>

              <button 
                  onClick={handleLaunchCampaign} 
                  disabled={isSubmitting || !adForm.targetLocation || !adForm.privacyPolicyUrl} 
                  className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70"
              >
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