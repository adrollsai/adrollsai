'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import {
  ArrowLeft,
  Loader2,
  DollarSign,
  TrendingUp,
  Video,
  Layers,
  HardDrive,
  BrainCircuit,
  Cloud,
  MessageSquare,
  Building2,
  CheckCircle2,
  HelpCircle,
  Globe
} from 'lucide-react'
import { toast } from 'sonner'

const EXCHANGE_RATE = 84.0;

export default function CostingAnalyticsPage() {
  const { id } = useParams()
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    checkAuthAndFetch()
  }, [id])

  const checkAuthAndFetch = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/dashboard')
        return
      }

      // Check if logged in user is super_admin
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile || profile.role !== 'super_admin') {
        toast.error('Unauthorized access')
        router.push('/dashboard')
        return
      }

      setAuthorized(true)

      // Fetch detailed costing metrics
      const res = await fetch(`/api/admin/costing?userId=${id}`)
      const json = await res.json()

      if (json.success) {
        setData(json.details)
      } else {
        throw new Error(json.error || 'Failed to fetch costing details')
      }
    } catch (err: any) {
      toast.error(err.message)
      router.push('/dashboard/accounts')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  if (!authorized || !data) return null

  const breakdown = data.breakdown || {}

  // Component icons mapping for visual aesthetic
  const serviceDetails = [
    {
      key: 'kieVideo',
      name: 'Kie.ai Video Generation',
      icon: <Video className="text-pink-600" size={20} />,
      desc: 'Creation of raw 15s scenes via Bytedance/Seedance and Veo models.',
      bgColor: 'bg-pink-50 border-pink-100',
    },
    {
      key: 'lambdaRender',
      name: 'AWS Lambda Video Rendering',
      icon: <Layers className="text-violet-600" size={20} />,
      desc: 'Remotion composition, overlays, logo insertion, and subtitles.',
      bgColor: 'bg-violet-50 border-violet-100',
    },
    {
      key: 'kieImage',
      name: 'Kie.ai Image Generation',
      icon: <CheckCircle2 className="text-emerald-600" size={20} />,
      desc: 'Creative asset generation for ad copy and multi-creatives.',
      bgColor: 'bg-emerald-50 border-emerald-100',
    },
    {
      key: 'geminiLLM',
      name: 'Gemini LLM Processing',
      icon: <BrainCircuit className="text-blue-600" size={20} />,
      desc: 'AI script synthesis, caption formatting, and ad copy rewrites.',
      bgColor: 'bg-blue-50 border-blue-100',
    },
    {
      key: 'r2Storage',
      name: 'Cloudflare R2 storage',
      icon: <HardDrive className="text-amber-600" size={20} />,
      desc: 'Active media hosting, R2 storage bucket bytes, and upload operations.',
      bgColor: 'bg-amber-50 border-amber-100',
    },
    {
      key: 'vercelHosting',
      name: 'Vercel Bandwidth & Serverless',
      icon: <Globe className="text-slate-700" size={20} />,
      desc: 'Bandwidth allocations and Edge Serverless execution for landing pages.',
      bgColor: 'bg-slate-50 border-slate-200',
    },
    {
      key: 'metaCampaigns',
      name: 'Meta Ads API Management',
      icon: <Cloud className="text-indigo-600" size={20} />,
      desc: 'Launches, webhooks, and automated Advantage+ campaign creations.',
      bgColor: 'bg-indigo-50 border-indigo-100',
    },
    {
      key: 'whatsappMsgs',
      name: 'WhatsApp Dispatch Routing',
      icon: <MessageSquare className="text-teal-600" size={20} />,
      desc: 'Lead notifications and automated WhatsApp messaging dispatches.',
      bgColor: 'bg-teal-50 border-teal-100',
    }
  ]

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24 px-4 sm:px-8 pt-8">
      {/* Top Bar */}
      <div className="max-w-5xl mx-auto mb-8 flex items-center justify-between">
        <button
          onClick={() => router.push('/dashboard/accounts')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-all font-bold text-sm bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm"
        >
          <ArrowLeft size={16} /> Back to Hierarchy
        </button>
        <span className="text-xs font-black uppercase bg-indigo-100 text-indigo-700 px-3 py-1 rounded-md tracking-wider">
          Super Admin Console
        </span>
      </div>

      {/* Header Profile Info */}
      <div className="max-w-5xl mx-auto bg-white border border-slate-200 rounded-[2rem] p-6 sm:p-8 shadow-sm mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-center">
            <Building2 className="text-blue-600" size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">{data.businessName}</h1>
            <p className="text-sm text-slate-500 mt-1">{data.email}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-600 tracking-tighter">
                ID: {id}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-100 text-emerald-700 tracking-tighter">
                Role: {data.role}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-violet-100 text-violet-700 tracking-tighter">
                Created: {new Date(data.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Highlight cost metrics */}
        <div className="flex gap-4 self-start md:self-center shrink-0">
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 min-w-[140px] text-left">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Compute Cost</p>
            <p className="text-xl font-extrabold text-slate-900 mt-1.5">Rs. {data.totalCostInr}</p>
            <p className="text-xs text-slate-500 font-bold mt-0.5">${data.totalCostUsd} USD</p>
          </div>
        </div>
      </div>

      {/* Main Grid: Details list & Cost Distribution Chart */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Service Attributions List (Left/Col 2) */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            Service Cost Attribution <span title="Calculated based on actual service resource usage"><HelpCircle size={16} className="text-slate-300" /></span>
          </h2>
          
          {serviceDetails.map((service) => {
            const usage = breakdown[service.key] || { count: 0, metric: 'N/A', usd: 0, inr: 0 }
            
            return (
              <div
                key={service.key}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-start gap-4 transition-all hover:border-slate-300"
              >
                <div className={`p-3 rounded-xl border shrink-0 ${service.bgColor}`}>
                  {service.icon}
                </div>
                
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between items-start gap-4 flex-wrap">
                    <h3 className="font-bold text-slate-900 text-sm">{service.name}</h3>
                    <div className="text-right shrink-0">
                      <p className="font-black text-slate-900 text-sm">Rs. {usage.inr.toFixed(2)}</p>
                      <p className="text-[10px] text-slate-400 font-bold">${usage.usd.toFixed(4)} USD</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 pr-6 leading-relaxed">{service.desc}</p>
                  
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-50 text-[10px] font-bold text-slate-500">
                    <div>
                      Usage: <span className="text-slate-900">{usage.count} units</span>
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                    <div>
                      Metric: <span className="text-slate-900">{usage.metric}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Cost Analysis Widgets (Right/Col 1) */}
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Cost Distribution</h2>
          
          {/* Distribution card */}
          <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Attributed Share</p>
            
            <div className="space-y-6">
              {[
                { name: 'Creative Generation (Kie.ai)', usd: (breakdown.kieVideo?.usd || 0) + (breakdown.kieImage?.usd || 0), color: 'bg-pink-500' },
                { name: 'Cloud Compute (AWS Lambda)', usd: breakdown.lambdaRender?.usd || 0, color: 'bg-violet-500' },
                { name: 'Cloud Storage (R2 S3)', usd: breakdown.r2Storage?.usd || 0, color: 'bg-amber-500' },
                { name: 'AI Language (Gemini LLM)', usd: breakdown.geminiLLM?.usd || 0, color: 'bg-blue-500' },
                { name: 'Distribution API (Meta/WhatsApp/Vercel)', usd: (breakdown.metaCampaigns?.usd || 0) + (breakdown.whatsappMsgs?.usd || 0) + (breakdown.vercelHosting?.usd || 0), color: 'bg-teal-500' }
              ].map((item, idx) => {
                const percentage = data.totalCostUsd > 0 ? (item.usd / data.totalCostUsd) * 100 : 0
                
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <span className="text-slate-500 truncate pr-4">{item.name}</span>
                      <span className="text-slate-900 shrink-0">{percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${item.color} rounded-full`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                      <span>Rs. {(item.usd * EXCHANGE_RATE).toFixed(2)}</span>
                      <span>${item.usd.toFixed(2)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Pricing Model details */}
          <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-4">Pricing Rules Used</h3>
            <div className="space-y-3 text-xs leading-relaxed text-slate-500">
              <div className="flex justify-between pb-2 border-b border-slate-50">
                <span>Kie.ai Video Credits</span>
                <span className="font-semibold text-slate-800">$0.005 / credit</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-50">
                <span>AWS Lambda Compute</span>
                <span className="font-semibold text-slate-800">$0.000033 / sec</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-50">
                <span>R2 Storage Hosting</span>
                <span className="font-semibold text-slate-800">$0.015 / GB-mo</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-50">
                <span>Meta Ad Campaign Launch</span>
                <span className="font-semibold text-slate-800">$0.05 / launch</span>
              </div>
              <div className="flex justify-between pb-2 border-b border-slate-50">
                <span>WhatsApp Message</span>
                <span className="font-semibold text-slate-800">$0.01 / msg</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-4 leading-normal font-medium">
              Attributions map real-time API calls and server logs directly to individual user operations for exact billing tracking.
            </p>
          </div>
        </div>
        
      </div>
    </div>
  )
}
