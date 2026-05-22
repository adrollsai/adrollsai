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
  Send,
  Phone,
  Mail,
  MessageSquare,
  Loader2
} from 'lucide-react'
import Link from 'next/link'
import { motion, useScroll, AnimatePresence } from 'framer-motion'
import { createClient } from '@/utils/supabase/client'

/**
 * --- CHAT MASCOT COMPONENT ---
 * Handles the floating AI dog mascot and its chat window.
 */
const ChatMascot = () => {
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
          <motion.img 
            src="https://i.ibb.co/C50rBTBj/pixar-style.png"
            alt="Rolls the Dog"
            className="w-full h-full object-contain"
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          />
        </motion.div>
        
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
  const [partnerLoginUrl, setPartnerLoginUrl] = useState('https://app.adrolls.in')
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR')

  // Contact Form State
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactMessage, setContactMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contactName,
          email: contactEmail,
          phone: contactPhone,
          message: contactMessage
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit query.')
      }

      setSubmitSuccess(true)
      setContactName('')
      setContactEmail('')
      setContactPhone('')
      setContactMessage('')
    } catch (err: any) {
      setSubmitError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && (tz.includes('Calcutta') || tz.includes('Kolkata') || tz.includes('Asia/Kolkata') || tz.includes('Asia/Calcutta') || tz.includes('Delhi') || tz.includes('India'))) {
        setCurrency('INR')
      } else {
        setCurrency('USD')
      }
    } catch (e) {
      setCurrency('INR')
    }
  }, [])

  /**
   * DYNAMIC ENVIRONMENT DETECTION
   * Ensures that login/signup buttons point to the local instance if testing on 
   * localhost or ngrok, preventing cross-domain session issues.
   */
  useEffect(() => {
    const hostname = window.location.hostname;
    const isDevOrTunnel = 
      hostname === 'localhost' || 
      hostname === '127.0.0.1' || 
      hostname.includes('ngrok-free.dev') || 
      hostname.includes('ngrok.io');

    if (isDevOrTunnel) {
      setPartnerLoginUrl('/login'); 
    } else {
      setPartnerLoginUrl('https://app.adrolls.in');
    }
  }, []);

  const [hasSession, setHasSession] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) setHasSession(true)
    }
    checkSession()
  }, [supabase])

  return (
    <div className="min-h-screen bg-slate-50 text-[#003D6F] font-sans selection:bg-[#F4B429]/30 selection:text-[#003D6F] overflow-x-hidden relative">
      
      {/* Background Texture Overlay */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'radial-gradient(#003D6F 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      </div>

      {/* Mascot Integration - Only show static version if NOT logged in */}
      {!hasSession && <ChatMascot />}

      {/* --- NAVIGATION BAR --- */}
      <nav className="fixed top-0 w-full z-50 border-b border-[#003D6F]/10 bg-white/95 backdrop-blur-xl transition-all duration-300">
        <div className="max-w-[1400px] mx-auto px-6 h-32 md:h-40 flex items-center justify-between">
          
          {/* Brand Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <img 
              src="https://i.ibb.co/7dDJdPgS/bg-removed.png" 
              alt="AdRolls" 
              className="h-24 md:h-32 w-auto min-w-[200px] object-contain hover:scale-105 transition-transform duration-300 drop-shadow-sm"
            />
          </div>
          
          {/* Desktop Navigation Links */}
          <div className="hidden lg:flex items-center gap-12 text-lg font-bold text-[#003D6F]/90">
            <a href="#features" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Features</a>
            <a href="#ads" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Meta Ads</a>
            <a href="#pricing" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Pricing</a>
            <a href="#contact" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Contact</a>
          </div>

          {/* Desktop Call to Action */}
          <div className="hidden lg:flex items-center gap-6">
            <Link 
              href={partnerLoginUrl} 
              className="text-[#003D6F] hover:text-[#B22B31] font-bold text-lg px-2"
            >
              Signup/Login
            </Link>
            <Link 
              href={partnerLoginUrl} 
              className="bg-[#B22B31] hover:bg-[#902227] text-white px-10 py-4 rounded-full text-lg font-bold transition-all shadow-[0_10px_30px_-10px_rgba(178,43,49,0.5)] active:scale-95 flex items-center gap-2"
            >
              Get Started <ArrowRight size={20}/>
            </Link>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="lg:hidden text-[#003D6F] p-2 bg-slate-100 rounded-lg">
            {isMenuOpen ? <X size={32} /> : <Menu size={32} />}
          </button>
        </div>

        {/* Mobile Sidebar Navigation */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="lg:hidden fixed top-32 md:top-40 left-0 w-full h-screen bg-white border-t border-slate-200 p-6 flex flex-col gap-6 z-50 text-xl font-bold"
            >
               <a href="#features" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Features</a>
               <a href="#ads" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Meta Ads</a>
               <a href="#pricing" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Pricing</a>
               <a href="#contact" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Contact</a>
               <div className="h-px w-full bg-slate-100 my-2" />
               <Link href={partnerLoginUrl} className="text-[#B22B31]">Signup/Login</Link>
            </motion.div>
          )}
        </AnimatePresence>
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
              <Link href={partnerLoginUrl} className="group w-full sm:w-auto px-12 py-6 bg-[#B22B31] text-white text-xl rounded-2xl font-bold hover:bg-[#902227] transition-all flex items-center justify-center gap-3 shadow-[0_20px_40px_-15px_rgba(178,43,49,0.3)] hover:-translate-y-1">
                Start Growing Today 
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform"/>
              </Link>
              <Link href={partnerLoginUrl} className="w-full sm:w-auto px-12 py-6 bg-white border-2 border-[#003D6F]/10 text-[#003D6F] text-xl rounded-2xl font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-3 hover:-translate-y-1 hover:border-[#003D6F]/30 hover:shadow-lg">
                <Play className="w-5 h-5 fill-current"/> Watch Demo
              </Link>
            </div>

            {/* Feature Badges */}
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

          {/* DASHBOARD MOCKUP PREVIEW */}
          <div className="relative mx-auto max-w-[1200px]">
             <div className="absolute -inset-1 bg-gradient-to-r from-[#B22B31] via-[#F4B429] to-[#003D6F] rounded-[2.5rem] blur-xl opacity-20"></div>
             
             <div className="relative rounded-[2.5rem] bg-white border-4 border-slate-100 p-4 shadow-2xl shadow-[#003D6F]/10">
                <div className="bg-slate-50 rounded-[2rem] overflow-hidden aspect-[16/10] md:aspect-[21/9] relative flex items-center justify-center border border-slate-200">
                   {/* Visual UI Grid Components */}
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
               {/* Card 1: AI Graphic Studio */}
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

               {/* Card 2: One-Click Posting */}
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

               {/* Card 3: Syncing */}
               <div className="md:col-span-1 lg:col-span-1 row-span-1 bg-white border-2 border-slate-200 p-10 rounded-[2.5rem] shadow-lg shadow-slate-200/50 hover:border-[#003D6F] transition-all group flex flex-col justify-between">
                  <div className="w-14 h-14 bg-[#003D6F]/10 rounded-2xl flex items-center justify-center group-hover:bg-[#003D6F] group-hover:text-white transition-colors">
                     <LayoutGrid className="w-7 h-7" />
                  </div>
                  <div>
                     <h3 className="text-2xl font-bold text-[#003D6F] mb-2">Products & Services Sync</h3>
                     <p className="text-slate-600 font-medium">Update listings once, sync everywhere instantly.</p>
                  </div>
               </div>

               {/* Card 4: SEO */}
               <div className="md:col-span-2 lg:col-span-1 row-span-1 bg-white border-2 border-slate-200 p-10 rounded-[2.5rem] shadow-lg shadow-slate-200/50 hover:border-[#003D6F] transition-all group flex flex-col justify-between">
                  <div className="w-14 h-14 bg-[#003D6F]/10 rounded-2xl flex items-center justify-center group-hover:bg-[#003D6F] group-hover:text-white transition-colors">
                     <Globe className="w-7 h-7" />
                  </div>
                  <div>
                     <h3 className="text-2xl font-bold text-[#003D6F] mb-2">Automated SEO</h3>
                     <p className="text-slate-600 font-medium">Rank on Google without hiring an agency.</p>
                  </div>
               </div>

               {/* Card 5: High-Conversion Pages */}
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

               {/* Card 6: CRM */}
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
                  <Link href={partnerLoginUrl} className="inline-block bg-white text-[#003D6F] px-8 py-4 rounded-xl font-bold text-lg hover:bg-[#F4B429] hover:text-[#003D6F] transition-all shadow-xl hover:scale-105">
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
           <div className="text-center mb-12">
              <h2 className="text-4xl md:text-6xl font-black text-[#003D6F] mb-6">Simple, Transparent Pricing</h2>
              <p className="text-slate-600 text-xl font-medium mb-10">Everything you need to grow your business, at a price that makes sense.</p>
           </div>

           {/* Dynamic Currency Switcher */}
           <div className="flex items-center justify-center gap-4 mb-16">
              <span className={`text-lg font-black transition-colors ${currency === 'INR' ? 'text-[#B22B31]' : 'text-slate-400'}`}>Rupees (₹)</span>
              <button 
                onClick={() => setCurrency(currency === 'INR' ? 'USD' : 'INR')}
                className="w-16 h-8 bg-slate-200 rounded-full p-1 relative transition-colors duration-300 focus:outline-none shadow-inner"
              >
                <div className={`w-6 h-6 bg-[#003D6F] rounded-full absolute top-1 transition-all duration-300 ${currency === 'USD' ? 'left-9' : 'left-1'}`} />
              </button>
              <span className={`text-lg font-black transition-colors ${currency === 'USD' ? 'text-[#B22B31]' : 'text-slate-400'}`}>Dollars ($)</span>
           </div>

           {/* 3 Pricing Cards Grid */}
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch mb-24">
              
              {/* Plan 1: Starter */}
              <div className="bg-white border-2 border-slate-200 rounded-[3.5rem] overflow-hidden shadow-xl hover:border-[#003D6F]/40 hover:shadow-2xl transition-all duration-300 flex flex-col justify-between p-10 relative">
                 <div>
                    <h3 className="text-2xl font-black text-[#003D6F] uppercase tracking-wider mb-2">Starter</h3>
                    <p className="text-slate-400 text-sm font-bold mb-8">For small businesses getting started</p>
                    <div className="flex items-baseline gap-2 mb-8">
                       <span className="text-6xl font-black text-[#B22B31]">
                          {currency === 'INR' ? '₹4,999' : '$49'}
                       </span>
                       <span className="text-slate-500 font-bold">/mo</span>
                    </div>
                    <div className="h-px bg-slate-100 mb-8" />
                    <ul className="space-y-4 mb-10">
                       {[
                         "30 Image Gen",
                         "3 Team Members",
                         "15 SEO Articles",
                         "10 Inventory Items",
                         "3 Campaign Launches",
                         "3 Campaigns",
                         "3 Optimizations",
                         "1 GB of Storage",
                         "Social Media Handling"
                       ].map((feature, i) => (
                         <li key={i} className="flex items-center gap-3 text-slate-600 font-bold text-sm">
                            <CheckCircle2 className="w-5 h-5 text-[#F4B429] fill-current shrink-0" />
                            <span>{feature}</span>
                         </li>
                       ))}
                    </ul>
                 </div>
                 <Link 
                    href={partnerLoginUrl}
                    className="block w-full py-5 bg-[#003D6F] hover:bg-[#00284d] text-white text-center rounded-2xl font-black text-lg transition-all shadow-md active:scale-95 mt-auto"
                 >
                    Get Started Free
                 </Link>
              </div>

              {/* Plan 2: Pro (Best Value - Highlighted) */}
              <div className="bg-white border-4 border-[#003D6F] rounded-[3.5rem] overflow-hidden shadow-2xl relative flex flex-col justify-between p-10 lg:scale-[1.05] z-10">
                 <div className="absolute top-0 right-10 bg-[#B22B31] text-white px-5 py-2 rounded-b-xl text-xs font-black uppercase tracking-widest">
                    Best Value
                 </div>
                 <div>
                    <h3 className="text-2xl font-black text-[#003D6F] uppercase tracking-wider mb-2">Pro</h3>
                    <p className="text-slate-400 text-sm font-bold mb-8">Ultimate automated growth engine</p>
                    <div className="flex items-baseline gap-2 mb-8">
                       <span className="text-6xl font-black text-[#B22B31]">
                          {currency === 'INR' ? '₹9,999' : '$199'}
                       </span>
                       <span className="text-slate-500 font-bold">/mo</span>
                    </div>
                    <div className="h-px bg-slate-100 mb-8" />
                    <ul className="space-y-4 mb-10">
                       {[
                         "80 Images",
                         "Unlimited Team Members",
                         "10 Campaign Launches",
                         "10 Optimization Requests",
                         "10 Remarketing Requests",
                         "30 SEO Articles",
                         "Daily Graphic Automation",
                         "5 GB of Storage",
                         "Social Media Management",
                         "Landing Page",
                         "White Labelled App",
                         "1 AI Video Editing / mo",
                         "3 AI Caption Generations / mo"
                       ].map((feature, i) => (
                         <li key={i} className="flex items-center gap-3 text-slate-700 font-bold text-sm">
                            <CheckCircle2 className="w-5 h-5 text-[#F4B429] fill-current shrink-0" />
                            <span>{feature}</span>
                         </li>
                       ))}
                    </ul>
                 </div>
                 <Link 
                    href={partnerLoginUrl}
                    className="block w-full py-5 bg-[#B22B31] hover:bg-[#902227] text-white text-center rounded-2xl font-black text-lg transition-all shadow-lg active:scale-95 shadow-[#B22B31]/30 mt-auto"
                 >
                    Start Growing Now
                 </Link>
              </div>

              {/* Plan 3: Ultra */}
              <div className="bg-white border-2 border-slate-200 rounded-[3.5rem] overflow-hidden shadow-xl hover:border-[#003D6F]/40 hover:shadow-2xl transition-all duration-300 flex flex-col justify-between p-10 relative">
                 <div>
                    <h3 className="text-2xl font-black text-[#003D6F] uppercase tracking-wider mb-2">Ultra</h3>
                    <p className="text-slate-400 text-sm font-bold mb-8">100% Done-For-You by experts</p>
                    <div className="flex items-baseline gap-2 mb-8">
                       <span className="text-6xl font-black text-[#B22B31]">
                          {currency === 'INR' ? '₹99,999' : '$1,999'}
                       </span>
                       <span className="text-slate-500 font-bold">/mo</span>
                    </div>
                    <div className="h-px bg-slate-100 mb-8" />
                    <ul className="space-y-4 mb-10">
                       {[
                         "All Done-For-You",
                         "We handle ads, ads creation, etc.",
                         "Unlimited AdRolls features",
                         "* AI charges to be born by the customer"
                       ].map((feature, i) => (
                         <li key={i} className="flex items-center gap-3 text-slate-600 font-bold text-sm">
                            <CheckCircle2 className="w-5 h-5 text-[#F4B429] fill-current shrink-0" />
                            <span>{feature}</span>
                         </li>
                       ))}
                    </ul>
                 </div>
                 <a 
                    href="#contact"
                    className="block w-full py-5 bg-slate-900 hover:bg-slate-800 text-white text-center rounded-2xl font-black text-lg transition-all shadow-md active:scale-95 mt-auto"
                 >
                    Contact Sales
                 </a>
              </div>

           </div>
        </div>
      </section>

      {/* --- VALUE COMPARISON SECTION --- */}
      <section className="py-24 bg-slate-50 relative border-t border-slate-100 z-10">
        <div className="max-w-[1400px] mx-auto px-6">
           <div className="text-center mb-16">
              <span className="text-[#B22B31] font-bold tracking-wider uppercase text-sm bg-red-50 px-3 py-1 rounded-full border border-red-100">
                 IMMENSE SAVINGS
              </span>
              <h2 className="text-4xl md:text-5xl font-black text-[#003D6F] mt-4">
                 AdRolls vs. Traditional Marketing
              </h2>
              <p className="text-slate-600 text-lg mt-2 font-medium">
                 See how much you save every single month by switching to our agentic AI workflow.
              </p>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              {/* Fluffy Pup mascot + Speech Bubble */}
              <div className="lg:col-span-4 flex flex-col items-center justify-center text-center relative order-2 lg:order-1">
                 <div className="relative w-64 h-64 md:w-80 md:h-80 filter drop-shadow-2xl">
                    <img 
                      src="/shihtzu.png" 
                      alt="Rolls the Pup" 
                      className="w-full h-full object-contain hover:scale-105 transition-transform duration-300"
                    />
                 </div>
                 {/* Speech Bubble */}
                 <div className="relative mt-6 bg-[#003D6F] text-white p-6 rounded-2xl border border-white/20 shadow-xl max-w-sm">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full w-0 h-0 border-x-8 border-x-transparent border-b-8 border-b-[#003D6F]"></div>
                    <p className="font-extrabold text-sm leading-relaxed">
                       "Woof! AdRolls saves you over {currency === 'INR' ? '₹3,60,000' : '$13,100'} every single month! That's enough to buy a lifetime of premium treats and squeaky toys! 🦴🐶"
                    </p>
                 </div>
              </div>

              {/* Comparison Table */}
              <div className="lg:col-span-8 bg-white border-2 border-slate-200 rounded-[2.5rem] shadow-2xl p-6 sm:p-10 order-1 lg:order-2 overflow-hidden relative">
                 <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                       <thead>
                          <tr className="border-b border-slate-100">
                             <th className="pb-6 font-black text-slate-400 text-xs uppercase tracking-wider">Services Required</th>
                             <th className="pb-6 font-black text-slate-400 text-xs uppercase tracking-wider">Traditional Cost</th>
                             <th className="pb-6 font-black text-[#B22B31] text-xs uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles className="w-4 h-4 text-[#F4B429]" /> AdRolls AI
                             </th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100 font-bold text-slate-700 text-sm">
                          {[
                            {
                              service: "SEO",
                              traditional: currency === 'INR' ? "₹30,000/mo" : "$1,200/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Ads Management",
                              traditional: currency === 'INR' ? "₹40,000/mo" : "$1,500/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Remarketing Campaign",
                              traditional: currency === 'INR' ? "₹20,000/mo" : "$800/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Video Production",
                              traditional: currency === 'INR' ? "₹50,000/mo" : "$2,000/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "AI Video Editing",
                              traditional: currency === 'INR' ? "₹45,000/mo" : "$1,500/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Graphics Designing",
                              traditional: currency === 'INR' ? "₹25,000/mo" : "$1,000/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "CRM",
                              traditional: currency === 'INR' ? "₹15,000/mo" : "$300/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Social Media Management",
                              traditional: currency === 'INR' ? "₹25,000/mo" : "$800/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Inventory Management",
                              traditional: currency === 'INR' ? "₹15,000/mo" : "$400/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Landing Page",
                              traditional: currency === 'INR' ? "₹20,000/mo" : "$600/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "Hosting",
                              traditional: currency === 'INR' ? "₹10,000/mo" : "$200/mo",
                              adrolls: "Included"
                            },
                            {
                              service: "White Labelled App",
                              traditional: currency === 'INR' ? "₹75,000/mo" : "$3,000/mo",
                              adrolls: "Included"
                            }
                          ].map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                               <td className="py-5 pr-4 text-base text-[#003D6F] font-black">{row.service}</td>
                               <td className="py-5 text-slate-500 text-base line-through decoration-[#B22B31] decoration-2">{row.traditional}</td>
                               <td className="py-5 text-[#B22B31] text-lg font-black flex items-center gap-2">
                                  <CheckCircle2 className="w-5 h-5 text-[#F4B429] fill-current shrink-0" /> {row.adrolls}
                               </td>
                            </tr>
                          ))}
                          {/* Total Calculation Row */}
                          <tr className="bg-slate-50/80 rounded-2xl">
                             <td className="py-6 px-4 text-lg text-[#003D6F] font-black uppercase">Total Monthly Value</td>
                             <td className="py-6 text-slate-500 text-lg line-through font-extrabold decoration-[#B22B31] decoration-2">
                                {currency === 'INR' ? "₹3,70,000" : "$13,300"}
                             </td>
                             <td className="py-6 text-green-600 text-xl font-black flex items-center gap-2 bg-green-50 px-4 rounded-xl border border-green-100">
                                <Sparkles className="w-5 h-5 text-[#F4B429]" /> Just {currency === 'INR' ? "₹9,999" : "$199"}
                             </td>
                          </tr>
                       </tbody>
                    </table>
                 </div>
              </div>
           </div>
        </div>
      </section>

      {/* --- FOOTER / CTA SECTION --- */}
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
               href={partnerLoginUrl}
               className="bg-[#B22B31] hover:bg-[#902227] text-white px-12 py-5 rounded-xl font-bold text-lg transition-all shadow-lg hover:scale-105"
             >
                Start Free Trial
             </Link>
          </div>
        </div>
      </section>
      
      {/* --- CONTACT FORM SECTION --- */}
      <section id="contact" className="py-24 bg-white relative border-t border-slate-200 z-10 overflow-hidden">
        {/* Abstract floating blur elements */}
        <div className="absolute top-0 left-0 w-[30vw] h-[30vw] bg-[#003D6F]/5 blur-[80px] rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[40vw] h-[40vw] bg-[#F4B429]/5 blur-[100px] rounded-full pointer-events-none translate-x-1/3 translate-y-1/3" />
        
        <div className="max-w-[1400px] mx-auto px-6 relative z-10">
           <div className="text-center max-w-2xl mx-auto mb-16">
              <span className="text-[#B22B31] font-bold tracking-wider uppercase text-sm bg-red-50 px-3 py-1 rounded-full border border-red-100">
                 Connect With Experts
              </span>
              <h2 className="text-4xl md:text-5xl font-black text-[#003D6F] mt-4">
                 Get In Touch With Sales
              </h2>
              <p className="text-slate-600 text-lg mt-2 font-medium">
                 Have a specific query or want a custom demo? Fill out the form and our team will get back to you within 2 hours.
              </p>
           </div>

           <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8 bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 rounded-[2.5rem] shadow-2xl p-6 sm:p-10 relative overflow-hidden">
              {/* Glassmorphic left info pane */}
              <div className="md:col-span-5 bg-[#003D6F] rounded-[1.75rem] p-8 text-white relative overflow-hidden flex flex-col justify-between shadow-xl min-h-[300px]">
                 <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-xl" />
                 <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-[#B22B31]/10 rounded-full blur-2xl" />
                 
                 <div className="relative z-10">
                    <span className="inline-block px-3 py-1 bg-white/10 rounded-full text-xs font-black uppercase tracking-wider mb-6">Contact Info</span>
                    <h3 className="text-2xl font-black mb-4">AdRolls Intelligence</h3>
                    <p className="text-blue-100 text-sm leading-relaxed mb-8">
                       Reach out to our agents to schedule an interactive video mapping of your current ad setup.
                    </p>
                    
                    <div className="space-y-6">
                       <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/10 shadow-sm shrink-0">
                             <Phone size={18} className="text-[#F4B429]" />
                          </div>
                          <div>
                             <p className="text-xs text-blue-200 font-bold uppercase tracking-wider">Call or WhatsApp</p>
                             <p className="text-sm font-bold text-white">+91 98101 23456</p>
                          </div>
                       </div>
                       
                       <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/10 shadow-sm shrink-0">
                             <Mail size={18} className="text-[#F4B429]" />
                          </div>
                          <div>
                             <p className="text-xs text-blue-200 font-bold uppercase tracking-wider">Email Us</p>
                             <p className="text-sm font-bold text-white">adrollsai@gmail.com</p>
                          </div>
                       </div>
                    </div>
                 </div>

                 <div className="relative z-10 pt-8 border-t border-white/10 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center shrink-0">
                       <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                    </div>
                    <p className="text-xs text-green-300 font-bold">Agents online • Fast Response</p>
                 </div>
              </div>

              {/* Right Input Form pane */}
              <form onSubmit={handleContactSubmit} className="md:col-span-7 space-y-6 flex flex-col justify-center">
                 {submitSuccess ? (
                    <motion.div 
                       initial={{ opacity: 0, scale: 0.95 }}
                       animate={{ opacity: 1, scale: 1 }}
                       className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center"
                    >
                       <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-200 text-green-600">
                          <CheckCircle2 size={32} />
                       </div>
                       <h4 className="text-2xl font-black text-[#003D6F] mb-2">Message Sent!</h4>
                       <p className="text-slate-600 font-bold text-sm leading-relaxed">
                          Woof! Thank you for contacting us. We've received your query and routed it directly to our sales agent CRM. An agent will get in touch with you shortly!
                       </p>
                    </motion.div>
                 ) : (
                    <>
                       {submitError && (
                          <div className="p-4 bg-red-50 border-2 border-red-200 text-red-700 rounded-xl text-sm font-bold flex items-center gap-2">
                             <span className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
                             {submitError}
                          </div>
                       )}

                       <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                             <label className="text-xs text-slate-500 font-black uppercase tracking-wider">Full Name</label>
                             <input 
                                type="text"
                                required
                                value={contactName}
                                onChange={(e) => setContactName(e.target.value)}
                                placeholder="Your Name"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] focus:ring-1 focus:ring-[#003D6F] transition-all"
                             />
                          </div>
                          <div className="space-y-2">
                             <label className="text-xs text-slate-500 font-black uppercase tracking-wider">Phone Number</label>
                             <input 
                                type="tel"
                                required
                                value={contactPhone}
                                onChange={(e) => setContactPhone(e.target.value)}
                                placeholder="e.g. +91 99999 99999"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] focus:ring-1 focus:ring-[#003D6F] transition-all"
                             />
                          </div>
                       </div>

                       <div className="space-y-2">
                          <label className="text-xs text-slate-500 font-black uppercase tracking-wider">Email Address</label>
                          <input 
                             type="email"
                             required
                             value={contactEmail}
                             onChange={(e) => setContactEmail(e.target.value)}
                             placeholder="email@example.com"
                             className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] focus:ring-1 focus:ring-[#003D6F] transition-all"
                          />
                       </div>

                       <div className="space-y-2">
                          <label className="text-xs text-slate-500 font-black uppercase tracking-wider">Your Message</label>
                          <textarea 
                             required
                             rows={4}
                             value={contactMessage}
                             onChange={(e) => setContactMessage(e.target.value)}
                             placeholder="How can we help your business grow?"
                             className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] focus:ring-1 focus:ring-[#003D6F] transition-all resize-none"
                          />
                       </div>

                       <button 
                          type="submit"
                          disabled={isSubmitting}
                          className="w-full py-4 bg-[#B22B31] hover:bg-[#902227] disabled:bg-slate-400 text-white rounded-xl font-black text-lg transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                       >
                          {isSubmitting ? (
                             <>
                                <Loader2 className="w-5 h-5 animate-spin" /> Submitting...
                             </>
                          ) : (
                             <>
                                Send Query <Send size={18} />
                             </>
                          )}
                       </button>
                    </>
                 )}
              </form>
           </div>
        </div>
      </section>

      {/* Dynamic Navigation Footer */}
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
              <Link href="/privacy-policy" className="text-slate-300 hover:text-[#F4B429] font-bold transition-colors">Privacy Policy</Link>
              <Link href="/terms-and-conditions" className="text-slate-300 hover:text-[#F4B429] font-bold transition-colors">Terms & Conditions</Link>
              <Link href="/refund-policy" className="text-slate-300 hover:text-[#F4B429] font-bold transition-colors">Refund Policy</Link>
            </div>
         </div>
      </footer>

    </div>
  )
}