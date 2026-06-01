'use client'

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { 
    AlertTriangle, 
    X, 
    Zap, 
    TrendingUp, 
    ShoppingBag, 
    ChevronRight, 
    Sparkles, 
    Crown,
    Loader2
} from 'lucide-react';
import { toast } from 'sonner';

// Define plans sequence for dynamic recommendations
const PLAN_SEQUENCE = ['free', 'growth', 'pro', 'professional', 'enterprise'];
const PLAN_UPGRADE_MAP: Record<string, string> = {
    free: 'growth',
    growth: 'pro',
    pro: 'enterprise',
    professional: 'enterprise',
    enterprise: 'custom'
};

const ADDON_MAPPING: Record<string, { id: string; name: string; price: number; effect: string }> = {
    videos: {
        id: 'video',
        name: 'Additional AI Video',
        price: 999,
        effect: '+1 AI Video quota'
    },
    images: {
        id: 'image_small',
        name: 'Small Image Pack',
        price: 59,
        effect: '+10 AI Images'
    },
    campaign_launches: {
        id: 'campaign_launch',
        name: 'Additional Campaign Launch',
        price: 399,
        effect: '+1 Campaign Launch quota'
    },
    campaign_optimizations: {
        id: 'campaign_optimization',
        name: 'Additional Campaign Optimization',
        price: 249,
        effect: '+1 Campaign Optimization quota'
    },
    retargeting_campaigns: {
        id: 'retargeting_campaign',
        name: 'Additional Retargeting Campaign',
        price: 499,
        effect: '+1 Retargeting Campaign quota'
    },
    team_members: {
        id: 'team_member',
        name: 'Additional Team Member',
        price: 299,
        effect: '+1 Team Member seat'
    }
};

