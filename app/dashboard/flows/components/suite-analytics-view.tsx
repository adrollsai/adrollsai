'use client'

import React, { useState } from 'react'
import { 
  BarChart3, TrendingUp, Activity, CheckCircle2, MessageSquare, 
  Phone, Users, ArrowUpRight, Zap, RefreshCw, Filter, Calendar
} from 'lucide-react'
import { InstagramIcon, FacebookIcon } from './suite-header'

const MOCK_LIVE_EVENTS = [
  {
    id: 'evt_1',
    time: 'Just now',
    channel: 'instagram',
    type: 'IG Comment Automation',
    title: 'Comment "SEND" on Wave City Reel',
    lead: 'priya_realestate',
    detail: 'Auto-liked comment, posted public reply #2, dispatched Sky Villa brochure in DM',
    status: 'success'
  },
  {
    id: 'evt_2',
    time: '2 mins ago',
    channel: 'whatsapp',
    type: 'DM Keyword Trigger',
    title: 'Keyword "price" matched',
    lead: '+91 98881 23412 (Amit Verma)',
    detail: 'Delivered WhatsApp pricing PDF + launched AI Qualification Flow',
    status: 'success'
  },
  {
    id: 'evt_3',
    time: '6 mins ago',
    channel: 'facebook',
    type: 'FB Ad Comment Auto-Reply',
    title: 'Lead Ad Comment "HOW MUCH"',
    lead: 'Suresh Kumar',
    detail: 'Auto-replied on Facebook ad & opened private Messenger checkout flow',
    status: 'success'
  },
  {
    id: 'evt_4',
    time: '12 mins ago',
    channel: 'voice',
    type: 'Visual Flow Execution',
    title: 'Voice Call Callback Completed',
    lead: '+91 97110 88921 (Simran Kaur)',
    detail: 'Gemini 3.1 Live (Puck voice) completed 2m 45s qualification call. Score: 85% (Hot Lead)',
    status: 'success'
  },
  {
    id: 'evt_5',
    time: '25 mins ago',
    channel: 'whatsapp',
    type: 'Drip Sequence Step 2',
    title: '7-Day Investor Drip (+24h)',
    lead: '+91 98140 55102 (Dr. Rajiv Mehta)',
    detail: 'Dispatched 4K architectural video tour to WhatsApp. Opened by lead at 11:42 AM',
    status: 'success'
  }
]

interface SuiteAnalyticsViewProps {
  flows: any[]
}

export function SuiteAnalyticsView({ flows }: SuiteAnalyticsViewProps) {
  const [filterChannel, setFilterChannel] = useState<'all' | 'whatsapp' | 'instagram' | 'facebook' | 'voice'>('all')

  const filteredEvents = MOCK_LIVE_EVENTS.filter(e => {
    if (filterChannel === 'all') return true
    return e.channel === filterChannel
  })

  return (
    <div className="space-y-6">
      {/* Unified KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Automations Active</span>
            <div className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
              <Zap size={16} />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">18 Rules</div>
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
          <div className="text-2xl font-black text-slate-900">14,280</div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
            <ArrowUpRight size={14} />
            <span>+28.4% this week</span>
          </div>
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

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>Conversion to Lead</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <BarChart3 size={16} />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">41.6%</div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
            <TrendingUp size={14} />
            <span>+8.2% vs manual replies</span>
          </div>
        </div>
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
                  WhatsApp Business API (Speed-to-lead & Bots)
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
              { stage: '1. Inbound Triggers Fired', count: '14,280', pct: '100%', color: 'bg-violet-600' },
              { stage: '2. Instant DM / Message Delivered', count: '14,120', pct: '98.9%', color: 'bg-indigo-600' },
              { stage: '3. CTA / Brochure Clicked', count: '8,430', pct: '59.7%', color: 'bg-blue-600' },
              { stage: '4. AI Qualification Completed', count: '5,940', pct: '41.6%', color: 'bg-emerald-600' }
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
    </div>
  )
}
