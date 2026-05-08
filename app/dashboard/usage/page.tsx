'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
    Zap, BarChart3, Image as ImageIcon, Rocket, Target, 
    RefreshCcw, FileText, HardDrive, Loader2, AlertCircle, ShieldCheck
} from 'lucide-react'
import { PLAN_LIMITS } from '@/utils/subscription'

export default function UsagePage() {
    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [usage, setUsage] = useState({
        ai_creatives_used: 0,
        campaign_launches_used: 0,
        ai_ad_optimizations_used: 0,
        remarketing_campaigns_used: 0,
        seo_articles_used: 0,
        storage_bytes_used: 0
    })

    useEffect(() => {
        const fetchUsage = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) return

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('ai_creatives_used, campaign_launches_used, ai_ad_optimizations_used, remarketing_campaigns_used, seo_articles_used, storage_bytes_used')
                    .eq('id', user.id)
                    .single()

                if (profile) {
                    setUsage({
                        ai_creatives_used: profile.ai_creatives_used || 0,
                        campaign_launches_used: profile.campaign_launches_used || 0,
                        ai_ad_optimizations_used: profile.ai_ad_optimizations_used || 0,
                        remarketing_campaigns_used: profile.remarketing_campaigns_used || 0,
                        seo_articles_used: profile.seo_articles_used || 0,
                        storage_bytes_used: profile.storage_bytes_used || 0
                    })
                }
            } catch (err) {
                console.error("Error fetching usage:", err)
            } finally {
                setLoading(false)
            }
        }
        fetchUsage()
    }, [supabase])

    const calculatePercent = (used: number, limit: number) => {
        return Math.min(Math.round((used / limit) * 100), 100)
    }

    const formatStorage = (bytes: number) => {
        const gb = bytes / (1024 * 1024 * 1024)
        return gb.toFixed(2)
    }

    const stats = [
        {
            label: 'AI Creatives',
            used: usage.ai_creatives_used,
            limit: PLAN_LIMITS.ai_creatives,
            icon: <ImageIcon size={20} />,
            color: 'bg-blue-500',
            description: 'AI-generated visual variations'
        },
        {
            label: 'Campaign Launches',
            used: usage.campaign_launches_used,
            limit: PLAN_LIMITS.campaign_launches,
            icon: <Rocket size={20} />,
            color: 'bg-purple-500',
            description: 'New Meta campaign deployments'
        },
        {
            label: 'AI Optimizations',
            used: usage.ai_ad_optimizations_used,
            limit: PLAN_LIMITS.ai_ad_optimizations,
            icon: <Target size={20} />,
            color: 'bg-emerald-500',
            description: 'AI-driven campaign health checks'
        },
        {
            label: 'Remarketing',
            used: usage.remarketing_campaigns_used,
            limit: PLAN_LIMITS.remarketing_campaigns,
            icon: <RefreshCcw size={20} />,
            color: 'bg-amber-500',
            description: 'Audience re-engagement cycles'
        },
        {
            label: 'SEO Articles',
            used: usage.seo_articles_used,
            limit: PLAN_LIMITS.seo_articles,
            icon: <FileText size={20} />,
            color: 'bg-indigo-500',
            description: 'AI-generated blog posts'
        },
        {
            label: 'Cloud Storage',
            used: parseFloat(formatStorage(usage.storage_bytes_used)),
            limit: PLAN_LIMITS.storage_gb,
            unit: 'GB',
            icon: <HardDrive size={20} />,
            color: 'bg-slate-700',
            description: 'Asset and document storage'
        }
    ]

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
                <Loader2 className="animate-spin text-blue-600" size={28} />
                <p className="text-sm text-slate-500 font-medium tracking-tight">Calculating your usage...</p>
            </div>
        )
    }

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
            
            <div className="mb-10 sm:mb-12 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                            <BarChart3 size={24} />
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Usage & Quotas</h1>
                    </div>
                    <p className="text-slate-500 text-sm font-medium">Tracking your <strong>Early Bird Plan</strong> consumption for the current billing cycle.</p>
                </div>
                
                <div className="bg-white border border-slate-200 px-5 py-3 rounded-2xl shadow-sm flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                        <Zap size={20} fill="currentColor" />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Current Plan</p>
                        <p className="text-sm font-extrabold text-slate-900">Early Bird Access</p>
                    </div>
                </div>
            </div>

            {/* Main Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 mb-12">
                {stats.map((stat, idx) => {
                    const percent = calculatePercent(stat.used, stat.limit)
                    const isNearLimit = percent > 85
                    
                    return (
                        <div key={idx} className="bg-white p-6 sm:p-8 rounded-[1.75rem] xs:rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                            <div className="flex items-start justify-between mb-6">
                                <div className={`p-3 rounded-2xl ${stat.color} text-white shadow-lg shadow-${stat.color.split('-')[1]}-200/50`}>
                                    {stat.icon}
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
                                    <p className="text-xl font-black text-slate-900 tracking-tight">
                                        {stat.used} <span className="text-slate-300">/</span> {stat.limit}{stat.unit || ''}
                                    </p>
                                </div>
                            </div>
                            
                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-2.5">
                                    <span className="text-xs font-bold text-slate-500">Cycle Consumption</span>
                                    <span className={`text-xs font-black ${isNearLimit ? 'text-red-500' : 'text-blue-600'}`}>
                                        {percent}%
                                    </span>
                                </div>
                                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full transition-all duration-1000 ${isNearLimit ? 'bg-red-500' : stat.color}`}
                                        style={{ width: `${percent}%` }}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 text-slate-400">
                                <AlertCircle size={14} className="shrink-0" />
                                <p className="text-[11px] font-medium leading-tight">{stat.description}</p>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Unlimited Features Banner */}
            <div className="bg-slate-900 rounded-[1.75rem] xs:rounded-[2.5rem] p-8 sm:p-12 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-4 flex items-center gap-3">
                            <ShieldCheck className="text-blue-400" size={32} /> Unlimited Features
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base font-medium max-w-xl">
                            Your Early Bird plan includes unlimited access to CRM management, team collaboration, 
                            product inventory syncing, and push notification services.
                        </p>
                    </div>
                    
                    <div className="flex gap-4 flex-wrap justify-center">
                        {['CRM', 'Team Members', 'Contacts', 'Lead Sync', 'Push Alerts'].map(f => (
                            <span key={f} className="bg-white/10 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold tracking-wide uppercase">
                                {f}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <p className="text-center text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mt-12">
                Quotas reset every 30 days based on your subscription start date.
            </p>
        </div>
    )
}
