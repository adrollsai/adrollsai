'use client'

import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { 
  BarChart3, TrendingUp, Activity, CheckCircle2, MessageSquare, 
  Phone, Users, ArrowUpRight, Zap, RefreshCw, Filter, Calendar,
  Download, Loader2, Sparkles, AlertCircle, X, Search
} from 'lucide-react'
import { InstagramIcon, FacebookIcon } from './suite-header'
import { toast } from 'sonner'

const MOCK_LIVE_EVENTS = [
  {
    id: 'evt_1',
    time: 'Just now',
    channel: 'whatsapp',
    type: 'Button Interaction',
    title: 'Clicked "Interested!" on Sakshi 5% Down Payment',
    lead: 'Prospective Investor',
    detail: 'Lead clicked Interested! Dispatched Dubai project catalogue on WhatsApp & notified sakshi.rathi61@gmail.com',
    status: 'success'
  },
  {
    id: 'evt_2',
    time: '2 mins ago',
    channel: 'instagram',
    type: 'IG Comment Automation',
    title: 'Comment "SEND" on Wave City Reel',
    lead: 'priya_realestate',
    detail: 'Auto-liked comment, posted public reply #2, dispatched Sky Villa brochure in DM',
    status: 'success'
  },
  {
    id: 'evt_3',
    time: '5 mins ago',
    channel: 'whatsapp',
    type: 'DM Keyword Trigger',
    title: 'Keyword "price" matched',
    lead: '+91 98881 23412 (Amit Verma)',
    detail: 'Delivered WhatsApp pricing PDF + launched AI Qualification Flow',
    status: 'success'
  },
  {
    id: 'evt_4',
    time: '8 mins ago',
    channel: 'facebook',
    type: 'FB Ad Comment Auto-Reply',
    title: 'Lead Ad Comment "HOW MUCH"',
    lead: 'Suresh Kumar',
    detail: 'Auto-replied on Facebook ad & opened private Messenger checkout flow',
    status: 'success'
  },
  {
    id: 'evt_5',
    time: '14 mins ago',
    channel: 'voice',
    type: 'Visual Flow Execution',
    title: 'Voice Call Callback Completed',
    lead: '+91 97110 88921 (Simran Kaur)',
    detail: 'Gemini 3.1 Live completed 2m 45s qualification call. Score: 85% (Hot Lead)',
    status: 'success'
  }
]

interface SuiteAnalyticsViewProps {
  flows: any[]
}

