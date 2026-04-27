'use client'

import { useState, useEffect, useRef } from 'react'
import { Zap, Plus, X, Loader2, Building2, Image as ImageIcon, Upload, RefreshCw, ExternalLink, TrendingUp, CreditCard, Eye, MousePointerClick, Users, Settings2, Sparkles, Video } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

type Property = { id: string; title: string; price: string; image_url: string; description?: string }
type Asset = { id: string; type: 'image' | 'video'; url: string }
type Campaign = { id: string; name: string; status: string; objective: string }
type LocationOption = { key: string; name: string; type: string; region?: string; country_code?: string; }
type CustomQuestion = { label: string; type: 'SHORT_ANSWER' | 'MULTIPLE_CHOICE'; options?: string[] }

type SelectedCreative = {
  uid: string;
  sourceType: 'inventory' | 'asset' | 'local';
  id?: string;
  file?: File;
  previewUrl: string;
  name: string;
}

const GENDERS = ['All', 'Male', 'Female']

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null) 
  
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
  const [properties, setProperties] = useState<Property[]>([])
  const [assets, setAssets] = useState<Asset[]>([]) 
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string | null>(null)
  const [facebookToken, setFacebookToken] = useState<string | null>(null)
  const [accountStatus, setAccountStatus] = useState<any>(null)

  const [locationSearchText, setLocationSearchText] = useState('')
  const [locationResults, setLocationResults] = useState<LocationOption[]>([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)

  const [statsModal, setStatsModal] = useState<{ isOpen: boolean, campaign: Campaign | null, insights: any, loading: boolean }>({ isOpen: false, campaign: null, insights: null, loading: false })
  
  // Optimizer States
  const [optimizingCampaignId, setOptimizingCampaignId] = useState<string | null>(null)
  const [optimizerResult, setOptimizerResult] = useState<any | null>(null)

  const [formQuestions, setFormQuestions] = useState<CustomQuestion[]>([])
  const [isAddingQuestion, setIsAddingQuestion] = useState(false)
  const [newQuestion, setNewQuestion] = useState<CustomQuestion>({ label: '', type: 'SHORT_ANSWER', options: [''] })

  // New Unified Creative Pool
  const [selectedCreatives, setSelectedCreatives] = useState<SelectedCreative[]>([])

  const [adForm, setAdForm] = useState({
    metaLocation: { location: null as LocationOption | null, radius: 20 },
    gender: 'All',
    dailyBudgetINR: 500,
    pageId: '', 
    linkUrl: 'https://adrolls.in', 
    privacyPolicyUrl: 'https://adrolls.in/privacy-policy', 
  })

  const isVideoFile = (file: File) => file.type.startsWith('video/');

  const fetchCampaigns = async () => {
      try {
          const res = await fetch('/api/meta-ads/campaigns');
          const data = await res.json();
          if (data.campaigns) setCampaigns(data.campaigns);
      } catch (e) { console.error("Failed to load campaigns", e); }
  }

  const checkAccountStatus = async (accountId: string) => {
      try {
          const res = await fetch(`/api/meta-ads/check-account?adAccountId=${accountId}`)
          const data = await res.json()
          setAccountStatus(data)
      } catch (e) { console.error(e) }
  }

  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase.from('profiles').select('facebook_token, ad_account_id, selected_page_id').eq('id', user.id).single()
      
      if (profile) {
        setFacebookToken(profile.facebook_token)
        setSelectedAdAccountId(profile.ad_account_id)
        setAdForm(prev => ({...prev, pageId: profile.selected_page_id || ''})) 
        if (profile.ad_account_id) {
            await fetchCampaigns()
            await checkAccountStatus(profile.ad_account_id)
        }
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
  }, [])

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
        if (locationSearchText.length > 2 && facebookToken) {
            setIsSearchingLocation(true)
            const res = await fetch(`/api/meta-ads/search-locations?q=${locationSearchText}&token=${facebookToken}`)
            const data = await res.json()
            setLocationResults(data.data || [])
            setIsSearchingLocation(false)
        } else {
            setLocationResults([])
        }
    }, 500)
    return () => clearTimeout(delayDebounceFn)
  }, [locationSearchText, facebookToken])
  
  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      setTogglingId(id);
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
      try {
          const res = await fetch('/api/meta-ads/update-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: id, newStatus }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
      } catch (error: any) {
          alert(`Failed to update status: ${error.message}`);
          setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: currentStatus } : c));
      } finally { setTogglingId(null); }
  }

  const handleOpenStats = async (campaign: Campaign) => {
      setStatsModal({ isOpen: true, campaign, insights: null, loading: true })
      try {
          const res = await fetch(`/api/meta-ads/campaign-insights?campaignId=${campaign.id}`)
          const data = await res.json()
          setStatsModal({ isOpen: true, campaign, insights: data.insights, loading: false })
      } catch(e) {
          setStatsModal(prev => ({ ...prev, loading: false }))
      }
  }

  const handleOptimizeCampaign = async (campaignId: string) => {
      setOptimizingCampaignId(campaignId);
      try {
          const res = await fetch('/api/meta-ads/optimize-campaign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaignId })
          });
          const data = await res.json();

          if (data.status === 'insufficient_data') {
              alert(data.message);
          } else if (data.status === 'success') {
              setOptimizerResult(data);
          } else {
              alert(`Error: ${data.error}`);
          }
      } catch (e: any) {
          alert(`Optimization Failed: ${e.message}`);
      } finally {
          setOptimizingCampaignId(null);
      }
  }

  const handleAddPresetQuestion = (type: 'budget' | 'timeline') => {
      if (type === 'budget') {
          setFormQuestions(prev => [...prev, { label: "What is your investment budget?", type: "MULTIPLE_CHOICE", options: ["Under INR 25L", "INR 25L - 50L", "INR 50L - 1Cr", "INR 1Cr+"] }]);
      } else if (type === 'timeline') {
          setFormQuestions(prev => [...prev, { label: "When are you planning to invest?", type: "MULTIPLE_CHOICE", options: ["Immediately", "1-3 Months", "3-6 Months", "Just exploring"] }]);
      }
  }

  const handleLocalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if(e.target.files) {
      const files = Array.from(e.target.files)
      const newCreatives = files.map(file => ({
        uid: Math.random().toString(36).substr(2, 9),
        sourceType: 'local' as const,
        file: file,
        previewUrl: URL.createObjectURL(file),
        name: file.name
      }))
      setSelectedCreatives(prev => [...prev, ...newCreatives])
    }
  }

  const removeCreative = (uid: string) => {
    setSelectedCreatives(prev => {
        const target = prev.find(p => p.uid === uid);
        if (target?.sourceType === 'local') URL.revokeObjectURL(target.previewUrl);
        return prev.filter(p => p.uid !== uid);
    })
  }

  const handleLaunchCampaign = async () => {
    if (isSubmitting) return
    if (!adForm.pageId || !selectedAdAccountId) { alert("Missing Facebook Page or Ad Account in Profile."); return }
    if (selectedCreatives.length === 0) { alert("Please select at least one creative (Inventory, Asset, or Upload)."); return; }
    if (!adForm.metaLocation.location || adForm.dailyBudgetINR < 100) { alert("Please set a valid target location and budget."); return }
    if (!adForm.privacyPolicyUrl) { alert("Privacy Policy URL required."); return; }
    
    setIsSubmitting(true)
    
    const formPayload = new FormData();
    formPayload.append('adAccountId', selectedAdAccountId);
    formPayload.append('facebookToken', facebookToken || '');
    formPayload.append('pageId', adForm.pageId);
    
    const locString = `${adForm.metaLocation.location.name}, ${adForm.metaLocation.location.region || adForm.metaLocation.location.country_code}`;
    formPayload.append('targetLocation', locString);
    formPayload.append('metaLocation', JSON.stringify(adForm.metaLocation));
    
    formPayload.append('gender', adForm.gender);
    formPayload.append('dailyBudgetINR', (adForm.dailyBudgetINR * 100).toString()); 
    formPayload.append('linkUrl', adForm.linkUrl);
    formPayload.append('privacyPolicyUrl', adForm.privacyPolicyUrl);
    formPayload.append('customQuestions', JSON.stringify(formQuestions));

    let localFileIndex = 0;
    selectedCreatives.forEach((c) => {
      if (c.sourceType === 'inventory') formPayload.append('inventoryIds', c.id!);
      if (c.sourceType === 'asset') formPayload.append('assetIds', c.id!);
      if (c.sourceType === 'local' && c.file) {
          formPayload.append(`creativeFiles[${localFileIndex}]`, c.file, c.file.name);
          localFileIndex++;
      }
    });

    try {
      const res = await fetch('/api/meta-ads/launch-campaign', { method: 'POST', body: formPayload })
      const data = await res.json()
      if (res.ok) {
        alert(`${data.message}`);
        setIsModalOpen(false)
        setAdForm(prev => ({ ...prev, metaLocation: { location: null, radius: 20 }, dailyBudgetINR: 500 })) 
        setSelectedCreatives([]); setFormQuestions([]);
        fetchCampaigns();
      } else throw new Error(data.error || 'Failed to Start');
    } catch (e: any) { alert('Launch Failed: ' + e.message); } 
    finally { setIsSubmitting(false) }
  }

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24">
      <div className="flex justify-between items-end mb-6">
        <div>
            <h1 className="text-2xl font-bold text-slate-900">AI Ads Manager</h1>
            <p className="text-slate-500 text-xs mt-1">Self-Optimizing Campaigns</p>
        </div>
        <div className="flex gap-2">
            <button onClick={fetchCampaigns} className="bg-white text-slate-500 p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform"><RefreshCw size={20} /></button>
            <button onClick={() => setIsModalOpen(true)} className="bg-primary hover:bg-blue-200 text-primary-text p-3 rounded-full shadow-md active:scale-95 transition-transform"><Plus size={20} strokeWidth={3} /></button>
        </div>
      </div>

      <div className="flex flex-col gap-4"> 
        {campaigns.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-100">No campaigns found. <br/>Tap '+' to launch a new AI Lead campaign.</div>
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
                        <button onClick={() => handleOpenStats(campaign)} className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-blue-600 bg-slate-50 py-1 px-2 rounded-md"><TrendingUp size={12} /> View Stats</button>
                        <button 
                            onClick={() => handleOptimizeCampaign(campaign.id)} 
                            disabled={optimizingCampaignId === campaign.id || campaign.status !== 'ACTIVE'}
                            className={`flex items-center gap-1 text-[10px] font-bold py-1 px-2 rounded-md transition-colors ${optimizingCampaignId === campaign.id ? 'bg-purple-100 text-purple-400' : campaign.status !== 'ACTIVE' ? 'bg-slate-100 text-slate-400' : 'bg-purple-50 text-purple-600 hover:bg-purple-100 hover:text-purple-700'}`}
                        >
                            {optimizingCampaignId === campaign.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Optimize
                        </button>
                        <a href={`https://adsmanager.facebook.com/ads/manager/account/campaigns/`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline">Manager <ExternalLink size={10} /></a>
                    </div>
                </div>
            ))
        )}
      </div>

      {/* OPTIMIZATION RESULT MODAL */}
      {optimizerResult && (
          <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-start mb-4">
                      <div>
                          <h2 className="text-xl font-bold text-slate-800 leading-tight pr-4 flex items-center gap-2"><Sparkles className="text-purple-500"/> AI Optimization Complete</h2>
                      </div>
                      <button onClick={() => setOptimizerResult(null)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={16} /></button>
                  </div>
                  
                  <div className="space-y-4">
                      {optimizerResult.pausedAds && optimizerResult.pausedAds.length > 0 && (
                          <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                              <h3 className="text-xs font-bold text-red-600 uppercase mb-1">Underperformers Paused</h3>
                              <p className="text-xs text-red-500">We halted {optimizerResult.pausedAds.length} variations that were wasting spend without generating leads.</p>
                          </div>
                      )}

                      {optimizerResult.insight && (
                          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                              <h3 className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1 mb-2"><Eye size={12}/> Visual Analysis of Winner</h3>
                              {optimizerResult.winnerImageAnalyzed && (
                                  <img src={optimizerResult.winnerImageAnalyzed} alt="Analyzed Winner" className="w-full h-24 object-cover rounded-lg mb-3 shadow-sm" />
                              )}
                              <p className="text-sm text-slate-700 leading-relaxed">{optimizerResult.insight}</p>
                          </div>
                      )}

                      {optimizerResult.videoConcept && (
                          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                              <h3 className="text-[10px] font-bold text-blue-500 uppercase flex items-center gap-1 mb-2"><Video size={12}/> AI Video Script Concept</h3>
                              <p className="text-sm text-blue-900 leading-relaxed">{optimizerResult.videoConcept}</p>
                          </div>
                      )}

                      {optimizerResult.newImageTask && (
                          <div className="text-center bg-purple-50 rounded-xl p-3 border border-purple-100">
                             <p className="text-xs text-purple-700 font-medium">A new static creative variation is being generated in the background to test next!</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* STATS MODAL */}
      {statsModal.isOpen && statsModal.campaign && (
          <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in zoom-in-95">
                  <div className="flex justify-between items-start mb-4">
                      <div>
                          <h2 className="text-lg font-bold text-slate-800 leading-tight pr-4">{statsModal.campaign.name}</h2>
                          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">{statsModal.campaign.status}</p>
                      </div>
                      <button onClick={() => setStatsModal({ isOpen: false, campaign: null, insights: null, loading: false })} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={16} /></button>
                  </div>
                  {statsModal.loading ? (
                      <div className="flex flex-col items-center justify-center py-10"><Loader2 className="animate-spin text-primary mb-2" /><p className="text-xs text-slate-500">Fetching Meta Insights...</p></div>
                  ) : statsModal.insights ? (
                      <div className="grid grid-cols-2 gap-3 mt-4">
                          <div className="bg-slate-50 p-4 rounded-2xl"><div className="text-[10px] text-slate-500 font-bold uppercase mb-1 flex items-center gap-1"><CreditCard size={12}/> Spend</div><div className="text-lg font-bold text-slate-800">₹{statsModal.insights.spend || '0'}</div></div>
                          <div className="bg-slate-50 p-4 rounded-2xl"><div className="text-[10px] text-slate-500 font-bold uppercase mb-1 flex items-center gap-1"><Eye size={12}/> Impressions</div><div className="text-lg font-bold text-slate-800">{statsModal.insights.impressions || '0'}</div></div>
                          <div className="bg-slate-50 p-4 rounded-2xl"><div className="text-[10px] text-slate-500 font-bold uppercase mb-1 flex items-center gap-1"><MousePointerClick size={12}/> Clicks</div><div className="text-lg font-bold text-slate-800">{statsModal.insights.clicks || '0'}</div></div>
                          <div className="bg-blue-50 p-4 rounded-2xl"><div className="text-[10px] text-blue-500 font-bold uppercase mb-1 flex items-center gap-1"><Users size={12}/> Leads</div><div className="text-lg font-bold text-blue-700">{statsModal.insights.actions?.find((a:any) => a.action_type === 'lead')?.value || '0'}</div></div>
                      </div>
                  ) : (
                      <div className="py-6 text-center text-sm text-slate-500">No performance data available yet.</div>
                  )}
              </div>
          </div>
      )}
      
      {/* LAUNCH MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">AI Launchpad</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
            
            <div className="space-y-4">
              
              {/* CREATIVE POOL SECTION */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-2">Creatives (Mix & Match)</label>
                
                <div className="flex gap-2 mb-3">
                  <select 
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const prop = properties.find(p => p.id === id);
                      if (prop && !selectedCreatives.find(c => c.id === id)) {
                        setSelectedCreatives(prev => [...prev, { uid: Math.random().toString(), sourceType: 'inventory', id, previewUrl: prop.image_url, name: prop.title }]);
                      }
                      e.target.value = "";
                    }} 
                    className="flex-1 bg-slate-50 border border-slate-100 text-slate-700 text-xs rounded-xl py-2 px-3 outline-none"
                  >
                    <option value="">+ Add Property</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>

                  <select 
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const asset = assets.find(a => a.id === id);
                      if (asset && !selectedCreatives.find(c => c.id === id)) {
                        setSelectedCreatives(prev => [...prev, { uid: Math.random().toString(), sourceType: 'asset', id, previewUrl: asset.url, name: `Library Asset` }]);
                      }
                      e.target.value = "";
                    }} 
                    className="flex-1 bg-slate-50 border border-slate-100 text-slate-700 text-xs rounded-xl py-2 px-3 outline-none"
                  >
                    <option value="">+ Add AI Asset</option>
                    {assets.map(a => <option key={a.id} value={a.id}>Asset {a.id.slice(-4)}</option>)}
                  </select>
                </div>

                <input type="file" ref={fileInputRef} onChange={handleLocalFiles} accept="image/*,video/*" className="hidden" multiple />
                <button onClick={() => fileInputRef.current?.click()} className="w-full mb-3 py-2 border border-dashed border-slate-300 rounded-xl text-xs font-bold text-slate-500 flex items-center justify-center gap-2 hover:bg-slate-50">
                   <Upload size={14} /> Upload Custom Files
                </button>

                {/* Selected Creatives Preview */}
                {selectedCreatives.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                      {selectedCreatives.map((c) => (
                         <div key={c.uid} className="relative w-16 h-16 rounded-xl flex-shrink-0 bg-slate-100 border border-slate-200 group">
                            {c.sourceType === 'local' && c.file && isVideoFile(c.file) ? (
                                <video src={c.previewUrl} className="w-full h-full object-cover rounded-xl" />
                            ) : (
                                <img src={c.previewUrl} className="w-full h-full object-cover rounded-xl" />
                            )}
                            <button onClick={() => removeCreative(c.uid)} className="absolute -top-1 -right-1 bg-white rounded-full p-0.5 text-red-500 shadow-sm border border-slate-100"><X size={12}/></button>
                         </div>
                      ))}
                    </div>
                )}
              </div>

              <h3 className="pt-2 border-t border-slate-100 text-[10px] font-bold text-slate-400 uppercase ml-1">Campaign Settings</h3>
              <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Website URL</label><input type="url" value={adForm.linkUrl} onChange={(e) => setAdForm(prev => ({...prev, linkUrl: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://yourwebsite.com" /></div>
              <div><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Privacy Policy URL <span className="text-red-400">*</span></label><input type="url" value={adForm.privacyPolicyUrl} onChange={(e) => setAdForm(prev => ({...prev, privacyPolicyUrl: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://adrolls.in/privacy-policy" /></div>
              
              <div className="relative">
                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Target Location</label>
                  {adForm.metaLocation.location ? (
                      <div className="w-full bg-slate-50 py-2 px-3 rounded-xl border border-slate-200 flex justify-between items-center">
                          <div>
                              <div className="text-sm font-bold text-slate-800">{adForm.metaLocation.location.name}</div>
                              <div className="text-[10px] text-slate-500 uppercase">{adForm.metaLocation.location.region}, {adForm.metaLocation.location.country_code}</div>
                          </div>
                          <button onClick={() => setAdForm(prev => ({ ...prev, metaLocation: { location: null, radius: 20 } }))}><X size={16} className="text-slate-400 hover:text-red-500"/></button>
                      </div>
                  ) : (
                      <>
                          <input type="text" value={locationSearchText} onChange={(e) => setLocationSearchText(e.target.value)} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Search city, state, or country..." />
                          {isSearchingLocation && <Loader2 size={16} className="absolute right-4 top-9 animate-spin text-slate-400" />}
                          {locationResults.length > 0 && (
                              <div className="absolute z-10 w-full bg-white mt-1 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 max-h-48 overflow-y-auto">
                                  {locationResults.map(loc => (
                                      <div key={loc.key} onClick={() => { setAdForm(prev => ({ ...prev, metaLocation: { location: loc, radius: 20 } })); setLocationSearchText(''); setLocationResults([]); }} className="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0">
                                          <div className="text-sm font-semibold text-slate-800">{loc.name}</div>
                                          <div className="text-[10px] uppercase font-bold text-slate-400">{loc.region ? `${loc.region}, ` : ''}{loc.country_code} ({loc.type})</div>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </>
                  )}
              </div>
              
              <div className="flex gap-4">
                  <div className="flex-1"><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Gender</label><select value={adForm.gender} onChange={(e) => setAdForm(prev => ({...prev, gender: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm outline-none">{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                  <div className="flex-1"><label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Budget (₹)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span><input type="number" min="100" step="100" value={adForm.dailyBudgetINR} onChange={(e) => setAdForm(prev => ({...prev, dailyBudgetINR: parseInt(e.target.value) || 0}))} className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm outline-none" /></div></div>
              </div>

              {/* FORM QUESTIONS SECTION */}
              <div className="pt-2 border-t border-slate-100">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 flex items-center gap-1 mb-2"><Settings2 size={12} /> Lead Form Questions</label>
                  
                  {formQuestions.length > 0 && (
                      <div className="flex flex-col gap-2 mb-3">
                          {formQuestions.map((q, idx) => (
                             <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex justify-between items-start group">
                                 <div>
                                     <div className="text-sm font-bold text-slate-800 leading-tight mb-1">{q.label}</div>
                                     <div className="text-[10px] text-slate-400 font-bold uppercase">{q.type === 'MULTIPLE_CHOICE' ? `Multiple Choice` : 'Short Answer'}</div>
                                 </div>
                                 <button onClick={() => setFormQuestions(prev => prev.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500 p-1"><X size={14}/></button>
                             </div>
                          ))}
                      </div>
                  )}

                  {!isAddingQuestion ? (
                      <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleAddPresetQuestion('budget')} className="text-[10px] font-bold bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full hover:bg-blue-100">+ Add Budget</button>
                          <button onClick={() => handleAddPresetQuestion('timeline')} className="text-[10px] font-bold bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full hover:bg-blue-100">+ Add Timeline</button>
                          <button onClick={() => setIsAddingQuestion(true)} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full hover:bg-slate-200">+ Custom</button>
                      </div>
                  ) : (
                      <div className="bg-slate-100 p-4 rounded-xl border border-slate-200 space-y-3">
                          <div>
                              <input type="text" value={newQuestion.label} onChange={e => setNewQuestion({...newQuestion, label: e.target.value})} className="w-full bg-white py-2.5 px-3 rounded-lg text-sm border border-slate-200" placeholder="Question Text" />
                          </div>
                          <div>
                              <select value={newQuestion.type} onChange={e => setNewQuestion({...newQuestion, type: e.target.value as any})} className="w-full bg-white py-2.5 px-3 rounded-lg text-sm border border-slate-200">
                                  <option value="SHORT_ANSWER">Short Answer</option>
                                  <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                              </select>
                          </div>
                          {newQuestion.type === 'MULTIPLE_CHOICE' && (
                              <input type="text" value={newQuestion.options?.join(', ')} onChange={e => setNewQuestion({...newQuestion, options: e.target.value.split(',')})} className="w-full bg-white py-2.5 px-3 rounded-lg text-sm border border-slate-200" placeholder="Options (comma separated)" />
                          )}
                          <div className="flex gap-2">
                              <button onClick={() => { if(newQuestion.label){ setFormQuestions(prev => [...prev, newQuestion]); setIsAddingQuestion(false); setNewQuestion({label: '', type: 'SHORT_ANSWER', options: ['']}); } }} className="flex-1 bg-slate-900 text-white px-3 py-2 rounded-lg text-xs font-bold">Save</button>
                              <button onClick={() => setIsAddingQuestion(false)} className="bg-slate-200 text-slate-600 px-4 py-2 rounded-lg text-xs font-bold">Cancel</button>
                          </div>
                      </div>
                  )}
              </div>

              <button onClick={handleLaunchCampaign} disabled={isSubmitting || !adForm.metaLocation.location || !adForm.privacyPolicyUrl || selectedCreatives.length === 0} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70 mt-4">
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 
                  {isSubmitting ? 'AI Optimizing & Launching...' : 'Launch Smart Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}