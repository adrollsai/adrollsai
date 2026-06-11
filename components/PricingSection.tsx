'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { CheckCircle2, Sparkles } from 'lucide-react'

export default function PricingSection() {
   const [currency, setCurrency] = useState<'INR' | 'USD'>('INR')
   const [partnerLoginUrl, setPartnerLoginUrl] = useState('https://app.adrolls.in')

   useEffect(() => {
      try {
         const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
         if (tz && (tz.includes('Calcutta') || tz.includes('Kolkata') || tz.includes('Asia/Kolkata') || tz.includes('Asia/Calcutta') || tz.includes('Delhi') || tz.includes('India'))) {
            setCurrency('INR')
         } else {
            setCurrency('USD')
         }
      } catch (e) {
         setCurrency('INR')
      }
   }, [])

   useEffect(() => {
      const hostname = window.location.hostname
      const isDevOrTunnel =
         hostname === 'localhost' ||
         hostname === '127.0.0.1' ||
         hostname.includes('ngrok-free.dev') ||
         hostname.includes('ngrok.io')

      if (isDevOrTunnel) {
         setPartnerLoginUrl('/login')
      } else {
         setPartnerLoginUrl('https://app.adrolls.in')
      }
   }, [])

   return (
      <section id="pricing" className="py-24 bg-white relative border-t border-slate-200 z-10">
         <div className="max-w-[1400px] mx-auto px-6">
            <div className="text-center mb-12">
               <h2 className="text-4xl md:text-5xl font-black text-[#003D6F] mb-4">Simple, Transparent Pricing</h2>
               <p className="text-slate-600 text-lg font-medium mb-8">Everything you need to grow your business, at a price that makes sense.</p>
            </div>

            {/* Currency Switcher */}
            <div className="flex items-center justify-center gap-4 mb-12">
               <span className={`text-base font-black transition-colors ${currency === 'INR' ? 'text-[#B22B31]' : 'text-slate-400'}`}>Rupees (₹)</span>
               <button
                  onClick={() => setCurrency(currency === 'INR' ? 'USD' : 'INR')}
                  className="w-14 h-7 bg-slate-200 rounded-full p-1 relative transition-colors duration-300 focus:outline-none shadow-inner"
               >
                  <div className={`w-5 h-5 bg-[#003D6F] rounded-full absolute top-1 transition-all duration-300 ${currency === 'USD' ? 'left-8' : 'left-1'}`} />
               </button>
               <span className={`text-base font-black transition-colors ${currency === 'USD' ? 'text-[#B22B31]' : 'text-slate-400'}`}>Dollars ($)</span>
            </div>

            {/* Guarantee Banner */}
            <div className="flex justify-center mb-12">
               <div className="inline-flex items-center gap-2 bg-[#E6F4EA] border border-[#137333] rounded-2xl px-6 py-3 shadow-sm text-[#137333] font-black text-sm">
                  <CheckCircle2 size={18} className="text-[#137333] shrink-0" />
                  <span>100% RISK-FREE: 30-DAY MONEY-BACK GUARANTEE</span>
               </div>
            </div>

            {/* Pricing Cards Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch mb-20">

               {/* Growth Plan */}
               <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-lg hover:border-[#003D6F]/40 hover:shadow-xl transition-all duration-300 flex flex-col justify-between relative">
                  <div>
                     <h3 className="text-xl font-black text-[#003D6F] uppercase tracking-wider mb-2">Growth</h3>
                     <p className="text-slate-400 text-xs font-bold mb-6">For growing brands seeking automated scale</p>
                     <div className="flex items-baseline gap-1 mb-6">
                        <span className="text-4xl font-black text-[#B22B31]">
                           {currency === 'INR' ? '₹9,999' : '$199'}
                        </span>
                        <span className="text-slate-500 font-bold text-sm">/mo</span>
                     </div>
                     <div className="h-px bg-slate-100 mb-6" />
                     <ul className="space-y-3 mb-8">
                        {[
                           "30 AI High-Res Images / mo",
                           "30 AI SEO Blog Articles / mo",
                           "5 Meta Campaign Launches / mo",
                           "5 AI Campaign Optimizations / mo",
                           "5 Team seats & Full CRM",
                           "Social Auto-Posting",
                           "10 GB Cloud Storage",
                           "Priority Email Support"
                        ].map((feature, i) => (
                           <li key={i} className="flex items-center gap-2.5 text-slate-600 font-bold text-xs">
                              <CheckCircle2 size={16} className="text-[#F4B429] fill-current shrink-0" />
                              <span>{feature}</span>
                           </li>
                        ))}
                     </ul>
                  </div>
                  <Link
                     href={partnerLoginUrl}
                     className="block w-full py-4 bg-[#003D6F] hover:bg-[#00284d] text-white text-center rounded-xl font-black text-sm transition-all active:scale-95"
                  >
                     Start Growth Plan
                  </Link>
               </div>

               {/* Pro Plan (Best Value) */}
               <div className="bg-white border-2 border-[#003D6F] rounded-[2.5rem] p-8 shadow-xl relative flex flex-col justify-between lg:scale-105 z-10">
                  <div className="absolute top-0 right-8 bg-[#B22B31] text-white px-4 py-1.5 rounded-b-lg text-[10px] font-black uppercase tracking-widest">
                     Best Value
                  </div>
                  <div>
                     <h3 className="text-xl font-black text-[#003D6F] uppercase tracking-wider mb-2">Pro</h3>
                     <p className="text-slate-400 text-xs font-bold mb-6">Ultimate automated growth engine</p>
                     <div className="flex items-baseline gap-1 mb-6">
                        <span className="text-4xl font-black text-[#B22B31]">
                           {currency === 'INR' ? '₹14,999' : '$299'}
                        </span>
                        <span className="text-slate-500 font-bold text-sm">/mo</span>
                     </div>
                     <div className="h-px bg-slate-100 mb-6" />
                     <ul className="space-y-3 mb-8">
                        {[
                           "60 AI High-Res Images / mo",
                           "30 AI SEO Blog Articles / mo",
                           "8 Meta Campaign Launches / mo",
                           "8 AI Campaign Optimizations / mo",
                           "10 Team seats & Full CRM",
                           "Social Auto-Posting",
                           "10 GB Cloud Storage",
                           "Priority WhatsApp Support"
                        ].map((feature, i) => (
                           <li key={i} className="flex items-center gap-2.5 text-slate-700 font-bold text-xs">
                              <CheckCircle2 size={16} className="text-[#F4B429] fill-current shrink-0" />
                              <span>{feature}</span>
                           </li>
                        ))}
                     </ul>
                  </div>
                  <Link
                     href={partnerLoginUrl}
                     className="block w-full py-4 bg-[#B22B31] hover:bg-[#902227] text-white text-center rounded-xl font-black text-sm transition-all shadow-md active:scale-95 shadow-[#B22B31]/30"
                  >
                     Start Pro Plan
                  </Link>
               </div>

               {/* Enterprise Plan */}
               <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-lg hover:border-[#003D6F]/40 hover:shadow-xl transition-all duration-300 flex flex-col justify-between relative">
                  <div>
                     <h3 className="text-xl font-black text-[#003D6F] uppercase tracking-wider mb-2">Enterprise</h3>
                     <p className="text-slate-400 text-xs font-bold mb-6">Premium massive quotas for large agencies</p>
                     <div className="flex items-baseline gap-1 mb-6">
                        <span className="text-4xl font-black text-[#B22B31]">
                           {currency === 'INR' ? '₹24,999' : '$499'}
                        </span>
                        <span className="text-slate-500 font-bold text-sm">/mo</span>
                     </div>
                     <div className="h-px bg-slate-100 mb-6" />
                     <ul className="space-y-3 mb-8">
                        {[
                           "90 AI High-Res Images / mo",
                           "30 AI SEO Blog Articles / mo",
                           "15 Meta Campaign Launches / mo",
                           "15 AI Campaign Optimizations / mo",
                           "20 Team seats & Full CRM",
                           "Social Auto-Posting",
                           "10 GB Cloud Storage",
                           "24/7 Account Manager"
                        ].map((feature, i) => (
                           <li key={i} className="flex items-center gap-2.5 text-slate-600 font-bold text-xs">
                              <CheckCircle2 size={16} className="text-[#F4B429] fill-current shrink-0" />
                              <span>{feature}</span>
                           </li>
                        ))}
                     </ul>
                  </div>
                  <Link
                     href={partnerLoginUrl}
                     className="block w-full py-4 bg-slate-900 hover:bg-slate-800 text-white text-center rounded-xl font-black text-sm transition-all active:scale-95"
                  >
                     Start Enterprise Plan
                  </Link>
               </div>

            </div>
         </div>
      </section>
   )
}
