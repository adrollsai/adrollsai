'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
   Zap,
   Target,
   Megaphone,
   CheckCircle2,
   ArrowRight,
   Play,
   LayoutGrid,
   Globe,
   Palette,
   Users2,
   Rocket,
   Phone,
   Mail,
   Sparkles,
   ShieldCheck,
   Clock,
   Award,
   Smile,
   X,
   Calendar,
   ChevronRight,
   Loader2
} from 'lucide-react'
import Link from 'next/link'
import LandingNavbar from '@/components/LandingNavbar'
import PricingSection from '@/components/PricingSection'
import ContactForm from '@/components/ContactForm'

const ADMIN_USER_ID = 'bc63c065-9bcc-4793-bedc-f0960406425b'
const LANDING_PAGE_ID = '906bdd5f-dda6-4f76-9170-4c81e90dc1f5'
const SLUG_VALUE = 'test-nobogent-1592'
const PIXEL_ID = '1344722394272912'

export default function LandingPageClient() {
   const partnerLoginUrl = 'https://app.nobogent.com'
   
   // Tickers and videos static lists
   const clientLogos = [
      {
         name: 'Bluesquare Infra',
         subtitle: 'Infrastructure Group',
         logoUrl: '/images/optimized/logo_bluesquare.webp',
         logo: (
            <svg className="w-8 h-8 text-[#124376]/50 group-hover:text-[#B31B20] transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <rect x="3" y="3" width="18" height="18" rx="2" />
               <path d="M9 3v18M3 9h18" />
            </svg>
         )
      },
      {
         name: 'HomCom Realtors',
         subtitle: 'Luxury Housing & Realtors',
         logoUrl: '/images/optimized/logo_homcom.webp',
         logo: (
            <svg className="w-8 h-8 text-[#124376]/50 group-hover:text-[#B31B20] transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
               <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
         )
      },
      {
         name: 'GNR Homes',
         subtitle: 'Elite Construction',
         logoUrl: '/images/optimized/logo_gnrhomes.webp',
         logo: (
            <svg className="w-8 h-8 text-[#124376]/50 group-hover:text-[#B31B20] transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <path d="m2 22 10-18 10 18" />
               <path d="M6 12h12M12 4v18" />
            </svg>
         )
      },
      {
         name: 'Realty Nation',
         subtitle: 'Real Estate Leaders',
         logoUrl: '/images/optimized/logo_realtynation.webp',
         logo: (
            <svg className="w-8 h-8 text-[#124376]/50 group-hover:text-[#B31B20] transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <circle cx="12" cy="12" r="10" />
               <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
            </svg>
         )
      },
      {
         name: 'The Pro Estate',
         subtitle: 'Premium Commercial',
         logoUrl: '',
         logo: (
            <svg className="w-8 h-8 text-[#124376]/50 group-hover:text-[#B31B20] transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <path d="M4 22V4h16v18M9 18h6M9 14h6M9 10h6M9 6h6" />
            </svg>
         )
      },
      {
         name: 'YourLocalAgency Canada',
         subtitle: 'Global Ad Partners',
         logoUrl: '/images/optimized/logo_yourlocalagency.webp',
         logo: (
            <svg className="w-8 h-8 text-[#124376]/50 group-hover:text-[#B31B20] transition-colors duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
               <circle cx="12" cy="11" r="3" />
            </svg>
         )
      }
   ]

   const showcaseVideos = [
      {
         url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/rendered/c890a11f-84ce-4592-ab8f-8682927b1a9d/video_1780469096223.mp4',
         title: 'Real Estate Dream Home Spotlight',
         desc: 'Fully generated cinematic camera movements and contextual ad copy overlays.'
      },
      {
         url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/renders/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/b5250912-eb17-41a6-a3a0-249b7d96da05.mp4',
         title: 'Agentic Product Walkthrough Creative',
         desc: 'Smart product zooms, automated transcript captions, and logo animation cards.'
      },
      {
         url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/rendered/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/video_1779798513180.mp4',
         title: 'Direct Response Service Promo',
         desc: 'High-converting hook sequence, animated trust badges, and phone overlays.'
      }
   ]

   const staticGraphics = [
      '/images/optimized/graphic_1.webp',
      '/images/optimized/graphic_2.webp',
      '/images/optimized/graphic_3.webp',
      '/images/optimized/graphic_4.webp',
      '/images/optimized/graphic_5.webp',
      '/images/optimized/graphic_6.webp',
      '/images/optimized/graphic_7.webp',
      '/images/optimized/graphic_8.webp',
      '/images/optimized/graphic_9.webp',
      '/images/optimized/graphic_10.webp'
   ]

   // Popup state management
   const [isModalOpen, setIsModalOpen] = useState(false)
   const [hasOpenedModal, setHasOpenedModal] = useState(false)
   const [hasSubmitted, setHasSubmitted] = useState(false)

   // Meta Pixel initialization
   useEffect(() => {
      if (typeof window !== 'undefined') {
         // @ts-ignore
         if (!window.fbq) {
            // @ts-ignore
            window._fbq = [];
            // @ts-ignore
            window.fbq = function() {
               // @ts-ignore
               window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments);
            };
            // @ts-ignore
            if (!window._fbq) window._fbq = window.fbq;
            // @ts-ignore
            window.fbq.push = window.fbq;
            // @ts-ignore
            window.fbq.loaded = true;
            // @ts-ignore
            window.fbq.version = '2.0';
            // @ts-ignore
            window.fbq.queue = [];
            const script = document.createElement('script');
            script.async = true;
            script.src = 'https://connect.facebook.net/en_US/fbevents.js';
            document.head.appendChild(script);
         }
         // @ts-ignore
         window.fbq('init', PIXEL_ID);
         // @ts-ignore
         window.fbq('track', 'PageView');
      }
   }, [])

   // Modal triggering logic (3s delay and scroll)
   useEffect(() => {
      const submitted = localStorage.getItem('adrolls_lead_submitted') === 'true'
      setHasSubmitted(submitted)

      if (submitted) return

      // 3 Second delay trigger
      const timer = setTimeout(() => {
         setIsModalOpen(prev => {
            if (!prev && !hasOpenedModal) {
               setHasOpenedModal(true)
               return true
            }
            return prev
         })
      }, 3000)

      // Scroll trigger
      const handleScroll = () => {
         if (window.scrollY > 100) {
            setIsModalOpen(prev => {
               if (!prev && !hasOpenedModal) {
                  setHasOpenedModal(true)
                  return true
               }
               return prev
            })
            window.removeEventListener('scroll', handleScroll)
         }
      }

      window.addEventListener('scroll', handleScroll)

      return () => {
         clearTimeout(timer)
         window.removeEventListener('scroll', handleScroll)
      }
   }, [hasOpenedModal])

   const handleCloseModal = () => {
      setIsModalOpen(false)
      localStorage.setItem('adrolls_popup_closed', 'true')
   }

   const handleOpenModalDirectly = () => {
      setIsModalOpen(true)
   }

   return (
      <div className="min-h-screen bg-[#FAFAFA] text-[#202124] font-sans selection:bg-[#DF9E27]/30 selection:text-[#124376] overflow-x-hidden relative">
         
         <LandingNavbar />

         <div className="fixed inset-0 z-0 opacity-[0.02] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(#124376 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
         </div>

         {/* --- 1. HERO SECTION --- */}
         <section className="relative pt-44 pb-20 md:pt-52 md:pb-28 overflow-hidden z-10">
            <div className="absolute top-0 right-0 w-[45vw] h-[45vw] bg-[#DF9E27]/10 blur-[100px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/4" />
            <div className="absolute bottom-0 left-0 w-[35vw] h-[35vw] bg-[#124376]/5 blur-[80px] rounded-full pointer-events-none translate-y-1/4 -translate-x-1/4" />

            <div className="max-w-[1400px] mx-auto px-6 relative z-10">
               <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center mb-16">
                  
                  {/* Left Side Content */}
                  <div className="lg:col-span-7 text-left">
                     <div className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-white border border-[#124376]/10 text-[#124376] text-xs font-black uppercase tracking-wider mb-8 shadow-sm">
                        <span className="relative flex h-2 w-2">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B31B20] opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2 w-2 bg-[#B31B20]"></span>
                        </span>
                        High-Converting Direct-Response Marketing Suite
                     </div>

                     <h1 className="text-4xl sm:text-6xl lg:text-6xl xl:text-7xl font-black tracking-tight text-[#124376] leading-[1.1] mb-8">
                        Your First <br />
                        <span className="relative inline-block text-transparent bg-clip-text bg-gradient-to-r from-[#B31B20] via-[#DF9E27] to-[#124376] mb-4">
                           AI Marketing Employee
                        </span>
                        <div className="flex flex-wrap items-center gap-3 mt-4 text-2xl md:text-3xl font-extrabold text-[#124376]">
                           <span className="text-slate-400 line-through font-medium">₹1,95,000</span>
                           <span className="text-[#B31B20]">₹9,999/mo</span>
                        </div>
                     </h1>

                     <p className="text-lg md:text-xl text-[#5F6368] mb-10 leading-relaxed font-medium max-w-2xl">
                        Tired of dry pipelines, creative burnout, and losing conversions to cookie-blocked tracking data? Adrolls auto-generates your ad graphics, edits video ads, and configures Meta Conversions API (CAPI) servers on autopilot—<span className="text-[#124376] font-bold bg-[#DF9E27]/10 px-2 py-0.5 rounded">launching high-converting campaigns in 60 seconds.</span>
                     </p>

                     <div className="flex flex-col sm:flex-row items-center gap-4 justify-start mb-8">
                        <button 
                           onClick={handleOpenModalDirectly}
                           className="w-full sm:w-auto px-10 py-5 bg-[#B31B20] hover:bg-[#902227] text-white text-lg rounded-2xl font-extrabold transition-all flex items-center justify-center gap-2.5 shadow-lg shadow-[#B31B20]/20 hover:-translate-y-0.5 cursor-pointer"
                        >
                           Get Started Now <ArrowRight size={18} />
                        </button>
                        <button 
                           onClick={handleOpenModalDirectly}
                           className="w-full sm:w-auto px-10 py-5 bg-white border border-slate-200 text-[#124376] text-lg rounded-2xl font-extrabold hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm hover:-translate-y-0.5 cursor-pointer"
                        >
                           Schedule Free Consultation
                        </button>
                     </div>

                     <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-slate-500 font-extrabold">
                        <div className="flex items-center gap-1.5"><ShieldCheck size={16} className="text-[#DF9E27]" /> No Credit Card Required</div>
                        <div className="flex items-center gap-1.5"><Clock size={16} className="text-[#DF9E27]" /> Setup in Under 1 Min</div>
                        <div className="flex items-center gap-1.5"><Award size={16} className="text-[#DF9E27]" /> 30-Day Money-Back Guarantee</div>
                     </div>
                  </div>

                  {/* Right Side Visual (Eligibility Form) */}
                  <div className="lg:col-span-5 relative" id="hero-form-section">
                     <div className="absolute -inset-2 bg-gradient-to-r from-[#B31B20] via-[#DF9E27] to-[#124376] rounded-[2.5rem] blur-xl opacity-10"></div>
                     <div className="relative rounded-[2.5rem] p-6 sm:p-8 shadow-2xl border border-slate-200/60 bg-white z-20">
                        <LeadFormCard />
                     </div>
                  </div>
               </div>

               {/* Client Logos Ticker marquee */}
               <div className="border-y border-slate-200/60 py-10 bg-slate-50/50">
                  <p className="text-center text-[10px] text-slate-400 font-black tracking-widest uppercase mb-8">TRUSTED BY SECTOR LEADERS & HIGH-GROWTH AGENCIES</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 max-w-7xl mx-auto px-6 items-center justify-items-center">
                     {clientLogos.map((client, i) => (
                        <div key={i} className="flex flex-col items-center text-center group transition-transform hover:-translate-y-1 duration-300">
                           <div className="mb-3 transform group-hover:scale-105 transition-transform duration-300 w-16 h-16 rounded-xl bg-white border border-slate-100 flex items-center justify-center p-2 shadow-sm overflow-hidden shrink-0">
                              {client.logoUrl ? (
                                 <img src={client.logoUrl} alt={client.name} className="w-full h-full object-contain" loading="lazy" width={64} height={64} />
                              ) : (
                                 client.logo
                              )}
                           </div>
                           <div className="text-sm font-black text-[#124376]/70 group-hover:text-[#124376] transition-colors duration-300 tracking-tight leading-tight">{client.name}</div>
                           <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 opacity-60 leading-none">{client.subtitle}</div>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         </section>

         {/* --- 2. VIDEOS SHOWCASE SECTION (REELS) --- */}
         <section id="showcase" className="py-24 bg-[#124376] relative z-10 text-white border-y border-[#0c3157]">
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#B31B20] blur-[180px] opacity-20 rounded-full translate-x-1/3 -translate-y-1/3 pointer-events-none" />
            
            <div className="max-w-[1400px] mx-auto px-6 relative z-10">
               <div className="text-center max-w-3xl mx-auto mb-16">
                  <span className="text-[#DF9E27] font-black tracking-wider uppercase text-xs bg-[#DF9E27]/10 border border-[#DF9E27]/30 px-3 py-1 rounded-full">PROVEN REELS & VIDEO PROOF</span>
                  <h2 className="text-3xl md:text-5xl font-black mt-4 mb-4">Adrolls Generates & Edits Reels for Your Business</h2>
                  <p className="text-slate-300 text-base font-medium">
                     These highly engaging video ads and social media reels were fully generated, formatted, and edited using the <b>Adrolls AI engine</b>.
                  </p>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  {showcaseVideos.map((video, idx) => (
                     <div key={idx} className="bg-white/5 border border-white/10 rounded-3xl p-5 shadow-xl flex flex-col justify-between hover:border-white/20 transition-all">
                        <div className="w-full aspect-[9/16] rounded-2xl overflow-hidden bg-black shadow-inner border border-white/5 relative group mb-5">
                           <video 
                              src={`${video.url}#t=0.1`}
                              className="w-full h-full object-cover"
                              preload="metadata"
                              controls
                              muted
                              loop
                              playsInline
                           />
                        </div>
                        <div>
                           <h4 className="font-extrabold text-lg mb-2 text-[#DF9E27]">{video.title}</h4>
                           <p className="text-xs text-slate-300 font-bold leading-relaxed">{video.desc}</p>
                           <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Edited with Adrolls</span>
                              <span className="w-2 h-2 rounded-full bg-green-400 shadow-sm shadow-green-400"></span>
                           </div>
                        </div>
                     </div>
                  ))}
               </div>
            </div>
         </section>

         {/* --- 3. THE BIG 3 BOTTLENECKS (PROBLEM STATEMENT) --- */}
         <section className="py-24 bg-white relative z-10">
            <div className="max-w-[1400px] mx-auto px-6">
               <div className="text-center max-w-3xl mx-auto mb-16">
                  <span className="text-[#B31B20] font-black tracking-wider uppercase text-xs bg-red-50 border border-red-100 px-3 py-1 rounded-full">Saas Problem Statement</span>
                  <h2 className="text-3xl md:text-5xl font-black text-[#124376] mt-4 mb-4">The Big 3 Growth Bottlenecks</h2>
                  <p className="text-slate-500 text-sm font-bold">Small and medium businesses are leaking revenue through three fatal pipeline blocks.</p>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="bg-[#FAFAFA] border border-slate-200 rounded-[2rem] p-8 flex flex-col justify-between min-h-[260px] border-t-4 border-t-[#B31B20]">
                     <h3 className="text-2xl font-black text-[#124376] mb-3">🚨 Dry Pipeline</h3>
                     <p className="text-xs text-slate-500 font-bold leading-relaxed">
                        Struggling with <strong>Lead Generation</strong>. Inconsistent flow of prospects makes scaling revenue completely unpredictable.
                     </p>
                  </div>
                  <div className="bg-[#FAFAFA] border border-slate-200 rounded-[2rem] p-8 flex flex-col justify-between min-h-[260px] border-t-4 border-t-[#B31B20]">
                     <h3 className="text-2xl font-black text-[#124376] mb-3">💸 Bleeding Cash</h3>
                     <p className="text-xs text-slate-500 font-bold leading-relaxed">
                        <strong>Low Conversions</strong>. You are spending thousands on ads, but users are bouncing instead of checking eligibility or taking action.
                     </p>
                  </div>
                  <div className="bg-[#FAFAFA] border border-slate-200 rounded-[2rem] p-8 flex flex-col justify-between min-h-[260px] border-t-4 border-t-[#B31B20]">
                     <h3 className="text-2xl font-black text-[#124376] mb-3">⏳ Creative Burnout</h3>
                     <p className="text-xs text-slate-500 font-bold leading-relaxed">
                        <strong>Content Creation Problem</strong>. Spending endless hours designing creatives and videos that get zero traction.
                     </p>
                  </div>
               </div>
            </div>
         </section>

         {/* --- 4. CONVERSION MULTIPLIERS (SLIDE DATA) --- */}
         <section className="py-24 bg-slate-50 border-t border-slate-200/60 relative z-10">
            <div className="max-w-[1400px] mx-auto px-6">
               <div className="text-center max-w-3xl mx-auto mb-16">
                  <span className="text-[#124376] font-black tracking-wider uppercase text-xs bg-blue-50 border border-blue-100 px-3 py-1 rounded-full">Conversion Optimizers</span>
                  <h2 className="text-3xl md:text-5xl font-black text-[#124376] mt-4 mb-4">How Nobogent Multiplies Conversions</h2>
                  <p className="text-slate-500 text-sm font-bold">Custom engineering configured directly under the hood to ensure traffic turns to revenue.</p>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="bg-white border border-slate-200/80 rounded-[2rem] p-8 flex flex-col justify-between min-h-[280px]">
                     <div>
                        <h4 className="text-2xl font-black text-[#124376] mb-3 flex items-center gap-2">🎯 CAPI Installed CRM</h4>
                        <p className="text-xs text-slate-500 font-bold leading-relaxed">
                           We deploy Meta Conversions API (CAPI) server-side integrations. Bypass browser cookie blockers, capture complete user sessions, and train ad algorithms to locate high-intent buyers.
                        </p>
                     </div>
                  </div>
                  <div className="bg-white border border-slate-200/80 rounded-[2rem] p-8 flex flex-col justify-between min-h-[280px]">
                     <div>
                        <h4 className="text-2xl font-black text-[#124376] mb-3 flex items-center gap-2">⚡ 1-Click Campaign Optimize</h4>
                        <p className="text-xs text-slate-500 font-bold leading-relaxed">
                           Tired of manual ad refreshes? Click optimize to generate multiple high-converting variations of winning graphics and deploy them directly to scale campaigns with zero fatigue.
                        </p>
                     </div>
                  </div>
                  <div className="bg-white border border-slate-200/80 rounded-[2rem] p-8 flex flex-col justify-between min-h-[280px]">
                     <div>
                        <h4 className="text-2xl font-black text-[#124376] mb-3 flex items-center gap-2">🤝 The Trust Retargeting Engine</h4>
                        <p className="text-xs text-slate-500 font-bold leading-relaxed">
                           Our system implements automated retargeting funnels that nurture and build <strong>TRUST</strong> (the keyword) with warm leads over time, pushing them systematically to conversion.
                        </p>
                     </div>
                  </div>
               </div>
            </div>
         </section>

         {/* --- 5. STATIC GRAPHICS GALLERY --- */}
         <section id="gallery" className="py-24 bg-[#FAFAFA] border-t border-slate-200/60 relative z-10">
            <div className="max-w-[1400px] mx-auto px-6">
               <div className="text-center max-w-2xl mx-auto mb-16">
                  <span className="text-[#B31B20] font-black tracking-wider uppercase text-xs bg-red-50 px-3 py-1 rounded-full border border-red-100">CLIENT CREATIVE SHOWCASE</span>
                  <h2 className="text-3xl md:text-5xl font-black text-[#124376] mt-4 mb-4">Static Creatives Created By Clients</h2>
                  <p className="text-[#5F6368] text-sm font-bold">
                     Take a look at actual static ads and graphic layouts constructed using our AI templates. Highly optimized for high CTR and visual contrast.
                  </p>
               </div>

               <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-6 space-y-6">
                  {staticGraphics.map((url, idx) => (
                     <div key={idx} className="break-inside-avoid bg-white border border-slate-200 rounded-3xl p-3 shadow-md hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                        <img
                           src={url}
                           alt={`Client creative asset ${idx + 1}`}
                           className="w-full h-auto rounded-2xl border border-slate-100"
                           loading="lazy"
                        />
                        <div className="mt-3 px-1 flex items-center justify-between text-[10px] text-slate-400 font-black uppercase">
                           <span>Creative #{idx + 1}</span>
                           <span className="text-[#B31B20]">Client Stamped</span>
                        </div>
                     </div>
                  ))}
               </div>
            </div>
         </section>

         {/* --- 6. VALUE COMPARISON TABLE --- */}
         <section className="py-24 bg-white border-t border-slate-200 relative z-10">
            <div className="max-w-[1400px] mx-auto px-6">
               <div className="text-center mb-16 max-w-3xl mx-auto">
                  <span className="text-[#B31B20] font-black tracking-wider uppercase text-xs bg-red-50 px-3 py-1.5 rounded-full border border-red-100">THE VALUE DISCONNECT</span>
                  <h2 className="text-3xl md:text-5xl font-black text-[#124376] mt-4">Compare the Monthly Savings</h2>
                  <p className="text-slate-500 text-sm font-bold mt-2">See how much you save every single month by switching from agencies to Adrolls AI suite.</p>
               </div>

               <div className="max-w-5xl mx-auto bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-xl">
                  <div className="overflow-x-auto">
                     <table className="w-full text-left border-collapse">
                        <thead>
                           <tr className="border-b border-slate-200">
                              <th className="pb-4 font-black text-[#124376] text-xs uppercase tracking-wider">Growth Service</th>
                              <th className="pb-4 font-black text-slate-400 text-xs uppercase tracking-wider">Traditional Agency Cost / Mo</th>
                              <th className="pb-4 font-black text-[#B31B20] text-xs uppercase tracking-wider flex items-center gap-1">
                                 <Sparkles size={14} className="text-[#DF9E27]" /> In Nobogent
                              </th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-bold text-slate-700 text-xs sm:text-sm">
                           {[
                              { tool: "GEO (Geospatial Targeting)", price: "₹15,000 / $200", nobogent: "✅ Included" },
                              { tool: "User Clone Video Generation", price: "₹30,000 / $400", nobogent: "✅ Included" },
                              { tool: "AI Video Editing", price: "₹25,000 / $350", nobogent: "✅ Included" },
                              { tool: "Static Ads Creation", price: "₹10,000 / $150", nobogent: "✅ Included" },
                              { tool: "Ads Management & Optimization", price: "₹40,000 / $500", nobogent: "✅ Included" },
                              { tool: "Retargeting System (Builds TRUST)", price: "₹20,000 / $250", nobogent: "✅ Included" },
                              { tool: "Social Media Management", price: "₹25,000 / $300", nobogent: "✅ Included" },
                              { tool: "Inventory Management", price: "₹15,000 / $200", nobogent: "✅ Included" },
                              { tool: "CAPI Installed CRM", price: "₹15,000 / $200", nobogent: "✅ Included" }
                           ].map((row, i) => (
                              <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                 <td className="py-4 text-[#124376] font-black">{row.tool}</td>
                                 <td className="py-4 text-[#B31B20] line-through decoration-[#B31B20]/40 decoration-2">{row.price}</td>
                                 <td className="py-4 text-[#124376] font-black flex items-center gap-1.5">
                                    <CheckCircle2 size={16} className="text-[#DF9E27] fill-current" /> {row.nobogent}
                                 </td>
                              </tr>
                           ))}
                           <tr className="bg-slate-50/80">
                              <td className="py-5 px-3 text-[#124376] font-black text-sm uppercase">Total Estimate</td>
                              <td className="py-5 text-[#B31B20] font-extrabold text-sm line-through decoration-[#B31B20] decoration-2">₹1,95,000 / $2,550</td>
                              <td className="py-5 text-green-600 font-black text-sm flex items-center gap-1 bg-green-50 px-3 rounded-lg border border-green-100">
                                 <Sparkles size={14} className="text-[#DF9E27]" /> Just ₹9,999 / $199
                              </td>
                           </tr>
                        </tbody>
                     </table>
                  </div>
               </div>
            </div>
         </section>

         {/* --- 7. NEW TEXT-ONLY TESTIMONIALS SECTION --- */}
         <section className="py-24 bg-slate-50 border-t border-slate-200/60 relative z-10">
            <div className="max-w-[1400px] mx-auto px-6">
               <div className="text-center max-w-2xl mx-auto mb-16">
                  <span className="text-[#B31B20] font-black tracking-wider uppercase text-xs bg-red-50 px-3 py-1 rounded-full border border-red-100">REAL CUSTOMER FEEDBACK</span>
                  <h2 className="text-3xl md:text-5xl font-black text-[#124376] mt-4 mb-4">What Business Owners Say</h2>
                  <p className="text-slate-500 text-sm font-bold">Unedited feedback from entrepreneurs who automated their marketing overhead with Adrolls.</p>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                  <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                     <div className="flex items-center gap-1 mb-4 text-[#DF9E27]">
                        {[...Array(5)].map((_, i) => (
                           <svg key={i} className="w-4 h-4 fill-current" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                           </svg>
                        ))}
                     </div>
                     <p className="text-slate-700 font-bold text-sm leading-relaxed mb-6 italic">
                        "We were burning ₹50,000 every single month paying agencies that brought in junk leads. Deploying the Adrolls CAPI backend and auto-graphics changed everything—our pipeline has been full ever since!"
                     </p>
                     <div className="border-t border-slate-100 pt-4">
                        <h4 className="font-extrabold text-[#124376] text-xs uppercase tracking-wider">Rajesh K.</h4>
                        <p className="text-[10px] font-bold text-slate-400">Owner, Realty Nation Partners</p>
                     </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                     <div className="flex items-center gap-1 mb-4 text-[#DF9E27]">
                        {[...Array(5)].map((_, i) => (
                           <svg key={i} className="w-4 h-4 fill-current" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                           </svg>
                        ))}
                     </div>
                     <p className="text-slate-700 font-bold text-sm leading-relaxed mb-6 italic">
                        "Creating social creatives and video layouts used to take up my entire week. With the Adrolls generator, I design everything, auto-edit the videos, and launch ads in under 60 seconds."
                     </p>
                     <div className="border-t border-slate-100 pt-4">
                        <h4 className="font-extrabold text-[#124376] text-xs uppercase tracking-wider">Simran S.</h4>
                        <p className="text-[10px] font-bold text-slate-400">Founder, Regalia Boutique</p>
                     </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                     <div className="flex items-center gap-1 mb-4 text-[#DF9E27]">
                        {[...Array(5)].map((_, i) => (
                           <svg key={i} className="w-4 h-4 fill-current" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                           </svg>
                        ))}
                     </div>
                     <p className="text-slate-700 font-bold text-sm leading-relaxed mb-6 italic">
                        "Our lead attribution was completely broken after iOS 14. Setting up the Adrolls Conversion API server-side solved it in a click. Our ROI is up 40% and our ads are finally tracking."
                     </p>
                     <div className="border-t border-slate-100 pt-4">
                        <h4 className="font-extrabold text-[#124376] text-xs uppercase tracking-wider">Amit V.</h4>
                        <p className="text-[10px] font-bold text-slate-400">Founder, Highland Mayfield</p>
                     </div>
                  </div>
               </div>
            </div>
         </section>

         {/* --- 8. DYNAMIC PRICING SECTION --- */}
         <PricingSection />

         {/* --- 9. CONTACT FORM SECTION --- */}
         <section id="contact" className="py-24 bg-white relative border-t border-slate-200/60 z-10 overflow-hidden">
            <div className="absolute top-0 left-0 w-[25vw] h-[25vw] bg-[#124376]/5 blur-[70px] rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2" />
            
            <div className="max-w-[1400px] mx-auto px-6 relative z-10">
               <div className="text-center max-w-2xl mx-auto mb-16">
                  <span className="text-[#B31B20] font-black tracking-wider uppercase text-xs bg-red-50 px-3 py-1 rounded-full border border-red-100">CONNECT WITH OUR TEAM</span>
                  <h2 className="text-3xl md:text-4xl font-black text-[#124376] mt-4">Schedule Your AI Consultation</h2>
                  <p className="text-slate-500 text-sm font-bold mt-2">
                     Ready to lock in your offer? Complete the short inquiry and let our engineering team deploy a mapped CAPI funnel for your business profile.
                  </p>
               </div>

               <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8 bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-[2.5rem] shadow-xl p-8 relative overflow-hidden">
                  
                  {/* Left info desk */}
                  <div className="md:col-span-5 bg-[#124376] rounded-2xl p-6 text-white flex flex-col justify-between shadow-xl min-h-[250px]">
                     <div>
                        <h3 className="text-xl font-black mb-3">Nobogent HQ</h3>
                        <p className="text-slate-300 text-xs leading-relaxed mb-6">Reach our sales desk or engineering support for quick assistance.</p>
                        
                        <div className="space-y-4">
                           <div className="flex items-center gap-3">
                              <Phone size={16} className="text-[#DF9E27]" />
                              <div>
                                 <p className="text-[9px] text-blue-200 uppercase font-black tracking-wider">Phone / WhatsApp</p>
                                 <p className="text-xs font-bold">+91 98726 69935</p>
                              </div>
                           </div>
                           <div className="flex items-center gap-3">
                              <Mail size={16} className="text-[#DF9E27]" />
                              <div>
                                 <p className="text-[9px] text-blue-200 uppercase font-black tracking-wider">Email Support</p>
                                 <p className="text-xs font-bold">adrollsai@gmail.com</p>
                              </div>
                           </div>
                        </div>
                     </div>

                     <div className="pt-6 border-t border-white/10 flex items-center gap-2 text-[10px] text-green-300 font-extrabold">
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                        <span>Support Staff Active Now</span>
                     </div>
                  </div>

                  {/* Right contact form */}
                  <ContactForm />

               </div>
            </div>
         </section>

         {/* --- 10. NAVIGATION FOOTER --- */}
         <footer className="bg-[#124376] py-12 border-t border-[#0c3157] text-white relative z-10">
            <div className="max-w-[1400px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
               <div className="flex items-center gap-2">
                  <Rocket className="text-[#DF9E27] w-5 h-5" />
                  <span className="text-lg font-black tracking-tight">Nobogent.com</span>
               </div>
               
               <div className="text-slate-400 text-xs font-bold">
                  NOBOGENT BUSINESS SOLUTIONS
               </div>

               <div className="flex flex-wrap justify-center gap-6 text-xs font-bold">
                  <Link href="/privacy-policy" className="text-slate-400 hover:text-[#DF9E27] transition-colors">Privacy Policy</Link>
                  <Link href="/terms-and-conditions" className="text-slate-400 hover:text-[#DF9E27] transition-colors">Terms & Conditions</Link>
                  <Link href="/refund-policy" className="text-slate-400 hover:text-[#DF9E27] transition-colors">Refund Policy</Link>
               </div>
            </div>
         </footer>

         {/* Mobile Bottom Floating CTA Bar */}
         <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden flex gap-2.5 p-3 bg-white/95 backdrop-blur-md border-t border-slate-200/80 shadow-[0_-8px_30px_rgba(0,0,0,0.08)]">
            <a 
               href="tel:+919872669935" 
               className="flex-1 py-4 text-center bg-[#124376] hover:bg-[#0c3157] text-white font-extrabold text-xs sm:text-sm rounded-2xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
            >
               <Phone size={14} /> Call Now
            </a>
            <a 
               href="https://wa.me/919872669935" 
               className="flex-1 py-4 text-center bg-[#25D366] hover:bg-[#20ba5a] text-white font-extrabold text-xs sm:text-sm rounded-2xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
               target="_blank"
               rel="noopener noreferrer"
            >
               <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12.031 2c-5.502 0-9.969 4.467-9.969 9.969 0 1.758.459 3.407 1.264 4.848L2.016 22l5.361-1.408c1.405.766 3.003 1.208 4.704 1.208 5.502 0 9.969-4.467 9.969-9.969S17.533 2 12.031 2zm6.6 14.562c-.272.766-1.583 1.395-2.222 1.488-.58.083-1.334.145-2.145-.113-1.045-.33-2.316-.92-3.415-1.636-1.921-1.25-3.149-2.909-3.992-4.227-.375-.589-.766-1.395-.742-2.155.021-.68.313-1.258.825-1.745.247-.237.49-.33.722-.33.165 0 .33.01.464.072.185.083.423.185.6.598.196.464.66 1.62.722 1.744.062.124.083.268 0 .444-.083.175-.186.29-.371.505-.185.216-.381.453-.546.618-.185.186-.381.392-.165.763.216.371.96 1.578 2.062 2.557 1.423 1.268 2.62 1.66 2.991 1.846.371.185.588.154.805-.093.216-.247.928-1.082 1.175-1.453.247-.371.495-.31.825-.186.33.124 2.093 1.03 2.454 1.207.36.175.6.268.69.423.091.155.091.897-.181 1.663z"/>
               </svg>
               WhatsApp Us
            </a>
         </div>

         {/* Desktop Floating WhatsApp Badge */}
         <a 
            href="https://wa.me/919872669935" 
            className="hidden lg:flex fixed bottom-8 right-8 z-50 bg-[#25D366] hover:bg-[#20ba5a] text-white p-4 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all group items-center border border-white/20"
            target="_blank"
            rel="noopener noreferrer"
            title="Chat on WhatsApp"
         >
            <svg className="w-6 h-6 fill-current shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
               <path d="M12.031 2c-5.502 0-9.969 4.467-9.969 9.969 0 1.758.459 3.407 1.264 4.848L2.016 22l5.361-1.408c1.405.766 3.003 1.208 4.704 1.208 5.502 0 9.969-4.467 9.969-9.969S17.533 2 12.031 2zm6.6 14.562c-.272.766-1.583 1.395-2.222 1.488-.58.083-1.334.145-2.145-.113-1.045-.33-2.316-.92-3.415-1.636-1.921-1.25-3.149-2.909-3.992-4.227-.375-.589-.766-1.395-.742-2.155.021-.68.313-1.258.825-1.745.247-.237.49-.33.722-.33.165 0 .33.01.464.072.185.083.423.185.6.598.196.464.66 1.62.722 1.744.062.124.083.268 0 .444-.083.175-.186.29-.371.505-.185.216-.381.453-.546.618-.185.186-.381.392-.165.763.216.371.96 1.578 2.062 2.557 1.423 1.268 2.62 1.66 2.991 1.846.371.185.588.154.805-.093.216-.247.928-1.082 1.175-1.453.247-.371.495-.31.825-.186.33.124 2.093 1.03 2.454 1.207.36.175.6.268.69.423.091.155.091.897-.181 1.663z"/>
            </svg>
            <span className="max-w-0 overflow-hidden group-hover:max-w-[120px] group-hover:ml-2 transition-all duration-300 ease-out font-black text-sm whitespace-nowrap">
               Chat with Us
            </span>
         </a>

         {/* --- POPUP OVERLAY MODAL --- */}
         <AnimatePresence>
            {isModalOpen && (
               <div className="fixed inset-0 z-[99999] bg-[#0F172A]/85 backdrop-blur-md flex items-center justify-center p-4">
                  <motion.div 
                     initial={{ opacity: 0, scale: 0.95, y: 15 }}
                     animate={{ opacity: 1, scale: 1, y: 0 }}
                     exit={{ opacity: 0, scale: 0.95, y: 15 }}
                     transition={{ duration: 0.25, ease: 'easeOut' }}
                     className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden max-w-5xl w-full flex flex-col md:flex-row relative"
                  >
                     {/* Close button */}
                     <button 
                        onClick={handleCloseModal}
                        className="absolute top-4 right-4 z-[100] w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors flex items-center justify-center text-slate-500 hover:text-slate-800 cursor-pointer"
                     >
                        <X size={20} />
                     </button>

                     {/* Left: original comparison image */}
                     <div className="md:w-1/2 bg-slate-50 flex items-center justify-center p-8 border-b md:border-b-0 md:border-r border-slate-100">
                        <div className="relative w-full aspect-video md:aspect-[4/3] rounded-2xl overflow-hidden border border-slate-200/80 shadow-md">
                           <img 
                              src="/images/optimized/hero_compare.webp" 
                              alt="Adrolls ROI comparison"
                              className="w-full h-full object-cover" 
                           />
                        </div>
                     </div>

                     {/* Right: step form */}
                     <div className="md:w-1/2 p-8 md:p-10 flex flex-col justify-center max-h-[90vh] overflow-y-auto">
                        <LeadFormCard onComplete={handleCloseModal} />
                     </div>
                  </motion.div>
               </div>
            )}
         </AnimatePresence>

      </div>
   )
}

/* ==========================================================================
   INTERACTIVE MULTI-STEP LEAD & BOOKING FORM CARD
   ========================================================================== */

interface LeadFormCardProps {
   onComplete?: () => void
}

type FormStep = 'qualification' | 'contact' | 'calendar' | 'confirmed' | 'success'

function LeadFormCard({ onComplete }: LeadFormCardProps) {
   const [step, setStep] = useState<FormStep>('qualification')

   const getStepHeader = () => {
      switch (step) {
         case 'qualification':
            return {
               title: 'Step 1: Qualification Questions',
               desc: 'Answer these 2 questions to check your integration eligibility.'
            }
         case 'contact':
            return {
               title: 'Step 2: Enter Contact Details',
               desc: 'Please fill out your contact details to complete your application.'
            }
         case 'calendar':
            return {
               title: 'Step 3: Book Onboarding Slot (Optional)',
               desc: 'Select a date and time slot to align our engineering setup directly onto your marketing servers.'
            }
         default:
            return null
      }
   }

   const header = getStepHeader()
   const [leadId, setLeadId] = useState<string>('')
   
   // Form Input states
   const [name, setName] = useState('')
   const [phone, setPhone] = useState('')
   const [email, setEmail] = useState('')
   const [city, setCity] = useState('')
   const [budget, setBudget] = useState('10k - 20k')
   const [timeline, setTimeline] = useState('Immediately')

   // Loading and error states
   const [isSubmitting, setIsSubmitting] = useState(false)
   const [errorSubmit, setErrorSubmit] = useState('')
   const [isBooking, setIsBooking] = useState(false)
   const [errorBooking, setErrorBooking] = useState('')

   // Calendar specific states
   const [selectedDate, setSelectedDate] = useState('')
   const [selectedSlot, setSelectedSlot] = useState('')
   const [slots, setSlots] = useState<string[]>([])
   const [loadingSlots, setLoadingSlots] = useState(false)
   const [errorSlots, setErrorSlots] = useState('')

   const getNextBookingDays = () => {
      const days = []
      const current = new Date()
      // Generate next 6 calendar days, excluding Sundays (0)
      while (days.length < 6) {
         const dayOfWeek = current.getDay()
         if (dayOfWeek !== 0) {
            const yyyy = current.getFullYear()
            const mm = String(current.getMonth() + 1).padStart(2, '0')
            const dd = String(current.getDate()).padStart(2, '0')
            days.push({
               dateStr: `${yyyy}-${mm}-${dd}`,
               label: current.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            })
         }
         current.setDate(current.getDate() + 1)
      }
      return days
   }

   // Fetch slots when date changes or calendar step is active
   useEffect(() => {
      if (selectedDate && step === 'calendar') {
         const fetchSlots = async () => {
            setLoadingSlots(true)
            setErrorSlots('')
            try {
               const res = await fetch(`/api/shared/booking/slots?userId=${ADMIN_USER_ID}&date=${selectedDate}`)
               const data = await res.json()
               if (!res.ok) throw new Error(data.error || 'Failed to fetch slots')
               setSlots(data.slots || [])
            } catch (err: any) {
               setErrorSlots(err.message || 'Error loading slots')
            } finally {
               setLoadingSlots(false)
            }
         }
         fetchSlots()
      }
   }, [selectedDate, step])

   const handleGoToQualification = (e: React.FormEvent) => {
      e.preventDefault()
      if (!name || !phone || !email || !city) {
         setErrorSubmit('Please fill out all fields.')
         return
      }
      setErrorSubmit('')
      setStep('qualification')
   }

   const handleLeadSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)
      setErrorSubmit('')
      try {
         const eventId = 'evt_lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11)
         const payload = {
            landing_page_id: LANDING_PAGE_ID,
            user_id: ADMIN_USER_ID,
            slug: SLUG_VALUE,
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim(),
            city: city.trim(),
            custom_question_0: budget,
            custom_question_1: timeline,
            eventId: eventId
         }

         const res = await fetch('/api/shared/landing-page/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
         })

         const resData = await res.json()
         if (!res.ok || !resData.success) {
            throw new Error(resData.error || 'Failed to submit details')
         }

         // Trigger Meta Pixel lead
         if (typeof window !== 'undefined' && (window as any).fbq) {
            (window as any).fbq('track', 'Lead', {
               content_name: 'Adrolls Premium Agency Integration',
               status: 'Qualified'
            }, { eventID: eventId })
         }

         setLeadId(resData.leadId)
         localStorage.setItem('adrolls_lead_submitted', 'true')
         
         // Move to Calendar slot booking
         setStep('calendar')
         const days = getNextBookingDays()
         if (days.length > 0) {
            setSelectedDate(days[0].dateStr)
         }
      } catch (err: any) {
         setErrorSubmit(err.message || 'Something went wrong. Please try again.')
      } finally {
         setIsSubmitting(false)
      }
   }

   const handleConfirmBooking = async () => {
      if (!selectedSlot) return
      setIsBooking(true)
      setErrorBooking('')
      try {
         const eventId = 'evt_sched_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11)
         const res = await fetch('/api/shared/booking/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               lead_id: leadId,
               slot: selectedSlot,
               user_id: ADMIN_USER_ID,
               eventId: eventId
            })
         })

         const data = await res.json()
         if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed to create booking')
         }

         // Trigger CAPI / Pixel schedule
         if (typeof window !== 'undefined' && (window as any).fbq) {
            (window as any).fbq('track', 'Schedule', {
               content_name: 'Adrolls Consultation Booking',
               status: 'Booked'
            }, { eventID: eventId })
         }

         setStep('confirmed')
      } catch (err: any) {
         setErrorBooking(err.message || 'Failed to book slot')
      } finally {
         setIsBooking(false)
      }
   }

   const handleSkipBooking = () => {
      setStep('success')
   }

   return (
      <div className="w-full text-slate-800">
         {header && (
            <div className="text-center mb-6">
               <h3 className="text-xl font-black text-[#124376] mb-1.5 tracking-tight">{header.title}</h3>
               <p className="text-xs text-slate-500 font-bold leading-normal">{header.desc}</p>
            </div>
         )}

         {/* Step 1: Qualification Custom Questions */}
         {step === 'qualification' && (
            <form onSubmit={(e) => { e.preventDefault(); setStep('contact'); }} className="space-y-5">
               {errorSubmit && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl">
                     {errorSubmit}
                  </div>
               )}
               <div className="space-y-2">
                  <label className="text-xs text-slate-600 font-black uppercase tracking-wider">What is your monthly marketing budget?</label>
                  <div className="grid grid-cols-3 gap-2">
                     {['10k - 20k', '20k - 30k', '50k+'].map(opt => (
                        <button
                           type="button"
                           key={opt}
                           onClick={() => setBudget(opt)}
                           className={`py-3 text-xs font-black rounded-xl border text-center transition-all cursor-pointer ${
                              budget === opt 
                              ? 'bg-[#124376] text-white border-[#124376] shadow-sm' 
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                           }`}
                        >
                           {opt}
                        </button>
                     ))}
                  </div>
               </div>

               <div className="space-y-2">
                  <label className="text-xs text-slate-600 font-black uppercase tracking-wider">When are you looking to get started?</label>
                  <div className="grid grid-cols-3 gap-2">
                     {['Immediately', 'This Week', 'Next Week'].map(opt => (
                        <button
                           type="button"
                           key={opt}
                           onClick={() => setTimeline(opt)}
                           className={`py-3 text-xs font-black rounded-xl border text-center transition-all cursor-pointer ${
                              timeline === opt 
                              ? 'bg-[#124376] text-white border-[#124376] shadow-sm' 
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                           }`}
                        >
                           {opt}
                        </button>
                     ))}
                  </div>
               </div>

               <div className="pt-2">
                  <button 
                     type="submit"
                     className="w-full py-4 bg-[#B31B20] hover:bg-[#902227] text-white font-extrabold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                     Continue <ChevronRight size={16} />
                  </button>
               </div>
            </form>
         )}

         {/* Step 2: Contact info */}
         {step === 'contact' && (
            <form onSubmit={handleLeadSubmit} className="space-y-4">
               {errorSubmit && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl">
                     {errorSubmit}
                  </div>
               )}
               <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Full Name</label>
                  <input 
                     type="text"
                     required
                     placeholder="John Doe"
                     value={name}
                     onChange={(e) => setName(e.target.value)}
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#124376] focus:outline-none focus:border-[#124376] transition-all"
                  />
               </div>
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">WhatsApp Number</label>
                     <input 
                        type="tel"
                        required
                        placeholder="+91 99999 99999"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#124376] focus:outline-none focus:border-[#124376] transition-all"
                     />
                  </div>
                  <div className="space-y-1">
                     <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">City</label>
                     <input 
                        type="text"
                        required
                        placeholder="e.g. Mohali"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#124376] focus:outline-none focus:border-[#124376] transition-all"
                     />
                  </div>
               </div>
               <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Email Address</label>
                  <input 
                     type="email"
                     required
                     placeholder="john@example.com"
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#124376] focus:outline-none focus:border-[#124376] transition-all"
                  />
               </div>
               <div className="flex gap-3 pt-2">
                  <button 
                     type="button"
                     onClick={() => setStep('qualification')}
                     className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-xl transition-all cursor-pointer"
                  >
                     Back
                  </button>
                  <button 
                     type="submit"
                     disabled={isSubmitting}
                     className="flex-1.5 py-4 bg-[#B31B20] hover:bg-[#902227] disabled:bg-slate-300 text-white font-extrabold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                     {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Confirm & Qualify'}
                  </button>
               </div>
            </form>
         )}

         {/* Step 3: Calendar slot booking */}
         {step === 'calendar' && (
            <div className="space-y-4 text-left">
               {/* Date buttons */}
               <div className="grid grid-cols-3 gap-1.5">
                  {getNextBookingDays().map(day => (
                     <button
                        type="button"
                        key={day.dateStr}
                        onClick={() => {
                           setSelectedDate(day.dateStr)
                           setSelectedSlot('')
                        }}
                        className={`py-2 px-1 text-[10px] font-black rounded-lg border text-center transition-all cursor-pointer ${
                           selectedDate === day.dateStr 
                           ? 'bg-[#124376] text-white border-[#124376]' 
                           : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                     >
                        {day.label}
                     </button>
                  ))}
               </div>

               {/* Slots container */}
               <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 min-h-[120px] max-h-[160px] overflow-y-auto">
                  {loadingSlots ? (
                     <div className="flex flex-col items-center justify-center py-6 text-xs text-slate-500 font-bold gap-2">
                        <Loader2 size={18} className="animate-spin text-[#124376]" />
                        <span>Finding free slots...</span>
                     </div>
                  ) : errorSlots ? (
                     <div className="text-center py-6 text-xs text-red-500 font-bold">{errorSlots}</div>
                  ) : slots.length === 0 ? (
                     <div className="text-center py-8 text-xs text-slate-400 font-bold">No available slots on this day.</div>
                  ) : (
                     <div className="grid grid-cols-2 gap-2">
                        {slots.map(slotStr => {
                           const timeLabel = new Date(slotStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                           return (
                              <button
                                 type="button"
                                 key={slotStr}
                                 onClick={() => setSelectedSlot(slotStr)}
                                 className={`py-2 text-[11px] font-bold rounded-lg border text-center transition-all cursor-pointer ${
                                    selectedSlot === slotStr 
                                    ? 'bg-[#DF9E27] text-white border-[#DF9E27]' 
                                    : 'bg-white text-[#124376] border-slate-200 hover:border-[#DF9E27] hover:text-[#DF9E27]'
                                 }`}
                              >
                                 {timeLabel}
                              </button>
                           )
                        })}
                     </div>
                  )}
               </div>

               {selectedSlot && (
                  <div className="pt-2">
                     {errorBooking && (
                        <div className="p-2.5 bg-red-50 text-red-700 text-xs font-bold rounded-xl mb-3">{errorBooking}</div>
                     )}
                     <button
                        type="button"
                        onClick={handleConfirmBooking}
                        disabled={isBooking}
                        className="w-full py-3 bg-[#22C55E] hover:bg-[#16A34A] disabled:bg-slate-300 text-white font-extrabold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                     >
                        {isBooking ? <Loader2 size={16} className="animate-spin" /> : 'Confirm Booking'}
                     </button>
                  </div>
               )}

               <div className="pt-2 text-center border-t border-slate-100">
                  <button
                     type="button"
                     onClick={handleSkipBooking}
                     className="text-slate-400 hover:text-slate-600 text-xs font-bold transition-colors cursor-pointer"
                  >
                     Skip scheduling for now
                  </button>
               </div>
            </div>
         )}

         {/* Step 4: Confirmed booking */}
         {step === 'confirmed' && (
            <div className="py-6 text-center space-y-4">
               <div className="w-14 h-14 bg-green-50 border border-green-200 rounded-full flex items-center justify-center text-green-600 mx-auto">
                  <CheckCircle2 size={32} />
               </div>
               <div>
                  <h4 className="text-lg font-black text-green-700">Booking Confirmed!</h4>
                  <p className="text-xs text-slate-500 font-bold mt-1 max-w-sm mx-auto leading-relaxed">
                     Your onboarding session has been successfully mapped onto Google Calendar. A calendar invite has been sent.
                  </p>
               </div>
               <button
                  type="button"
                  onClick={onComplete}
                  className="px-6 py-3 bg-[#124376] hover:bg-[#0c3157] text-white text-xs font-black rounded-xl transition-all cursor-pointer"
               >
                  Close & Proceed
               </button>
            </div>
         )}

         {/* Step 5: Direct Success without booking */}
         {step === 'success' && (
            <div className="py-6 text-center space-y-4">
               <div className="w-14 h-14 bg-green-50 border border-green-200 rounded-full flex items-center justify-center text-green-600 mx-auto">
                  <CheckCircle2 size={32} />
               </div>
               <div>
                  <h4 className="text-lg font-black text-green-700">Application Submitted!</h4>
                  <p className="text-xs text-slate-500 font-bold mt-1 max-w-sm mx-auto leading-relaxed">
                     Thank you! Your lead details have been submitted. Our engineering coordinators will reach out shortly.
                  </p>
               </div>
               <button
                  type="button"
                  onClick={onComplete}
                  className="px-6 py-3 bg-[#124376] hover:bg-[#0c3157] text-white text-xs font-black rounded-xl transition-all cursor-pointer"
               >
                  Close & Proceed
               </button>
            </div>
         )}
      </div>
   )
}
