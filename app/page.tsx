'use client'

import React, { useState, useEffect } from 'react'
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
  Menu,
  X,
  Sparkles,
  Send
} from 'lucide-react'
import Link from 'next/link'
import { motion, useScroll, AnimatePresence } from 'framer-motion'

// --- CHAT MASCOT COMPONENT ---
const ChatMascot = () => {
  const { scrollYProgress } = useScroll();
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      {/* --- THE CHAT WINDOW --- */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-32 right-6 z-[70] w-[300px] md:w-[350px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden font-sans"
          >
            {/* Header */}
            <div className="bg-[#003D6F] p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white font-bold">
                  <span className="text-xs">AI</span>
                </div>
                <div>
                  <h4 className="text-white font-bold text-sm">AdRolls Assistant</h4>
                  <p className="text-blue-200 text-xs flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"/> Online
                  </p>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 h-64 bg-slate-50 overflow-y-auto flex flex-col gap-3">
              <div className="bg-white p-3 rounded-tr-xl rounded-bl-xl rounded-br-xl shadow-sm border border-slate-100 self-start max-w-[85%]">
                <p className="text-slate-600 text-sm">
                  Hello! I'm Rolls. 🐶 <br/>How can I help you grow your business today?
                </p>
              </div>
            </div>

            {/* Input */}
            <div className="p-3 border-t border-slate-100 bg-white flex gap-2">
              <input 
                type="text" 
                placeholder="Type your question..." 
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#003D6F]"
              />
              <button className="bg-[#003D6F] text-white p-2 rounded-lg hover:bg-[#002a4d]">
                <Send size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- THE DOG BUTTON --- */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-[60] cursor-pointer group flex flex-col items-end"
      >
        <motion.div 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-24 h-24 md:w-28 md:h-28 relative filter drop-shadow-xl"
        >
          {/* REPLACED SVG WITH YOUR PNG */}
          <motion.img 
            src="https://i.ibb.co/C50rBTBj/pixar-style.png"
            alt="Rolls the Dog"
            className="w-full h-full object-contain"
            // Breathing Animation
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          />
        </motion.div>
        
        {/* Helper Badge */}
        <div className="mt-2 bg-[#003D6F] px-3 py-1 rounded-full shadow-lg border border-white/20">
          <p className="text-white font-bold text-[10px] md:text-xs whitespace-nowrap">
            Woof! I'm Rolls! Need help?
          </p>
        </div>
      </div>
    </>
  )
}

// --- MAIN PAGE ---
export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  
  const PARTNER_LOGIN_URL = process.env.NODE_ENV === 'development' 
  ? '/login' 
  : 'https://app.adrolls.in';

  return (
    <div className="min-h-screen bg-slate-50 text-[#003D6F] font-sans selection:bg-[#F4B429]/30 selection:text-[#003D6F] overflow-x-hidden relative">
      
      {/* Background Texture */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#003D6F 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      </div>

      {/* --- CHAT MASCOT --- */}
      <ChatMascot />

      {/* --- NAVIGATION --- */}
      <nav className="fixed top-0 w-full z-50 border-b border-[#003D6F]/10 bg-white/95 backdrop-blur-xl transition-all duration-300">
        <div className="max-w-[1400px] mx-auto px-6 h-32 md:h-40 flex items-center justify-between">
          
          {/* LOGO */}
          <div className="flex items-center gap-2 shrink-0">
            <img 
              src="https://i.ibb.co/7dDJdPgS/bg-removed.png" 
              alt="AdRolls" 
              className="h-24 md:h-32 w-auto min-w-[200px] object-contain hover:scale-105 transition-transform duration-300 drop-shadow-sm"
            />
          </div>
          
          {/* DESKTOP MENU */}
          <div className="hidden lg:flex items-center gap-12 text-lg font-bold text-[#003D6F]/90">
            <a href="#features" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Features</a>
            <a href="#ads" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Meta Ads</a>
            <a href="#pricing" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Pricing</a>
          </div>

          {/* CTA BUTTONS */}
          <div className="hidden lg:flex items-center gap-6">
            <Link 
              href={PARTNER_LOGIN_URL} 
              className="text-[#003D6F] hover:text-[#B22B31] font-bold text-lg px-2"
            >
              Signup/Login
            </Link>
            <Link 
              href={PARTNER_LOGIN_URL} 
              className="bg-[#B22B31] hover:bg-[#902227] text-white px-10 py-4 rounded-full text-lg font-bold transition-all shadow-[0_10px_30px_-10px_rgba(178,43,49,0.5)] active:scale-95 flex items-center gap-2"
            >
              Get Started <ArrowRight size={20}/>
            </Link>
          </div>

          {/* MOBILE MENU TOGGLE */}
          <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="lg:hidden text-[#003D6F] p-2 bg-slate-100 rounded-lg">
            {isMenuOpen ? <X size={32} /> : <Menu size={32} />}
          </button>
        </div>

        {/* MOBILE MENU */}
        {isMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 bg-white p-6 absolute w-full shadow-2xl flex flex-col gap-6 z-50 text-xl">
             <a href="#features" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F] font-bold">Features</a>
             <a href="#ads" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F] font-bold">Meta Ads</a>
             <a href="#pricing" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F] font-bold">Pricing</a>
             <Link href={PARTNER_LOGIN_URL} className="text-[#B22B31] font-bold">Signup/Login</Link>
          </div>
        )}
      </nav>

      {/* --- HERO SECTION --- */}
      <section className="relative pt-48 pb-24 md:pt-64 md:pb-40 overflow-hidden z-10">
        <div className="absolute top-0 right-0 w-[50vw] h-[50vw] bg-[#F4B429]/10 blur-[120px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[40vw] h-[40vw] bg-[#003D6F]/5 blur-[100px] rounded-full pointer-events-none translate-y-1/4 -translate-x-1/4" />
        
        <div className="max-w-[1400px] mx-auto px-6 relative z-10">
          <div className="text-center max-w-6xl mx-auto mb-20">
            <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-white border-2 border-[#003D6F]/5 text-[#003D6F] text-sm font-extrabold uppercase tracking-widest mb-10 shadow-lg cursor-default">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B22B31] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#B22B31]"></span>
              </span>
              AI Marketing Suite for Small & Medium Businesses
            </div>
            
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight text-[#003D6F] leading-[1.05] mb-10 drop-shadow-sm">
              Grow Your Business <br className="hidden md:block"/>
              <span className="relative inline-block">
                <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-[#B22B31] via-[#D35F30] to-[#F4B429]">
                   On Autopilot.
                </span>
                <svg className="absolute -bottom-2 md:-bottom-4 left-0 w-full h-4 md:h-6 text-[#F4B429]/40 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
                   <path d="M0 5 Q 50 15 100 5" stroke="currentColor" strokeWidth="12" fill="none" />
                </svg>
              </span>
            </h1>
            
            <p className="text-xl md:text-2xl text-slate-600 mb-14 leading-relaxed max-w-3xl mx-auto font-medium">
              Stop juggling 10 different tools. AdRolls uses AI to design your graphics, manage products & services, post to social, and launch ads—<span className="text-[#003D6F] font-bold bg-blue-50 px-2 py-1 rounded">all in one place.</span>
            </p>
            
            <div className="flex flex-col sm:flex-row items-center gap-6 justify-center">
              <Link href={PARTNER_LOGIN_URL} className="group w-full sm:w-auto px-12 py-6 bg-[#B22B31] text-white text-xl rounded-2xl font-bold hover:bg-[#902227] transition-all flex items-center justify-center gap-3 shadow-[0_20px_40px_-15px_rgba(178,43,49,0.3)] hover:-translate-y-1">
                Start Growing Today 
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform"/>
              </Link>
              <Link href={PARTNER_LOGIN_URL} className="w-full sm:w-auto px-12 py-6 bg-white border-2 border-[#003D6F]/10 text-[#003D6F] text-xl rounded-2xl font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-3 hover:-translate-y-1 hover:border-[#003D6F]/30 hover:shadow-lg">
                <Play className="w-5 h-5 fill-current"/> Watch Demo
              </Link>
            </div>

            <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-6 text-base text-slate-500 font-bold">
              <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-[#F4B429] fill-current" /> No Design Skills Needed
              </div>
              <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-[#F4B429] fill-current" /> Automated SEO
              </div>
              <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-xl border border-slate-200 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-[#F4B429] fill-current" /> Meta CAPI Integration
              </div>
            </div>
          </div>

          {/* DASHBOARD PREVIEW */}
          <div className="relative mx-auto max-w-[1200px]">
             <div className="absolute -inset-1 bg-gradient-to-r from-[#B22B31] via-[#F4B429] to-[#003D6F] rounded-[2.5rem] blur-xl opacity-20"></div>
             
             <div className="relative rounded-[2.5rem] bg-white border-4 border-slate-100 p-4 shadow-2xl shadow-[#003D6F]/10">
                <div className="bg-slate-50 rounded-[2rem] overflow-hidden aspect-[16/10] md:aspect-[21/9] relative flex items-center justify-center border border-slate-200">
                   
                   {/* Abstract UI Representation */}
                   <div className="absolute inset-0 grid grid-cols-12 grid-rows-6 gap-6 p-8 md:p-12">
                      <div className="hidden md:block col-span-2 row-span-6 bg-white rounded-2xl border-2 border-slate-100 shadow-sm"></div>
                      <div className="col-span-12 md:col-span-10 row-span-1 bg-white rounded-2xl border-2 border-slate-100 shadow-sm flex items-center px-6 gap-4">
                         <div className="w-32 h-4 bg-slate-100 rounded-full"></div>
                         <div className="flex-1"></div>
                         <div className="w-10 h-10 rounded-full bg-[#B22B31]/10 border border-[#B22B31]/20"></div>
                      </div>
                      <div className="col-span-12 md:col-span-7 row-span-3 bg-white rounded-2xl border-2 border-slate-100 shadow-sm p-8 relative overflow-hidden group">
                         <div className="flex justify-between items-center mb-8">
                            <div className="h-4 w-32 bg-slate-100 rounded"></div>
                            <div className="px-3 py-1 bg-green-100 rounded-full flex items-center justify-center text-green-700 text-sm font-bold border border-green-200">+24.5%</div>
                         </div>
                         <div className="flex items-end gap-3 h-32 w-full">
                            {[40, 60, 45, 70, 50, 80, 65, 90].map((h, i) => (
                               <div key={i} className="flex-1 bg-[#003D6F] rounded-t-lg opacity-10" style={{height: `${h}%`}}></div>
                            ))}
                         </div>
                      </div>
                      <div className="hidden md:block col-span-3 row-span-3 space-y-4">
                         <div className="h-1/2 bg-[#B22B31] rounded-2xl shadow-xl shadow-[#B22B31]/20 p-6 text-white flex flex-col justify-between relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-20"><Zap size={48}/></div>
                            <div className="text-sm font-medium opacity-80">Active Leads</div>
                            <div className="text-4xl font-bold">1,204</div>
                         </div>
                         <div className="h-1/2 bg-white rounded-2xl border-2 border-slate-100 shadow-sm p-6 flex flex-col justify-center items-center">
                            <div className="w-14 h-14 rounded-full bg-[#F4B429]/20 flex items-center justify-center text-[#F4B429] mb-3">
                               <Megaphone size={28}/>
                            </div>
                            <div className="text-base font-bold text-[#003D6F]">Ad Running</div>
                         </div>
                      </div>
                      <div className="col-span-12 md:col-span-10 row-span-2 grid grid-cols-3 gap-6">
                         {[1,2,3].map(i => (
                            <div key={i} className="bg-white rounded-2xl border-2 border-slate-100 shadow-sm p-5 flex gap-4 items-center">
                               <div className="w-14 h-14 bg-slate-100 rounded-xl"></div>
                               <div className="space-y-2 flex-1">
                                  <div className="h-3 w-3/4 bg-slate-100 rounded"></div>
                                  <div className="h-2 w-1/2 bg-slate-100 rounded"></div>
                               </div>
                            </div>
                         ))}
                      </div>
                   </div>

                </div>
             </div>
          </div>
        </div>
      </section>

      {/* --- FEATURES GRID --- */}
      <section id="features" className="py-32 bg-white relative z-10">
         <div className="max-w-[1400px] mx-auto px-6">
            <div className="mb-20 text-center">
               <span className="text-[#B22B31] font-bold tracking-wider uppercase text-sm bg-red-50 px-3 py-1 rounded-full border border-red-100">Everything You Need</span>
               <h2 className="text-4xl md:text-5xl font-black text-[#003D6F] mt-4">Built for Growth</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-8 auto-rows-[320px]">
               {/* Card 1 */}
               <div className="md:col-span-2 lg:col-span-2 row-span-1 bg-white border-2 border-slate-200 p-10 rounded-[2.5rem] shadow-lg shadow-slate-200/50 hover:border-[#F4B429] hover:shadow-2xl hover:shadow-[#003D6F]/10 transition-all group relative overflow-hidden flex flex-col justify-between">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[#B22B31]/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-125 transition-transform duration-700"/>
                  <div className="w-16 h-16 bg-[#B22B31]/10 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-[#B22B31] group-hover:text-white transition-colors duration-300">
                     <Palette className="w-8 h-8" />
                  </div>
                  <div>
                     <h3 className="text-3xl font-bold text-[#003D6F] mb-3">AI Graphic Studio</h3>
                     <p className="text-lg text-slate-600 leading-relaxed max-w-md">
                        Generate professional social media posts and ad creatives in seconds.
                     </p>
                  </div>
               </div>

               {/* Card 2 */}
               <div className="md:col-span-1 lg:col-span-1 row-span-2 bg-[#003D6F] text-white p-10 rounded-[2.5rem] shadow-xl hover:translate-y-[-5px] transition-all group relative overflow-hidden flex flex-col border-4 border-[#003D6F]">
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#00284d]"/>
                  <div className="relative z-10 flex-1">
                     <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-8 backdrop-blur-sm">
                        <Megaphone className="w-8 h-8 text-[#F4B429]" />
                     </div>
                     <h3 className="text-3xl font-bold mb-4">One-Click Posting</h3>
                     <p className="text-blue-200 text-lg leading-relaxed">
                        Publish to Facebook, Instagram, LinkedIn, and Twitter simultaneously.
                     </p>
                  </div>
                  <div className="relative z-10 mt-8 bg-white/10 rounded-xl p-4 backdrop-blur-md border border-white/10">
                     <div className="flex gap-2 mb-2">
                        <div className="w-2 h-2 rounded-full bg-red-400"/>
                        <div className="w-2 h-2 rounded-full bg-yellow-400"/>
                        <div className="w-2 h-2 rounded-full bg-green-400"/>
                     </div>
                     <div className="h-2 w-3/4 bg-white/20 rounded mb-2"/>
                     <div className="h-2 w-1/2 bg-white/20 rounded"/>
                  </div>
               </div>

               {/* Card 3 */}
               <div className="md:col-span-1 lg:col-span-1 row-span-1 bg-white border-2 border-slate-200 p-10 rounded-[2.5rem] shadow-lg shadow-slate-200/50 hover:border-[#003D6F] transition-all group flex flex-col justify-between">
                  <div className="w-14 h-14 bg-[#003D6F]/10 rounded-2xl flex items-center justify-center group-hover:bg-[#003D6F] group-hover:text-white transition-colors">
                     <LayoutGrid className="w-7 h-7" />
                  </div>
                  <div>
                     <h3 className="text-2xl font-bold text-[#003D6F] mb-2">Products & Services Sync</h3>
                     <p className="text-slate-600 font-medium">Update listings once, sync everywhere instantly.</p>
                  </div>
               </div>

               {/* Card 4 */}
               <div className="md:col-span-2 lg:col-span-1 row-span-1 bg-white border-2 border-slate-200 p-10 rounded-[2.5rem] shadow-lg shadow-slate-200/50 hover:border-[#003D6F] transition-all group flex flex-col justify-between">
                  <div className="w-14 h-14 bg-[#003D6F]/10 rounded-2xl flex items-center justify-center group-hover:bg-[#003D6F] group-hover:text-white transition-colors">
                     <Globe className="w-7 h-7" />
                  </div>
                  <div>
                     <h3 className="text-2xl font-bold text-[#003D6F] mb-2">Automated SEO</h3>
                     <p className="text-slate-600 font-medium">Rank on Google without hiring an agency.</p>
                  </div>
               </div>

               {/* Card 5 */}
               <div className="md:col-span-2 lg:col-span-2 row-span-1 bg-gradient-to-br from-[#F4B429] to-[#E5A825] p-10 rounded-[2.5rem] shadow-xl transition-all group relative overflow-hidden flex flex-col justify-between border-4 border-[#F4B429]">
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-sm text-[#003D6F]">
                     <Sparkles className="w-8 h-8" />
                  </div>
                  <div className="text-[#003D6F]">
                     <h3 className="text-3xl font-black mb-3">High Conversion Pages</h3>
                     <p className="text-lg font-bold opacity-80 max-w-md leading-snug">
                        Automatically generate beautiful landing pages designed to turn visitors into customers.
                     </p>
                  </div>
               </div>

               {/* Card 6 */}
               <div className="md:col-span-1 lg:col-span-1 row-span-1 bg-white border-2 border-slate-200 p-10 rounded-[2.5rem] shadow-lg shadow-slate-200/50 hover:border-[#B22B31] transition-all group flex flex-col justify-between">
                  <div className="w-14 h-14 bg-[#B22B31]/10 rounded-2xl flex items-center justify-center group-hover:bg-[#B22B31] group-hover:text-white transition-colors">
                     <Users2 className="w-7 h-7" />
                  </div>
                  <div>
                     <h3 className="text-2xl font-bold text-[#003D6F] mb-2">Integrated CRM</h3>
                     <p className="text-slate-600 font-medium">Manage leads directly inside AdRolls.</p>
                  </div>
               </div>
            </div>
         </div>
      </section>

      {/* --- DEEP DIVE: META ADS --- */}
      <section id="ads" className="py-32 bg-slate-50 overflow-hidden relative z-10">
        <div className="max-w-[1400px] mx-auto px-6">
           <div className="bg-[#003D6F] rounded-[3rem] p-10 md:p-20 relative overflow-hidden shadow-2xl">
              <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-[#B22B31] blur-[200px] opacity-30 rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none"/>
              <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-[#F4B429] blur-[150px] opacity-10 rounded-full -translate-x-1/2 translate-y-1/2 pointer-events-none"/>
              
              <div className="relative z-10 flex flex-col lg:flex-row items-center gap-16 text-white">
                <div className="flex-1">
                  <div className="inline-block px-4 py-2 bg-[#F4B429]/20 rounded-full text-[#F4B429] text-xs font-extrabold tracking-widest uppercase mb-6 backdrop-blur-md border border-[#F4B429]/30">
                    Premium Feature
                  </div>
                  <h3 className="text-4xl md:text-6xl font-black mb-8 leading-tight">
                    Smarter Ads.<br/>Better Leads.
                  </h3>
                  <p className="text-slate-200 mb-10 text-xl leading-relaxed max-w-xl font-medium">
                    Most small businesses waste money on ads that don't track results. AdRolls uses <b className="text-[#F4B429]">Meta Conversions API (CAPI)</b> to send server-side data directly to Facebook/Instagram. 
                  </p>
                  <ul className="space-y-6 mb-12">
                     <li className="flex items-center gap-4 text-white text-lg font-medium">
                        <div className="w-8 h-8 bg-[#F4B429] rounded-full flex items-center justify-center text-[#003D6F] font-bold shadow-lg shadow-[#F4B429]/20">
                           <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <span>Bypass browser cookie blockers</span>
                     </li>
                     <li className="flex items-center gap-4 text-white text-lg font-medium">
                        <div className="w-8 h-8 bg-[#F4B429] rounded-full flex items-center justify-center text-[#003D6F] font-bold shadow-lg shadow-[#F4B429]/20">
                           <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <span>Train AI to find high-intent buyers</span>
                     </li>
                  </ul>
                  <Link href={PARTNER_LOGIN_URL} className="inline-block bg-white text-[#003D6F] px-8 py-4 rounded-xl font-bold text-lg hover:bg-[#F4B429] hover:text-[#003D6F] transition-all shadow-xl hover:scale-105">
                    Start Running AI Ads
                  </Link>
                </div>
                
                <div className="flex-1 w-full max-w-lg">
                   <div className="bg-white/10 backdrop-blur-xl rounded-[2.5rem] border border-white/20 p-8 shadow-2xl relative">
                      <div className="absolute -top-10 -right-10 bg-[#B22B31] p-5 rounded-2xl shadow-xl animate-bounce">
                         <Target className="w-8 h-8 text-white"/>
                      </div>

                      <div className="flex justify-between items-center mb-8">
                         <h4 className="font-bold text-white text-xl">Performance</h4>
                         <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-bold border border-green-500/30">+24% Growth</span>
                      </div>
                      <div className="space-y-6">
                         <div className="bg-black/30 p-6 rounded-2xl flex justify-between items-center border border-white/5 backdrop-blur-md">
                            <div className="flex items-center gap-4">
                                <div className="bg-[#B22B31]/20 p-3 rounded-xl text-[#B22B31]"><Users2 size={24}/></div>
                                <div>
                                  <div className="text-sm text-slate-300 mb-1">Total Leads</div>
                                  <div className="text-2xl font-black text-white">2,405</div>
                                </div>
                            </div>
                         </div>
                      </div>
                   </div>
                </div>
              </div>
           </div>
        </div>
      </section>

      {/* --- PRICING SECTION --- */}
      <section id="pricing" className="py-32 bg-white relative border-t border-slate-200 z-10">
        <div className="max-w-[1400px] mx-auto px-6">
           <div className="text-center mb-20">
              <h2 className="text-4xl md:text-6xl font-black text-[#003D6F] mb-6">Simple, Transparent Pricing</h2>
              <p className="text-slate-600 text-xl font-medium">Everything you need to grow your business, at a price that makes sense.</p>
           </div>

           <div className="max-w-xl mx-auto bg-white border-2 border-slate-200 rounded-[3rem] overflow-hidden shadow-2xl shadow-[#003D6F]/10 relative hover:border-[#F4B429] transition-all duration-300 group">
              <div className="absolute top-0 inset-x-0 h-4 bg-gradient-to-r from-[#003D6F] via-[#B22B31] to-[#F4B429]"></div>
              
              <div className="p-12 text-center border-b border-slate-100">
                 <h3 className="text-xl font-extrabold text-[#003D6F] uppercase tracking-widest mb-4">Starter Plan</h3>
                 <div className="flex items-baseline justify-center gap-2 mb-6">
                    <span className="text-lg text-slate-500 font-medium">Starting at</span>
                    <span className="text-7xl font-black text-[#B22B31]">₹999</span>
                    <span className="text-slate-500 font-medium">/mo</span>
                 </div>
                 <p className="text-slate-500 text-lg font-medium">Perfect for small businesses and solo entrepreneurs.</p>
              </div>

              <div className="p-12 bg-slate-50/50">
                 <ul className="space-y-6 mb-10">
                    {[
                      "AI Social Media Content & Posting",
                      "Product & Service Management",
                      "Basic CRM Functionality",
                      "Meta Ads Manager (Self-Serve)",
                      "High-Conversion Landing Page"
                    ].map((feature, i) => (
                      <li key={i} className="flex items-center gap-4 text-slate-700 text-lg font-bold">
                         <div className="w-6 h-6 rounded-full bg-[#F4B429]/20 flex items-center justify-center text-[#B22B31] shrink-0">
                           <CheckCircle2 className="w-4 h-4" />
                         </div>
                         {feature}
                      </li>
                    ))}
                 </ul>
                 
                 <Link 
                    href={PARTNER_LOGIN_URL}
                    className="block w-full py-6 bg-[#003D6F] hover:bg-[#00284d] text-white text-center rounded-2xl font-bold text-xl transition-all shadow-xl shadow-[#003D6F]/20 hover:scale-[1.02]"
                 >
                    Get Started Now
                 </Link>
                 <p className="text-center text-sm text-slate-400 mt-6 font-medium">No credit card required for demo.</p>
              </div>
           </div>
        </div>
      </section>

      {/* --- FOOTER / CTA --- */}
      <section className="py-32 bg-slate-50 border-t border-slate-200 z-10 relative">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-5xl md:text-7xl font-black text-[#003D6F] mb-10 tracking-tight leading-none">
            Ready to Automate <br/><span className="text-[#B22B31]">Your Marketing?</span>
          </h2>
          <p className="text-slate-600 mb-12 text-xl font-medium">
            Join hundreds of small businesses growing faster with AdRolls.
          </p>
          
          <div className="flex justify-center">
             <Link 
               href={PARTNER_LOGIN_URL}
               className="bg-[#B22B31] hover:bg-[#902227] text-white px-12 py-5 rounded-xl font-bold text-lg transition-all shadow-lg hover:scale-105"
             >
               Start Free Trial
             </Link>
          </div>
        </div>
      </section>
      
      {/* Footer Links */}
      <footer className="bg-[#003D6F] py-16 border-t border-[#00284d] text-white relative z-10">
         <div className="max-w-[1400px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center backdrop-blur-sm">
                <Rocket className="text-white w-5 h-5" />
              </div>
              <span className="text-xl font-bold tracking-tight">AdRolls.in</span>
            </div>
            
            <div className="text-slate-300 text-sm font-medium order-3 md:order-2">
               &copy; 2024 AdRolls Intelligence Pvt Ltd. All rights reserved.
            </div>

            <div className="flex flex-wrap justify-center gap-8 order-2 md:order-3">
              <Link
                href="/privacy-policy"
                className="text-slate-300 hover:text-[#F4B429] font-bold transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms-and-conditions"
                className="text-slate-300 hover:text-[#F4B429] font-bold transition-colors"
              >
                Terms & Conditions
              </Link>
              <Link
                href="/refund-policy"
                className="text-slate-300 hover:text-[#F4B429] font-bold transition-colors"
              >
                Refund Policy
              </Link>
            </div>
         </div>
      </footer>

    </div>
  )
}