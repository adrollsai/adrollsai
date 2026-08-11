'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { getCachedValue, setCachedValue } from '@/utils/client-cache';
import {
    X,
    Check,
    ShieldCheck,
    Loader2,
    CalendarDays,
    Crown,
    Sparkles,
    CheckCircle,
    ShoppingBag,
    Coins,
    Percent,
    LogOut
} from 'lucide-react';
import { toast } from 'sonner';

export default function BillingPage() {
    const router = useRouter();
    const supabase = createClient();

    const [loading, setLoading] = useState(() => {
        if (typeof window !== 'undefined') {
            const cached = getCachedValue<any>('billing_cache');
            if (cached) return false;
        }
        return true;
    });
    const [activePlan, setActivePlan] = useState<string>(() => {
        const cached = typeof window !== 'undefined' ? getCachedValue<any>('billing_cache') : null;
        return cached?.activePlan || 'free';
    });
    const [activePlanName, setActivePlanName] = useState<string>(() => {
        const cached = typeof window !== 'undefined' ? getCachedValue<any>('billing_cache') : null;
        return cached?.activePlanName || 'Free Plan';
    });
    const [renewalDate, setRenewalDate] = useState<string | null>(() => {
        const cached = typeof window !== 'undefined' ? getCachedValue<any>('billing_cache') : null;
        return cached?.renewalDate || null;
    });
    const [creditsBalance, setCreditsBalance] = useState<number>(() => {
        const cached = typeof window !== 'undefined' ? getCachedValue<any>('billing_cache') : null;
        return cached?.creditsBalance || 0;
    });
    const [isUnlimited, setIsUnlimited] = useState<boolean>(() => {
        const cached = typeof window !== 'undefined' ? getCachedValue<any>('billing_cache') : null;
        return cached?.isUnlimited || false;
    });

    const fetchBillingData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push('/');
                return;
            }

            const res = await fetch('/api/subscription/usage');
            if (res.ok) {
                const data = await res.json();
                setActivePlanName(data.planName);
                setCreditsBalance(data.credits || 0);
                setIsUnlimited(!!data.isUnlimited);

                let formattedDate: string | null = null;
                if (data.resetDate) {
                    formattedDate = new Date(data.resetDate).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                    setRenewalDate(formattedDate);
                }

                const { data: profile } = await supabase
                    .from('profiles')
                    .select('subscription_plan, subscription_status')
                    .eq('id', user.id)
                    .single();

                const plan = profile?.subscription_plan || 'free';
                if (profile) {
                    setActivePlan(plan);
                }

                // Persist billing data to localStorage
                setCachedValue('billing_cache', {
                    activePlan: plan,
                    activePlanName: data.planName,
                    renewalDate: formattedDate,
                    creditsBalance: data.credits || 0,
                    isUnlimited: !!data.isUnlimited
                });
            }
        } catch (error) {
            console.error("Error loading billing details:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBillingData();
    }, [router, supabase]);

    const handlePurchase = (planName: string, amount: number, period: string) => {
        toast.info(`Redirecting to secure WhatsApp payment desk for ${planName}...`);
        const message = encodeURIComponent(`Hi! I would like to subscribe to the Nobo Pro Plan (${planName} - Rs. ${amount.toLocaleString('en-IN')} for ${period}). Please help me activate this plan.`);
        window.open(`https://wa.me/919872669935?text=${message}`, '_blank');
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
                <Loader2 className="animate-spin text-blue-600" size={32} />
                <p className="text-sm text-slate-500 font-medium">Loading subscription details...</p>
            </div>
        );
    }

    const planTiers = [
        {
            id: 'monthly',
            name: "Pro Plan - Monthly",
            price: 9999,
            displayPrice: "₹9,999",
            period: "month",
            credits: 10000,
            desc: "Ideal for month-to-month flexibility and complete access.",
            savings: null,
            badge: "Flexible"
        },
        {
            id: 'quarterly',
            name: "Pro Plan - Quarterly",
            price: 24999,
            displayPrice: "₹24,999",
            period: "3 months",
            credits: 25000,
            desc: "Popular option balancing value with active dials and chat.",
            savings: "Save 17%",
            badge: "Best Value",
            highlight: true
        },
        {
            id: 'yearly',
            name: "Pro Plan - Yearly",
            price: 99999,
            displayPrice: "₹99,999",
            period: "year",
            credits: 100000,
            desc: "The absolute best value plan for committed real estate businesses.",
            savings: "Save 17% (Save ₹19,989/yr)",
            badge: "Ultimate Savings"
        }
    ];

    return (
        <div className="min-h-screen bg-[#F8FAFC] pb-32 font-sans overflow-x-hidden">

            {/* Premium Top Navigation */}
            <div className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200 shadow-sm">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <Crown size={22} className="text-blue-600" />
                        <h1 className="text-lg font-black text-slate-900 tracking-tight">SaaS Membership Subscription</h1>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.push('/dashboard/profile')}
                            className="text-slate-600 hover:text-slate-900 font-extrabold text-xs px-3 py-1.5 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
                        >
                            Profile / Settings
                        </button>
                        <button
                            onClick={async () => {
                                await supabase.auth.signOut()
                                router.push('/login')
                            }}
                            className="bg-red-50 hover:bg-red-100 text-red-600 font-extrabold text-xs px-3 py-1.5 rounded-xl border border-red-200 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                        >
                            <LogOut size={14} />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16">

                {/* Page Intro */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-wider mb-4 border border-blue-100">
                        <Sparkles size={12} fill="currentColor" /> Unified Scale
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-3">
                        Choose your subscription plan
                    </h2>
                    <p className="text-slate-500 text-sm max-w-lg mx-auto font-medium leading-relaxed">
                        To unlock calling, smart auto-reply agents, and landing page builds, subscribe to an active base plan package. Extra usage is billed live from Nobo Credits.
                    </p>
                </div>

                {/* Account Status Card */}
                <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm mb-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full border border-blue-100">Current Status</span>
                            {activePlan !== 'free' && <CheckCircle size={16} className="text-green-500" fill="currentColor" />}
                        </div>
                        <h3 className="text-2xl font-black text-slate-800 mt-2">
                            {activePlanName}
                        </h3>
                    </div>
                    
                    <div className="flex gap-4">
                        <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100">
                            <Coins className="text-indigo-600" size={20} />
                            <div>
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Credits Balance</span>
                                <span className="text-sm font-black text-slate-800">{isUnlimited ? '∞' : `${creditsBalance.toLocaleString()} Credits`}</span>
                            </div>
                        </div>

                        {renewalDate && activePlan !== 'free' && (
                            <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100">
                                <CalendarDays className="text-blue-500" size={20} />
                                <div>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Next Renewal</span>
                                    <span className="text-sm font-black text-slate-800">{renewalDate}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Rate Card Grid */}
                <div className="bg-white rounded-[2.5rem] border border-slate-200 p-6 sm:p-8 shadow-sm mb-12 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/40 rounded-full blur-2xl pointer-events-none" />
                    <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4">
                        <Sparkles className="text-blue-600 animate-pulse" size={20} />
                        <h3 className="text-sm font-black uppercase tracking-wider text-slate-800">Prepaid Usage Rate Card</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                        <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100/85 transition-all hover:bg-slate-100/30">
                            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">Voice Calls</span>
                            <span className="text-base font-black text-slate-800 mt-1 block">₹10/min</span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-medium">Prepaid outbound dials</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100/85 transition-all hover:bg-slate-100/30">
                            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">AI Images</span>
                            <span className="text-base font-black text-slate-800 mt-1 block">₹30/gen</span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-medium">Image creative builds</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100/85 transition-all hover:bg-slate-100/30">
                            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">AI Videos</span>
                            <span className="text-base font-black text-slate-800 mt-1 block">₹250/15s</span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-medium">AI presenter clips</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100/85 transition-all hover:bg-slate-100/30">
                            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block">Video Renders</span>
                            <span className="text-base font-black text-slate-800 mt-1 block">₹20/render</span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-medium">Media edit outputs</span>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-[1.5rem] border border-slate-100/85 transition-all hover:bg-slate-100/30 col-span-2 sm:col-span-1">
                            <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider block font-black">Other Tasks</span>
                            <span className="text-base font-black text-slate-800 mt-1 block">As Per Actual</span>
                            <span className="text-[9px] text-slate-400 block mt-0.5 font-medium">Chatbot/Campaigns at 2x cost</span>
                        </div>
                    </div>
                </div>

                {/* Subscriptions Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch mb-12">
                    {planTiers.map((tier) => {
                        return (
                            <div
                                key={tier.id}
                                className={`bg-white rounded-[2.5rem] border overflow-hidden flex flex-col justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative ${tier.highlight
                                        ? 'border-blue-600 ring-2 ring-blue-600/10 shadow-lg md:scale-105 z-10'
                                        : 'border-slate-200'
                                    }`}
                            >
                                <div className="p-8">
                                    <div className="flex justify-between items-start mb-4">
                                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${tier.highlight ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                                            {tier.badge}
                                        </span>
                                        {tier.savings && (
                                            <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-0.5">
                                                <Percent size={10} /> {tier.savings}
                                            </span>
                                        )}
                                    </div>

                                    <h3 className="text-lg font-black text-slate-900 mt-2">{tier.name}</h3>

                                    <div className="my-6">
                                        <div className="flex items-baseline leading-none">
                                            <span className="text-4xl font-black text-slate-900 tracking-tight">{tier.displayPrice}</span>
                                            <span className="text-xs text-slate-400 font-bold ml-1">/ {tier.period}</span>
                                        </div>
                                        <p className="text-[9px] text-slate-400 font-bold mt-1.5">Inclusive of GST</p>
                                    </div>

                                    <p className="text-slate-500 text-xs font-semibold leading-relaxed mb-6">
                                        {tier.desc}
                                    </p>

                                    <ul className="space-y-3.5 border-t border-slate-100 pt-6">
                                        <li className="flex items-center gap-2">
                                            <div className="shrink-0 w-4 h-4 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                                                <Check size={10} strokeWidth={4} />
                                            </div>
                                            <span className="text-xs text-slate-700 font-black">{tier.credits.toLocaleString()} Nobo Credits included</span>
                                        </li>
                                        {[
                                            "ai website creation",
                                            "ai image gen",
                                            "ai video gen",
                                            "graphic generations",
                                            "video generations",
                                            "bulk gen",
                                            "ad launches",
                                            "remarketing campaigns",
                                            "click to whatsapp ads",
                                            "ai whatsapp bot",
                                            "ai whatsapp followups",
                                            "ai voice calling and followups",
                                            "calendar booking system",
                                            "ai video editing",
                                            "one click social media posting",
                                            "advanced crm",
                                            "whatsapp chat interface",
                                            "inventory management",
                                            "fully autonomous"
                                        ].map((feat, i) => (
                                            <li key={i} className="flex items-center gap-2">
                                                <div className="shrink-0 w-4 h-4 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                                                    <Check size={10} strokeWidth={4} />
                                                </div>
                                                <span className="text-xs text-slate-600 font-bold">{feat}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="p-8 border-t border-slate-50 bg-slate-50/50">
                                    <button
                                        onClick={() => handlePurchase(tier.name, tier.price, tier.period)}
                                        className={`w-full py-3.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${tier.highlight
                                                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/10'
                                                : 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50'
                                            }`}
                                    >
                                        <ShoppingBag size={14} /> Subscribe Now
                                    </button>
                                </div>

                            </div>
                        );
                    })}
                </div>

                <div className="text-center text-xs text-slate-400 font-bold mt-10">
                    Need support? Contact us directly via WhatsApp at +91 98726 69935.
                </div>

            </div>
        </div>
    );
}