export default function QuotaManager() {
    return null;
    const router = useRouter();
    const pathname = usePathname();
    const [usage, setUsage] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    
    // Warning banner states
    const [warningQuota, setWarningQuota] = useState<any>(null);
    const [dismissBanner, setDismissBanner] = useState(false);
    
    // Exhaustion modal states
    const [exhaustedQuota, setExhaustedQuota] = useState<any>(null);

    useEffect(() => {
        const fetchUsage = async () => {
            try {
                const res = await fetch('/api/subscription/usage');
                if (!res.ok) throw new Error("Failed to load usage quotas");
                const data = await res.json();
                setUsage(data);

                // Run quota checks
                if (data.limits) {
                    let highestExhausted: any = null;
                    let highestWarning: any = null;

                    Object.entries(data.limits).forEach(([key, quota]: [string, any]) => {
                        // Skip storage or unlimit checks
                        if (key === 'storage' || quota.limit === 999999 || quota.limit === 0) return;
                        
                        const pct = quota.limit > 0 ? (quota.used / quota.limit) : 0;

                        if (quota.used >= quota.limit) {
                            if (!highestExhausted) highestExhausted = { key, ...quota };
                        } else if (pct >= 0.8) {
                            if (!highestWarning) highestWarning = { key, ...quota, pct: Math.round(pct * 100) };
                        }
                    });

                    if (highestExhausted) {
                        setExhaustedQuota(highestExhausted);
                    } else if (highestWarning) {
                        setWarningQuota(highestWarning);
                    }
                }
            } catch (err) {
                console.error("Quota fetch error:", err);
            } finally {
                setLoading(false);
            }
        };

        // Don't run banner/modals on the billing page itself to prevent interfering with checkout UX
        if (pathname !== '/dashboard/billing') {
            fetchUsage();
        } else {
            setLoading(false);
        }
    }, [pathname]);

    const handleBuyAddon = async (addonId: string) => {
        setCheckoutLoading(true);
        try {
            const res = await fetch('/api/payment/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addonId })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to start payment checkout");

            if (data.url) {
                window.location.href = data.url;
            } else {
                toast.error("Checkout server configuration issue.");
                setCheckoutLoading(false);
            }
        } catch (err: any) {
            toast.error("Checkout Failed", { description: err.message });
            setCheckoutLoading(false);
        }
    };

    if (loading || pathname === '/dashboard/billing') return null;

    // 1. Quota Exhausted Full Screen Modal (>= 100% usage)
    if (exhaustedQuota) {
        const addon = ADDON_MAPPING[exhaustedQuota.key];
        const currentPlanKey = (usage?.planName || 'Free Plan').replace(' Plan', '').toLowerCase();
        const recommendedPlanKey = PLAN_UPGRADE_MAP[currentPlanKey] || 'starter';
        const recommendedPlanName = recommendedPlanKey.charAt(0).toUpperCase() + recommendedPlanKey.slice(1) + ' Plan';

        return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                {/* Immersive backdrop glassmorphism */}
                <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md transition-opacity duration-300" />
                
                <div className="bg-white rounded-[2.5rem] w-full max-w-lg relative shadow-2xl border border-slate-200/50 overflow-hidden animate-in fade-in zoom-in duration-300 z-10">
                    
                    {/* Header Splash */}
                    <div className="bg-gradient-to-br from-red-500 via-rose-500 to-amber-500 text-white p-8 relative">
                        <div className="absolute top-4 right-4">
                            <button 
                                onClick={() => setExhaustedQuota(null)}
                                className="text-white/80 hover:text-white bg-black/10 hover:bg-black/20 p-2 rounded-full transition-all"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex items-center gap-3.5 mb-2">
                            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shadow-inner backdrop-blur-sm">
                                <AlertTriangle size={24} className="text-white" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-rose-100 bg-black/15 px-3 py-1 rounded-full border border-white/10">Quota Exhausted</span>
                        </div>
                        
                        <h3 className="text-2xl font-black tracking-tight leading-tight">
                            You've hit your maximum {exhaustedQuota.label} limit!
                        </h3>
                        <p className="text-rose-100 text-xs mt-2 font-medium leading-relaxed">
                            Upgrade your pricing tier or purchase a single add-on bundle to continue creating campaigns and creatives without interruption.
                        </p>
                    </div>

                    <div className="p-8 space-y-6">
                        
                        {/* Option A: Purchase single Add-on */}
                        {addon && (
                            <div className="bg-slate-50 border border-slate-200/60 rounded-3xl p-5 hover:bg-slate-100/50 transition-all group">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <span className="text-[9px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">Add-on Option</span>
                                        <h4 className="font-extrabold text-slate-800 text-sm mt-1">{addon.name}</h4>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs text-slate-400 font-bold">Only</span>
                                        <p className="text-lg font-black text-slate-900 leading-none mt-0.5">₹{addon.price}</p>
                                    </div>
                                </div>
                                <p className="text-slate-500 text-[11px] font-medium leading-relaxed mb-4">
                                    Adds a one-time <span className="font-bold text-slate-700">{addon.effect}</span> directly into your current billing cycle. Excellent for urgent deliveries.
                                </p>

                                <button
                                    onClick={() => handleBuyAddon(addon.id)}
                                    disabled={checkoutLoading}
                                    className="w-full bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white py-3 rounded-2xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2"
                                >
                                    {checkoutLoading ? (
                                        <Loader2 className="animate-spin" size={14} />
                                    ) : (
                                        <>
                                            <ShoppingBag size={14} /> Buy Now with PhonePe
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* Option B: Upgrade Plan (Recommended) */}
                        <div className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-200/50 rounded-3xl p-6 hover:shadow-md transition-all relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl group-hover:scale-150 transition-all duration-500" />
                            
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <Crown size={16} className="text-blue-600 animate-pulse" />
                                    <span className="text-[10px] font-black uppercase tracking-wider text-blue-600">Dynamic Recommendation</span>
                                </div>
                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">Saves up to 60%</span>
                            </div>

                            <h4 className="font-black text-slate-800 text-base">
                                Upgrade to {recommendedPlanName}
                            </h4>
                            <p className="text-slate-500 text-xs mt-1 font-medium leading-relaxed mb-5">
                                Gain access to much larger monthly creative limits, team slots, advanced CRM tools, and professional campaign launching systems.
                            </p>

                            <button
                                onClick={() => {
                                    setExhaustedQuota(null);
                                    router.push('/dashboard/billing');
                                }}
                                className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white py-3.5 rounded-2xl text-xs font-black shadow-lg shadow-blue-500/20 transition-all flex items-center justify-center gap-1.5 group"
                            >
                                <Sparkles size={14} /> View Upgrade Plans <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        );
    }

    // 2. Sleek Amber warning banner (80% to 99% usage)
    if (warningQuota && !dismissBanner) {
        return (
            <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-600/10 border-b border-amber-200/50 px-4 py-2.5 flex items-center justify-between gap-4 animate-in slide-in-from-top duration-300">
                <div className="max-w-4xl mx-auto flex-1 flex items-center gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                        <AlertTriangle className="text-amber-600" size={16} />
                    </div>
                    <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                        <p className="text-[11px] sm:text-xs font-bold text-slate-800">
                            Warning: You've used {warningQuota.pct}% of your monthly {warningQuota.label} quota! ({warningQuota.used}/{warningQuota.limit})
                        </p>
                        <button 
                            onClick={() => router.push('/dashboard/billing')}
                            className="text-[10px] sm:text-xs font-black text-amber-700 hover:text-amber-800 underline underline-offset-2 flex items-center gap-0.5 w-fit active:scale-95 transition-all"
                        >
                            Upgrade Plan <ChevronRight size={12} />
                        </button>
                    </div>
                </div>
                <button 
                    onClick={() => setDismissBanner(true)}
                    className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-amber-500/5 rounded-full transition-colors shrink-0"
                >
                    <X size={14} />
                </button>
            </div>
        );
    }

    return null;
}