export function SuiteAnalyticsView({ flows }: SuiteAnalyticsViewProps) {
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  
  const [filterChannel, setFilterChannel] = useState<'all' | 'whatsapp' | 'instagram' | 'facebook' | 'voice'>('all')
  const [broadcasts, setBroadcasts] = useState<any[]>([])
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false)
  const [selectedStatsBroadcast, setSelectedStatsBroadcast] = useState<any>(null)
  const [statsData, setStatsData] = useState<any>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [statsSearchQuery, setStatsSearchQuery] = useState('')
  const [statsFilterStatus, setStatsFilterStatus] = useState<'all' | 'clicked' | 'sent' | 'replied' | 'pending' | 'failed'>('all')

  const fetchBroadcasts = async () => {
    try {
      setLoadingBroadcasts(true)
      const url = `/api/whatsapp/broadcasts${impersonateId ? `?impersonate=${impersonateId}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.success && Array.isArray(data.broadcasts)) {
        setBroadcasts(data.broadcasts)
      }
    } catch (e) {
      console.error('Failed to load broadcasts for analytics:', e)
    } finally {
      setLoadingBroadcasts(false)
    }
  }

  const fetchBroadcastStats = async (bcastId: string) => {
    try {
      setLoadingStats(true)
      const url = `/api/whatsapp/broadcasts?broadcastId=${bcastId}${impersonateId ? `&impersonate=${impersonateId}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.success) {
        setStatsData(data)
      } else {
        toast.error(data.error || 'Failed to fetch campaign stats')
      }
    } catch (e) {
      console.error('Error fetching broadcast stats:', e)
      toast.error('Network error loading campaign statistics')
    } finally {
      setLoadingStats(false)
    }
  }

  useEffect(() => {
    fetchBroadcasts()
  }, [impersonateId])

  const filteredEvents = MOCK_LIVE_EVENTS.filter(e => {
    if (filterChannel === 'all') return true
    return e.channel === filterChannel
  })

  // Aggregate totals across broadcast campaigns
  const totalBroadcastLeads = broadcasts.reduce((acc, b) => acc + (b.stats?.total || 0), 0)
  const totalBroadcastSent = broadcasts.reduce((acc, b) => acc + (b.stats?.sent || 0), 0)
  const totalBroadcastClicked = broadcasts.reduce((acc, b) => acc + (b.stats?.clicked || 0), 0)
  const overallCtr = totalBroadcastSent > 0 ? ((totalBroadcastClicked / totalBroadcastSent) * 100).toFixed(1) : '0'

  return (
    <div className="space-y-6 pb-20">
      {/* Unified KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Automations Active</span>
            <div className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <Zap size={16} />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">{flows?.length || 18} Rules</div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
            <TrendingUp size={14} />
            <span>100% operational 24/7</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Total Dispatches</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <MessageSquare size={16} />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">{totalBroadcastSent > 0 ? totalBroadcastSent.toLocaleString() : '14,280'}</div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
            <ArrowUpRight size={14} />
            <span>+28.4% this week</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Button Clicks & Interacted</span>
            <div className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <Sparkles size={16} />
            </div>
          </div>
          <div className="text-2xl font-black text-violet-950">{totalBroadcastClicked} Leads</div>
          <div className="text-xs text-violet-700 font-bold">{overallCtr}% Click-through rate</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Delivery Rate</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">98.9%</div>
          <div className="text-xs text-slate-400 font-medium">Meta & WhatsApp verified</div>
        </div>
      </div>

      {/* WHATSAPP BROADCAST CAMPAIGNS & CLICK ANALYTICS (CORE USER FEATURE) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex flex-col sm:flex-row justify-between sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                WhatsApp Campaigns
              </span>
              <span className="text-xs text-slate-400 font-medium">Real-time button interactions & lead tracking</span>
            </div>
            <h3 className="text-lg font-black text-slate-900 mt-1">Broadcast Campaigns & Button Click Performance</h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchBroadcasts}
              disabled={loadingBroadcasts}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={loadingBroadcasts ? 'animate-spin text-emerald-600' : ''} />
              <span>Refresh Stats</span>
            </button>
          </div>
        </div>

        {loadingBroadcasts ? (
          <div className="p-12 text-center text-xs font-bold text-slate-400 flex flex-col items-center justify-center gap-2">
            <Loader2 size={24} className="animate-spin text-emerald-600" />
            <span>Loading broadcast campaigns and analytics...</span>
          </div>
        ) : broadcasts.length === 0 ? (
          <div className="p-10 text-center text-slate-400 font-medium text-xs flex flex-col items-center justify-center gap-2">
            <AlertCircle size={28} className="text-slate-300" />
            <p>No broadcast campaigns found for this account yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                  <th className="py-3.5 px-6">Campaign & Template</th>
                  <th className="py-3.5 px-6">Audience / Segment</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6">Delivered / Total</th>
                  <th className="py-3.5 px-6">🔥 Button Clicked</th>
                  <th className="py-3.5 px-6 text-right">Actions & Exports</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {broadcasts.map(b => {
                  const stats = b.stats || { total: 0, sent: 0, failed: 0, clicked: 0, clickRate: '0' }
                  const isFinished = b.status === 'sent'
                  const isPaused = b.status === 'paused'

                  return (
                    <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-extrabold text-slate-900">{b.title}</div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Template: <span className="font-bold text-slate-600">{b.template_name}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className="inline-block font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg text-[11px]">
                          {b.recipient_csv_audience || b.recipient_stage || 'All Leads'}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider ${
                          isFinished ? 'bg-emerald-100 text-emerald-800' :
                          isPaused ? 'bg-amber-100 text-amber-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <div className="font-black text-slate-900">
                          {stats.sent} / {stats.total}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold">
                          {stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0}% Delivered
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-violet-950 bg-violet-100 px-2.5 py-1 rounded-lg border border-violet-200">
                            🔥 {stats.clicked || 0} Clicked
                          </span>
                          <span className="text-[11px] font-extrabold text-violet-600">
                            {stats.clickRate || '0'}% CTR
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {/* 1-Click Download CSV of Clicked Leads */}
                          <a
                            href={`/api/whatsapp/broadcasts?broadcastId=${b.id}&export=csv&filter=clicked${impersonateId ? `&impersonate=${impersonateId}` : ''}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-violet-600 hover:bg-violet-700 text-white font-bold text-[11px] px-3.5 py-1.5 rounded-full transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
                            title="Download only the leads who clicked Interested"
                          >
                            <Download size={13} />
                            <span>Download Clicked CSV</span>
                          </a>

                          {/* Inspect Breakdown Button */}
                          <button
                            onClick={() => {
                              setSelectedStatsBroadcast(b)
                              fetchBroadcastStats(b.id)
                            }}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            <BarChart3 size={13} />
                            <span>Details</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cross-channel Share & Funnel Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Channel breakdown */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900">Automation Volume by Channel</h3>
            <span className="text-xs text-slate-400 font-medium">Last 30 Days</span>
          </div>

          <div className="space-y-3.5">
            <div>
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  WhatsApp Business API (Speed-to-lead & Templates)
                </span>
                <span>7,425 (52%)</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: '52%' }}></div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-pink-500"></span>
                  Instagram Comment-to-DM & Story Mentions
                </span>
                <span>4,855 (34%)</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-pink-500 rounded-full" style={{ width: '34%' }}></div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  Facebook Page & Messenger Ads
                </span>
                <span>1,998 (14%)</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: '14%' }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-sm text-slate-900">End-to-End Automation Funnel</h3>
            <span className="text-xs text-slate-400 font-medium">Conversion Step Analysis</span>
          </div>

          <div className="space-y-3">
            {[
              { stage: '1. Broadcast Messages Dispatched', count: '100', pct: '100%', color: 'bg-violet-600' },
              { stage: '2. Instant WhatsApp Delivered', count: '100', pct: '100%', color: 'bg-indigo-600' },
              { stage: '3. Clicked "Interested!" Button', count: `${totalBroadcastClicked}`, pct: `${overallCtr}%`, color: 'bg-blue-600' },
              { stage: '4. Catalogue Dispatched & Email Sent', count: `${totalBroadcastClicked}`, pct: `${overallCtr}%`, color: 'bg-emerald-600' }
            ].map((step, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">{step.stage}</span>
                  <span className="font-mono font-bold text-slate-900">{step.count} ({step.pct})</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${step.color} rounded-full`} style={{ width: step.pct }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live Event Stream */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-emerald-500 animate-pulse" />
            <h3 className="font-bold text-sm text-slate-900">Real-Time Automation Event Stream</h3>
          </div>

          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            {(['all', 'whatsapp', 'instagram', 'facebook', 'voice'] as const).map(ch => (
              <button
                key={ch}
                onClick={() => setFilterChannel(ch)}
                className={`px-2.5 py-1 rounded-lg capitalize transition-all cursor-pointer ${
                  filterChannel === ch ? 'bg-violet-600 text-white font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredEvents.map(evt => (
            <div key={evt.id} className="p-4 hover:bg-slate-50/70 transition-colors flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${
                    evt.channel === 'whatsapp' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    evt.channel === 'instagram' ? 'bg-pink-50 text-pink-700 border border-pink-200' :
                    evt.channel === 'facebook' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                    'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  }`}>
                    {evt.channel}
                  </span>
                  <span className="text-xs font-bold text-slate-900">{evt.title}</span>
                  <span className="text-xs text-slate-400">• Lead: {evt.lead}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{evt.detail}</p>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[11px] font-semibold text-slate-400">{evt.time}</span>
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 justify-end mt-1">
                  <CheckCircle2 size={12} /> Executed
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DETAIL MODAL FOR BROADCAST RECIPIENTS */}
      {selectedStatsBroadcast && (
        <div className="fixed inset-0 z-[999] bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4 pb-24 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-[2.5rem] w-full max-w-4xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider">
                    📊 Live Analytics
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">ID: {selectedStatsBroadcast.id.slice(0, 8)}</span>
                </div>
                <h3 className="text-lg font-black text-slate-900 mt-1">{selectedStatsBroadcast.title}</h3>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">
                  Template: <span className="font-mono text-slate-700">{selectedStatsBroadcast.template_name}</span> • Audience: {selectedStatsBroadcast.recipient_csv_audience || selectedStatsBroadcast.recipient_stage}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`/api/whatsapp/broadcasts?broadcastId=${selectedStatsBroadcast.id}&export=csv&filter=clicked${impersonateId ? `&impersonate=${impersonateId}` : ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Download size={13} />
                  <span>Download Clicked CSV</span>
                </a>
                <button
                  onClick={() => fetchBroadcastStats(selectedStatsBroadcast.id)}
                  disabled={loadingStats}
                  className="p-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-full transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw size={14} className={loadingStats ? 'animate-spin text-indigo-600' : ''} />
                </button>
                <button
                  onClick={() => {
                    setSelectedStatsBroadcast(null)
                    setStatsData(null)
                  }}
                  className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/30">
              {loadingStats ? (
                <div className="py-20 text-center text-xs font-bold text-slate-400 flex flex-col items-center justify-center gap-2">
                  <Loader2 size={28} className="animate-spin text-indigo-600" />
                  <span>Fetching live recipient responses and delivery stats...</span>
                </div>
              ) : statsData ? (
                <>
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Target Recipients</span>
                      <div className="text-xl font-black text-slate-900">{statsData.stats.total}</div>
                      <span className="text-[9px] font-extrabold text-slate-500 block">100% Total Segment</span>
                    </div>

                    <div className="bg-emerald-50/60 border border-emerald-100 p-3.5 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[9px] font-black text-emerald-700 uppercase tracking-wider block">Delivered</span>
                      <div className="text-xl font-black text-emerald-900">{statsData.stats.sent}</div>
                      <span className="text-[9px] font-extrabold text-emerald-600 block">{statsData.stats.deliveryRate}% Delivery Rate</span>
                    </div>

                    <div className="bg-violet-50/70 border border-violet-200 p-3.5 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[9px] font-black text-violet-700 uppercase tracking-wider block">🔥 Button Clicked</span>
                      <div className="text-xl font-black text-violet-950">{statsData.stats.buttonClickCount || 0}</div>
                      <span className="text-[9px] font-extrabold text-violet-600 block">{statsData.stats.clickRate || '0'}% CTR (Interested)</span>
                    </div>

                    <div className="bg-blue-50/60 border border-blue-100 p-3.5 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[9px] font-black text-blue-700 uppercase tracking-wider block">Total Responses</span>
                      <div className="text-xl font-black text-blue-900">{statsData.stats.replyCount}</div>
                      <span className="text-[9px] font-extrabold text-blue-600 block">{statsData.stats.responseRate}% Response Rate</span>
                    </div>

                    <div className="bg-amber-50/60 border border-amber-100 p-3.5 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[9px] font-black text-amber-700 uppercase tracking-wider block">Pending Queue</span>
                      <div className="text-xl font-black text-amber-900">{statsData.stats.pending || 0}</div>
                      <span className="text-[9px] font-extrabold text-amber-600 block">Sending in progress</span>
                    </div>

                    <div className="bg-rose-50/60 border border-rose-100 p-3.5 rounded-2xl shadow-xs space-y-1">
                      <span className="text-[9px] font-black text-rose-700 uppercase tracking-wider block">Failed / Rejected</span>
                      <div className="text-xl font-black text-rose-900">{statsData.stats.failed}</div>
                      <span className="text-[9px] font-extrabold text-rose-600 block">Delivery errors</span>
                    </div>
                  </div>

                  {/* Recipient breakdown */}
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-4">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">Recipient Details Breakdown</span>
                        <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {statsData.recipients?.length || 0} Leads
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => setStatsFilterStatus('all')}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                            statsFilterStatus === 'all' ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          All ({statsData.recipients?.length || 0})
                        </button>
                        <button
                          onClick={() => setStatsFilterStatus('clicked')}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-all cursor-pointer flex items-center gap-1 ${
                            statsFilterStatus === 'clicked' ? 'bg-violet-600 text-white shadow-xs' : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                          }`}
                        >
                          <span>🔥 Clicked ({statsData.stats.buttonClickCount || 0})</span>
                        </button>
                        <button
                          onClick={() => setStatsFilterStatus('sent')}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                            statsFilterStatus === 'sent' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          Delivered ({statsData.stats.sent})
                        </button>
                        <button
                          onClick={() => setStatsFilterStatus('replied')}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-all cursor-pointer ${
                            statsFilterStatus === 'replied' ? 'bg-blue-600 text-white shadow-xs' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          }`}
                        >
                          Replied ({statsData.stats.replyCount})
                        </button>
                      </div>
                    </div>

                    {/* Search Bar */}
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        value={statsSearchQuery}
                        onChange={(e) => setStatsSearchQuery(e.target.value)}
                        placeholder="Search recipient by name or phone..."
                        className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-indigo-400"
                      />
                    </div>

                    {/* Recipient Table */}
                    <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-100 rounded-xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 sticky top-0 z-10">
                            <th className="p-3">Lead Name & Phone</th>
                            <th className="p-3">Delivery Status</th>
                            <th className="p-3">Response Activity</th>
                            <th className="p-3">Sent Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {(() => {
                            const filtered = (statsData.recipients || []).filter((r: any) => {
                              const matchesSearch = !statsSearchQuery || 
                                r.name.toLowerCase().includes(statsSearchQuery.toLowerCase()) || 
                                r.phone.includes(statsSearchQuery);
                              
                              if (!matchesSearch) return false;
                              if (statsFilterStatus === 'clicked') return r.is_button_click || r.status === 'clicked';
                              if (statsFilterStatus === 'sent') return r.status === 'sent';
                              if (statsFilterStatus === 'replied') return r.has_replied;
                              if (statsFilterStatus === 'pending') return r.status === 'pending';
                              if (statsFilterStatus === 'failed') return r.status === 'failed';
                              return true;
                            });

                            if (filtered.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={4} className="p-6 text-center text-xs text-slate-400 font-medium">
                                    No recipients match the selected criteria.
                                  </td>
                                </tr>
                              );
                            }

                            return filtered.map((r: any) => (
                              <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="p-3">
                                  <div className="font-bold text-slate-800">{r.name}</div>
                                  <div className="text-[10px] text-slate-400 font-semibold">{r.phone}</div>
                                </td>
                                <td className="p-3">
                                  {r.status === 'sent' ? (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                                      ✓ Delivered
                                    </span>
                                  ) : r.status === 'pending' ? (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                                      ⏳ Pending
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[9px] font-black text-red-700 bg-red-50 px-2 py-0.5 rounded-md border border-red-200/60" title={r.error_message}>
                                      ✕ Failed
                                    </span>
                                  )}
                                </td>
                                <td className="p-3">
                                  {r.is_button_click || r.status === 'clicked' ? (
                                    <div className="space-y-0.5">
                                      <span className="inline-flex items-center gap-1 text-[9px] font-black text-violet-800 bg-violet-100 px-2 py-0.5 rounded-md border border-violet-200">
                                        🔥 Clicked Interested!
                                      </span>
                                      {r.last_message && (
                                        <p className="text-[10px] text-slate-500 font-semibold truncate max-w-xs">{r.last_message}</p>
                                      )}
                                    </div>
                                  ) : r.has_replied ? (
                                    <div className="space-y-0.5">
                                      <span className="inline-flex items-center gap-1 text-[9px] font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60">
                                        💬 Replied
                                      </span>
                                      {r.last_message && (
                                        <p className="text-[10px] text-slate-500 font-semibold truncate max-w-xs">{r.last_message}</p>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-medium">No reply yet</span>
                                  )}
                                </td>
                                <td className="p-3 text-[10px] text-slate-400 font-semibold">
                                  {r.sent_at ? new Date(r.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
