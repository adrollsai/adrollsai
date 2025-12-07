'use client'

import { useState, useEffect } from 'react'
import { Megaphone, TrendingUp, DollarSign, MousePointer, Loader2, Plus, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'

interface AdAccount {
  account_id: string;
  name: string;
  currency: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  insights?: {
      data: {
          spend: string;
          clicks: string;
          impressions: string;
      }[];
  }
}

interface Insights {
  impressions: string;
  clicks: string;
  spend: string;
  ctr: string;
}

export default function AdsDashboard() {
  const { data: session } = authClient.useSession()
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedAccount, setSelectedAccount] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [insights, setInsights] = useState<Insights | null>(null)

  // Fetch initial status
  useEffect(() => {
    async function checkStatus() {
        if (!session) return;
        try {
            const res = await fetch('/api/profile');
            const data = await res.json();

            if (data.adAccountId) {
                // Account is set up, load data
                setNeedsSetup(false);
                fetchDashboardData();
            } else {
                // Need to select an account
                setNeedsSetup(true);
                fetchAdAccounts();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const fetchAdAccounts = async () => {
      const res = await fetch('/api/ads/accounts');
      const data = await res.json();
      if (data.data) {
          setAdAccounts(data.data);
      }
  }

  const selectAccount = async (id: string, name: string) => {
      setLoading(true);
      await fetch('/api/ads/init', {
          method: 'POST',
          body: JSON.stringify({ adAccountId: id, adAccountName: name })
      });
      setNeedsSetup(false);
      fetchDashboardData();
      setLoading(false);
  }

  const fetchDashboardData = async () => {
      const [campRes, insRes] = await Promise.all([
          fetch('/api/ads/campaigns'),
          fetch('/api/ads/insights')
      ]);
      const campData = await campRes.json();
      const insData = await insRes.json();

      if (campData.data) setCampaigns(campData.data);
      if (insData.data && insData.data.length > 0) setInsights(insData.data[0]);
  }

  if (loading) {
      return (
          <div className="flex items-center justify-center min-h-screen">
              <Loader2 className="animate-spin text-primary" />
          </div>
      )
  }

  // SETUP SCREEN
  if (needsSetup) {
      return (
          <div className="p-8 max-w-md mx-auto min-h-screen flex flex-col items-center justify-center text-center">
              <div className="bg-blue-100 p-4 rounded-full mb-6">
                  <Megaphone size={48} className="text-blue-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Setup Ads Manager</h1>
              <p className="text-slate-500 mb-8">
                  Select a Facebook Ad Account to manage your campaigns.
              </p>

              <div className="w-full space-y-3">
                  {adAccounts.length === 0 ? (
                       <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">
                           No Ad Accounts found. Please make sure your Facebook account has an Ad Account.
                       </div>
                  ) : (
                      adAccounts.map((acc: AdAccount) => (
                          <button
                            key={acc.account_id}
                            onClick={() => selectAccount(acc.account_id, acc.name)}
                            className="w-full p-4 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-left flex justify-between items-center group"
                          >
                              <span className="font-semibold text-slate-700 group-hover:text-blue-700">{acc.name}</span>
                              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded group-hover:bg-blue-100 group-hover:text-blue-600">{acc.currency}</span>
                          </button>
                      ))
                  )}
              </div>
          </div>
      )
  }

  // DASHBOARD SCREEN
  return (
    <div className="p-6 pb-24 max-w-lg mx-auto min-h-screen">
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Ads Manager</h1>
            <Link href="/dashboard/ads/create">
                <button className="bg-primary text-primary-text px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm hover:opacity-90 transition-all">
                    <Plus size={16} /> New Campaign
                </button>
            </Link>
        </div>

        {/* METRICS */}
        <div className="grid grid-cols-2 gap-3 mb-8">
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <TrendingUp size={14} /> <span className="text-xs font-medium">Impressions</span>
                </div>
                <div className="text-xl font-bold text-slate-900">
                    {insights ? parseInt(insights.impressions).toLocaleString() : '0'}
                </div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <DollarSign size={14} /> <span className="text-xs font-medium">Spend</span>
                </div>
                <div className="text-xl font-bold text-slate-900">
                    ${insights ? parseFloat(insights.spend).toFixed(2) : '0.00'}
                </div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <MousePointer size={14} /> <span className="text-xs font-medium">Clicks</span>
                </div>
                <div className="text-xl font-bold text-slate-900">
                    {insights ? parseInt(insights.clicks).toLocaleString() : '0'}
                </div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex items-center gap-2 text-slate-400 mb-1">
                    <AlertCircle size={14} /> <span className="text-xs font-medium">CTR</span>
                </div>
                <div className="text-xl font-bold text-slate-900">
                    {insights ? parseFloat(insights.ctr).toFixed(2) : '0.00'}%
                </div>
            </div>
        </div>

        {/* CAMPAIGNS LIST */}
        <h2 className="text-lg font-bold text-slate-900 mb-4">Active Campaigns</h2>
        <div className="space-y-3">
            {campaigns.length === 0 ? (
                <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-slate-400 text-sm">No campaigns running currently.</p>
                </div>
            ) : (
                campaigns.map((camp: Campaign) => (
                    <div key={camp.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="font-semibold text-slate-800 text-sm">{camp.name}</h3>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                                camp.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                                {camp.status}
                            </span>
                        </div>
                        <div className="flex gap-4 text-xs text-slate-500">
                            <span>Target: {camp.objective.replace(/_/g, ' ')}</span>
                        </div>
                        {camp.insights && camp.insights.data && (
                             <div className="mt-3 pt-3 border-t border-slate-50 flex justify-between text-xs">
                                 <div>
                                     <span className="text-slate-400">Spend: </span>
                                     <span className="font-medium text-slate-700">${camp.insights.data[0].spend}</span>
                                 </div>
                                 <div>
                                     <span className="text-slate-400">Clicks: </span>
                                     <span className="font-medium text-slate-700">{camp.insights.data[0].clicks}</span>
                                 </div>
                             </div>
                        )}
                    </div>
                ))
            )}
        </div>
    </div>
  )
}
