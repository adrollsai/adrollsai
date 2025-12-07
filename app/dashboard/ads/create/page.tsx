'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Rocket, Target, Layout, DollarSign, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'

export default function CreateAdPage() {
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [pageId, setPageId] = useState<string | null>(null)

  // Fetch user's page ID
  useEffect(() => {
      async function fetchProfile() {
          try {
              const res = await fetch('/api/profile');
              if (res.ok) {
                  const data = await res.json();
                  if (data.selectedPageId) {
                      setPageId(data.selectedPageId);
                  }
              }
          } catch(e) { console.error(e) }
      }
      fetchProfile();
  }, []);

  // Form State
  const [formData, setFormData] = useState({
      name: '',
      objective: 'OUTCOME_TRAFFIC',
      daily_budget: 1000, // $10.00
      duration: 7,
      target_country: 'US',
      asset_id: '' // In real app, we'd pick from Assets
  })

  const handleSubmit = async () => {
      setLoading(true);
      try {
          if (!pageId) {
              alert("No Facebook Page selected. Please go to Profile and select a page first.");
              setLoading(false);
              return;
          }

          // Construct payload
          const payload = {
              name: formData.name,
              objective: formData.objective,
              daily_budget: formData.daily_budget,
              status: 'PAUSED', // Always pause initially for safety
              billing_event: 'IMPRESSIONS',
              optimization_goal: 'LINK_CLICKS',
              targeting: {
                  geo_locations: { countries: [formData.target_country] }
              },
              creative: {
                 // Mocking a creative spec for now or user would select an existing post
                 creative_id: null,
                 object_story_spec: {
                     page_id: pageId, // Using the dynamic Page ID
                     link_data: {
                         link: "https://example.com", // This should ideally come from user input or asset
                         message: "Check out our new property!",
                         name: formData.name,
                         description: "Best in class apartments",
                         picture: "https://placehold.co/600x400" // Placeholder image
                     }
                 }
              }
          };

          const res = await fetch('/api/ads/campaigns', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });

          if (!res.ok) {
              const err = await res.json();
              throw new Error(err.error || "Failed to create campaign");
          }

          router.push('/dashboard/ads');
      } catch (e: any) {
          console.error(e);
          alert(e.message || "Something went wrong");
      } finally {
          setLoading(false);
      }
  }

  return (
    <div className="p-6 max-w-lg mx-auto min-h-screen bg-surface">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
            <Link href="/dashboard/ads" className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                <ArrowLeft size={20} />
            </Link>
            <h1 className="text-xl font-bold text-slate-900">Create Campaign</h1>
        </div>

        {/* Steps */}
        <div className="flex gap-2 mb-8">
            {[1, 2, 3].map(i => (
                <div key={i} className={`h-1 flex-1 rounded-full ${step >= i ? 'bg-primary' : 'bg-slate-200'}`} />
            ))}
        </div>

        {/* STEP 1: BASICS */}
        {step === 1 && (
            <div className="space-y-6">
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Campaign Name</label>
                    <input
                        type="text"
                        className="w-full p-3 rounded-xl border border-slate-200 focus:outline-none focus:border-primary"
                        placeholder="e.g. Summer Promo"
                        value={formData.name}
                        onChange={e => setFormData({...formData, name: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Objective</label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setFormData({...formData, objective: 'OUTCOME_TRAFFIC'})}
                            className={`p-4 rounded-xl border text-left ${formData.objective === 'OUTCOME_TRAFFIC' ? 'border-primary bg-blue-50' : 'border-slate-200'}`}
                        >
                            <Target className="text-blue-500 mb-2" size={20} />
                            <div className="font-semibold text-sm">Traffic</div>
                            <div className="text-xs text-slate-500">Send people to website</div>
                        </button>
                        <button
                            onClick={() => setFormData({...formData, objective: 'OUTCOME_AWARENESS'})}
                            className={`p-4 rounded-xl border text-left ${formData.objective === 'OUTCOME_AWARENESS' ? 'border-primary bg-blue-50' : 'border-slate-200'}`}
                        >
                            <Layout className="text-purple-500 mb-2" size={20} />
                            <div className="font-semibold text-sm">Awareness</div>
                            <div className="text-xs text-slate-500">Reach more people</div>
                        </button>
                    </div>
                </div>
                <button
                    disabled={!formData.name}
                    onClick={() => setStep(2)}
                    className="w-full bg-primary text-primary-text font-bold py-3.5 rounded-xl mt-4 disabled:opacity-50"
                >
                    Next: Budget
                </button>
            </div>
        )}

        {/* STEP 2: BUDGET & TARGETING */}
        {step === 2 && (
             <div className="space-y-6">
                 <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Daily Budget</label>
                    <div className="relative">
                        <DollarSign size={16} className="absolute left-3 top-4 text-slate-400" />
                        <input
                            type="number"
                            className="w-full p-3 pl-9 rounded-xl border border-slate-200 focus:outline-none focus:border-primary"
                            value={formData.daily_budget / 100}
                            onChange={e => setFormData({...formData, daily_budget: parseInt(e.target.value) * 100})}
                        />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">You will spend up to ${formData.daily_budget/100 * 30} per month.</p>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Location</label>
                    <select
                        className="w-full p-3 rounded-xl border border-slate-200 bg-white"
                        value={formData.target_country}
                        onChange={e => setFormData({...formData, target_country: e.target.value})}
                    >
                        <option value="US">United States</option>
                        <option value="CA">Canada</option>
                        <option value="GB">United Kingdom</option>
                        <option value="AU">Australia</option>
                    </select>
                </div>

                <div className="flex gap-3">
                    <button onClick={() => setStep(1)} className="flex-1 py-3.5 font-semibold text-slate-500">Back</button>
                    <button onClick={() => setStep(3)} className="flex-1 bg-primary text-primary-text font-bold py-3.5 rounded-xl">Next: Review</button>
                </div>
             </div>
        )}

        {/* STEP 3: REVIEW & LAUNCH */}
        {step === 3 && (
            <div className="space-y-6">
                <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <span className="text-slate-500 text-sm">Campaign</span>
                        <span className="font-semibold text-slate-800">{formData.name}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <span className="text-slate-500 text-sm">Objective</span>
                        <span className="font-semibold text-slate-800">{formData.objective === 'OUTCOME_TRAFFIC' ? 'Traffic' : 'Awareness'}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <span className="text-slate-500 text-sm">Budget</span>
                        <span className="font-semibold text-slate-800">${formData.daily_budget/100} / day</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                         <span className="text-slate-500 text-sm">Target</span>
                         <span className="font-semibold text-slate-800">{formData.target_country}</span>
                     </div>
                    <div className="flex justify-between items-center">
                        <span className="text-slate-500 text-sm">Page ID</span>
                        <span className="font-semibold text-slate-800">{pageId || "Not Selected"}</span>
                    </div>
                </div>

                { !pageId && (
                     <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">
                         No Facebook Page selected. Please go to Profile settings to select a page.
                     </div>
                )}

                <button
                    onClick={handleSubmit}
                    disabled={loading || !pageId}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-md shadow-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? <Loader2 className="animate-spin" /> : <Rocket size={20} />}
                    {loading ? 'Launching...' : 'Launch Campaign'}
                </button>

                <button onClick={() => setStep(2)} className="w-full py-3 font-semibold text-slate-400 text-sm">Back</button>
            </div>
        )}
    </div>
  )
}
