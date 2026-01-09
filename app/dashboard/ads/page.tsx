'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Zap, Plus, X, Loader2, RefreshCw, BarChart2, TrendingUp, Users, MousePointer, IndianRupee } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useOrganization } from '@/components/OrganizationWrapper'
import Link from 'next/link'

// --- TYPES ---
type Property = {
  id: string
  title: string
  template_adset_id?: string 
}

type Campaign = {
  id: string
  name: string
  status: string 
  objective: string | null // Safety: Allow null
}

type MarketplaceAd = {
  id: string
  title: string
  description: string
  price: number
  image_url: string
}

type Insights = {
  spend: number
  impressions: number
  clicks: number
  cpc: number
  ctr: number
  leads: number
  cost_per_lead: number
}

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  
  // Organization Context
  const orgData = useOrganization()
  const org = orgData?.org
  const userRole = orgData?.userRole
  
  const [activeTab, setActiveTab] = useState<'campaigns' | 'market'>('campaigns')
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false) // Added refreshing state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [buyingId, setBuyingId] = useState<string | null>(null)
  
  // Analytics State
  const [analyticsId, setAnalyticsId] = useState<string | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [mounted, setMounted] = useState(false)
  
  // Data State
  const [adCredits, setAdCredits] = useState<number>(0)
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
  const [marketAds, setMarketAds] = useState<MarketplaceAd[]>([]) 
  const [properties, setProperties] = useState<Property[]>([]) 
  
  // Insights Cache Map (CampaignID -> Insights)
  const [insightsCache, setInsightsCache] = useState<Record<string, Insights>>({})

  const [adForm, setAdForm] = useState({
    propertyId: '', 
    lifetimeBudgetINR: 3000, 
  })

  // --- CACHE HELPERS ---
  const saveToCache = (userId: string, data: any) => {
    try {
        localStorage.setItem(`ads_cache_${userId}`, JSON.stringify(data));
        localStorage.setItem(`ads_cache_time_${userId}`, Date.now().toString());
    } catch (e) {
        console.error("Cache Save Error", e);
    }
  }

  const loadFromCache = (userId: string) => {
      try {
          const cached = localStorage.getItem(`ads_cache_${userId}`);
          return cached ? JSON.parse(cached) : null;
      } catch (e) {
          return null;
      }
  }

  // --- 1. FETCH DATA (Unified) ---
  const fetchAdsData = async (forceRefresh = false) => {
    try {
        if (!forceRefresh) setLoading(true)
        else setIsRefreshing(true)

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }

        // --- TRY CACHE FIRST ---
        if (!forceRefresh) {
            const cachedData = loadFromCache(user.id);
            if (cachedData) {
                console.log("⚡ Loading Ads from Cache");
                setAdCredits(cachedData.adCredits);
                setCampaigns(cachedData.campaigns);
                setMarketAds(cachedData.marketAds);
                setProperties(cachedData.properties);
                setInsightsCache(cachedData.insightsCache || {});
                setLoading(false);
                return; // STOP HERE IF CACHED
            }
        }

        console.log("🌐 Fetching Ads from APIs...");

        // 1. Fetch Profile (Credits)
        const { data: profile } = await supabase.from('profiles').select('role, ad_credits, organization_id').eq('id', user.id).single()
        if (!profile) return

        const currentCredits = profile.ad_credits || 0
        let fetchedCampaigns: Campaign[] = []
        let fetchedMarketAds: MarketplaceAd[] = []
        let fetchedProperties: Property[] = []

        // 2. Fetch Campaigns (Meta API)
        try {
            const res = await fetch('/api/meta-ads/campaigns');
            if (res.ok) {
                const data = await res.json();
                if (data.campaigns && Array.isArray(data.campaigns)) {
                   fetchedCampaigns = data.campaigns;
                }
            }
        } catch (e) { console.error("Failed to load campaigns", e); }

        // 3. Fetch Market Ads & Properties (If Agent)
        if (profile.role === 'agent') {
            const { data: ads } = await supabase.from('ads').select('*')
            fetchedMarketAds = ads || []

            if (profile.organization_id) {
                const { data: props } = await supabase.from('properties').select('id, title, template_adset_id').eq('organization_id', profile.organization_id).order('created_at', { ascending: false });
                fetchedProperties = props || []
            }
        }

        // --- UPDATE STATE ---
        setAdCredits(currentCredits)
        setCampaigns(fetchedCampaigns)
        setMarketAds(fetchedMarketAds)
        setProperties(fetchedProperties)

        // Keep existing insights cache if just refreshing list, unless force refresh clears it?
        // Let's keep insights cache on refresh to be nice, or clear it if we want "fresh" fresh.
        // The prompt implies "load until refresh clicked", so refresh should probably update everything.
        // However, fetching *all* insights for *all* campaigns at once is too heavy.
        // So we will just keep the existing insights cache in memory/localstorage, 
        // but rely on individual fetch if the user clicks "Analytics" again (handled in fetchInsights).
        
        // --- SAVE TO CACHE ---
        const cachePayload = {
            adCredits: currentCredits,
            campaigns: fetchedCampaigns,
            marketAds: fetchedMarketAds,
            properties: fetchedProperties,
            insightsCache: insightsCache // Persist known insights
        }
        saveToCache(user.id, cachePayload)

    } catch (err) {
        console.error("Critical Load Error:", err)
    } finally {
        setLoading(false)
        setIsRefreshing(false)
    }
  }

  // --- 2. FETCH INSIGHTS (On Demand with Cache) ---
  const fetchInsights = async (campaignId: string) => {
      setAnalyticsId(campaignId);
      setLoadingInsights(true);
      setInsights(null); 
      
      // A. Check Cache
      if (insightsCache[campaignId]) {
          console.log("⚡ Insight loaded from cache");
          setInsights(insightsCache[campaignId]);
          setLoadingInsights(false);
          return;
      }

      // B. Fetch Fresh
      try {
          const res = await fetch(`/api/meta-ads/insights?campaignId=${campaignId}`);
          const data = await res.json();
          if (data.insights) {
              setInsights(data.insights);
              
              // Update Cache
              const newCache = { ...insightsCache, [campaignId]: data.insights }
              setInsightsCache(newCache)
              
              // Persist to LocalStorage
              const { data: { user } } = await supabase.auth.getUser()
              if (user) {
                  const currentCache = loadFromCache(user.id) || {}
                  saveToCache(user.id, { ...currentCache, insightsCache: newCache })
              }
          }
          else throw new Error(data.error || "No data");
      } catch (e) {
          console.error(e);
          setAnalyticsId(null);
      } finally {
          setLoadingInsights(false);
      }
  }

  // --- ACTIONS ---
  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      setTogglingId(id);
      
      // Optimistic Update
      const updatedCampaigns = campaigns.map(c => c.id === id ? { ...c, status: newStatus } : c)
      setCampaigns(updatedCampaigns);
      
      // Update Cache Immediately (Optimistic)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
          const currentCache = loadFromCache(user.id) || {}
          saveToCache(user.id, { ...currentCache, campaigns: updatedCampaigns })
      }

      try {
          const res = await fetch('/api/meta-ads/update-status', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: id, newStatus })
          });
          if (!res.ok) throw new Error("Failed");
      } catch (error) {
          alert(`Failed to update status.`);
          // Revert on failure
          const reverted = campaigns.map(c => c.id === id ? { ...c, status: currentStatus } : c)
          setCampaigns(reverted);
          if (user) {
             const currentCache = loadFromCache(user.id) || {}
             saveToCache(user.id, { ...currentCache, campaigns: reverted })
          }
      } finally { setTogglingId(null); }
  }

  const handleBuyMarketAd = async (ad: MarketplaceAd) => {
    setBuyingId(ad.id)
    try {
      const response = await fetch('/api/phonepe/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: ad.price, adId: ad.id }),
      })
      const data = await response.json()
      if (data.url) window.location.href = data.url
      else alert('Payment initiation failed.')
    } catch (error) { console.error(error); alert('Payment Error') } finally { setBuyingId(null) }
  }

  // --- INITIAL LOAD ---
  useEffect(() => {
    setMounted(true)
    fetchAdsData(false) // Default: Load from Cache
  }, [])
  
  // --- LAUNCH HANDLER ---
  const handleLaunchCampaign = async () => {
    if (isSubmitting) return
    if (!adForm.propertyId) { alert("Please select a Project."); return }
    if (adForm.lifetimeBudgetINR < 3000) { alert("Minimum budget is ₹3,000 for a 30-day campaign."); return }
    
    if (userRole === 'agent' && adCredits < adForm.lifetimeBudgetINR) {
        alert(`Insufficient Credits. You have ₹${adCredits}. Please top up your wallet.`);
        router.push('/dashboard/wallet');
        return;
    }
    
    setIsSubmitting(true)
    const formPayload = new FormData();
    formPayload.append('propertyId', adForm.propertyId);
    formPayload.append('lifetimeBudgetINR', adForm.lifetimeBudgetINR.toString()); 
    
    try {
      const res = await fetch('/api/meta-ads/launch-campaign', { method: 'POST', body: formPayload })
      const data = await res.json()
      if (res.ok) {
        alert(`${data.message}`);
        setIsModalOpen(false)
        setAdForm(prev => ({ ...prev, propertyId: '', lifetimeBudgetINR: 3000 })) 
        
        // Force Refresh to get new campaign & update credits
        fetchAdsData(true); 

      } else {
        throw new Error(data.error || 'Launch Failed');
      }
    } catch (e: any) {
      console.error(e);
      alert('Launch Failed: ' + e.message);
    } finally {
      setIsSubmitting(false)
    }
  }
  
  // Portal Helper
  const ModalPortal = ({ children }: { children: React.ReactNode }) => {
    if (!mounted) return null
    return createPortal(children, document.body)
  }

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="p-5 max-w-5xl mx-auto min-h-screen pb-24 mt-12">
      {/* HEADER */}
      <div className="flex justify-between items-end mb-6">
        <div>
            <div className="flex items-center gap-2">
               {org?.master_logo_url && <img src={org.master_logo_url} className="w-6 h-6 object-contain" />}
               <h1 className="text-2xl font-bold text-slate-900">Ads Center</h1>
            </div>
            <div className="flex gap-4 items-center mt-1">
                <p className="text-slate-500 text-xs">Manage campaigns & lead flow</p>
            </div>
        </div>
        <div className="flex gap-2">
            {userRole === 'admin' && (
                <Link href="/dashboard/ads/mapping" className="bg-blue-50 text-blue-600 px-4 py-3 rounded-full text-sm font-bold flex items-center gap-2 hover:bg-blue-100 transition-colors">
                    <RefreshCw size={16}/> Map Projects
                </Link>
            )}
            
            {/* Refresh Button */}
            <button 
                onClick={() => fetchAdsData(true)} 
                disabled={isRefreshing}
                className="bg-white text-slate-500 p-3 rounded-full shadow-sm border border-slate-100 hover:text-slate-900 active:scale-95 transition-all disabled:opacity-50"
            >
                <RefreshCw size={20} className={isRefreshing ? "animate-spin" : ""} />
            </button>

            {userRole === 'agent' && (
              <button onClick={() => setIsModalOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white p-3 rounded-full shadow-md">
                <Plus size={20} strokeWidth={3} />
              </button>
            )}
        </div>
      </div>

      {/* CAMPAIGNS LIST */}
      <div className="flex flex-col gap-4 animate-in fade-in duration-300"> 
          {campaigns.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-100">
                  No active campaigns. {userRole === 'agent' && <><br/>Tap '+' to launch a new Project Ad.</>}
              </div>
          ) : (
              campaigns.map(campaign => (
                  <div key={campaign.id} className="bg-white p-5 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200">
                      <div className="flex justify-between items-start mb-4">
                          <div className="max-w-[65%]">
                              <h3 className="text-sm font-bold text-slate-800 truncate leading-tight">{campaign.name}</h3>
                              <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1">
                                {campaign.objective ? campaign.objective.replace('OUTCOME_', '') : 'CAMPAIGN'}
                              </p>
                          </div>
                          <div className="flex items-center gap-2">
                              {/* STATUS TOGGLE */}
                              {togglingId === campaign.id && <Loader2 size={12} className="animate-spin text-slate-400" />}
                              <button onClick={() => handleToggleStatus(campaign.id, campaign.status)} className={`w-11 h-6 rounded-full p-1 transition-colors ${campaign.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-200'}`}>
                                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${campaign.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} />
                              </button>
                          </div>
                      </div>
                      
                      <div className="flex justify-between items-center pt-3 border-t border-slate-50">
                           <span className={`flex items-center gap-1 text-[10px] font-bold ${campaign.status === 'ACTIVE' ? 'text-green-600' : 'text-slate-400'}`}>
                             {campaign.status}
                           </span>
                          
                           {/* ANALYTICS BUTTON */}
                           <button 
                             onClick={() => fetchInsights(campaign.id)}
                             className="text-xs font-bold text-slate-600 flex items-center gap-1 hover:text-blue-600 transition-colors bg-slate-100 px-3 py-1.5 rounded-full"
                           >
                             <BarChart2 size={14} /> Analytics
                           </button>
                      </div>
                  </div>
              ))
          )}
      </div>
      
      {/* ANALYTICS MODAL */}
      {analyticsId && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl relative">
                  <button onClick={() => setAnalyticsId(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-800"><X size={20} /></button>
                  
                  <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><BarChart2 className="text-blue-600"/> Campaign Insights</h3>
                  <p className="text-xs text-slate-500 mb-6">Lifetime performance metrics</p>

                  {loadingInsights ? (
                      <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                          <Loader2 className="animate-spin text-blue-600" size={32} />
                          <span className="text-xs">Fetching data from Facebook...</span>
                      </div>
                  ) : insights ? (
                      <div className="grid grid-cols-2 gap-4">
                          {/* SPEND */}
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <div className="flex items-center gap-2 mb-1 text-slate-400 text-xs uppercase font-bold"><IndianRupee size={12}/> Spend</div>
                              <div className="text-2xl font-bold text-slate-900">₹{insights.spend.toLocaleString()}</div>
                          </div>
                          
                          {/* LEADS */}
                          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                              <div className="flex items-center gap-2 mb-1 text-blue-400 text-xs uppercase font-bold"><Users size={12}/> Leads</div>
                              <div className="text-2xl font-bold text-blue-700">{insights.leads}</div>
                          </div>

                          {/* COST PER LEAD */}
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <div className="flex items-center gap-2 mb-1 text-slate-400 text-xs uppercase font-bold"><TrendingUp size={12}/> Cost/Lead</div>
                              <div className="text-xl font-bold text-slate-900">₹{Math.round(insights.cost_per_lead)}</div>
                          </div>

                          {/* IMPRESSIONS */}
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <div className="flex items-center gap-2 mb-1 text-slate-400 text-xs uppercase font-bold"><MousePointer size={12}/> Impressions</div>
                              <div className="text-xl font-bold text-slate-900">{insights.impressions.toLocaleString()}</div>
                          </div>
                      </div>
                  ) : (
                      <div className="text-center py-10 text-slate-400">No data available yet.</div>
                  )}
              </div>
          </div>
        </ModalPortal>
      )}

      {/* LAUNCH MODAL */}
      {isModalOpen && (
        <ModalPortal>
            <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10">
                <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-800">New Campaign</h2>
                <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
                </div>
                
                <div className="space-y-6">
                {/* Project Select */}
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Select Project</label>
                    <select value={adForm.propertyId} onChange={(e) => setAdForm(prev => ({...prev, propertyId: e.target.value}))} className="w-full bg-slate-50 border border-slate-100 text-slate-700 text-sm rounded-xl py-3 pl-4 pr-8 outline-none">
                        <option value="">-- Choose Project --</option>
                        {properties.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.title} {p.template_adset_id ? '' : '(Not Configured)'}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Budget Input */}
                <div>
                    <div className="flex justify-between">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Lifetime Budget (30 Days)</label>
                        <span className={`text-[10px] font-bold ${adCredits < adForm.lifetimeBudgetINR ? 'text-red-500' : 'text-green-600'}`}>
                            Credits: ₹{adCredits}
                        </span>
                    </div>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <input 
                            type="number" 
                            min="3000" 
                            step="100" 
                            value={adForm.lifetimeBudgetINR} 
                            onChange={(e) => setAdForm(prev => ({...prev, lifetimeBudgetINR: parseInt(e.target.value) || 0}))} 
                            className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm outline-none font-bold" 
                        />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 ml-1">Minimum ₹3,000 required for 30 days.</p>
                </div>

                <button 
                    onClick={handleLaunchCampaign} 
                    disabled={isSubmitting || !adForm.propertyId} 
                    className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 disabled:opacity-70"
                >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 
                    {isSubmitting ? 'Launching...' : `Launch Campaign (₹${adForm.lifetimeBudgetINR})`}
                </button>
                </div>
            </div>
            </div>
        </ModalPortal>
      )}
    </div>
  )
}