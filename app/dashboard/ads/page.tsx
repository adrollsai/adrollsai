'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Zap, Plus, X, Loader2, RefreshCw, BarChart2, TrendingUp, Users, MousePointer, IndianRupee, ExternalLink, CreditCard, Link as LinkIcon } from 'lucide-react'
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
  objective: string | null 
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
  
  const orgData = useOrganization()
  const org = orgData?.org
  const userRole = orgData?.userRole
  
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false) 
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  
  // Analytics State
  const [analyticsId, setAnalyticsId] = useState<string | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [mounted, setMounted] = useState(false)
  
  // Data State
  const [accountBalance, setAccountBalance] = useState<number | null>(null) // Now stores Meta Balance
  const [adAccountId, setAdAccountId] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
  const [properties, setProperties] = useState<Property[]>([]) 
  
  const [insightsCache, setInsightsCache] = useState<Record<string, Insights>>({})

  const [adForm, setAdForm] = useState({
    propertyId: '', 
    dailyBudgetINR: 200, // Changed default to Daily
  })

  // --- CACHE HELPERS ---
  const saveToCache = (userId: string, data: any) => {
    try {
        localStorage.setItem(`ads_cache_${userId}`, JSON.stringify(data));
    } catch (e) { console.error("Cache Save Error", e); }
  }

  const loadFromCache = (userId: string) => {
      try {
          const cached = localStorage.getItem(`ads_cache_${userId}`);
          return cached ? JSON.parse(cached) : null;
      } catch (e) { return null; }
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
                setAccountBalance(cachedData.accountBalance);
                setAdAccountId(cachedData.adAccountId);
                setCampaigns(cachedData.campaigns);
                setProperties(cachedData.properties);
                setInsightsCache(cachedData.insightsCache || {});
                setLoading(false);
                return;
            }
        }

        // 1. Fetch Profile for ID
        const { data: profile } = await supabase.from('profiles').select('organization_id, ad_account_id').eq('id', user.id).single()
        
        // 2. Fetch Balance from Meta (Server-side proxy)
        let freshBalance = 0;
        try {
            const bRes = await fetch('/api/meta-ads/balance');
            const bData = await bRes.json();
            if(bData.balance) freshBalance = parseFloat(bData.balance) / 100; // Cents to Unit
        } catch(e) {}

        let fetchedCampaigns: Campaign[] = []
        let fetchedProperties: Property[] = []

        // 3. Fetch Campaigns (Meta API)
        try {
            const res = await fetch('/api/meta-ads/campaigns');
            if (res.ok) {
                const data = await res.json();
                if (data.campaigns && Array.isArray(data.campaigns)) {
                   fetchedCampaigns = data.campaigns;
                }
            }
        } catch (e) { }

        // 4. Fetch Properties
        if (profile?.organization_id) {
            const { data: props } = await supabase.from('properties').select('id, title, template_adset_id').eq('organization_id', profile.organization_id).order('created_at', { ascending: false });
            fetchedProperties = props || []
        }

        // --- UPDATE STATE ---
        setAccountBalance(freshBalance)
        setAdAccountId(profile?.ad_account_id || null)
        setCampaigns(fetchedCampaigns)
        setProperties(fetchedProperties)
        
        // --- SAVE TO CACHE ---
        const cachePayload = {
            accountBalance: freshBalance,
            adAccountId: profile?.ad_account_id,
            campaigns: fetchedCampaigns,
            properties: fetchedProperties,
            insightsCache: insightsCache 
        }
        saveToCache(user.id, cachePayload)

    } catch (err) {
        console.error("Critical Load Error:", err)
    } finally {
        setLoading(false)
        setIsRefreshing(false)
    }
  }

  // --- 2. FETCH INSIGHTS ---
  const fetchInsights = async (campaignId: string) => {
      setAnalyticsId(campaignId);
      setLoadingInsights(true);
      setInsights(null); 
      
      if (insightsCache[campaignId]) {
          setInsights(insightsCache[campaignId]);
          setLoadingInsights(false);
          return;
      }

      try {
          const res = await fetch(`/api/meta-ads/insights?campaignId=${campaignId}`);
          const data = await res.json();
          if (data.insights) {
              setInsights(data.insights);
              const newCache = { ...insightsCache, [campaignId]: data.insights }
              setInsightsCache(newCache)
              
              const { data: { user } } = await supabase.auth.getUser()
              if (user) {
                  const currentCache = loadFromCache(user.id) || {}
                  saveToCache(user.id, { ...currentCache, insightsCache: newCache })
              }
          }
      } catch (e) { setAnalyticsId(null); } 
      finally { setLoadingInsights(false); }
  }

  // --- ACTIONS ---
  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      setTogglingId(id);
      
      const updatedCampaigns = campaigns.map(c => c.id === id ? { ...c, status: newStatus } : c)
      setCampaigns(updatedCampaigns);
      
      try {
          const res = await fetch('/api/meta-ads/update-status', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: id, newStatus })
          });
          if (!res.ok) throw new Error("Failed");
      } catch (error) {
          alert(`Failed to update status.`);
          setCampaigns(campaigns.map(c => c.id === id ? { ...c, status: currentStatus } : c));
      } finally { setTogglingId(null); }
  }

  useEffect(() => {
    setMounted(true)
    fetchAdsData(false) 
  }, [])
  
  // --- LAUNCH HANDLER ---
  const handleLaunchCampaign = async () => {
    if (isSubmitting) return
    if (!adForm.propertyId) { alert("Please select a Project."); return }
    if (adForm.dailyBudgetINR < 100) { alert("Minimum daily budget is ₹100."); return }
    
    if (!adAccountId) {
        alert("Please connect your Ad Account in Profile settings first.");
        router.push('/dashboard/profile');
        return;
    }

    setIsSubmitting(true)
    const formPayload = new FormData();
    formPayload.append('propertyId', adForm.propertyId);
    formPayload.append('dailyBudgetINR', adForm.dailyBudgetINR.toString()); 
    
    try {
      const res = await fetch('/api/meta-ads/launch-campaign', { method: 'POST', body: formPayload })
      const data = await res.json()
      if (res.ok) {
        alert(`${data.message}`);
        setIsModalOpen(false)
        setAdForm(prev => ({ ...prev, propertyId: '', dailyBudgetINR: 200 })) 
        fetchAdsData(true); 
      } else {
        throw new Error(data.error || 'Launch Failed');
      }
    } catch (e: any) {
      alert('Launch Failed: ' + e.message);
    } finally {
      setIsSubmitting(false)
    }
  }
  
  const ModalPortal = ({ children }: { children: React.ReactNode }) => {
    if (!mounted) return null
    return createPortal(children, document.body)
  }

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="p-5 max-w-5xl mx-auto min-h-screen pb-24 mt-12">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
        <div>
            <div className="flex items-center gap-2">
               {org?.master_logo_url && <img src={org.master_logo_url} className="w-6 h-6 object-contain" />}
               <h1 className="text-2xl font-bold text-slate-900">Ads Manager</h1>
            </div>
            <p className="text-slate-500 text-xs mt-1">Run decentralized ads from your own account.</p>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
             {/* BALANCE CARD */}
             <div className="bg-white border border-slate-200 rounded-full pl-4 pr-1 py-1 flex items-center gap-4 shadow-sm">
                 <div className="text-right">
                     <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Account Balance</p>
                     <p className="text-sm font-bold text-slate-900 leading-none">
                        {accountBalance === null ? '...' : `₹${accountBalance.toLocaleString()}`}
                     </p>
                 </div>
                 {adAccountId ? (
                     <a 
                        href={`https://secure.facebook.com/ads/manager/billing_history/summary/?act=${adAccountId}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="bg-blue-50 text-blue-600 px-3 py-2 rounded-full text-xs font-bold hover:bg-blue-100 flex items-center gap-1 transition-colors"
                     >
                         <CreditCard size={14}/> Top Up
                     </a>
                 ) : (
                     <Link href="/dashboard/profile" className="bg-red-50 text-red-500 px-3 py-2 rounded-full text-xs font-bold hover:bg-red-100">Connect</Link>
                 )}
             </div>

             {/* 🛑 RESTORED BUTTON: MAP PROJECTS (ADMIN ONLY) 🛑 */}
             {userRole === 'admin' && (
                <Link href="/dashboard/ads/mapping" className="bg-white text-blue-600 px-4 py-3 rounded-full shadow-sm border border-slate-100 text-sm font-bold flex items-center gap-2 hover:bg-blue-50 transition-colors">
                    <LinkIcon size={16}/> Map Projects
                </Link>
             )}

            <button 
                onClick={() => fetchAdsData(true)} 
                disabled={isRefreshing}
                className="bg-white text-slate-500 p-3 rounded-full shadow-sm border border-slate-100 hover:text-slate-900 active:scale-95 transition-all disabled:opacity-50"
            >
                <RefreshCw size={20} className={isRefreshing ? "animate-spin" : ""} />
            </button>

            {/* Launch Button (Available to Agents and Admins who want to run ads) */}
            <button onClick={() => setIsModalOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white p-3 rounded-full shadow-md">
              <Plus size={20} strokeWidth={3} />
            </button>
        </div>
      </div>

      {/* CAMPAIGNS LIST */}
      <div className="flex flex-col gap-4 animate-in fade-in duration-300"> 
          {campaigns.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-100">
                  No active campaigns. 
                  <br/>Tap '+' to launch a new Project Ad.
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

      {/* ANALYTICS MODAL (Same as before) */}
      {analyticsId && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl relative">
                  <button onClick={() => setAnalyticsId(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-800"><X size={20} /></button>
                  <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2"><BarChart2 className="text-blue-600"/> Campaign Insights</h3>
                  {loadingInsights ? (
                      <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2"><Loader2 className="animate-spin text-blue-600" size={32} /></div>
                  ) : insights ? (
                      <div className="grid grid-cols-2 gap-4 mt-6">
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <div className="flex items-center gap-2 mb-1 text-slate-400 text-xs uppercase font-bold"><IndianRupee size={12}/> Spend</div>
                              <div className="text-2xl font-bold text-slate-900">₹{insights.spend.toLocaleString()}</div>
                          </div>
                          <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                              <div className="flex items-center gap-2 mb-1 text-blue-400 text-xs uppercase font-bold"><Users size={12}/> Leads</div>
                              <div className="text-2xl font-bold text-blue-700">{insights.leads}</div>
                          </div>
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <div className="flex items-center gap-2 mb-1 text-slate-400 text-xs uppercase font-bold"><TrendingUp size={12}/> Cost/Lead</div>
                              <div className="text-xl font-bold text-slate-900">₹{Math.round(insights.cost_per_lead)}</div>
                          </div>
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <div className="flex items-center gap-2 mb-1 text-slate-400 text-xs uppercase font-bold"><MousePointer size={12}/> Impressions</div>
                              <div className="text-xl font-bold text-slate-900">{insights.impressions.toLocaleString()}</div>
                          </div>
                      </div>
                  ) : <div className="text-center py-10 text-slate-400">No data available yet.</div>}
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
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Select Project</label>
                    <select value={adForm.propertyId} onChange={(e) => setAdForm(prev => ({...prev, propertyId: e.target.value}))} className="w-full bg-slate-50 border border-slate-100 text-slate-700 text-sm rounded-xl py-3 pl-4 pr-8 outline-none">
                        <option value="">-- Choose Project --</option>
                        {properties.map(p => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <div className="flex justify-between">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Daily Budget</label>
                    </div>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <input 
                            type="number" 
                            min="100" 
                            step="50" 
                            value={adForm.dailyBudgetINR} 
                            onChange={(e) => setAdForm(prev => ({...prev, dailyBudgetINR: parseInt(e.target.value) || 0}))} 
                            className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm outline-none font-bold" 
                        />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 ml-1">Billed directly to your Ad Account.</p>
                </div>

                <button 
                    onClick={handleLaunchCampaign} 
                    disabled={isSubmitting || !adForm.propertyId} 
                    className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 disabled:opacity-70"
                >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 
                    {isSubmitting ? 'Launching...' : `Launch (₹${adForm.dailyBudgetINR}/day)`}
                </button>
                </div>
            </div>
            </div>
        </ModalPortal>
      )}
    </div>
  )
}