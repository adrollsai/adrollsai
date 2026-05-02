'use client'

import { useState, useEffect, useRef } from 'react'
import { Zap, Plus, X, Loader2, Image as ImageIcon, Upload, RefreshCw, ExternalLink, TrendingUp, CreditCard, Eye, MousePointerClick, Users, Settings2, Sparkles, Video, MapPin, LayoutGrid, PauseCircle, PlayCircle, PlusCircle, CheckCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

type Property = { id: string; title: string; price: string; image_url: string; description?: string }
type Asset = { id: string; type: 'image' | 'video'; url: string; property_id?: string }
type Campaign = { id: string; name: string; status: string; objective: string }
type LocationOption = { key: string; name: string; type: string; region?: string; country_code?: string; }
type CustomQuestion = { label: string; type: 'SHORT_ANSWER' | 'MULTIPLE_CHOICE'; options?: string[]; disqualifyingOptions?: string[] }

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
  
  // Data States
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [selectedCreatives, setSelectedCreatives] = useState<SelectedCreative[]>([])
  const [showAssetSelector, setShowAssetSelector] = useState<{isOpen: boolean, type: 'inventory' | 'ai'}>({isOpen: false, type: 'inventory'})
  const [assetFilter, setAssetFilter] = useState<string>('All')
  
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
  
  const [campaignLeadCounts, setCampaignLeadCounts] = useState<Record<string, number>>({})
  const [orchestrator, setOrchestrator] = useState<{
    isOpen: boolean,
    mode: 'optimize' | 'remarketing' | null,
    campaign: Campaign | null,
    status: 'analyzing' | 'presenting' | 'generating' | 'reviewing' | 'pushing' | 'success' | 'error',
    logs: { id: number, text: string, type: 'system' | 'ai' | 'user' }[],
    variations: any[],
    selectedVariations: number[],
    insight: string,
    leadFormId: string | null
  }>({ isOpen: false, mode: null, campaign: null, status: 'analyzing', logs: [], variations: [], selectedVariations: [], insight: '', leadFormId: null })

  const [optimizedCampaigns, setOptimizedCampaigns] = useState<string[]>([])

  // Form States
  const [formQuestions, setFormQuestions] = useState<CustomQuestion[]>([])
  const [isAddingQuestion, setIsAddingQuestion] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [newQuestion, setNewQuestion] = useState<CustomQuestion>({ label: '', type: 'SHORT_ANSWER', options: [''] })

  const [adForm, setAdForm] = useState({
    metaLocations: [] as { location: LocationOption, radius: number }[],
    gender: 'All',
    dailyBudgetINR: 500,
    pageId: '', 
    linkUrl: 'https://adrolls.in', 
    optimizeForConversions: false,
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

      const [propsRes, assetsRes, leadsRes] = await Promise.all([
          supabase.from('properties').select('id, title, price, image_url, description').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('assets').select('id, type, url, property_id').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('leads').select('campaign_id').eq('user_id', user.id)
      ])

      const newProps = propsRes.data || []
      const newAssets = (assetsRes.data as Asset[]) || []
      
      const leads = leadsRes.data || [];
      const leadCounts: Record<string, number> = {};
      leads.forEach(l => {
          if (l.campaign_id) leadCounts[l.campaign_id] = (leadCounts[l.campaign_id] || 0) + 1;
      });
      setCampaignLeadCounts(leadCounts);

      setCampaigns(newCampaigns)
      setProperties(newProps)
      setAssets(newAssets)

    } catch (error) {
      console.error("Fetch Error:", error)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  // Trigger initial fetch
  useEffect(() => { 
    fetchAdsData() 
    const saved = localStorage.getItem('optimized_campaign_ids')
    if (saved) setOptimizedCampaigns(JSON.parse(saved))
  }, [])

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

  const handleOptimize = async (campaign: Campaign) => {
      if (optimizedCampaigns.includes(campaign.id)) {
          alert("This campaign has already been optimized by the AI Strategist.");
          return;
      }

      setOrchestrator({
          isOpen: true,
          mode: 'optimize',
          campaign,
          status: 'analyzing',
          logs: [{ id: Date.now(), text: `Analyzing performance metrics for ${campaign.name}...`, type: 'system' }],
          variations: [],
          selectedVariations: [],
          insight: '',
          leadFormId: null
      });
  
      try {
          const res = await fetch('/api/meta-ads/optimize-campaign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaignId: campaign.id })
          });
          const data = await res.json();
          
          if (data.status === 'success') {
              // Lock the campaign
              const newOptimized = [...optimizedCampaigns, campaign.id];
              setOptimizedCampaigns(newOptimized);
              localStorage.setItem('optimized_campaign_ids', JSON.stringify(newOptimized));

              setOrchestrator(prev => ({
                  ...prev,
                  status: 'presenting',
                  insight: data.insight,
                  variations: data.variations || [],
                  selectedVariations: (data.variations || []).map((_: any, i: number) => i), // Select all by default
                  leadFormId: data.leadFormId,
                  logs: [
                      ...prev.logs, 
                      { id: Date.now(), text: data.insight, type: 'ai' },
                      { id: Date.now()+1, text: "I've drafted 10 high-performance variations. Background generation for all 10 images has started. You will be notified when they are ready for final review.", type: 'system' }
                  ]
              }));
          } else {
               setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: data.message || "Failed to analyze.", type: 'system' }]}));
          }
      } catch (e) {
          setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Network error occurred.", type: 'system' }]}));
      }
  }

  const handleRemarketing = async (campaign: Campaign) => {
      setOrchestrator({
          isOpen: true,
          mode: 'remarketing',
          campaign,
          status: 'analyzing',
          logs: [{ id: Date.now(), text: `Analyzing 100+ leads for ${campaign.name}...`, type: 'system' }],
          variations: [],
          selectedVariations: [],
          insight: '',
          leadFormId: null
      });
  
      try {
          const res = await fetch('/api/meta-ads/remarketing-strategy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaignId: campaign.id, campaignName: campaign.name })
          });
          const data = await res.json();
          
          if (data.status === 'success') {
              setOrchestrator(prev => ({
                  ...prev,
                  status: 'presenting',
                  insight: data.insight,
                  variations: data.variations || [],
                  logs: [
                      ...prev.logs, 
                      { id: Date.now(), text: data.insight, type: 'ai' },
                      { id: Date.now()+1, text: "I've prepared 3 retargeting strategies (Social Proof, Urgency, Rapport) to warm up these leads. Ready to generate assets?", type: 'system' }
                  ]
              }));
          } else {
               setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: data.message || "Failed to analyze.", type: 'system' }]}));
          }
      } catch (e) {
          setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Network error occurred.", type: 'system' }]}));
      }
  }

  const handleApproveVariations = async () => {
      if (!orchestrator.variations.length || !orchestrator.campaign) return;
      
      if (orchestrator.status === 'presenting') {
          // Move to generating phase
          setOrchestrator(prev => ({
              ...prev,
              status: 'generating',
              logs: [...prev.logs, { id: Date.now(), text: "Strategy approved. Background image generation tasks have been queued. You can close this and you will be notified when images are ready for final review.", type: 'user' }]
          }));
          return;
      }

      if (orchestrator.status === 'reviewing') {
          // User has reviewed and is now pushing
          setOrchestrator(prev => ({
              ...prev,
              status: 'pushing',
              logs: [...prev.logs, { id: Date.now(), text: `Pushing ${prev.selectedVariations.length} selected variations to Meta...`, type: 'user' }]
          }));

          try {
              // Fetch the actual asset objects from the state (we need URLs and captions)
              const selectedAssets = orchestrator.variations.filter((_, i) => orchestrator.selectedVariations.includes(i));
              
              const res = await fetch('/api/meta-ads/push-optimized-ads', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                      campaignId: orchestrator.campaign.id, 
                      selectedAssets,
                      leadFormId: orchestrator.leadFormId 
                  })
              });
              const data = await res.json();

              if (data.success) {
                  setOrchestrator(prev => ({
                      ...prev,
                      status: 'success',
                      logs: [...prev.logs, { id: Date.now(), text: `Successfully pushed ${data.pushedCount} new ads to Meta! They are currently in PAUSED state.`, type: 'system' }]
                  }));
              } else {
                  setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: data.error || "Push failed.", type: 'system' }]}));
              }
          } catch (e) {
              setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Network error during push.", type: 'system' }]}));
          }
      }
  }

  const handleReviewOptimizedAssets = async () => {
    if (!orchestrator.campaign) return;
    
    setOrchestrator(prev => ({...prev, status: 'analyzing', logs: [...prev.logs, { id: Date.now(), text: "Scanning library for newly generated optimization assets...", type: 'system' }]}));
    
    try {
        const { data: { user } } = await supabase.auth.getUser();
        // Fetch assets with titles matching our variations
        const { data: newAssets } = await supabase
            .from('assets')
            .select('*')
            .eq('user_id', user?.id)
            .ilike('property_id', `%opt%`) // We should have tagged them or we can just look for recent ones
            .order('created_at', { ascending: false })
            .limit(20);
        
        if (newAssets && newAssets.length > 0) {
            // Map assets back to variations if possible, or just show them
            setOrchestrator(prev => ({
                ...prev,
                status: 'reviewing',
                variations: newAssets.map(a => ({
                    id: a.id,
                    title: a.property_id || "Optimized Creative",
                    url: a.url,
                    caption: a.caption,
                    headline: a.caption?.split('\n\n')[0],
                    primary_text: a.caption?.split('\n\n')[1]
                })),
                selectedVariations: newAssets.map((_, i) => i),
                logs: [...prev.logs, { id: Date.now(), text: `Found ${newAssets.length} generated creatives ready for review.`, type: 'system' }]
            }));
        } else {
            setOrchestrator(prev => ({...prev, status: 'generating', logs: [...prev.logs, { id: Date.now(), text: "No assets found yet. Please wait a few more minutes for generation to finish.", type: 'system' }]}));
        }
    } catch (e) {
        setOrchestrator(prev => ({...prev, status: 'error', logs: [...prev.logs, { id: Date.now(), text: "Failed to load assets.", type: 'system' }]}));
    }
  }

  const handleAddPresetQuestion = (type: 'budget' | 'timeline' | 'type' | 'visit') => {
      if (type === 'budget') {
          setFormQuestions(prev => [...prev, { label: "What is your budget?", type: "MULTIPLE_CHOICE", options: ["Less than 50L", "50L - 70L", "70L - 1 Cr", "1 Cr - 1.5 Cr", "1.5Cr - 2 Cr", "Above 2 Cr"], disqualifyingOptions: [] }]);
      } else if (type === 'timeline') {
          setFormQuestions(prev => [...prev, { label: "How soon do you want to buy?", type: "MULTIPLE_CHOICE", options: ["Immediately", "WIthin a month", "Within 3 months", "Just Looking (Disqualify)"], disqualifyingOptions: ["Just Looking (Disqualify)"] }]);
      } else if (type === 'type') {
          setFormQuestions(prev => [...prev, { label: "What are you looking for?", type: "MULTIPLE_CHOICE", options: ["Residential", "Commercial", "Plots", "Apartments", "Villa", "Kothi"], disqualifyingOptions: [] }]);
      } else if (type === 'visit') {
          setFormQuestions(prev => [...prev, { label: "What time would you like to visit?", type: "MULTIPLE_CHOICE", options: ["10 AM - 1 PM", "1 PM - 4 PM", "4 PM - 7 PM"], disqualifyingOptions: [] }]);
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
    if (adForm.metaLocations.length === 0 || adForm.dailyBudgetINR < 100) { alert("Please set a valid target location and budget."); return }
    if (!adForm.linkUrl) { alert("Please provide a valid Website URL for the Lead Form."); return }
    
    setIsSubmitting(true)
    
    const { data: { user } } = await supabase.auth.getUser();
    const autoPrivacyUrl = `https://${window.location.host}/privacy/${user?.id}`;
    
    const formPayload = new FormData();
    formPayload.append('adAccountId', selectedAdAccountId);
    formPayload.append('facebookToken', facebookToken || '');
    formPayload.append('pageId', adForm.pageId);
    
    formPayload.append('metaLocations', JSON.stringify(adForm.metaLocations));
    formPayload.append('gender', adForm.gender);
    formPayload.append('dailyBudgetINR', (adForm.dailyBudgetINR * 100).toString()); 
    formPayload.append('linkUrl', adForm.linkUrl);
    formPayload.append('privacyPolicyUrl', autoPrivacyUrl);
    formPayload.append('optimizeForConversions', adForm.optimizeForConversions.toString());
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
        setAdForm(prev => ({ ...prev, metaLocations: [], dailyBudgetINR: 500 })) 
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
                                    onClick={() => handleOptimize(campaign)} 
                                    disabled={orchestrator.isOpen && orchestrator.mode === 'optimize'}
                                    className={`flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-3 rounded-xl transition-all ${
                                        orchestrator.isOpen && orchestrator.campaign?.id === campaign.id && orchestrator.mode === 'optimize' ? 'bg-purple-100 text-purple-400' 
                                        : campaign.status !== 'ACTIVE' ? 'bg-slate-50 text-slate-400 cursor-not-allowed' 
                                        : 'bg-purple-50 text-purple-600 hover:bg-purple-100 hover:text-purple-700 shadow-sm'
                                    }`}
                                >
                                    <Sparkles size={14} /> Optimize
                                </button>

                                <button 
                                    onClick={() => handleRemarketing(campaign)} 
                                    disabled={orchestrator.isOpen && orchestrator.mode === 'remarketing'}
                                    className={`flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-3 rounded-xl transition-all ${
                                        orchestrator.isOpen && orchestrator.campaign?.id === campaign.id && orchestrator.mode === 'remarketing' ? 'bg-blue-100 text-blue-400' 
                                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 shadow-sm'
                                    }`}
                                >
                                    <Users size={14} /> Remarket
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

      {/* AGENT ORCHESTRATOR MODAL */}
      {orchestrator.isOpen && (
          <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm flex items-center justify-end p-0 sm:p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-right-8 overflow-hidden flex flex-col relative">
                  
                  {/* Decorative Background */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-purple-100 to-transparent rounded-bl-full opacity-50 pointer-events-none" />

                  {/* Header */}
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 relative z-10">
                      <div>
                          <h2 className="text-xl font-bold text-slate-900 leading-tight flex items-center gap-2">
                              <Sparkles className="text-purple-500"/> AdRolls Strategist
                          </h2>
                          <p className="text-xs font-medium text-slate-500 mt-1 uppercase tracking-widest">{orchestrator.mode === 'optimize' ? 'Andromeda Optimization' : 'Remarketing Engine'}</p>
                      </div>
                      <button onClick={() => setOrchestrator(prev => ({...prev, isOpen: false}))} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition-colors shrink-0"><X size={18} /></button>
                  </div>
                  
                  {/* Chat / Action Area */}
                  <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 mb-6 relative z-10">
                      {orchestrator.logs.map((log) => (
                          <div key={log.id} className={`flex ${log.type === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                              <div className={`max-w-[85%] p-4 rounded-2xl text-sm font-medium leading-relaxed ${
                                  log.type === 'user' ? 'bg-purple-600 text-white rounded-br-sm' 
                                  : log.type === 'system' ? 'bg-slate-50 text-slate-600 border border-slate-100 rounded-bl-sm'
                                  : 'bg-purple-50 text-purple-900 border border-purple-100 rounded-bl-sm shadow-sm'
                              }`}>
                                  {log.type === 'ai' && <div className="flex items-center gap-1.5 mb-2 text-purple-600"><Sparkles size={14} className="animate-pulse"/> <span className="text-[10px] uppercase tracking-widest font-bold">Analysis</span></div>}
                                  {log.text}
                              </div>
                          </div>
                      ))}

                      {orchestrator.status === 'analyzing' || orchestrator.status === 'generating' ? (
                          <div className="flex justify-start animate-in fade-in">
                              <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl rounded-bl-sm flex items-center gap-3">
                                  <div className="flex gap-1.5">
                                      <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{animationDelay: '0ms'}}/>
                                      <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{animationDelay: '150ms'}}/>
                                      <div className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{animationDelay: '300ms'}}/>
                                  </div>
                                  <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Processing</span>
                              </div>
                          </div>
                      ) : null}

                      {/* Display Variations if Present */}
                      {orchestrator.variations.length > 0 && (orchestrator.status === 'presenting' || orchestrator.status === 'reviewing') && (
                          <div className="space-y-4 mt-4 animate-in fade-in">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2">Review variations below:</p>
                              <div className="grid grid-cols-1 gap-4">
                                  {orchestrator.variations.map((v, i) => {
                                      const isSelected = orchestrator.selectedVariations.includes(i);
                                      return (
                                          <div 
                                              key={i} 
                                              onClick={() => {
                                                  setOrchestrator(prev => {
                                                      const newSelected = isSelected 
                                                          ? prev.selectedVariations.filter(idx => idx !== i)
                                                          : [...prev.selectedVariations, i];
                                                      return { ...prev, selectedVariations: newSelected };
                                                  });
                                              }}
                                              className={`relative bg-white border rounded-2xl p-4 shadow-sm transition-all cursor-pointer group ${
                                                  isSelected ? 'border-purple-500 bg-purple-50/30 ring-1 ring-purple-100' : 'border-slate-200 hover:border-slate-300'
                                              }`}
                                          >
                                              <div className="flex justify-between items-start mb-2">
                                                  <h4 className="text-xs font-bold text-slate-800 uppercase">{v.title}</h4>
                                                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-200'}`}>
                                                      {isSelected && <CheckCircle size={12} />}
                                                  </div>
                                              </div>
                                              <div className="space-y-2">
                                                  <p className="text-[10px] font-bold text-purple-600 uppercase tracking-tighter leading-tight">Headline: {v.headline}</p>
                                                  <p className="text-[10px] text-slate-600 font-medium leading-relaxed italic border-l-2 border-slate-100 pl-2">Prompt: {v.image_prompt}</p>
                                              </div>
                                              {!isSelected && <div className="absolute inset-0 bg-white/40 rounded-2xl z-10" />}
                                          </div>
                                      );
                                  })}
                              </div>
                          </div>
                      )}
                  </div>

                  {/* Footer Action */}
                  {orchestrator.status === 'presenting' && (
                      <div className="pt-4 border-t border-slate-100 relative z-10 animate-in fade-in">
                          <button 
                              onClick={handleApproveVariations}
                              disabled={orchestrator.selectedVariations.length === 0}
                              className="w-full bg-purple-600 text-white font-bold py-4 rounded-2xl hover:bg-purple-700 shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale"
                          >
                              <CheckCircle size={18} /> Push {orchestrator.selectedVariations.length} Winning Concepts
                          </button>
                      </div>
                  )}
                  {orchestrator.status === 'generating' && (
                      <div className="pt-4 border-t border-slate-100 relative z-10 animate-in fade-in">
                          <button 
                              onClick={handleReviewOptimizedAssets}
                              className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-700 shadow-md transition-all flex items-center justify-center gap-2"
                          >
                              <RefreshCw size={18} /> Load Generated Assets for Review
                          </button>
                      </div>
                  )}
                  {orchestrator.status === 'reviewing' && (
                      <div className="pt-4 border-t border-slate-100 relative z-10 animate-in fade-in">
                          <button 
                              onClick={handleApproveVariations}
                              disabled={orchestrator.selectedVariations.length === 0}
                              className="w-full bg-green-600 text-white font-bold py-4 rounded-2xl hover:bg-green-700 shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                              <Zap size={18} /> Push {orchestrator.selectedVariations.length} Selected to Meta
                          </button>
                      </div>
                  )}
                  {orchestrator.status === 'pushing' && (
                      <div className="pt-4 border-t border-slate-100 relative z-10 animate-in fade-in">
                          <div className="w-full bg-slate-100 text-slate-400 font-bold py-4 rounded-2xl flex items-center justify-center gap-2">
                              <Loader2 size={18} className="animate-spin" /> Pushing to Meta...
                          </div>
                      </div>
                  )}
                  {orchestrator.status === 'success' && (
                      <div className="pt-4 border-t border-slate-100 relative z-10 animate-in fade-in">
                          <button 
                              onClick={() => setOrchestrator(prev => ({...prev, isOpen: false}))}
                              className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 shadow-md transition-all flex items-center justify-center gap-2"
                          >
                              Done
                          </button>
                      </div>
                  )}
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
                  <button 
                    onClick={() => setShowAssetSelector({isOpen: true, type: 'inventory'})}
                    className="w-full bg-white border border-slate-200 text-slate-700 hover:border-blue-400 hover:bg-blue-50 text-sm font-medium rounded-2xl py-3 px-4 transition-all flex items-center justify-center gap-2"
                  >
                    + Add From Inventory
                  </button>
                  <button 
                    onClick={() => setShowAssetSelector({isOpen: true, type: 'ai'})}
                    className="w-full bg-white border border-slate-200 text-slate-700 hover:border-blue-400 hover:bg-blue-50 text-sm font-medium rounded-2xl py-3 px-4 transition-all flex items-center justify-center gap-2"
                  >
                    + Add AI Asset
                  </button>
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
                      
                      <div className="relative">
                          <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1.5 uppercase tracking-wider">Target Locations</label>
                          
                          {/* Selected Locations Chips */}
                          {adForm.metaLocations.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-3">
                                  {adForm.metaLocations.map((loc, idx) => (
                                      <div key={idx} className="bg-blue-50/50 py-2 px-3 rounded-xl border border-blue-200 flex items-center gap-2">
                                          <div className="text-xs font-bold text-blue-900 flex items-center gap-1"><MapPin size={12}/> {loc.location.name}</div>
                                          <button onClick={() => setAdForm(prev => ({ ...prev, metaLocations: prev.metaLocations.filter((_, i) => i !== idx) }))} className="bg-white p-1 rounded-full shadow-sm text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>
                                      </div>
                                  ))}
                              </div>
                          )}

                          <div className="relative">
                            <input type="text" value={locationSearchText} onChange={(e) => setLocationSearchText(e.target.value)} className="w-full bg-slate-50 hover:bg-slate-100/50 py-3.5 pl-11 pr-5 rounded-2xl text-slate-800 text-sm font-medium focus:ring-4 focus:ring-blue-500/20 outline-none border border-slate-200/60 focus:border-blue-400 transition-all" placeholder="Search and add multiple cities or states..." />
                            <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                            {isSearchingLocation && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />}
                          </div>
                          
                          {locationResults.length > 0 && (
                              <div className="absolute z-20 w-full bg-white mt-2 rounded-2xl shadow-xl border border-slate-100 max-h-56 overflow-y-auto custom-scrollbar">
                                  {locationResults.map(loc => (
                                      <div key={loc.key} onClick={() => { 
                                          if (!adForm.metaLocations.find(l => l.location.key === loc.key)) {
                                              setAdForm(prev => ({ ...prev, metaLocations: [...prev.metaLocations, { location: loc, radius: 20 }] })); 
                                          }
                                          setLocationSearchText(''); 
                                          setLocationResults([]); 
                                      }} className="p-4 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 transition-colors">
                                          <div className="text-sm font-bold text-slate-800">{loc.name}</div>
                                          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-1">{loc.region ? `${loc.region}, ` : ''}{loc.country_code} ({loc.type})</div>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>

                      {/* Pixel Optimization Toggle */}
                      <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-4 rounded-2xl border border-purple-100 flex items-center justify-between mt-4">
                          <div>
                              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Sparkles size={16} className="text-purple-500"/> Optimize for High-Quality Leads</h3>
                              <p className="text-xs text-slate-600 mt-1 font-medium">Use AI to automatically find users who are more likely to convert (requires Pixel).</p>
                          </div>
                          <button 
                              onClick={() => setAdForm(prev => ({ ...prev, optimizeForConversions: !prev.optimizeForConversions }))}
                              className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 shrink-0 ${adForm.optimizeForConversions ? 'bg-purple-500 focus:ring-purple-500' : 'bg-slate-300 focus:ring-slate-400'}`}
                          >
                              <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${adForm.optimizeForConversions ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
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
                                     <div className="flex flex-wrap gap-1.5 mt-1">
                                         <span className="text-[9px] bg-blue-100 text-blue-600 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">{q.type === 'MULTIPLE_CHOICE' ? `Multiple Choice` : 'Short Answer'}</span>
                                         {q.type === 'MULTIPLE_CHOICE' && q.options?.map((opt, oIdx) => (
                                             <span key={oIdx} className="text-[9px] bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">{opt}</span>
                                         ))}
                                     </div>
                                 </div>
                                 <div className="flex gap-2">
                                     <button onClick={() => { setEditingIdx(idx); setNewQuestion(q); setIsAddingQuestion(true); }} className="bg-white p-2 rounded-full text-slate-400 hover:text-blue-500 shadow-sm border border-slate-100 transition-colors"><Settings2 size={14}/></button>
                                     <button onClick={() => setFormQuestions(prev => prev.filter((_, i) => i !== idx))} className="bg-white p-2 rounded-full text-slate-400 hover:text-red-500 shadow-sm border border-slate-100 transition-colors"><X size={14}/></button>
                                 </div>
                              </div>
                          ))}
                      </div>
                  )}

                  {(!isAddingQuestion && editingIdx === null) ? (
                      <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleAddPresetQuestion('budget')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Budget</button>
                          <button onClick={() => handleAddPresetQuestion('type')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Property Type</button>
                          <button onClick={() => handleAddPresetQuestion('timeline')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Timeline</button>
                          <button onClick={() => handleAddPresetQuestion('visit')} className="text-xs font-bold bg-blue-50 text-blue-600 px-4 py-2.5 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1"><PlusCircle size={14}/> Visit Time</button>
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
                              <div className="space-y-3">
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Configure Options</label>
                                  {(newQuestion.options || []).map((opt, oIdx) => (
                                      <div key={oIdx} className="flex gap-2 items-center">
                                          <input 
                                              type="text" 
                                              value={opt} 
                                              onChange={e => {
                                                  const updated = [...(newQuestion.options || [])];
                                                  updated[oIdx] = e.target.value;
                                                  setNewQuestion({...newQuestion, options: updated});
                                              }} 
                                              className="flex-1 bg-white py-3 px-4 rounded-xl text-sm font-medium border border-slate-200 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all" 
                                              placeholder={`Option ${oIdx + 1}`} 
                                          />
                                          <button 
                                              onClick={() => {
                                                  const isDisq = newQuestion.disqualifyingOptions?.includes(opt);
                                                  const newDisq = isDisq 
                                                      ? (newQuestion.disqualifyingOptions || []).filter(d => d !== opt)
                                                      : [...(newQuestion.disqualifyingOptions || []), opt];
                                                  setNewQuestion({...newQuestion, disqualifyingOptions: newDisq});
                                              }}
                                              className={`px-3 py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${
                                                  newQuestion.disqualifyingOptions?.includes(opt) 
                                                  ? 'bg-red-50 text-red-600 border-red-100 shadow-inner' 
                                                  : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                              }`}
                                          >
                                              {newQuestion.disqualifyingOptions?.includes(opt) ? 'Disqualified' : 'Qualify'}
                                          </button>
                                          <button 
                                              onClick={() => {
                                                  const updated = (newQuestion.options || []).filter((_, i) => i !== oIdx);
                                                  setNewQuestion({...newQuestion, options: updated});
                                              }}
                                              className="p-3 text-slate-400 hover:text-red-500 transition-colors"
                                          >
                                              <X size={16} />
                                          </button>
                                      </div>
                                  ))}
                                  <button 
                                      onClick={() => setNewQuestion({...newQuestion, options: [...(newQuestion.options || []), '']})}
                                      className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                                  >
                                      <PlusCircle size={14} /> Add Another Option
                                  </button>
                              </div>
                          )}
                      </div>
                  )}
                          <div className="flex gap-3 pt-2">
                              <button onClick={() => { setIsAddingQuestion(false); setEditingIdx(null); setNewQuestion({label: '', type: 'SHORT_ANSWER', options: ['']}); }} className="bg-white border border-slate-200 text-slate-600 px-6 py-3 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors">Cancel</button>
                              <button onClick={() => { 
                                  if(newQuestion.label){ 
                                      if (editingIdx !== null) {
                                          const updated = [...formQuestions];
                                          updated[editingIdx] = newQuestion;
                                          setFormQuestions(updated);
                                      } else {
                                          setFormQuestions(prev => [...prev, newQuestion]); 
                                      }
                                      setIsAddingQuestion(false); 
                                      setEditingIdx(null);
                                      setNewQuestion({label: '', type: 'SHORT_ANSWER', options: ['']}); 
                                  } 
                              }} className="flex-1 bg-slate-900 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors shadow-sm">
                                  {editingIdx !== null ? 'Update Question' : 'Save Question'}
                              </button>
                          </div>
                      </div>
                  

            </div>

            {/* Sticky Launch Button Footer */}
            <div className="p-6 bg-white border-t border-slate-100 flex-shrink-0">
                <button 
                    onClick={handleLaunchCampaign} 
                    disabled={isSubmitting || adForm.metaLocations.length === 0 || selectedCreatives.length === 0} 
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
      {/* ASSET SELECTOR MODAL */}
      {showAssetSelector.isOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl flex flex-col h-[80vh] overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
              <h2 className="text-xl font-bold text-slate-900">
                  Select {showAssetSelector.type === 'inventory' ? 'Inventory Creative' : 'AI Asset'}
              </h2>
              <button onClick={() => setShowAssetSelector({isOpen: false, type: 'inventory'})} className="bg-slate-100 p-2 rounded-full text-slate-500 hover:bg-slate-200"><X size={20} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50/50">
                {showAssetSelector.type === 'inventory' ? (
                    properties.length === 0 ? (
                        <div className="text-center text-slate-500 py-10 font-medium bg-white rounded-2xl border border-slate-100 shadow-sm">No inventory items found.</div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {properties.map(p => {
                                const isSelected = selectedCreatives.some(c => c.id === p.id);
                                return (
                                    <div 
                                        key={p.id} 
                                        onClick={() => {
                                            if (isSelected) {
                                                removeCreative(selectedCreatives.find(c => c.id === p.id)!.uid);
                                            } else {
                                                setSelectedCreatives(prev => [...prev, { uid: Math.random().toString(), sourceType: 'inventory', id: p.id, previewUrl: p.image_url, name: p.title }]);
                                            }
                                        }}
                                        className={`relative aspect-square rounded-[1.5rem] overflow-hidden border-[3px] cursor-pointer transition-all group shadow-sm ${isSelected ? 'border-blue-500 opacity-50 cursor-not-allowed bg-blue-50' : 'border-transparent hover:border-blue-400 hover:shadow-lg bg-white'}`}
                                    >
                                        <img src={p.image_url} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-8">
                                            <p className="text-white text-sm font-bold truncate drop-shadow-md">{p.title}</p>
                                        </div>
                                        {isSelected && (
                                            <div className="absolute top-3 right-3 bg-blue-500 text-white p-1 rounded-full shadow-md">
                                                <CheckCircle size={16} />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : (
                    <div className="space-y-4">
                        {/* Filter Dropdown */}
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Filter by Product</label>
                            <select 
                                value={assetFilter} 
                                onChange={(e) => setAssetFilter(e.target.value)} 
                                className="bg-white border border-slate-200 text-sm font-medium text-slate-700 py-2 px-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer shadow-sm min-w-[200px]"
                            >
                                <option value="All">All Assets</option>
                                {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                            </select>
                        </div>
                        
                        {assets.length === 0 ? (
                            <div className="text-center text-slate-500 py-10 font-medium bg-white rounded-2xl border border-slate-100 shadow-sm">No AI assets found.</div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                {assets.filter(a => assetFilter === 'All' || a.property_id === assetFilter).map(a => {
                                    const isSelected = selectedCreatives.some(c => c.id === a.id);
                                    return (
                                        <div 
                                            key={a.id} 
                                            onClick={() => {
                                                if (isSelected) {
                                                    removeCreative(selectedCreatives.find(c => c.id === a.id)!.uid);
                                                } else {
                                                    setSelectedCreatives(prev => [...prev, { uid: Math.random().toString(), sourceType: 'asset', id: a.id, previewUrl: a.url, name: `Library Asset` }]);
                                                }
                                            }}
                                            className={`relative aspect-square rounded-[1.5rem] overflow-hidden border-[3px] cursor-pointer transition-all shadow-sm ${isSelected ? 'border-blue-500 opacity-50 cursor-not-allowed bg-blue-50' : 'border-transparent hover:border-blue-400 hover:shadow-lg bg-slate-100'}`}
                                        >
                                            <img src={a.url} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                                            {isSelected && (
                                                <div className="absolute top-3 right-3 bg-blue-500 text-white p-1 rounded-full shadow-md">
                                                    <CheckCircle size={16} />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-white flex justify-end">
                <button 
                    onClick={() => setShowAssetSelector({isOpen: false, type: 'inventory'})}
                    className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-colors shadow-md"
                >
                    Done
                </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}