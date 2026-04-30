'use client'

import { useState, useEffect, useRef } from 'react'
import { Zap, Plus, X, Loader2, Image as ImageIcon, Upload, RefreshCw, ExternalLink, TrendingUp, CreditCard, Eye, MousePointerClick, Users, Settings2, Sparkles, Video, MapPin, LayoutGrid, PauseCircle, PlayCircle, PlusCircle } from 'lucide-react'
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
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in ms

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null) 
  
  // Data States
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
  const [properties, setProperties] = useState<Property[]>([])
  const [assets, setAssets] = useState<Asset[]>([]) 
  
  // Profile / Config States
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string | null>(null)
  const [facebookToken, setFacebookToken] = useState<string | null>(null)
  const [accountStatus, setAccountStatus] = useState<any>(null)

  // Location Search
  const [locationSearchText, setLocationSearchText] = useState('')
  const [locationResults, setLocationResults] = useState<LocationOption[]>([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)

  // Modals
  const [statsModal, setStatsModal] = useState<{ isOpen: boolean, campaign: Campaign | null, insights: any, loading: boolean }>({ isOpen: false, campaign: null, insights: null, loading: false })
  const [optimizingCampaignId, setOptimizingCampaignId] = useState<string | null>(null)
  const [optimizerResult, setOptimizerResult] = useState<any | null>(null)

  // Form States
  const [formQuestions, setFormQuestions] = useState<CustomQuestion[]>([])
  const [isAddingQuestion, setIsAddingQuestion] = useState(false)
  const [newQuestion, setNewQuestion] = useState<CustomQuestion>({ label: '', type: 'SHORT_ANSWER', options: [''] })
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

  const checkAccountStatus = async (accountId: string) => {
      try {
          const res = await fetch(`/api/meta-ads/check-account?adAccountId=${accountId}`)
          const data = await res.json()
          setAccountStatus(data)
      } catch (e) { console.error(e) }
  }

  // 1. SAFE FETCH WITH LOCAL CACHING
  const fetchAdsData = async (force = false) => {
    try {
      if (!force && campaigns.length === 0) setLoading(true)
      if (force) setIsRefreshing(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const cacheKeyCamp = `ads_campaigns_${user.id}`
      const cacheKeyProps = `ads_props_${user.id}`
      const cacheKeyAssets = `ads_assets_${user.id}`
      const timeKey = `ads_time_${user.id}`

      // Always fetch profile directly to ensure we have the latest tokens for launching ads
      const { data: profile } = await supabase.from('profiles').select('facebook_token, ad_account_id, selected_page_id').eq('id', user.id).single()
      
      if (profile) {
        setFacebookToken(profile.facebook_token)
        setSelectedAdAccountId(profile.ad_account_id)
        setAdForm(prev => ({...prev, pageId: profile.selected_page_id || ''}))
        if (profile.ad_account_id && !force) {
            checkAccountStatus(profile.ad_account_id) // Do this quietly in background
        }
      }

      // Check Local Cache
      if (!force) {
          const lastFetch = localStorage.getItem(timeKey)
          const now = Date.now()

          if (lastFetch && (now - parseInt(lastFetch) < CACHE_DURATION)) {
              const cCamp = localStorage.getItem(cacheKeyCamp)
              const cProps = localStorage.getItem(cacheKeyProps)
              const cAssets = localStorage.getItem(cacheKeyAssets)

              if (cCamp && cProps && cAssets) {
                  setCampaigns(JSON.parse(cCamp))
                  setProperties(JSON.parse(cProps))
                  setAssets(JSON.parse(cAssets))
                  setLoading(false)
                  return; // Cache is valid and fresh, exit early
              }
          }
      }

      // Fetch Fresh Data
      let newCampaigns: Campaign[] = []
      if (profile?.ad_account_id) {
          if (force) checkAccountStatus(profile.ad_account_id)
          try {
              const res = await fetch('/api/meta-ads/campaigns')
              const data = await res.json()
              if (data.campaigns) newCampaigns = data.campaigns
          } catch (e) { console.error("Failed to load campaigns", e) }
      }

      const [propsRes, assetsRes] = await Promise.all([
          supabase.from('properties').select('id, title, price, image_url, description').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('assets').select('id, type, url').eq('user_id', user.id).order('created_at', { ascending: false })
      ])

      const newProps = propsRes.data || []
      const newAssets = (assetsRes.data as Asset[]) || []

      setCampaigns(newCampaigns)
      setProperties(newProps)
      setAssets(newAssets)

      // Save to Cache
      localStorage.setItem(cacheKeyCamp, JSON.stringify(newCampaigns))
      localStorage.setItem(cacheKeyProps, JSON.stringify(newProps))
      localStorage.setItem(cacheKeyAssets, JSON.stringify(newAssets))
      localStorage.setItem(timeKey, Date.now().toString())

    } catch (error) {
      console.error("Fetch Error:", error)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  // Trigger initial fetch
  useEffect(() => { fetchAdsData() }, [])

  // Location Search Debounce
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
      
      const updatedCampaigns = campaigns.map(c => c.id === id ? { ...c, status: newStatus } : c);
      setCampaigns(updatedCampaigns);

      // Update local cache quietly
      const { data: { user } } = await supabase.auth.getUser();
      if (user) localStorage.setItem(`ads_campaigns_${user.id}`, JSON.stringify(updatedCampaigns));

      try {
          const res = await fetch('/api/meta-ads/update-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: id, newStatus }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
      } catch (error: any) {
          alert(`Failed to update status: ${error.message}`);
          // Revert on fail
          const reverted = campaigns.map(c => c.id === id ? { ...c, status: currentStatus } : c);
          setCampaigns(reverted);
          if (user) localStorage.setItem(`ads_campaigns_${user.id}`, JSON.stringify(reverted));
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
        setSelectedCreatives([]);
        setFormQuestions([]);
        fetchAdsData(true); // Force fetch to update list with new campaign
      } else throw new Error(data.error || 'Failed to Start');
    } catch (e: any) { alert('Launch Failed: ' + e.message); } 
    finally { setIsSubmitting(false) }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16 relative">
        
      {/* FIXED REFRESH BUTTON */}
      <button 
          onClick={() => fetchAdsData(true)}
          className="fixed top-4 right-4 z-[60] bg-white/90 backdrop-blur-md p-2.5 rounded-full shadow-md border border-slate-200 text-slate-500 hover:text-blue-600 transition-all active:scale-95"
          title="Refresh Ads Data"
      >
          <RefreshCw size={18} className={isRefreshing ? "animate-spin text-blue-600" : ""} />
      </button>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* HEADER */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-8">
            <div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight ml-1">AI Ads Manager</h1>
                <p className="text-slate-500 text-sm mt-1 font-medium ml-1">Self-Optimizing Smart Campaigns</p>
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
                <button 
                    onClick={() => setIsModalOpen(true)} 
                    className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-8 py-3.5 rounded-full shadow-md shadow-blue-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 font-bold"
                >
                    <Plus size={20} strokeWidth={3} /> <span className="hidden sm:inline">New Campaign</span>
                </button>
            </div>
        </div>

        {/* CAMPAIGN GRID (Responsive) */}
        {loading ? (
            <div className="flex flex-col items-center justify-center min-h-[40vh] text-slate-400 gap-4">
                <Loader2 size={32} className="animate-spin text-slate-300" />
                <p className="text-sm font-medium animate-pulse">Syncing with Meta...</p>
            </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6"> 
                {campaigns.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400 bg-white rounded-[2.5rem] border border-slate-200/60 border-dashed">
                        <LayoutGrid size={48} className="text-slate-200 mb-4" />
                        <p className="text-base font-bold text-slate-600">No active campaigns</p>
                        <p className="text-sm mt-1">Tap 'New Campaign' to launch your first AI-optimized ad.</p>
                    </div>
                ) : (
                    campaigns.map(campaign => (
                        <div key={campaign.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200/60 transition-all hover:shadow-lg hover:border-blue-200 flex flex-col h-full group">
                            
                            {/* Card Header */}
                            <div className="flex justify-between items-start mb-4">
                                <div className="max-w-[70%]">
                                    <h3 className="text-base font-bold text-slate-800 truncate leading-tight group-hover:text-blue-600 transition-colors">{campaign.name}</h3>
                                    <div className="flex items-center gap-1.5 mt-2">
                                        <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${campaign.status === 'ACTIVE' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                                            {campaign.status === 'ACTIVE' ? <PlayCircle size={10}/> : <PauseCircle size={10}/>} {campaign.status}
                                        </span>
                                    </div>
                                </div>
        
                                <div className="flex items-center gap-2">
                                    {togglingId === campaign.id && <Loader2 size={14} className="animate-spin text-slate-400" />}
                                    <button 
                                        onClick={() => handleToggleStatus(campaign.id, campaign.status)} 
                                        className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 ${campaign.status === 'ACTIVE' ? 'bg-green-500 focus:ring-green-500' : 'bg-slate-200 focus:ring-slate-400'}`}
                                    >
                                        <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${campaign.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </div>

                            <div className="flex-grow"></div>
                            
                            {/* Card Actions */}
                            <div className="flex justify-between items-center text-xs text-slate-500 pt-4 border-t border-slate-100">
                                <button 
                                    onClick={() => handleOpenStats(campaign)} 
                                    className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-600 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 py-2 px-3 rounded-xl transition-colors"
                                >
                                    <TrendingUp size={14} /> Stats
                                </button>
                                
                                <button 
                                    onClick={() => handleOptimizeCampaign(campaign.id)} 
                                    disabled={optimizingCampaignId === campaign.id || campaign.status !== 'ACTIVE'}
                                    className={`flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-3 rounded-xl transition-all ${
                                        optimizingCampaignId === campaign.id ? 'bg-purple-100 text-purple-400' 
                                        : campaign.status !== 'ACTIVE' ? 'bg-slate-50 text-slate-400 cursor-not-allowed' 
                                        : 'bg-purple-50 text-purple-600 hover:bg-purple-100 hover:text-purple-700 shadow-sm'
                                    }`}
                                >
                                    {optimizingCampaignId === campaign.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Optimize
                                </button>
                                
                                <a 
                                    href={`https://adsmanager.facebook.com/ads/manager/account/campaigns/`} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-xl transition-colors"
                                >
                                    <ExternalLink size={16} />
                                </a>
                            </div>
                        </div>
                    ))
                )}
            </div>
        )}

      {/* OPTIMIZATION RESULT MODAL */}
      {optimizerResult && (
          <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4">
                      <div>
                          <h2 className="text-xl font-bold text-slate-900 leading-tight flex items-center gap-2">
                              <Sparkles className="text-purple-500"/> AI Optimization Done
                          </h2>
                      </div>
                      <button onClick={() => setOptimizerResult(null)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                  </div>
                  
                  <div className="space-y-5">
                      {optimizerResult.pausedAds && optimizerResult.pausedAds.length > 0 && (
                          <div className="bg-red-50/80 border border-red-100 rounded-2xl p-4">
                              <h3 className="text-xs font-bold text-red-600 uppercase mb-1.5 tracking-wider">Underperformers Paused</h3>
                              <p className="text-sm text-red-600 font-medium">We halted {optimizerResult.pausedAds.length} variations that were wasting spend without generating leads.</p>
                          </div>
                      )}

                      {optimizerResult.insight && (
                          <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-5">
                              <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                  <Eye size={14}/> Visual Analysis of Winner
                              </h3>
                              {optimizerResult.winnerImageAnalyzed && (
                                  <img src={optimizerResult.winnerImageAnalyzed} alt="Analyzed Winner" className="w-full h-32 object-cover rounded-xl mb-4 shadow-inner" />
                              )}
                              <p className="text-sm text-slate-700 leading-relaxed font-medium">{optimizerResult.insight}</p>
                          </div>
                      )}

                      {optimizerResult.videoConcept && (
                          <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-5">
                              <h3 className="text-[10px] font-bold text-blue-600 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                  <Video size={14}/> AI Video Script Concept
                              </h3>
                              <p className="text-sm text-blue-900 leading-relaxed font-medium">{optimizerResult.videoConcept}</p>
                          </div>
                      )}

                      {optimizerResult.newImageTask && (
                          <div className="text-center bg-purple-50 rounded-2xl p-4 border border-purple-100 shadow-inner">
                              <p className="text-sm text-purple-700 font-bold">A new static creative variation is being generated in the background to test next!</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* STATS MODAL */}
      {statsModal.isOpen && statsModal.campaign && (
          <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95">
                  <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4">
                      <div>
                          <h2 className="text-xl font-bold text-slate-900 leading-tight pr-4 truncate max-w-[250px]">{statsModal.campaign.name}</h2>
                          <span className={`inline-block text-[10px] mt-2 font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ${statsModal.campaign.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                              {statsModal.campaign.status}
                          </span>
                      </div>
                      <button onClick={() => setStatsModal({ isOpen: false, campaign: null, insights: null, loading: false })} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={18} /></button>
                  </div>

                  {statsModal.loading ? (
                      <div className="flex flex-col items-center justify-center py-12">
                          <Loader2 className="animate-spin text-blue-500 mb-3" size={32} />
                          <p className="text-sm text-slate-500 font-medium">Fetching Meta Insights...</p>
                      </div>
                  ) : statsModal.insights ? (
                      <div className="grid grid-cols-2 gap-4">
                          <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><CreditCard size={14}/> Spend</div>
                              <div className="text-2xl font-black text-slate-800">₹{statsModal.insights.spend || '0'}</div>
                          </div>
                          <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><Eye size={14}/> Views</div>
                              <div className="text-2xl font-black text-slate-800">{statsModal.insights.impressions || '0'}</div>
                          </div>
                          <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-100 hover:border-blue-100 transition-colors">
                              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><MousePointerClick size={14}/> Clicks</div>
                              <div className="text-2xl font-black text-slate-800">{statsModal.insights.clicks || '0'}</div>
                          </div>
                          <div className="bg-blue-50 p-5 rounded-[1.5rem] border border-blue-100 shadow-sm">
                              <div className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><Users size={14}/> Leads</div>
                              <div className="text-3xl font-black text-blue-700">{statsModal.insights.actions?.find((a:any) => a.action_type === 'lead')?.value || '0'}</div>
                          </div>
                      </div>
                  ) : (
                      <div className="py-10 text-center text-sm font-medium text-slate-500 bg-slate-50 rounded-[1.5rem] border border-dashed border-slate-200">
                          No performance data available yet. <br/>Check back after 24 hours.
                      </div>
                  )}
              </div>
          </div>
      )}
      
      {/* LAUNCH MODAL (Responsive Bottom Sheet / Centered Card) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-2xl rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300 max-h-[90vh] flex flex-col overflow-hidden">
            
            {/* Launchpad Header */}
            <div className="flex justify-between items-center p-6 bg-white border-b border-slate-100 flex-shrink-0">
              <h2 className="text-xl font-bold text-slate-900">AI Launchpad</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors"><X size={20} /></button>
            </div>
            
            {/* Launchpad Body (Scrollable) */}
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-8">
              
              {/* CREATIVE POOL SECTION */}
              <div className="bg-slate-50/50 p-5 rounded-[2rem] border border-slate-100">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                   <ImageIcon size={16} /> Mix & Match Creatives
                </label>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
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
                    className="w-full bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-2xl py-3 px-4 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer"
                  >
                    <option value="">+ Add From Inventory</option>
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
                    className="w-full bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-2xl py-3 px-4 outline-none focus:ring-4 focus:ring-blue-500/20 transition-all cursor-pointer"
                  >
                    <option value="">+ Add AI Asset</option>
                    {assets.map(a => <option key={a.id} value={a.id}>Asset {a.id.slice(-4)}</option>)}
                  </select>
                </div>

                <input type="file" ref={fileInputRef} onChange={handleLocalFiles} accept="image/*,video/*" className="hidden" multiple />
                <button 
                    onClick={() => fileInputRef.current?.click()} 
                    className="w-full mb-4 py-3.5 border-2 border-dashed border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50 rounded-2xl text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center justify-center gap-2 transition-all"
                >
                    <Upload size={18} /> Upload Custom Files
                </button>

                {/* Selected Creatives Preview */}
                {selectedCreatives.length > 0 && (
                    <div className="flex gap-3 overflow-x-auto pb-2 pt-2 custom-scrollbar">
                      {selectedCreatives.map((c) => (
                         <div key={c.uid} className="relative w-20 h-20 rounded-[1.25rem] flex-shrink-0 bg-white shadow-sm border border-slate-200 group">
                            {c.sourceType === 'local' && c.file && isVideoFile(c.file) ? (
                                <video src={c.previewUrl} className="w-full h-full object-cover rounded-[1.25rem]" />
                            ) : (
                                <img src={c.previewUrl} className="w-full h-full object-cover rounded-[1.25rem]" />
                            )}
                            <button 
                                onClick={() => removeCreative(c.uid)} 
                                className="absolute -top-2 -right-2 bg-white rounded-full p-1 text-red-500 shadow-md border border-slate-100 hover:bg-red-50 transition-colors"
                            >
                                <X size={14}/>
                            </button>
                          </div>
                      ))}
                    </div>
                )}
              </div>

              {/* CAMPAIGN SETTINGS */}
              <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4 border-b border-slate-100 pb-2">
                     Campaign Settings
                  </label>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Website URL</label>
                          <input type="url" value={adForm.linkUrl} onChange={(e) => setAdForm(prev => ({...prev, linkUrl: e.target.value}))} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" placeholder="https://yourwebsite.com" />
                      </div>
                      
                      <div>
                          <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Privacy Policy URL <span className="text-red-400">*</span></label>
                          <input type="url" value={adForm.privacyPolicyUrl} onChange={(e) => setAdForm(prev => ({...prev, privacyPolicyUrl: e.target.value}))} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" placeholder="https://adrolls.in/privacy-policy" />
                      </div>
                      
                      <div className="relative">
                          <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Target Location</label>
                          {adForm.metaLocation.location ? (
                              <div className="w-full bg-blue-50/50 py-3 px-5 rounded-2xl border border-blue-200 flex justify-between items-center">
                                  <div>
                                      <div className="text-sm font-bold text-blue-900 flex items-center gap-1.5"><MapPin size={14}/> {adForm.metaLocation.location.name}</div>
                                      <div className="text-[10px] text-blue-600 font-medium uppercase tracking-wider mt-0.5 ml-5">{adForm.metaLocation.location.region}, {adForm.metaLocation.location.country_code}</div>
                                  </div>
                                  <button onClick={() => setAdForm(prev => ({ ...prev, metaLocation: { location: null, radius: 20 } }))} className="bg-white p-1.5 rounded-full shadow-sm text-slate-400 hover:text-red-500 transition-colors"><X size={16} /></button>
                              </div>
                          ) : (
                              <>
                                  <div className="relative">
                                    <input type="text" value={locationSearchText} onChange={(e) => setLocationSearchText(e.target.value)} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 pl-11 pr-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" placeholder="Search city, state, or country..." />
                                    <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                                    {isSearchingLocation && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />}
                                  </div>
                                  {locationResults.length > 0 && (
                                      <div className="absolute z-20 w-full bg-white mt-2 rounded-2xl shadow-xl border border-slate-100 max-h-56 overflow-y-auto custom-scrollbar">
                                          {locationResults.map(loc => (
                                              <div key={loc.key} onClick={() => { setAdForm(prev => ({ ...prev, metaLocation: { location: loc, radius: 20 } })); setLocationSearchText(''); setLocationResults([]); }} className="p-4 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 transition-colors">
                                                  <div className="text-sm font-bold text-slate-800">{loc.name}</div>
                                                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1">{loc.region ? `${loc.region}, ` : ''}{loc.country_code} ({loc.type})</div>
                                              </div>
                                          ))}
                                      </div>
                                  )}
                              </>
                          )}
                      </div>
                    
                      <div className="flex flex-col sm:flex-row gap-4">
                          <div className="flex-1">
                              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Gender</label>
                              <select value={adForm.gender} onChange={(e) => setAdForm(prev => ({...prev, gender: e.target.value}))} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 px-4 rounded-2xl text-slate-800 text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all cursor-pointer">
                                  {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                              </select>
                          </div>
                          <div className="flex-1">
                              <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Daily Budget (₹)</label>
                              <div className="relative">
                                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                                  <input type="number" min="100" step="100" value={adForm.dailyBudgetINR} onChange={(e) => setAdForm(prev => ({...prev, dailyBudgetINR: parseInt(e.target.value) || 0}))} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 pl-9 pr-4 rounded-2xl text-slate-800 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-500/20 border border-slate-200/60 transition-all" />
                              </div>
                          </div>
                      </div>
                  </div>
              </div>

              {/* FORM QUESTIONS SECTION */}
              <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4 border-b border-slate-100 pb-2">
                      <Settings2 size={16} /> Lead Form Questions
                  </label>
                 
                  {formQuestions.length > 0 && (
                      <div className="flex flex-col gap-3 mb-4">
                          {formQuestions.map((q, idx) => (
                              <div key={idx} className="bg-slate-50 border border-slate-200/60 rounded-[1.25rem] p-4 flex justify-between items-center group shadow-sm">
                                 <div>
                                     <div className="text-sm font-bold text-slate-800 leading-tight mb-1">{q.label}</div>
                                     <div className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">{q.type === 'MULTIPLE_CHOICE' ? `Multiple Choice` : 'Short Answer'}</div>
                                 </div>
                                 <button onClick={() => setFormQuestions(prev => prev.filter((_, i) => i !== idx))} className="bg-white p-2 rounded-full text-slate-400 hover:text-red-500 shadow-sm border border-slate-100 transition-colors"><X size={14}/></button>
                              </div>
                          ))}
                      </div>
                  )}

                  {!isAddingQuestion ? (
                      <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleAddPresetQuestion('budget')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Budget</button>
                          <button onClick={() => handleAddPresetQuestion('timeline')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Timeline</button>
                          <button onClick={() => setIsAddingQuestion(true)} className="text-xs font-bold bg-slate-100 text-slate-600 px-4 py-2.5 rounded-full hover:bg-slate-200 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Custom</button>
                      </div>
                  ) : (
                      <div className="bg-slate-50/80 p-5 rounded-[1.5rem] border border-slate-200 space-y-4 shadow-inner">
                          <div>
                              <input type="text" value={newQuestion.label} onChange={e => setNewQuestion({...newQuestion, label: e.target.value})} className="w-full bg-white py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all" placeholder="Question Text (e.g. When do you want to move?)" />
                          </div>
                          <div>
                              <select value={newQuestion.type} onChange={e => setNewQuestion({...newQuestion, type: e.target.value as any})} className="w-full bg-white py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all cursor-pointer">
                                  <option value="SHORT_ANSWER">Short Answer (Text)</option>
                                  <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                              </select>
                          </div>
                          {newQuestion.type === 'MULTIPLE_CHOICE' && (
                              <input type="text" value={newQuestion.options?.join(', ')} onChange={e => setNewQuestion({...newQuestion, options: e.target.value.split(',')})} className="w-full bg-white py-3.5 px-4 rounded-2xl text-sm font-medium border border-slate-200 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all" placeholder="Options (comma separated, e.g. 1 Month, 3 Months)" />
                          )}
                          <div className="flex gap-3 pt-2">
                              <button onClick={() => setIsAddingQuestion(false)} className="bg-white border border-slate-200 text-slate-600 px-6 py-3 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors">Cancel</button>
                              <button onClick={() => { if(newQuestion.label){ setFormQuestions(prev => [...prev, newQuestion]); setIsAddingQuestion(false); setNewQuestion({label: '', type: 'SHORT_ANSWER', options: ['']}); } }} className="flex-1 bg-slate-900 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors shadow-sm">Save Question</button>
                          </div>
                      </div>
                  )}
              </div>

            </div>

            {/* Sticky Launch Button Footer */}
            <div className="p-6 bg-white border-t border-slate-100 flex-shrink-0">
                <button 
                    onClick={handleLaunchCampaign} 
                    disabled={isSubmitting || !adForm.metaLocation.location || !adForm.privacyPolicyUrl || selectedCreatives.length === 0} 
                    className="w-full bg-slate-900 text-white py-4 sm:py-5 rounded-[1.5rem] text-sm sm:text-base font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 shadow-lg shadow-slate-900/20 hover:bg-slate-800"
                >
                    {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : <Zap size={20} className="text-yellow-400" />} 
                    {isSubmitting ? 'AI Optimizing & Launching...' : 'Launch Smart Campaign'}
                </button>
            </div>
            
          </div>
        </div>
      )}
      
      </div> 
    </div>
  )
}