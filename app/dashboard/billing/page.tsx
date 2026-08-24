'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { getCachedValue, setCachedValue } from '@/utils/client-cache';
import {
    ShieldCheck,
    Loader2,
    CalendarDays,
    Crown,
    Sparkles,
    CheckCircle,
    CheckCircle2,
    ShoppingBag,
    Coins,
    LogOut,
    Image as ImageIcon,
    Video,
    Users,
    PhoneCall,
    PhoneForwarded,
    Bot,
    MessageSquare,
    Database,
    Megaphone,
    Building2,
    Globe,
    Layout,
    Cloud,
    BarChart3,
    Headphones,
    RotateCw,
    Star
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
                
                // Normalize plan name to never show Early Bird
                let resolvedPlanName = data.planName || 'Free Plan';
                if (resolvedPlanName.toLowerCase().includes('early bird')) {
                    resolvedPlanName = 'Pro Plan';
                }

                setActivePlanName(resolvedPlanName);
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
                    activePlanName: resolvedPlanName,
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

    const handlePurchase = (planTitle: string, amount: number, period: string, savingsText?: string) => {
        toast.info(`Redirecting to secure WhatsApp payment desk for ${planTitle}...`);
        const savingsNote = savingsText ? ` (${savingsText})` : '';
        const message = encodeURIComponent(`Hi! I would like to subscribe to the Nobogent ${planTitle} (Rs. ${amount.toLocaleString('en-IN')} + 18% GST for ${period}${savingsNote}). Please help me activate this plan.`);
        window.open(`https://wa.me/919872669935?text=${message}`, '_blank');
    };

    const cleanActivePlanDisplay = activePlanName.toLowerCase().includes('early bird')
        ? 'Pro Plan'
        : activePlanName;

    const featuresList = [
        { name: "50 AI Images", subtext: null, icon: ImageIcon },
        { name: "10 AI Videos", subtext: null, icon: Video },
        { name: "5 Users", subtext: null, icon: Users },
        { name: "Virtual Phone Number", subtext: "(In case they use AI Calling)", icon: PhoneCall },
        { name: "AI Calling", subtext: "(Recharge for minutes separately)", icon: PhoneForwarded },
        { name: "WhatsApp AI Chatbot", subtext: null, icon: Bot },
        { name: "WhatsApp Business API", subtext: null, icon: MessageSquare },
        { name: "Advanced CRM", subtext: null, icon: Database },
        { name: "Meta Ads Management", subtext: null, icon: Megaphone },
        { name: "Inventory Management", subtext: null, icon: Building2 },
        { name: "Business Website", subtext: null, icon: Globe },
        { name: "AI Landing Page Generator", subtext: null, icon: Layout },
        { name: "Free Hosting", subtext: null, icon: Cloud },
        { name: "WhatsApp Bot Analytics", subtext: null, icon: BarChart3 },
    ];

    const planTiers = [
        {
            id: '1-month',
            title: "1 MONTH PLAN",
            duration: "1 Month",
            price: 9999,
            displayPrice: "₹9,999",
            gst: "+ 18% GST",
            badge: null,
            savings: null,
            headerBg: "bg-[#0A1128]",
            headerTextColor: "text-white",
            btnStyle: "bg-slate-900 text-white hover:bg-slate-800",
            cardBorder: "border-slate-200"
        },
        {
            id: '6-months',
            title: "6 MONTHS PLAN",
            duration: "6 Months",
            price: 54999,
            displayPrice: "₹54,999",
            gst: "+ 18% GST",
            badge: "MOST POPULAR",
            savings: {
                label: "You Save",
                amount: "₹5,001",
                discount: "(8% OFF)"
            },
            headerBg: "bg-gradient-to-r from-[#312E81] via-[#4338CA] to-[#6366F1]",
            headerTextColor: "text-white",
            savingsBoxBg: "bg-[#F3E8FF] border border-[#E9D5FF] text-[#6B21A8]",
            btnStyle: "bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] text-white hover:opacity-95 shadow-lg shadow-indigo-500/20",
            cardBorder: "border-purple-300 ring-2 ring-purple-500/10 shadow-xl"
        },
        {
            id: '12-months',
            title: "12 MONTHS PLAN",
            duration: "12 Months",
            price: 99999,
            displayPrice: "₹99,999",
            gst: "+ 18% GST",
            badge: "BEST VALUE",
            savings: {
                label: "You Save",
                amount: "₹20,001",
                discount: "(17% OFF)"
            },
            headerBg: "bg-[#0A1128]",
            headerTextColor: "text-white",
            savingsBoxBg: "bg-[#DCFCE7] border border-[#BBF7D0] text-[#166534]",
            btnStyle: "bg-slate-900 text-white hover:bg-slate-800",
            cardBorder: "border-slate-200"
        }
    ];

    const guaranteeBadges = [
        {
            title: "No Setup Fees",
            desc: "Get started instantly",
            icon: ShieldCheck
        },
        {
            title: "100% Secure Hosting",
            desc: "Reliable. Fast. Secure.",
            icon: Cloud
        },
        {
            title: "Priority Support",
            desc: "We're here to help you grow",
            icon: Headphones
        },
        {
            title: "Cancel Anytime",
            desc: "No long-term lock-in",
            icon: RotateCw
        }
    ];

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
                <Loader2 className="animate-spin text-blue-600" size={32} />
                <p className="text-sm text-slate-500 font-medium">Loading subscription details...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F8FAFC] pb-28 font-sans overflow-x-hidden">

            {/* Top Navigation */}
            <div className="bg-white/90 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <Crown size={22} className="text-indigo-600" />
                        <h1 className="text-lg font-black text-slate-900 tracking-tight">SaaS Membership Subscription</h1>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.push('/dashboard/profile')}
                            className="text-slate-600 hover:text-slate-900 font-extrabold text-xs px-3.5 py-2 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
                        >
                            Profile / Settings
                        </button>
                        <button
                            onClick={async () => {
                                await supabase.auth.signOut();
                                router.push('/login');
                            }}
                            className="bg-red-50 hover:bg-red-100 text-red-600 font-extrabold text-xs px-3.5 py-2 rounded-xl border border-red-200 transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                        >
                            <LogOut size={14} />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-10">

                {/* Account Status Card */}
                <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm mb-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                                Current Status
                            </span>
                            {activePlan !== 'free' && <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />}
                        </div>
                        <h3 className="text-2xl font-black text-slate-900 mt-2">
                            {cleanActivePlanDisplay}
                        </h3>
                    </div>
                    
                    <div className="flex flex-wrap gap-4">
                        <div className="flex items-center gap-3 bg-slate-50 px-5 py-3.5 rounded-2xl border border-slate-100 shadow-inner">
                            <Coins className="text-indigo-600" size={22} />
                            <div>
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Credits Balance</span>
                                <span className="text-base font-black text-slate-800">{isUnlimited ? '∞' : `${creditsBalance.toLocaleString()} Credits`}</span>
                            </div>
                        </div>

                        {renewalDate && activePlan !== 'free' && (
                            <div className="flex items-center gap-3 bg-slate-50 px-5 py-3.5 rounded-2xl border border-slate-100 shadow-inner">
                                <CalendarDays className="text-blue-500" size={22} />
                                <div>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Next Renewal</span>
                                    <span className="text-base font-black text-slate-800">{renewalDate}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Prepaid Usage Rate Card */}
                <div className="bg-white rounded-[2.5rem] border border-slate-200 p-6 sm:p-8 shadow-sm mb-14 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-50/50 rounded-full blur-3xl pointer-events-none" />
                    <div className="flex items-center gap-2.5 mb-6 border-b border-slate-100 pb-4">
                        <Sparkles className="text-indigo-600" size={20} />
                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Prepaid Usage Rate Card</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/70 transition-all hover:bg-slate-100/60">
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Voice Calls</span>
                            <span className="text-xl font-black text-slate-900 mt-1 block">5 Credits/min</span>
                            <span className="text-[10px] text-slate-500 block mt-1 font-medium">Prepaid outbound dials</span>
                        </div>
                        <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/70 transition-all hover:bg-slate-100/60">
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">AI Images</span>
                            <span className="text-xl font-black text-slate-900 mt-1 block">10 Credits/image</span>
                            <span className="text-[10px] text-slate-500 block mt-1 font-medium">High-res creative builds</span>
                        </div>
                        <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/70 transition-all hover:bg-slate-100/60">
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">AI Videos</span>
                            <span className="text-xl font-black text-slate-900 mt-1 block">50 Credits/15 sec</span>
                            <span className="text-[10px] text-slate-500 block mt-1 font-medium">AI presenter clips</span>
                        </div>
                        <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/70 transition-all hover:bg-slate-100/60">
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Other Tasks</span>
                            <span className="text-xl font-black text-slate-900 mt-1 block">As Per Actual</span>
                            <span className="text-[10px] text-slate-500 block mt-1 font-medium">Standard usage operations & automations</span>
                        </div>
                    </div>
                </div>

                {/* Main Plans Section (Matching Screenshot 2) */}
                <div className="bg-white rounded-[2.5rem] border border-slate-200/90 p-6 sm:p-10 shadow-xl relative overflow-hidden">
                    
                    {/* Header Block with Brand */}
                    <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-slate-100">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-white font-black text-base shadow-sm">
                                    N
                                </span>
                                <span className="text-xl font-black tracking-wider text-slate-900 uppercase">NOBOGENT</span>
                            </div>
                            <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight mt-3">
                                All-in-One <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-indigo-600">AI Marketing & Sales</span> Platform
                            </h2>
                            <p className="text-slate-500 text-sm font-semibold mt-2">
                                Everything you need to grow, manage and scale your business.
                            </p>
                        </div>
                    </div>

                    {/* Desktop Comparison Table (lg+) */}
                    <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr>
                                    {/* Left feature header column */}
                                    <th className="w-1/4 pb-6 text-left align-bottom">
                                        <div className="text-xs font-black uppercase tracking-wider text-slate-400">
                                            Included Features
                                        </div>
                                    </th>

                                    {/* Plan Columns */}
                                    {planTiers.map((plan) => (
                                        <th key={plan.id} className="w-1/4 pb-6 px-3 align-top">
                                            <div className={`relative rounded-3xl overflow-hidden border ${plan.cardBorder} transition-all duration-300`}>
                                                
                                                {/* Yellow Tag / Ribbon */}
                                                {plan.badge && (
                                                    <div className="absolute top-0 right-0 bg-[#FACC15] text-[#713F12] text-[9px] font-black uppercase px-3.5 py-1 rounded-bl-xl shadow-sm z-20">
                                                        {plan.badge}
                                                    </div>
                                                )}

                                                {/* Card Header */}
                                                <div className={`${plan.headerBg} ${plan.headerTextColor} p-5 text-center flex flex-col items-center justify-center min-h-[90px]`}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <CalendarDays size={18} className="text-white/80" />
                                                        <span className="text-sm font-black uppercase tracking-wider text-white">
                                                            {plan.title}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Pricing Block */}
                                                <div className="bg-white p-6 text-center border-t border-slate-100 flex flex-col items-center">
                                                    <div className="text-4xl font-black text-slate-900 tracking-tight">
                                                        {plan.displayPrice}
                                                    </div>
                                                    <div className="text-xs font-bold text-slate-400 mt-1">
                                                        {plan.gst}
                                                    </div>

                                                    {/* Savings Box if any */}
                                                    <div className="h-16 flex items-center justify-center w-full mt-3">
                                                        {plan.savings ? (
                                                            <div className={`w-full py-2 px-3 rounded-2xl ${plan.savingsBoxBg} text-center`}>
                                                                <span className="text-[10px] font-bold block uppercase tracking-wider">{plan.savings.label}</span>
                                                                <div className="flex items-center justify-center gap-1.5">
                                                                    <span className="text-lg font-black">{plan.savings.amount}</span>
                                                                    <span className="text-[11px] font-extrabold">{plan.savings.discount}</span>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="h-full" />
                                                        )}
                                                    </div>

                                                    <button
                                                        onClick={() => handlePurchase(plan.title, plan.price, plan.duration, plan.savings ? `Save ${plan.savings.amount}` : undefined)}
                                                        className={`w-full mt-4 py-3 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${plan.btnStyle}`}
                                                    >
                                                        <ShoppingBag size={14} /> Subscribe Now
                                                    </button>
                                                </div>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody>
                                {featuresList.map((feat, idx) => (
                                    <tr 
                                        key={idx} 
                                        className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/20'}`}
                                    >
                                        {/* Feature label with icon */}
                                        <td className="py-4 pr-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 border border-purple-100">
                                                    <feat.icon size={16} />
                                                </div>
                                                <div>
                                                    <span className="text-xs font-black text-slate-800 block">
                                                        {feat.name}
                                                    </span>
                                                    {feat.subtext && (
                                                        <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                                                            {feat.subtext}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>

                                        {/* Checkmark for Plan 1 */}
                                        <td className="py-4 text-center">
                                            <div className="flex justify-center items-center">
                                                <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                                    <CheckCircle2 size={16} strokeWidth={2.5} />
                                                </div>
                                            </div>
                                        </td>

                                        {/* Checkmark for Plan 2 */}
                                        <td className="py-4 text-center">
                                            <div className="flex justify-center items-center">
                                                <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                                    <CheckCircle2 size={16} strokeWidth={2.5} />
                                                </div>
                                            </div>
                                        </td>

                                        {/* Checkmark for Plan 3 */}
                                        <td className="py-4 text-center">
                                            <div className="flex justify-center items-center">
                                                <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                                    <CheckCircle2 size={16} strokeWidth={2.5} />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile & Tablet Card Layout (below lg) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:hidden items-stretch">
                        {planTiers.map((plan) => (
                            <div 
                                key={plan.id}
                                className={`bg-white rounded-3xl border overflow-hidden flex flex-col justify-between shadow-lg relative ${plan.cardBorder}`}
                            >
                                {/* Yellow Ribbon Tag */}
                                {plan.badge && (
                                    <div className="absolute top-0 right-0 bg-[#FACC15] text-[#713F12] text-[10px] font-black uppercase px-4 py-1.5 rounded-bl-2xl shadow-sm z-20">
                                        {plan.badge}
                                    </div>
                                )}

                                <div>
                                    {/* Card Top */}
                                    <div className={`${plan.headerBg} ${plan.headerTextColor} p-6 text-center flex flex-col items-center justify-center`}>
                                        <div className="flex items-center gap-2 mb-1">
                                            <CalendarDays size={20} className="text-white/80" />
                                            <span className="text-base font-black uppercase tracking-wider text-white">
                                                {plan.title}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Price & Savings */}
                                    <div className="p-6 text-center border-b border-slate-100">
                                        <div className="text-4xl font-black text-slate-900 tracking-tight">
                                            {plan.displayPrice}
                                        </div>
                                        <div className="text-xs font-bold text-slate-400 mt-1">
                                            {plan.gst}
                                        </div>

                                        {plan.savings && (
                                            <div className={`mt-4 py-2.5 px-4 rounded-2xl ${plan.savingsBoxBg} text-center`}>
                                                <span className="text-[10px] font-bold block uppercase tracking-wider">{plan.savings.label}</span>
                                                <div className="flex items-center justify-center gap-1.5">
                                                    <span className="text-xl font-black">{plan.savings.amount}</span>
                                                    <span className="text-xs font-extrabold">{plan.savings.discount}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Features Checklist */}
                                    <div className="p-6">
                                        <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-4">
                                            Included in this plan:
                                        </div>
                                        <ul className="space-y-3.5">
                                            {featuresList.map((feat, i) => (
                                                <li key={i} className="flex items-center gap-3">
                                                    <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                                                        <CheckCircle2 size={13} strokeWidth={2.5} />
                                                    </div>
                                                    <div>
                                                        <span className="text-xs font-bold text-slate-700 block">
                                                            {feat.name}
                                                        </span>
                                                        {feat.subtext && (
                                                            <span className="text-[10px] text-slate-400 font-semibold block">
                                                                {feat.subtext}
                                                            </span>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>

                                {/* Subscribe Action */}
                                <div className="p-6 bg-slate-50/60 border-t border-slate-100">
                                    <button
                                        onClick={() => handlePurchase(plan.title, plan.price, plan.duration, plan.savings ? `Save ${plan.savings.amount}` : undefined)}
                                        className={`w-full py-4 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 ${plan.btnStyle}`}
                                    >
                                        <ShoppingBag size={16} /> Subscribe Now
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Guarantee & Trust Badges (Screenshot 2 Bottom) */}
                    <div className="mt-14 pt-10 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-6">
                        {guaranteeBadges.map((badge, idx) => (
                            <div key={idx} className="flex items-center gap-3.5">
                                <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center shrink-0 shadow-sm">
                                    <badge.icon size={22} />
                                </div>
                                <div>
                                    <div className="text-xs sm:text-sm font-black text-slate-900">
                                        {badge.title}
                                    </div>
                                    <div className="text-[10px] sm:text-xs text-slate-400 font-semibold mt-0.5">
                                        {badge.desc}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Bottom Dark Navy Bar (Screenshot 2) */}
                    <div className="mt-10 bg-[#0A1026] text-white rounded-2xl px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left shadow-lg">
                        <div className="flex items-center gap-2 text-xs font-black">
                            <span className="bg-amber-400/20 text-amber-300 p-1.5 rounded-lg flex items-center justify-center">
                                <Star size={14} className="fill-amber-400 text-amber-400" />
                            </span>
                            <span>One Platform. Endless Possibilities.</span>
                        </div>
                        <div className="text-xs text-slate-300 font-medium">
                            Save more with longer plans and power your business with AI.
                        </div>
                        <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                            All prices exclusive of 18% GST
                        </div>
                    </div>

                </div>

                <div className="text-center text-xs text-slate-400 font-bold mt-10">
                    Need support or custom package? Contact us directly via WhatsApp at +91 98726 69935.
                </div>

            </div>
        </div>
    );
}