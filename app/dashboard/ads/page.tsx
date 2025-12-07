// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/dashboard/ads/page.tsx

'use client'

import { useState, useEffect, useRef } from 'react'
import { Zap, Plus, X, Loader2, DollarSign, Building2, Image as ImageIcon, Upload, Film } from 'lucide-react'
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

const GENDERS = ['All', 'Male', 'Female']

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null) 
  
  // --- CORE STATE ---
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // --- DATA STATE ---
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
    linkUrl: 'https://yourbusiness.com', // Added back for API submission
  })
  
  // NEW: State for local file upload (array of files)
  const [localCreatives, setLocalCreatives] = useState<File[]>([]);
  const [localCreativePreviews, setLocalCreativePreviews] = useState<string[]>([]);

  // Helper to check if file is video
  const isVideoFile = (file: File) => file.type.startsWith('video/');

  // --- DATA FETCHING ---
  useEffect(() => {
    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // 1. Get Profile Data (Tokens/IDs)
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

      // 2. Get Inventory Properties
      const { data: props } = await supabase
        .from('properties')
        .select('id, title, price, image_url, description')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (props) setProperties(props)
      
      // 3. Get User Assets
      const { data: assetsData } = await supabase
        .from('assets')
        .select('id, type, url')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (assetsData) setAssets(assetsData as Asset[])

      setLoading(false)
    }
    loadData()
    
    return () => {
        // Clean up object URLs when component unmounts or state changes (for local uploads)
        localCreativePreviews.forEach(url => URL.revokeObjectURL(url));
    };
  }, [])
  
  // --- HANDLERS ---
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        // FIX: Handle multiple files and limit
        const files = Array.from(e.target.files).slice(0, 3); 
        
        // Clean up previous URLs
        localCreativePreviews.forEach(url => URL.revokeObjectURL(url));

        setLocalCreatives(files);
        setLocalCreativePreviews(files.map(file => URL.createObjectURL(file)));
        
        // Ensure local upload mode is selected, clearing other IDs
        setAdForm(prev => ({...prev, sourceType: 'localUpload', selectedSourceIds: []}))
    }
  }

  // Helper to update selected IDs from dropdowns/buttons
  const handleSourceIdChange = (id: string) => {
    // For simplicity, let's treat selection as single for inventory/asset dropdowns
    setAdForm(prev => ({...prev, selectedSourceIds: id ? [id] : []}));
  }

  const handleLaunchCampaign = async () => {
    if (isSubmitting) return
    if (!adForm.pageId) { alert("Please ensure a Facebook Page is selected in Profile."); return }
    if (!selectedAdAccountId) { alert("Please select an Ad Account in the Profile tab."); return }
    
    // Validation based on source type
    if (adForm.sourceType === 'localUpload' && localCreatives.length === 0) {
        alert("Please select at least one file to upload."); return;
    }
    // Check if non-local source is selected
    if (adForm.sourceType !== 'localUpload' && adForm.selectedSourceIds.length === 0) {
        alert("Please select a Property or Asset."); return;
    }
    if (!adForm.targetLocation || adForm.dailyBudgetINR < 100) { alert("Please set a target location and a reasonable budget (> ₹100)."); return }
    
    setIsSubmitting(true)
    
    // Use FormData for file submission, even if no file is present.
    const formPayload = new FormData();
    formPayload.append('adAccountId', selectedAdAccountId);
    formPayload.append('facebookToken', facebookToken || '');
    formPayload.append('pageId', adForm.pageId);
    formPayload.append('sourceType', adForm.sourceType);
    
    // Append primary fields
    formPayload.append('targetLocation', adForm.targetLocation);
    formPayload.append('gender', adForm.gender);
    formPayload.append('dailyBudgetINR', (adForm.dailyBudgetINR * 100).toString()); // Convert to paise
    formPayload.append('linkUrl', adForm.linkUrl); // Include linkUrl

    
    // Append selected source ID(s)
    adForm.selectedSourceIds.forEach((id, index) => {
        formPayload.append(`selectedSourceIds[${index}]`, id);
    });

    // Append local files
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
        alert(`Campaign Launched! ID: ${data.campaignId}. The AI is now optimizing.`);
        setIsModalOpen(false)
        setAdForm({ sourceType: 'inventory', selectedSourceIds: [], targetLocation: '', gender: 'All', dailyBudgetINR: 500, pageId: adForm.pageId, linkUrl: adForm.linkUrl }) 
        setLocalCreatives([]);
        setLocalCreativePreviews([]);
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


  // Determine active source data for preview
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
            <p className="text-slate-500 text-xs mt-1">AI-optimized campaigns for {selectedAdAccountId}</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-primary hover:bg-blue-200 text-primary-text p-3 rounded-full shadow-md active:scale-95 transition-transform">
          <Plus size={20} strokeWidth={3} />
        </button>
      </div>

      {/* Placeholder for Campaign List (Similar to Inventory) */}
      <div className="flex flex-col gap-4">
        <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-dashed border-slate-100">
            No active campaigns found. <br/>Tap '+' to launch a new AI-managed campaign.
        </div>
      </div>
      
      {/* --- LAUNCH AD MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">Launch New Campaign</h2>
              <button onClick={() => setIsModalOpen(false)} className="bg-slate-100 p-2 rounded-full text-slate-500"><X size={20} /></button>
            </div>
            
            <div className="space-y-4">
              
              {/* Source Type Toggle */}
              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                  <button 
                      onClick={() => { setAdForm(prev => ({...prev, sourceType: 'inventory', selectedSourceIds: []})); setLocalCreatives([]); setLocalCreativePreviews([]); }}
                      className={`flex-1 flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${adForm.sourceType === 'inventory' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      <Building2 size={12} /> Inventory
                  </button>
                  <button 
                      onClick={() => { setAdForm(prev => ({...prev, sourceType: 'asset', selectedSourceIds: []})); setLocalCreatives([]); setLocalCreativePreviews([]); }}
                      className={`flex-1 flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${adForm.sourceType === 'asset' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      <ImageIcon size={12} /> Assets
                  </button>
                  {/* NEW LOCAL UPLOAD BUTTON */}
                  <button 
                      onClick={() => { fileInputRef.current?.click(); setAdForm(prev => ({...prev, sourceType: 'localUpload', selectedSourceIds: []}));}} 
                      className={`flex-1 flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-bold transition-all ${adForm.sourceType === 'localUpload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      <Upload size={12} /> Upload
                  </button>
              </div>
              {/* FIX: Added 'multiple' attribute */}
              <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,video/*" className="hidden" multiple /> 

              {/* Source Selector (Dynamic) */}
              <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 block mb-1">Select Source (Max 3)</label>
                  {/* Dropdown for Inventory/Assets */}
                  {adForm.sourceType !== 'localUpload' && (
                      <select
                          value={adForm.selectedSourceIds[0] || ''}
                          onChange={(e) => handleSourceIdChange(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 text-slate-700 text-sm rounded-xl py-2.5 pl-4 pr-4 appearance-none focus:ring-2 focus:ring-primary outline-none"
                      >
                          <option value="">-- Select {adForm.sourceType === 'inventory' ? 'Property' : 'Asset'} --</option>
                          {adForm.sourceType === 'inventory' ? (
                              properties.map(p => <option key={p.id} value={p.id}>{p.title} ({p.price})</option>)
                          ) : (
                              assets.map(a => <option key={a.id} value={a.id}>{a.type.toUpperCase()} Asset {a.id.slice(-4)}</option>)
                          )}
                      </select>
                  )}
                  {/* Display for Local Upload */}
                  {adForm.sourceType === 'localUpload' && (
                    <div className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm">
                        {localCreatives.length > 0 ? `${localCreatives.length} file(s) selected` : "Select up to 3 images/videos to upload directly to Meta."}
                    </div>
                  )}

                  {/* FIX: Preview Area - Renders multiple small previews */}
                  <div className='flex gap-2 mt-2'>
                    {/* Previews for Local Files */}
                    {localCreativePreviews.map((url, index) => (
                      <div key={index} className='h-16 w-16 rounded-xl overflow-hidden bg-slate-200 border border-slate-300 relative'>
                        {isVideoFile(localCreatives[index]) ? (
                            <video src={url} controls={false} autoPlay muted loop className='w-full h-full object-cover' />
                        ) : (
                            <img src={url} alt={`Local Creative ${index}`} className='w-full h-full object-cover' />
                        )}
                         {isVideoFile(localCreatives[index]) && <Film size={16} className="absolute top-1 left-1 text-white/80" />}
                      </div>
                    ))}
                    {/* Single Preview for Inventory/Assets */}
                    {!adForm.sourceType.includes('local') && activePreviewUrl && (
                        <div className='h-16 w-16 rounded-xl overflow-hidden bg-slate-200 border border-slate-300'>
                            <img src={activePreviewUrl} alt="Creative Preview" className='w-full h-full object-cover' />
                        </div>
                    )}
                  </div>
              </div>

              {/* Minimal Targeting & Budget */}
              <h3 className="pt-2 border-t border-slate-100 text-[10px] font-bold text-slate-400 uppercase ml-1">AI Campaign Settings</h3>
              
              {/* Website URL */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Website URL</label>
                <input type="url" value={adForm.linkUrl} onChange={(e) => setAdForm(prev => ({...prev, linkUrl: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="https://yourwebsite.com" />
              </div>

              {/* Targeting Location */}
              <div>
                  <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Target Location</label>
                  <input type="text" value={adForm.targetLocation} onChange={(e) => setAdForm(prev => ({...prev, targetLocation: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. Mohali, Tricity Area" />
              </div>

              {/* Gender & Budget Row */}
              <div className="flex gap-4">
                  <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Gender</label>
                      <select value={adForm.gender} onChange={(e) => setAdForm(prev => ({...prev, gender: e.target.value}))} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none">
                          {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                  </div>
                  <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Daily Budget (₹)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <input type="number" min="100" step="100" value={adForm.dailyBudgetINR} onChange={(e) => setAdForm(prev => ({...prev, dailyBudgetINR: parseInt(e.target.value) || 0}))} className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" />
                      </div>
                  </div>
              </div>

              {/* Final Launch Button */}
              <button 
                  onClick={handleLaunchCampaign} 
                  disabled={isSubmitting || !adForm.targetLocation || (adForm.sourceType === 'localUpload' && localCreatives.length === 0) || (adForm.sourceType !== 'localUpload' && adForm.selectedSourceIds.length === 0)} 
                  className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70"
              >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 
                  {isSubmitting ? 'AI Launching Campaign...' : 'Launch AI Campaign'}
              </button>

            </div>
          </div>
        </div>
      )}

    </div>
  )
}