'use client'

import { useState, useEffect } from 'react'
import { 
    Coins, 
    Phone, 
    MessageSquare, 
    Zap, 
    Rocket, 
    RefreshCw, 
    PlusCircle, 
    Calendar, 
    ShieldCheck
} from 'lucide-react'
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

    const handleRecharge = (planName: string, amount: number) => {
        toast.info(`Redirecting to our secure WhatsApp payment desk for ${planName}...`)
        const message = encodeURIComponent(`Hi! I would like to recharge my Nobo Credits account with the ${planName} (Rs. ${amount.toLocaleString('en-IN')}).`)
        window.open(`https://wa.me/919872669935?text=${message}`, '_blank')
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-slate-500 font-semibold animate-pulse">Loading Credits Ledger...</p>
                </div>
            </div>
        )
    }

    if (!usage) return null

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'calling':
                return <Phone size={18} className="text-blue-600" />
            case 'whatsapp':
                return <MessageSquare size={18} className="text-emerald-600" />
            case 'ai_generation':
                return <Zap size={18} className="text-purple-600" />
            case 'campaign_launch':
                return <Rocket size={18} className="text-orange-600" />
            case 'topup':
            case 'subscription':
                return <PlusCircle size={18} className="text-emerald-600" />
            default:
                return <Coins size={18} className="text-slate-600" />
        }
    }

    const getCategoryBg = (category: string) => {
        switch (category) {
            case 'calling':
                return 'bg-blue-50 border-blue-100'
            case 'whatsapp':
                return 'bg-emerald-50 border-emerald-100'
            case 'ai_generation':
                return 'bg-purple-50 border-purple-100'
            case 'campaign_launch':
                return 'bg-orange-50 border-orange-100'
            case 'topup':
            case 'subscription':
                return 'bg-emerald-50 border-emerald-100'
            default:
                return 'bg-slate-50 border-slate-100'
        }
    }

    const formatCategoryName = (category: string) => {
        if (category === 'ai_generation') return 'AI Agent Generation'
        if (category === 'campaign_launch') return 'Meta Campaign'
        return category.charAt(0).toUpperCase() + category.slice(1)
    }

    return (
        <div className="min-h-screen bg-[#F8FAFC] pb-32 pt-16">
            <div className="max-w-6xl mx-auto px-6 pt-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-10">
                    <div>
                        <h1 className="text-4xl font-black text-slate-900 tracking-tight">Nobo Credits</h1>
                        <p className="text-slate-500 mt-2 font-medium">Manage your prepaid credits balance, buy packages, and view billing ledger.</p>
                    </div>
                    
                    <button
                        onClick={fetchUsage}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                        <RefreshCw size={14} /> Refresh Balance
                    </button>
                </div>

                <div className="space-y-12">
                    {/* Top Section: Balance Card & Recharge Quick Actions */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        
                        {/* Glassmorphic Balance Card */}
                        <div className="lg:col-span-1 bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-xl shadow-indigo-600/10 flex flex-col justify-between min-h-[300px] group">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_50%)]" />
                            <div className="relative z-10 flex justify-between items-start">
                                <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md border border-white/10">
                                    <Coins size={24} className="text-yellow-300" />
                                </div>
                                <span className="text-[10px] font-extrabold uppercase tracking-widest bg-emerald-500/90 text-white px-3 py-1 rounded-full shadow-sm">
                                    Active Balance
                                </span>
                            </div>
                            <div className="relative z-10 my-6">
                                <span className="text-white/70 text-xs font-semibold block mb-1">Prepaid Balance</span>
                                <h2 className="text-5xl font-black tracking-tight mb-2">
                                    {usage.isUnlimited ? '∞' : (usage.credits || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                </h2>
                                <span className="text-indigo-200/90 text-sm font-bold block">
                                    {usage.isUnlimited ? 'Unlimited Account Plan' : `≈ ₹ ${(usage.credits / 10).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} INR`}
                                </span>
                            </div>
                            <div className="relative z-10 pt-4 border-t border-white/10 text-xs text-indigo-200/80 font-medium">
                                Prepaid rates calculated live. Deducted after action execution.
                            </div>
                            <div className="absolute right-0 bottom-0 translate-x-12 translate-y-12 w-48 h-48 rounded-full bg-white/5 blur-3xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />
                        </div>

                        {/* Recharge packages section */}
                        <div className="lg:col-span-2 space-y-6">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Top-Up Credit Packages</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {[
                                    { name: 'Starter Pack', amount: 2000, credits: 20000, desc: 'For growing campaigns', color: 'border-slate-200' },
                                    { name: 'Growth Pack', amount: 5000, credits: 50000, desc: 'Calling & manual chat combo', color: 'border-indigo-600 ring-2 ring-indigo-600/10 scale-102', recommended: true },
                                    { name: 'Enterprise Pack', amount: 10000, credits: 100000, desc: 'High volume voice calling', color: 'border-slate-200' }
                                ].map((pkg, idx) => (
                                    <div 
                                        key={idx} 
                                        className={`bg-white p-6 rounded-[2rem] border relative overflow-hidden flex flex-col justify-between shadow-sm transition-all hover:shadow-md hover:scale-[1.03] duration-300 ${pkg.color}`}
                                    >
                                        {pkg.recommended && (
                                            <span className="absolute top-3 right-3 text-[9px] font-black uppercase tracking-wider bg-indigo-600 text-white px-2 py-0.5 rounded-md shadow-sm">
                                                Best Value
                                            </span>
                                        )}
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-800 mb-1">{pkg.name}</h4>
                                            <p className="text-[10px] text-slate-400 font-medium mb-4">{pkg.desc}</p>
                                            <div className="mb-4">
                                                <span className="text-2xl font-black text-slate-900">
                                                    {pkg.credits.toLocaleString()}
                                                </span>
                                                <span className="text-xs font-bold text-slate-400 block mt-0.5">Credits</span>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-slate-500 mb-4">
                                                Rs. {pkg.amount.toLocaleString()}
                                            </div>
                                            <button
                                                onClick={() => handleRecharge(pkg.name, pkg.amount)}
                                                className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer ${pkg.recommended ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700'}`}
                                            >
                                                <PlusCircle size={14} />
                                                Recharge Now
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Credits rates information banner */}
                    <div className="bg-slate-900 text-white p-6 rounded-[2rem] border border-slate-800 shadow-xl relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div className="z-10 max-w-2xl">
                            <h4 className="text-sm font-extrabold tracking-wide uppercase text-indigo-400 flex items-center gap-1.5 mb-1">
                                <ShieldCheck size={16} /> Live Billing Structure Active
                            </h4>
                            <p className="text-xs text-slate-300 font-medium leading-relaxed">
                                Prepaid billing calculates cost values dynamically. AI text and image generation are charged based on token inputs. Outbound Voice Calls are billed per minute based on actual Twilio carrier cost plus speech/LLM engine runtimes. WhatsApp messages incur a micro-infra process rate.
                            </p>
                        </div>
                        <div className="z-10 flex gap-4 text-xs font-bold shrink-0">
                            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2 text-center backdrop-blur-sm">
                                <span className="text-slate-400 block text-[9px] uppercase tracking-wider mb-0.5">WhatsApp Outbound</span>
                                <span>2 Credits</span>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2 text-center backdrop-blur-sm">
                                <span className="text-slate-400 block text-[9px] uppercase tracking-wider mb-0.5">Voice Minutes</span>
                                <span>Actual Cost × 20</span>
                            </div>
                        </div>
                    </div>

                    {/* Ledger / Transaction history */}
                    <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200/60 p-8">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-lg font-black text-slate-800">Credits Transactions Ledger</h3>
                                <p className="text-xs text-slate-400 mt-1 font-medium">Real-time ledger events representing your account usage</p>
                            </div>
                        </div>

                        {(!usage.transactions || usage.transactions.length === 0) ? (
                            <div className="text-center py-16 flex flex-col items-center gap-4">
                                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100">
                                    <Coins className="text-slate-300" size={20} />
                                </div>
                                <div className="max-w-xs">
                                    <p className="text-sm font-bold text-slate-700">No Transactions Found</p>
                                    <p className="text-xs text-slate-400 font-medium mt-1">Recharge your balance or use calling, chat, or campaign builder to write events to the ledger.</p>
                                </div>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-[10px] uppercase tracking-widest text-slate-400 font-extrabold">
                                            <th className="pb-4 pl-2">Event Description</th>
                                            <th className="pb-4">Category</th>
                                            <th className="pb-4">Date</th>
                                            <th className="pb-4 text-right pr-2">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 text-xs">
                                        {usage.transactions.map((tx: any) => {
                                            const isDeduction = tx.amount < 0
                                            return (
                                                <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors group">
                                                    <td className="py-4 pl-2 font-semibold text-slate-700 max-w-sm truncate group-hover:text-slate-900">
                                                        {tx.description}
                                                    </td>
                                                    <td className="py-4">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`p-2 rounded-xl border ${getCategoryBg(tx.category)}`}>
                                                                {getCategoryIcon(tx.category)}
                                                            </div>
                                                            <span className="font-semibold text-slate-600 text-[11px]">
                                                                {formatCategoryName(tx.category)}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 font-medium text-slate-400">
                                                        <div className="flex items-center gap-1.5">
                                                            <Calendar size={12} />
                                                            {new Date(tx.created_at).toLocaleString('en-IN', {
                                                                day: 'numeric',
                                                                month: 'short',
                                                                hour: '2-digit',
                                                                minute: '2-digit'
                                                            })}
                                                        </div>
                                                    </td>
                                                    <td className="py-4 text-right pr-2">
                                                        <span className={`font-black text-sm ${isDeduction ? 'text-rose-500' : 'text-emerald-500'}`}>
                                                            {isDeduction ? '' : '+'}{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-slate-400 ml-1">Credits</span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
