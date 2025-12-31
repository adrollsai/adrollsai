'use client'

import { useState, useEffect } from 'react'
import { Zap, Plus, X, Loader2, RefreshCw, ExternalLink, ShoppingBag, LayoutGrid, List, Building2, Wallet } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { useOrganization } from '@/components/OrganizationWrapper'
import Link from 'next/link'

// --- TYPES ---
type Property = {
  id: string
  title: string
  // We use this to know if the Admin has "Mapped" this project yet
  template_adset_id?: string 
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

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  
  // 1. CONTEXT & ROLES
  // We use this to know if they are an Admin (show Mapping button) or Agent (show Marketplace)
  const { org, userRole } = useOrganization()
  
  // --- TABS STATE ---
  const [activeTab, setActiveTab] = useState<'campaigns' | 'market'>('campaigns')

  // --- UI STATE ---
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [buyingId, setBuyingId] = useState<string | null>(null)
  
  // --- DATA STATE ---
  const [adCredits, setAdCredits] = useState<number>(0)
  const [campaigns, setCampaigns] = useState<Campaign[]>([]) 
  const [marketAds, setMarketAds] = useState<MarketplaceAd[]>([]) 
  const [properties, setProperties] = useState<Property[]>([]) 

  // --- FORM STATE (Simplified for Agency Model) ---
  // Agents ONLY select the Project and the Budget. 
  // The backend clones the rest from the Admin's Template.
  const [adForm, setAdForm] = useState({
    propertyId: '', 
    lifetimeBudgetINR: 2500, // Default Budget
  })

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

  // --- ACTIONS ---
  const handleToggleStatus = async (id: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      setTogglingId(id);
      
      // Optimistic Update
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
          // Revert on failure
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
        body: JSON.stringify({ amount: ad.price, adId: ad.id }),
      })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert('Payment initiation failed.')
      }
    } catch (error) {
      console.error(error)
      alert('Payment Error')
    } finally {
      setBuyingId(null)
    }
  }

  // --- INITIAL LOAD ---
  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // 1. Fetch Profile Info
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, ad_credits, organization_id') 
        .eq('id', user.id)
        .single()
      
      if (profile) {
        setAdCredits(profile.ad_credits || 0)
        await fetchCampaigns();
        
        // 2. Setup for Agents
        if (profile.role === 'agent') {
            await fetchMarketAds();

            // Fetch Projects that belong to this Agent's Organization
            if (profile.organization_id) {
                const { data: props } = await supabase
                    .from('properties')
                    .select('id, title, template_adset_id')
                    .eq('organization_id', profile.organization_id)
                    .order('created_at', { ascending: false });
                
                if (props) setProperties(props);
            }
        }
      }
      setLoading(false)
    }
    loadData()
  }, [])
  

  // --- LAUNCH HANDLER ---
  const handleLaunchCampaign = async () => {
    if (isSubmitting) return
    
    // 1. Validation
    if (!adForm.propertyId) { alert("Please select a Project."); return }
    if (adForm.lifetimeBudgetINR < 500) { alert("Budget must be at least ₹500."); return }
    
    // 2. Credit Check
    // If they don't have enough money, stop them and send them to marketplace
    if (userRole === 'agent' && adCredits < adForm.lifetimeBudgetINR) {
        alert(`Insufficient Credits. You need ₹${adForm.lifetimeBudgetINR} but have ₹${adCredits}. Please buy credits in the Marketplace.`);
        setActiveTab('market'); 
        setIsModalOpen(false);
        return;
    }
    
    setIsSubmitting(true)
    
    // 3. Payload Construction
    const formPayload = new FormData();
    formPayload.append('propertyId', adForm.propertyId);
    formPayload.append('dailyBudgetINR', adForm.lifetimeBudgetINR.toString()); 
    
    try {
      const res = await fetch('/api/meta-ads/launch-campaign', {
        method: 'POST',
        body: formPayload, 
      })

      const data = await res.json()

      if (res.ok) {
        alert(`${data.message}`);
        setIsModalOpen(false)
        setAdForm(prev => ({ ...prev, propertyId: '', lifetimeBudgetINR: 2500 })) 
        fetchCampaigns();
        setAdCredits(prev => prev - adForm.lifetimeBudgetINR); // Immediate UI update
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

  if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="p-5 max-w-5xl mx-auto min-h-screen pb-24">
      {/* HEADER */}
      <div className="flex justify-between items-end mb-6">
        <div>
            <div className="flex items-center gap-2">
               {org?.master_logo_url && <img src={org.master_logo_url} className="w-6 h-6 object-contain" />}
               <h1 className="text-2xl font-bold text-slate-900">Ads Center</h1>
            </div>
            
            <div className="flex gap-4 items-center mt-1">
                <p className="text-slate-500 text-xs">Manage campaigns & Buy ad slots</p>
                {/* CREDIT DISPLAY (Only for Agents) */}
                {userRole === 'agent' && (
                    <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                        <Wallet size={12}/> Credits: ₹{adCredits}
                    </div>
                )}
            </div>
        </div>
        <div className="flex gap-2">
            {/* ADMIN LINK: Only visible to Admins */}
            {userRole === 'admin' && (
                <Link href="/dashboard/ads/mapping" className="bg-blue-50 text-blue-600 px-4 py-3 rounded-full text-sm font-bold flex items-center gap-2 hover:bg-blue-100 transition-colors">
                    <RefreshCw size={16}/> Map Projects
                </Link>
            )}

            <button onClick={() => { fetchCampaigns(); if(userRole==='agent') fetchMarketAds(); }} className="bg-white text-slate-500 p-3 rounded-full shadow-sm border border-slate-100 active:scale-95 transition-transform"><RefreshCw size={20} /></button>
            
            {/* NEW CAMPAIGN BUTTON: Only visible to Agents in Campaigns tab */}
            {activeTab === 'campaigns' && userRole === 'agent' && (
              <button onClick={() => setIsModalOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white p-3 rounded-full shadow-md active:scale-95 transition-transform">
                <Plus size={20} strokeWidth={3} />
              </button>
            )}
        </div>
      </div>

      {/* TABS (Only for Agents) */}
      {userRole === 'agent' ? (
          <div className="flex p-1 bg-slate-100 rounded-xl mb-6 w-fit">
            <button onClick={() => setActiveTab('campaigns')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'campaigns' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              <List size={16} /> My Campaigns
            </button>
            <button onClick={() => setActiveTab('market')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'market' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              <LayoutGrid size={16} /> Marketplace
            </button>
          </div>
      ) : (
          <div className="mb-6"><h2 className="font-bold text-slate-800">All Active Campaigns</h2></div>
      )}

      {/* --- CONTENT: CAMPAIGNS TAB --- */}
      {activeTab === 'campaigns' && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300"> 
          {campaigns.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-100">
                  No active campaigns. {userRole === 'agent' && <><br/>Tap '+' to launch a new Project Ad.</>}
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
                          <span className={`flex items-center gap-1 text-[10px] font-bold ${campaign.status === 'ACTIVE' ? 'text-green-600' : 'text-slate-400'}`}>
                             {campaign.status}
                          </span>
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
                       <div className="flex items-center justify-center h-full text-slate-300"><ShoppingBag size={32} /></div>
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
                      {buyingId === ad.id ? 'Processing...' : 'Buy Credits'}
                    </button>
                  </div>
                </div>
             ))
           )}
        </div>
      )}
      
      {/* --- LAUNCH MODAL (Simplified) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">New Campaign</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
            
            <div className="space-y-6">
              
              {/* 1. PROJECT SELECTION */}
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Select Project</label>
                  <div className="relative">
                      <select 
                        value={adForm.propertyId} 
                        onChange={(e) => setAdForm(prev => ({...prev, propertyId: e.target.value}))} 
                        className="w-full bg-slate-50 border border-slate-100 text-slate-700 text-sm rounded-xl py-3 pl-4 pr-8 appearance-none focus:ring-2 focus:ring-primary outline-none"
                      >
                          <option value="">-- Choose Project --</option>
                          {properties.map(p => (
                             <option key={p.id} value={p.id}>
                                {p.title} {p.template_adset_id ? '' : '(Not Configured by Admin)'}
                             </option>
                          ))}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                         <Building2 size={16} className="text-slate-400"/>
                      </div>
                  </div>
                  {/* HELPER TEXT */}
                  {properties.length === 0 && (
                      <p className="text-[10px] text-red-400 mt-1">
                          No projects found. Please ask your Admin to create projects and map them to Facebook.
                      </p>
                  )}
              </div>

              {/* 2. BUDGET SELECTION */}
              <div>
                  <div className="flex justify-between">
                     <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Lifetime Budget</label>
                     <span className={`text-[10px] font-bold ${adCredits < adForm.lifetimeBudgetINR ? 'text-red-500' : 'text-green-600'}`}>
                        Credits: ₹{adCredits}
                     </span>
                  </div>
                  <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                      <input 
                        type="number" 
                        min="500" 
                        step="100" 
                        value={adForm.lifetimeBudgetINR} 
                        onChange={(e) => setAdForm(prev => ({...prev, lifetimeBudgetINR: parseInt(e.target.value) || 0}))} 
                        className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none font-bold" 
                      />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 ml-1">Total spend over 30 days. Deducted from your credits.</p>
              </div>

              <button 
                onClick={handleLaunchCampaign} 
                disabled={isSubmitting || !adForm.propertyId} 
                className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70 mt-2"
              >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 
                  {isSubmitting ? 'Launching...' : `Launch Campaign (₹${adForm.lifetimeBudgetINR})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}