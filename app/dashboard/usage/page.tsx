'use client'

import { useState, useEffect } from 'react'
import { PieChart, Users, HardDrive, Zap, Rocket, Search, MessageSquare, ShieldCheck, RefreshCw, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

export default function UsagePage() {
    const [usage, setUsage] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    const fetchUsage = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/subscription/usage')
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            setUsage(data)
        } catch (err: any) {
            toast.error("Failed to load usage data")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchUsage()
    }, [])

    if (loading) {
        return (
            <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 font-bold animate-pulse">Calculating Usage...</p>
                </div>
            </div>
        )
    }

    if (!usage) return null

    const getProgressColor = (used: number, limit: number) => {
        const percent = (used / limit) * 100
        if (percent >= 90) return 'bg-red-500'
        if (percent >= 70) return 'bg-amber-500'
        return 'bg-blue-600'
    }

    const getBgColor = (used: number, limit: number) => {
        const percent = (used / limit) * 100
        if (percent >= 90) return 'bg-red-50'
        if (percent >= 70) return 'bg-amber-50'
        return 'bg-blue-50'
    }

    return (
        <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16">
            <div className="max-w-4xl mx-auto px-6 pt-8">

                {/* Header */}
                <div className="flex justify-between items-end mb-10">
                    <div>
                        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Usage & Quota</h1>
                        <p className="text-slate-500 mt-2 font-medium">Tracking your "{usage.planName}" resources</p>
                    </div>
                    <button
                        onClick={fetchUsage}
                        className="p-3 bg-white rounded-2xl shadow-sm border border-slate-200 text-slate-400 hover:text-blue-600 transition-all active:scale-95"
                    >
                        <RefreshCw size={20} />
                    </button>
                </div>

                {/* Reset Banner */}
                <div className="bg-slate-900 rounded-[2rem] p-8 mb-8 text-white relative overflow-hidden shadow-2xl shadow-slate-900/20">
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="text-blue-400" size={18} />
                            <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Fair Usage Active</span>
                        </div>
                        <h2 className="text-2xl font-bold mb-1">Your limits reset on {new Date(usage.resetDate).toLocaleDateString()}</h2>
                        <p className="text-slate-400 text-sm font-medium">Unused credits do not roll over to the next month.</p>
                    </div>
                    <Zap className="absolute -right-8 -bottom-8 text-white/5 w-64 h-64 rotate-12" />
                </div>

                {/* Usage Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

                    {/* Storage Card */}
                    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200/60 flex flex-col justify-between group hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-6">
                            <div className="p-4 bg-indigo-50 text-indigo-600 rounded-3xl group-hover:scale-110 transition-transform">
                                <HardDrive size={24} />
                            </div>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Storage</span>
                        </div>
                        <div>
                            <div className="flex justify-between items-end mb-2">
                                <h3 className="text-2xl font-black text-slate-900">{usage.limits.storage.used} <span className="text-sm text-slate-400 font-bold">/ {usage.limits.storage.limit} GB</span></h3>
                                <span className="text-xs font-bold text-slate-500">{((usage.limits.storage.used / usage.limits.storage.limit) * 100).toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-1000 ${getProgressColor(usage.limits.storage.used, usage.limits.storage.limit)}`}
                                    style={{ width: `${(usage.limits.storage.used / usage.limits.storage.limit) * 100}%` }}
                                />
                            </div>
                            <p className="mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Includes Media Assets & Lead Database</p>
                        </div>
                    </div>

                    {/* AI Creatives Card */}
                    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200/60 flex flex-col justify-between group hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-6">
                            <div className="p-4 bg-blue-50 text-blue-600 rounded-3xl group-hover:scale-110 transition-transform">
                                <Zap size={24} />
                            </div>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">AI Designs</span>
                        </div>
                        <div>
                            <div className="flex justify-between items-end mb-2">
                                <h3 className="text-2xl font-black text-slate-900">{usage.limits.ai_creatives.used} <span className="text-sm text-slate-400 font-bold">/ {usage.limits.ai_creatives.limit}</span></h3>
                                <span className="text-xs font-bold text-slate-500">{Math.round((usage.limits.ai_creatives.used / usage.limits.ai_creatives.limit) * 100)}%</span>
                            </div>
                            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-1000 ${getProgressColor(usage.limits.ai_creatives.used, usage.limits.ai_creatives.limit)}`}
                                    style={{ width: `${(usage.limits.ai_creatives.used / usage.limits.ai_creatives.limit) * 100}%` }}
                                />
                            </div>
                            <p className="mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">AI Content Generation Quota</p>
                        </div>
                    </div>

                    {/* Other limits as list */}
                    <div className="sm:col-span-2 space-y-4 mt-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] ml-4 mb-4">Other Plan Resources</h4>

                        {[
                            { key: 'campaign_launches', icon: Rocket, color: 'text-orange-600', bg: 'bg-orange-50' },
                            { key: 'ai_ad_optimizations', icon: ShieldCheck, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                            { key: 'remarketing_campaigns', icon: RefreshCw, color: 'text-purple-600', bg: 'bg-purple-50' },
                            { key: 'seo_articles', icon: Search, color: 'text-rose-600', bg: 'bg-rose-50' }
                        ].map((item) => {
                            const data = usage.limits[item.key]
                            const Icon = item.icon
                            return (
                                <div key={item.key} className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-sm flex items-center justify-between group hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 ${item.bg} ${item.color} rounded-2xl`}>
                                            <Icon size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-900">{data.label}</p>
                                            <p className="text-xs text-slate-500 font-medium">Monthly allocation</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-lg font-black text-slate-900">{data.used} <span className="text-xs text-slate-400 font-bold">/ {data.limit}</span></p>
                                        <div className="w-24 h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                                            <div
                                                className={`h-full ${getProgressColor(data.used, data.limit)}`}
                                                style={{ width: `${(data.used / data.limit) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )
                        })}

                        {/* UNLIMITED FEATURES SECTION */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                            {[
                                { label: 'CRM & Leads Sync', icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                                { label: 'Team Members', icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-50' },
                                { label: 'Ad Performance Tracking', icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50' },
                                { label: 'Whitelabeled Catalog', icon: ShieldCheck, color: 'text-indigo-600', bg: 'bg-indigo-50' }
                            ].map((feat, idx) => (
                                <div key={idx} className="bg-white/60 p-5 rounded-3xl border border-slate-100 flex items-center gap-4">
                                    <div className={`p-3 ${feat.bg} ${feat.color} rounded-2xl`}>
                                        <feat.icon size={18} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-900">{feat.label}</p>
                                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Unlimited</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Info Card instead of Upgrade CTA */}
                <div className="mt-12 bg-slate-900 rounded-[2.5rem] p-10 text-center relative overflow-hidden shadow-2xl shadow-slate-900/20">
                    <h3 className="text-2xl font-bold text-white mb-2">You're on the "Early Bird" Plan</h3>
                    <p className="text-slate-400 font-medium max-w-md mx-auto">You have full access to all Andromeda AI features as a founding member.</p>
                    <PieChart className="absolute -left-10 -bottom-10 text-white/5 w-48 h-48 -rotate-12" />
                </div>

            </div>
        </div>
    )
}
