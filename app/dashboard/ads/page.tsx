// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/dashboard/ads/page.tsx (full changes)

'use client'

import { useState, useEffect } from 'react'
import { Zap, LayoutGrid, Upload, Loader2, DollarSign } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'

// You would define types for AdAccount, Campaign, Asset here

export default function AdsPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [facebookToken, setFacebookToken] = useState<string | null>(null)
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string | null>(null) // NEW STATE
  
  // Placeholder data for the ad form
  const [adForm, setAdForm] = useState({
    pageId: '',
    primaryText: '',
    linkUrl: 'https://yourbusiness.com',
    imageUrl: '', // URL from Assets or direct upload
    ctaType: 'LEARN_MORE',
    budget: 500, // INR
  })

  // Load profile tokens and select the primary Facebook Page/Ad Account
  useEffect(() => {
    const loadProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      // Fetch the token, page ID, and NEW ad_account_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token, selected_page_id, ad_account_id')
        .eq('id', user.id)
        .single()
      
      if (profile) {
        setFacebookToken(profile.facebook_token)
        setSelectedAdAccountId(profile.ad_account_id) // SET AD ACCOUNT ID
        setAdForm(prev => ({ 
            ...prev, 
            pageId: profile.selected_page_id || '' 
        })) 
      }
      setLoading(false)
    }
    loadProfile()
  }, [])
  
  // Placeholder for Ads API call
  const handleRunAd = async () => {
    if (!adForm.pageId || !selectedAdAccountId || !adForm.imageUrl) {
      alert("Missing required fields (Page, Ad Account, Image).")
      return
    }
    
    setIsSubmitting(true)
    
    try {
      const payload = {
        accessToken: facebookToken,
        pageId: adForm.pageId,
        adAccountId: selectedAdAccountId, // USE DYNAMIC ID
        creative: {
          imageUrl: adForm.imageUrl,
          primaryText: adForm.primaryText,
          linkUrl: adForm.linkUrl,
          ctaType: adForm.ctaType,
        },
        campaignConfig: { /* campaign and adset details */ }
      }

      const res = await fetch('/api/meta-ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (res.ok) {
        alert(`Ad Creative Started: ${data.message}. Creative ID: ${data.creativeId}`);
      } else {
        alert('Ad Creation Failed: ' + data.error);
      }
      
    } catch (e) {
      console.error(e);
      alert('Network Error during Ad Submission');
    } finally {
      setIsSubmitting(false)
    }
  }

  // NOTE: You would add asset fetching/upload logic here (similar to dashboard/assets/page.tsx)
  
  if (loading) return <div className="p-10 text-center text-slate-400 text-sm animate-pulse">Loading Ads setup...</div>
  
  // Check if token and account ID are present
  if (!facebookToken || !selectedAdAccountId) {
    return (
      <div className="p-5 max-w-md mx-auto text-center pt-20">
        <Zap size={48} className="text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Connect Facebook & Ad Account</h2>
        <p className="text-slate-500 mb-6">Please go to the Profile tab to connect your Facebook account with **Ads Management** permissions, and select your Ad Account ID.</p>
        <button onClick={() => router.push('/dashboard/profile')} className="bg-slate-900 text-white px-6 py-3 rounded-xl text-sm font-bold">Go to Profile</button>
      </div>
    )
  }

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-24">
      <div className="flex justify-between items-end mb-6">
        <div><h1 className="text-2xl font-bold text-slate-900">Meta Ads Manager</h1><p className="text-slate-500 text-xs mt-1">Launch campaigns quickly with AI assets</p></div>
        <Zap size={24} className="text-primary-text" />
      </div>

      <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-blue-100 space-y-4">
        
        {/* Ad Account Info (DYNAMIC DISPLAY) */}
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
            <span className="text-xs font-bold text-slate-500 uppercase">Ad Account:</span>
            <span className="text-sm font-medium text-slate-800">{selectedAdAccountId}</span>
        </div>

        {/* Ad Creative Image/Video */}
        <div>
            <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Creative Asset URL</label>
            <input type="url" value={adForm.imageUrl} onChange={(e) => setAdForm({...adForm, imageUrl: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Image or Video URL from Assets tab" />
            <p className="text-[10px] text-slate-400 mt-1 ml-2">Upload or select an asset URL from the Assets tab.</p>
        </div>

        {/* Primary Text */}
        <div>
            <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Primary Text (Caption)</label>
            <textarea rows={2} value={adForm.primaryText} onChange={(e) => setAdForm({...adForm, primaryText: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm resize-none focus:ring-2 focus:ring-primary outline-none" placeholder="Write compelling ad copy here..." />
        </div>

        {/* Link URL */}
        <div>
            <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Website URL</label>
            <input type="url" value={adForm.linkUrl} onChange={(e) => setAdForm({...adForm, linkUrl: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" />
        </div>

        {/* Budget */}
        <div>
            <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Daily Budget (INR)</label>
            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                <input type="number" value={adForm.budget} onChange={(e) => setAdForm({...adForm, budget: parseFloat(e.target.value) || 0})} className="w-full bg-slate-50 py-3 pl-6 pr-4 rounded-xl text-slate-800 text-sm focus:ring-2 focus:ring-primary outline-none" />
            </div>
        </div>

        {/* Launch Button */}
        <button onClick={handleRunAd} disabled={isSubmitting || !adForm.imageUrl} className="w-full bg-slate-900 text-white py-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-70">
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />} 
            {isSubmitting ? 'Launching Ad...' : 'Launch Campaign'}
        </button>
      </div>

    </div>
  )
}