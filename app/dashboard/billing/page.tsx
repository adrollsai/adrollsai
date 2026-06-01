'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { 
    X, 
    Check, 
    Zap, 
    ShieldCheck, 
    Loader2, 
    ArrowRight, 
    CalendarDays, 
    Lock,
    Crown,
    Plus,
    Flame,
    Building2,
    Users2,
    MessageSquare,
    DollarSign,
    Sparkles,
    CheckCircle,
    UserCheck,
    Video,
    Image as ImageIcon,
    FileText,
    Rocket,
    Settings,
    Maximize2,
    ShoppingBag
} from 'lucide-react';
import { toast } from 'sonner';

export default function BillingPage() {
  const router = useRouter();
  const supabase = createClient();
  
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activePlan, setActivePlan] = useState<string>('free');
  const [activePlanName, setActivePlanName] = useState<string>('Free Plan');
  const [renewalDate, setRenewalDate] = useState<string | null>(null);
  
  // Usage tracking state
  const [usageLimits, setUsageLimits] = useState<any>(null);

  // Lead modal state
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadForm, setLeadForm] = useState({
      name: '',
      companyName: '',
      email: '',
      phone: '',
      teamSize: '10-50',
      budget: '50000',
      requirements: ''
  });

  // Fetch Usage & Subscription Details on Load
  const fetchBillingData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
          router.push('/');
          return;
      }

      // Fetch usage endpoint
      const res = await fetch('/api/subscription/usage');
      if (res.ok) {
          const data = await res.json();
          setUsageLimits(data.limits);
          setActivePlanName(data.planName);
          
          if (data.resetDate) {
              setRenewalDate(new Date(data.resetDate).toLocaleDateString('en-IN', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
              }));
          }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_plan, subscription_status')
        .eq('id', user.id)
        .single();

      if (profile) {
          setActivePlan(profile.subscription_plan || 'free');
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

  // Handle Plan / Add-on Purchase Redirection
  const handlePurchase = async (params: { planId?: string; addonId?: string }) => {
    setIsProcessing(true);
    try {
      const res = await fetch('/api/payment/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Failed to initiate checkout');
      
      if (data.url) {
          window.location.href = data.url;
      } else {
          toast.error("Checkout server configuration issue.");
          setIsProcessing(false);
      }
    } catch (error: any) {
      toast.error('Payment Error', { description: error.message });
      setIsProcessing(false);
    }
  };

  // Submit Lead Form
  const handleLeadSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLeadSubmitting(true);
      try {
          const res = await fetch('/api/payment/custom-lead', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(leadForm)
          });
          
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to submit request");

          toast.success("Request Submitted!", { 
              description: "Our enterprise sales representative will call you shortly." 
          });
          setShowLeadModal(false);
          setLeadForm({
              name: '',
              companyName: '',
              email: '',
              phone: '',
              teamSize: '10-50',
              budget: '50000',
              requirements: ''
          });
      } catch (err: any) {
          toast.error("Submission Failed", { description: err.message });
      } finally {
          setLeadSubmitting(false);
      }
  };

  const pricingTiers = [
    {
      id: 'growth',
      name: "Growth Plan",
      price: "₹9,999",
      period: "month",
      desc: "Our most sought-after plan tailored to growing real estate agencies.",
      features: [
        "Full CRM Integration",
        "Social Media Auto-Posting",
        "5 Team Member seats included",
        "5 AI Videos per month",
        "30 AI High-Res Images per month",
        "30 AI SEO Blog Articles per month",
        "5 Meta Campaign Launches per month",
        "5 AI Campaign Optimizations per month",
        "10 GB Cloud Media Storage",
        "Priority Email Support"
      ],
      tag: "Most Popular",
      highlight: true
    },
    {
      id: 'pro',
      name: "Pro Plan",
      price: "₹14,999",
      period: "month",
      desc: "Built for established agencies seeking premium automated growth.",
      features: [
        "Full CRM Integration",
        "Social Media Auto-Posting",
        "10 Team Member seats included",
        "8 AI Videos per month",
        "60 AI High-Res Images per month",
        "30 AI SEO Blog Articles per month",
        "8 Meta Campaign Launches per month",
        "8 AI Campaign Optimizations per month",
        "10 GB Cloud Media Storage",
        "Custom Domain Whitelabeling",
        "Priority WhatsApp Support"
      ],
      tag: "Advanced Scaling",
      highlight: false
    },
    {
      id: 'enterprise',
      name: "Enterprise Plan",
      price: "₹24,999",
      period: "month",
      desc: "Premium, massive quota bundles tailored for large corporate entities.",
      features: [
        "Full CRM Integration",
        "Social Media Auto-Posting",
        "20 Team Member seats included",
        "15 AI Videos per month",
        "90 AI High-Res Images per month",
        "30 AI SEO Blog Articles per month",
        "15 Meta Campaign Launches per month",
        "15 AI Campaign Optimizations per month",
        "10 GB Cloud Media Storage",
        "Custom Whitelabeled Domain",
        "24/7 Dedicated Account Manager"
      ],
      tag: "For Large Agencies",
      highlight: false
    },
    {
      id: 'custom',
      name: "Custom Plan",
      price: "Talk to Sales",
      period: "custom",
      desc: "Bespoke ad quotas, custom branding elements, and advanced strategies.",
      features: [
        "Bespoke Quotas of AI Videos",
        "Custom Image Packs & Assets",
        "Custom CRM and Round-Robin Rules",
        "Direct API Integration and Webhooks",
        "Whitelabel App & Custom Branding",
        "Full Dedicated Engineering Support"
      ],
      tag: "Bespoke Corporate",
      highlight: false
    }
  ];

  const addonsList = [
      {
          id: 'video',
          name: "Additional AI Video",
          price: "₹999",
          desc: "+1 AI Video quota added immediately to your current cycle.",
          quotaKey: "videos"
      },
      {
          id: 'team_member',
          name: "Additional Team Member",
          price: "₹299/mo",
          desc: "+1 Team Member seat.",
          quotaKey: "team_members"
      },
      {
          id: 'campaign_launch',
          name: "Additional Campaign Launch",
          price: "₹399",
          desc: "+1 Meta ad campaign launch quota.",
          quotaKey: "campaign_launches"
      },
      {
          id: 'campaign_optimization',
          name: "Additional Campaign Optimization",
          price: "₹249",
          desc: "+1 Campaign Optimization run to refresh visual DNA.",
          quotaKey: "campaign_optimizations"
      },
      {
          id: 'retargeting_campaign',
          name: "Additional Retargeting Campaign",
          price: "₹499",
          desc: "+1 Retargeting Campaign quota. Retargeting is add-on only.",
          quotaKey: "retargeting_campaigns"
      },
      {
          id: 'image_small',
          name: "Small Image Pack (+10)",
          price: "₹59",
          desc: "+10 AI Image generations added immediately.",
          quotaKey: "images"
      },
      {
          id: 'image_medium',
          name: "Medium Image Pack (+50)",
          price: "₹199",
          desc: "+50 AI Image generations added immediately.",
          quotaKey: "images"
      },
      {
          id: 'image_large',
          name: "Large Image Pack (+100)",
          price: "₹349",
          desc: "+100 AI Image generations added immediately.",
          quotaKey: "images"
      }
  ];

  if (loading) {
      return (
          <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
              <Loader2 className="animate-spin text-blue-600" size={32} />
              <p className="text-sm text-slate-500 font-medium">Loading billing details...</p>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 font-sans overflow-x-hidden">
      
      {/* Premium Top Navigation */}
      <div className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
              <Crown size={22} className="text-blue-600" />
              <h1 className="text-lg font-black text-slate-900 tracking-tight">SaaS Subscription & Quotas</h1>
          </div>
          
          <button 
              onClick={() => router.push('/dashboard/profile')}
              className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors"
              title="Close"
          >
              <X size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16">
          
          {/* Page Intro */}
          <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-wider mb-4 border border-blue-100">
                  <Sparkles size={12} fill="currentColor" /> Streamlined AI scale
              </div>
              <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-3">
                  Find the perfect fit for your agency
              </h2>
              <p className="text-slate-500 text-sm sm:text-base max-w-lg mx-auto font-medium leading-relaxed">
                  Choose a comprehensive monthly quota plan, or modularly top-up specific creative and campaign counts using our secure Add-ons Shop.
              </p>
          </div>

          {/* Real-time Usage Trackers */}
          {usageLimits && (
              <div className="bg-white rounded-[2rem] border border-slate-200 p-6 sm:p-8 shadow-sm mb-16">
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 border-b border-slate-100 pb-5">
                      <div>
                          <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full border border-blue-100">Active Membership</span>
                          <h3 className="text-xl font-black text-slate-800 mt-2 flex items-center gap-2">
                              {activePlanName} {activePlan !== 'free' && <CheckCircle size={18} className="text-green-500" fill="currentColor" />}
                          </h3>
                      </div>
                      {renewalDate && activePlan !== 'free' && (
                          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 px-3.5 py-2 rounded-2xl border border-slate-100 font-bold">
                              <CalendarDays size={14} className="text-blue-500" />
                              <span>Resets & Renews On <span className="text-slate-800">{renewalDate}</span></span>
                          </div>
                      )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      
                      {/* Videos Quota */}
                      <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4 flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500 font-extrabold uppercase">AI Videos</span>
                              <Video size={16} className="text-blue-500" />
                          </div>
                          <div className="mt-4">
                              <p className="text-xl font-black text-slate-900 leading-none">
                                  {usageLimits.videos.used} <span className="text-slate-400 font-bold text-sm">/ {usageLimits.videos.limit}</span>
                              </p>
                              <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                                  <div 
                                      className={`h-1.5 rounded-full ${usageLimits.videos.used >= usageLimits.videos.limit ? 'bg-rose-500' : 'bg-blue-600'}`} 
                                      style={{ width: `${Math.min(100, (usageLimits.videos.used / (usageLimits.videos.limit || 1)) * 100)}%` }}
                                  />
                              </div>
                          </div>
                      </div>

                      {/* Images Quota */}
                      <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4 flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500 font-extrabold uppercase">AI Images</span>
                              <ImageIcon size={16} className="text-indigo-500" />
                          </div>
                          <div className="mt-4">
                              <p className="text-xl font-black text-slate-900 leading-none">
                                  {usageLimits.images.used} <span className="text-slate-400 font-bold text-sm">/ {usageLimits.images.limit}</span>
                              </p>
                              <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                                  <div 
                                      className={`h-1.5 rounded-full ${usageLimits.images.used >= usageLimits.images.limit ? 'bg-rose-500' : 'bg-indigo-600'}`} 
                                      style={{ width: `${Math.min(100, (usageLimits.images.used / (usageLimits.images.limit || 1)) * 100)}%` }}
                                  />
                              </div>
                          </div>
                      </div>

                      {/* Campaign Launches */}
                      <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4 flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500 font-extrabold uppercase">Launches</span>
                              <Rocket size={16} className="text-purple-500" />
                          </div>
                          <div className="mt-4">
                              <p className="text-xl font-black text-slate-900 leading-none">
                                  {usageLimits.campaign_launches.used} <span className="text-slate-400 font-bold text-sm">/ {usageLimits.campaign_launches.limit}</span>
                              </p>
                              <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                                  <div 
                                      className={`h-1.5 rounded-full ${usageLimits.campaign_launches.used >= usageLimits.campaign_launches.limit ? 'bg-rose-500' : 'bg-purple-600'}`} 
                                      style={{ width: `${Math.min(100, (usageLimits.campaign_launches.used / (usageLimits.campaign_launches.limit || 1)) * 100)}%` }}
                                  />
                              </div>
                          </div>
                      </div>

                      {/* Team Members */}
                      <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4 flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500 font-extrabold uppercase">Team Size</span>
                              <Users2 size={16} className="text-teal-500" />
                          </div>
                          <div className="mt-4">
                              <p className="text-xl font-black text-slate-900 leading-none">
                                  {usageLimits.team_members.used} <span className="text-slate-400 font-bold text-sm">/ {usageLimits.team_members.limit === 999999 ? '∞' : usageLimits.team_members.limit}</span>
                              </p>
                              <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2 overflow-hidden">
                                  <div 
                                      className="h-1.5 rounded-full bg-teal-600" 
                                      style={{ width: `${usageLimits.team_members.limit === 999999 ? 100 : Math.min(100, (usageLimits.team_members.used / usageLimits.team_members.limit) * 100)}%` }}
                                  />
                              </div>
                          </div>
                      </div>

                  </div>
              </div>
          )}

          {/* Tiered Subscriptions Pricing Catalog */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20 items-stretch">
              {pricingTiers.map((tier) => {
                  const isCurrent = activePlan === tier.id || (activePlan === 'professional' && tier.id === 'pro');
                  return (
                      <div 
                          key={tier.id}
                          className={`bg-white rounded-[2rem] border overflow-hidden flex flex-col justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative ${
                              tier.highlight 
                                  ? 'border-blue-500 ring-2 ring-blue-500/10 shadow-lg md:scale-105 z-10' 
                                  : 'border-slate-200'
                          }`}
                      >
                          {/* Banner Highlights */}
                          {tier.highlight && (
                              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[9px] font-black uppercase text-center py-1.5 flex items-center justify-center gap-1">
                                  <Flame size={10} fill="currentColor" /> {tier.tag}
                              </div>
                          )}

                          <div className="p-6">
                              <div className="mb-4">
                                  {!tier.highlight && (
                                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                          {tier.tag}
                                      </span>
                                  )}
                                  <h3 className="text-base font-black text-slate-900 mt-2">{tier.name}</h3>
                              </div>

                              <div className="my-5">
                                  {tier.period === 'custom' ? (
                                      <div className="h-12 flex items-center">
                                          <p className="text-xl font-black text-slate-900 leading-none">{tier.price}</p>
                                      </div>
                                  ) : (
                                      <div>
                                          <div className="flex items-baseline leading-none">
                                              <span className="text-2xl font-black text-slate-900 tracking-tight">{tier.price}</span>
                                              <span className="text-[10px] text-slate-400 font-bold ml-1">/ {tier.period}</span>
                                          </div>
                                          <p className="text-[8px] text-slate-400 font-bold mt-1">Inclusive of GST</p>
                                      </div>
                                  )}
                              </div>

                              <p className="text-slate-500 text-[11px] font-medium leading-relaxed mb-6 h-12 overflow-hidden">
                                  {tier.desc}
                              </p>

                              <ul className="space-y-2 border-t border-slate-50 pt-5">
                                  {tier.features.map((f, i) => (
                                      <li key={i} className="flex items-start gap-2">
                                          <div className="shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                                              <Check size={8} strokeWidth={4} />
                                          </div>
                                          <span className="text-[10px] text-slate-600 font-bold">{f}</span>
                                      </li>
                                  ))}
                              </ul>
                          </div>

                          <div className="p-6 border-t border-slate-50 bg-slate-50/50">
                              {isCurrent ? (
                                  <button 
                                      disabled
                                      className="w-full bg-slate-100 text-slate-400 py-3 rounded-2xl text-xs font-bold cursor-not-allowed border border-slate-200 flex items-center justify-center gap-1.5"
                                  >
                                      <ShieldCheck size={14} /> Active Plan
                                  </button>
                              ) : tier.id === 'custom' ? (
                                  <button 
                                      onClick={() => setShowLeadModal(true)}
                                      className="w-full bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white py-3 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1 group"
                                  >
                                      Contact Sales <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                                  </button>
                              ) : (
                                  <a 
                                      href="tel:+919872669935"
                                      className={`w-full text-center py-3 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-sm ${
                                          tier.highlight
                                              ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/10'
                                              : 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50'
                                      }`}
                                  >
                                      Contact +91-98726 69935
                                  </a>
                              )}
                          </div>

                      </div>
                  );
              })}
          </div>

          {/* Modular Add-on shop */}
          <div className="border-t border-slate-200 pt-16">
              <div className="text-center mb-10">
                  <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-3.5 py-1 rounded-full border border-indigo-100">Add-on Quotas Shop</span>
                  <h3 className="text-3xl font-black text-slate-900 mt-3 tracking-tight">Need a quick boost?</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto font-medium mt-1">
                      Purchase individual credits or member slots instantly on the go. Perfect for high-demand months.
                  </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {addonsList.map((addon) => {
                      const isDisabled = activePlan === 'enterprise' && addon.id === 'team_member';
                      return (
                          <div 
                              key={addon.id}
                              className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                          >
                              <div>
                                  <div className="flex items-start justify-between mb-4">
                                      <h4 className="font-extrabold text-slate-800 text-sm">{addon.name}</h4>
                                      <p className="text-sm font-black text-slate-900">{addon.price}</p>
                                  </div>
                                  <p className="text-slate-500 text-[11px] leading-relaxed font-medium mb-6">
                                      {addon.desc}
                                  </p>
                              </div>

                              <a
                                  href="tel:+919872669935"
                                  className="w-full bg-slate-900 hover:bg-slate-800 text-white text-center py-3.5 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                              >
                                  Contact +91-98726 69935
                              </a>
                          </div>
                      );
                  })}
              </div>
          </div>

          <div className="mt-16 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Lock size={12} /> SSL Secured Payments Powered by PhonePe UPI & Autopay
          </div>
          
      </div>

      {/* Lead capture form Modal */}
      {showLeadModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowLeadModal(false)} />
              <div className="bg-white rounded-[2.5rem] w-full max-w-lg relative shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 border border-slate-200/50">
                  
                  {/* Header Decoration */}
                  <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 text-white p-8">
                      <div className="flex items-center gap-4">
                          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center shadow-inner backdrop-blur-md">
                              <Crown className="text-blue-400" size={26} />
                          </div>
                          <div>
                              <h3 className="text-2xl font-black tracking-tight">Custom Corporate Package</h3>
                              <p className="text-xs text-slate-400 font-bold mt-0.5">Let us build a bespoke strategy for your agency.</p>
                          </div>
                      </div>
                  </div>

                  <form onSubmit={handleLeadSubmit} className="p-8 space-y-5">
                      
                      {/* Name & Company */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Full Name</label>
                              <input 
                                  type="text" 
                                  required
                                  placeholder="e.g. John Doe"
                                  value={leadForm.name}
                                  onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-4 text-xs font-semibold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                              />
                          </div>
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Company Name</label>
                              <input 
                                  type="text" 
                                  required
                                  placeholder="e.g. Prime Realty Group"
                                  value={leadForm.companyName}
                                  onChange={(e) => setLeadForm({ ...leadForm, companyName: e.target.value })}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-4 text-xs font-semibold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                              />
                          </div>
                      </div>

                      {/* Email & Phone */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Email Address</label>
                              <input 
                                  type="email" 
                                  required
                                  placeholder="john@primerealty.com"
                                  value={leadForm.email}
                                  onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-4 text-xs font-semibold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                              />
                          </div>
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Phone Number</label>
                              <input 
                                  type="tel" 
                                  required
                                  placeholder="+91 98765 43210"
                                  value={leadForm.phone}
                                  onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-4 text-xs font-semibold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                              />
                          </div>
                      </div>

                      {/* Team Size & Budget */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Team Size</label>
                              <select 
                                  value={leadForm.teamSize}
                                  onChange={(e) => setLeadForm({ ...leadForm, teamSize: e.target.value })}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-4 text-xs font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                              >
                                  <option value="1-10">1 - 10 Members</option>
                                  <option value="10-50">10 - 50 Members</option>
                                  <option value="50-100">50 - 100 Members</option>
                                  <option value="100+">100+ Corporate Members</option>
                              </select>
                          </div>
                          <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Monthly Marketing Budget</label>
                              <select 
                                  value={leadForm.budget}
                                  onChange={(e) => setLeadForm({ ...leadForm, budget: e.target.value })}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 px-4 text-xs font-bold text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                              >
                                  <option value="25000">Below ₹25,000 / mo</option>
                                  <option value="50000">₹25,000 - ₹50,000 / mo</option>
                                  <option value="100000">₹50,000 - ₹1,00,000 / mo</option>
                                  <option value="500000">₹1,00,000 - ₹5,00,000 / mo</option>
                                  <option value="500001">Above ₹5,00,000 / mo</option>
                              </select>
                          </div>
                      </div>

                      {/* Requirements */}
                      <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Specific Requirements & Notes</label>
                          <textarea 
                              required
                              rows={3}
                              placeholder="Describe your desired monthly AI Video and Image quotas, Meta strategies, etc..."
                              value={leadForm.requirements}
                              onChange={(e) => setLeadForm({ ...leadForm, requirements: e.target.value })}
                              className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 text-xs font-semibold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all resize-none"
                          />
                      </div>

                      {/* Submit */}
                      {leadSubmitting ? (
                          <button disabled className="w-full bg-slate-100 text-slate-400 py-3.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 border border-slate-200">
                              <Loader2 size={16} className="animate-spin" /> Processing request...
                          </button>
                      ) : (
                          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white py-3.5 rounded-2xl text-xs font-black shadow-lg shadow-blue-500/20 transition-all">
                              Submit Custom Plan Query
                          </button>
                      )}
                  </form>
              </div>
          </div>
      )}

    </div>
  );
}