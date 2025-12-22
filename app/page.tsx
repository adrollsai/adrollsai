'use client'

import React, { useState } from 'react'
import { 
  Building2, 
  Users2, 
  BarChart3, 
  Trophy, 
  Megaphone, 
  CheckCircle2, 
  ArrowRight, 
  Play,
  LayoutGrid,
  TrendingUp,
  ShieldCheck,
  ChevronRight
} from 'lucide-react'
import Link from 'next/link'

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
    // --- DYNAMIC LINK LOGIC ---
  // If we are developing locally, just go to "/login"
  // If we are in production, go to the app subdomain
  const PARTNER_LOGIN_URL = process.env.NODE_ENV === 'development' 
  ? '/login' 
  : 'https://app.adrolls.in';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500/30">
      
      {/* --- NAVIGATION --- */}
      <nav className="fixed top-0 w-full z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center">
              <Building2 className="text-white w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">AdRolls<span className="text-slate-400">.ai</span></span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <a href="#problem" className="hover:text-amber-400 transition-colors">The Disconnect</a>
            <a href="#solution" className="hover:text-amber-400 transition-colors">The Ecosystem</a>
            <a href="#service" className="hover:text-amber-400 transition-colors">Managed Service</a>
            <a href="#results" className="hover:text-amber-400 transition-colors">Results</a>
          </div>

          <div className="flex items-center gap-4">
            {/* UPDATED: Partner Login now uses the yellow button styling and 'Request Audit' is removed */}
            <Link 
              href={PARTNER_LOGIN_URL} 
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-5 py-2.5 rounded-full text-sm font-bold transition-all active:scale-95 shadow-[0_0_20px_-5px_rgba(245,158,11,0.5)]"
            >
              Partner Login
            </Link>
          </div>
        </div>
      </nav>

      {/* --- HERO SECTION --- */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-amber-500/10 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            
            {/* Hero Copy */}
            <div className="flex-1 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-amber-500 text-xs font-bold uppercase tracking-wider mb-6">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"/>
                For Developers & Master Brokers
              </div>
              
              <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1] mb-6">
                Fast Track Real Estate Sales <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-amber-600">
                  Without Ad Spend.
                </span>
              </h1>
              
              <p className="text-lg text-slate-400 mb-8 leading-relaxed max-w-2xl mx-auto lg:mx-0">
                Transform your dormant Channel Partner network into a hyper-active, 24/7 digital sales force. We provide the infrastructure and strategy to dominate the market using the people you already have.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
                <button className="w-full sm:w-auto px-8 py-4 bg-white text-slate-950 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center justify-center gap-2">
                  Request Network Audit <ArrowRight className="w-4 h-4"/>
                </button>
                <button className="w-full sm:w-auto px-8 py-4 bg-slate-900 border border-slate-800 text-white rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2">
                  <Play className="w-4 h-4 fill-current"/> See How It Works
                </button>
              </div>

              <div className="mt-10 flex items-center justify-center lg:justify-start gap-6 text-sm text-slate-500 font-medium">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-500" /> No Software Setup
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-500" /> Fully Managed
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-500" /> Result Oriented
                </div>
              </div>
            </div>

            {/* Hero Visual - Abstract Dashboard Interface */}
            <div className="flex-1 w-full relative">
              <div className="relative rounded-2xl bg-slate-900 border border-slate-800 p-2 shadow-2xl shadow-amber-900/20 rotate-1 hover:rotate-0 transition-transform duration-700">
                <div className="absolute -top-12 -right-12 bg-slate-800/50 backdrop-blur-md border border-slate-700 p-4 rounded-xl hidden md:block animate-bounce-slow">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center text-green-500"><TrendingUp size={20}/></div>
                      <div>
                        <div className="text-xs text-slate-400">Leads Today</div>
                        <div className="text-xl font-bold text-white">+142</div>
                      </div>
                   </div>
                </div>

                <div className="bg-slate-950 rounded-xl overflow-hidden aspect-[4/3] relative">
                  {/* Mock UI Header */}
                  <div className="h-12 border-b border-slate-800 flex items-center px-4 gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-slate-800"></div>
                      <div className="w-3 h-3 rounded-full bg-slate-800"></div>
                    </div>
                  </div>
                  {/* Mock UI Body */}
                  <div className="p-6 grid grid-cols-2 gap-4">
                     <div className="col-span-2 bg-slate-900 rounded-lg p-4 border border-slate-800">
                        <div className="flex justify-between items-center mb-4">
                           <div className="h-4 w-32 bg-slate-800 rounded"></div>
                           <div className="h-8 w-24 bg-amber-500/20 rounded text-amber-500 text-xs flex items-center justify-center font-bold">Live Status</div>
                        </div>
                        <div className="space-y-2">
                           <div className="h-2 w-full bg-slate-800 rounded"></div>
                           <div className="h-2 w-2/3 bg-slate-800 rounded"></div>
                        </div>
                     </div>
                     <div className="bg-slate-900 rounded-lg p-4 border border-slate-800 flex flex-col items-center justify-center py-8">
                        <div className="w-12 h-12 rounded-full border-4 border-amber-500/20 flex items-center justify-center text-amber-500 font-bold mb-2">12K</div>
                        <div className="text-xs text-slate-500">Asset Shares</div>
                     </div>
                     <div className="bg-slate-900 rounded-lg p-4 border border-slate-800 flex flex-col items-center justify-center py-8">
                        <div className="w-12 h-12 rounded-full border-4 border-blue-500/20 flex items-center justify-center text-blue-500 font-bold mb-2">450</div>
                        <div className="text-xs text-slate-500">Qualified Leads</div>
                     </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* --- SOCIAL PROOF --- */}
      <section className="py-10 border-y border-slate-900 bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-slate-500 text-sm font-medium mb-8">TRUSTED INFRASTRUCTURE FOR</p>
          <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            {/* Placeholder Logos */}
            {['Lodha', 'Godrej Properties', 'Prestige', 'Brigade', 'Sobha'].map((brand) => (
               <div key={brand} className="text-xl font-serif font-bold text-slate-300">{brand}</div>
            ))}
          </div>
        </div>
      </section>

      {/* --- PROBLEM / AGITATION --- */}
      <section id="problem" className="py-24 bg-slate-950">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
            You Have 500 Channel Partners. <br/>
            <span className="text-slate-500">Why Are Only 10 Selling?</span>
          </h2>
          <p className="text-lg text-slate-400 mb-12 leading-relaxed">
            Most developers rely on the "Pareto Principle"—80% of sales come from 20% of agents. 
            The rest of your network is untapped potential, sitting idle because they lack the content, 
            the systems, and the urgency to sell <b>your</b> inventory.
          </p>

          <div className="grid md:grid-cols-3 gap-8 text-left">
             <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center mb-4">
                  <LayoutGrid className="text-red-500 w-5 h-5"/>
                </div>
                <h3 className="text-white font-bold mb-2">Content Chaos</h3>
                <p className="text-sm text-slate-400">Agents waiting days for generic brochures that they don't share.</p>
             </div>
             <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center mb-4">
                  <Megaphone className="text-red-500 w-5 h-5"/>
                </div>
                <h3 className="text-white font-bold mb-2">Zero Visibility</h3>
                <p className="text-sm text-slate-400">No way to track who is actually pitching your property to clients.</p>
             </div>
             <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
                <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center mb-4">
                  <Users2 className="text-red-500 w-5 h-5"/>
                </div>
                <h3 className="text-white font-bold mb-2">Low Engagement</h3>
                <p className="text-sm text-slate-400">Without competition or gamification, partners lose interest quickly.</p>
             </div>
          </div>
        </div>
      </section>

      {/* --- SOLUTION --- */}
      <section id="solution" className="py-24 bg-slate-900 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
             <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">Enter The Partner Activation Ecosystem</h2>
             <p className="text-slate-400 max-w-2xl mx-auto">We deploy a proprietary, white-labeled infrastructure into your business that gamifies sales and automates marketing for your entire network.</p>
          </div>

          <div className="space-y-24">
            
            {/* Feature 1: Automated Branding */}
            <div className="flex flex-col md:flex-row items-center gap-12">
               <div className="flex-1 space-y-6">
                  <div className="w-12 h-12 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <LayoutGrid className="text-slate-900 w-6 h-6" />
                  </div>
                  <h3 className="text-3xl font-bold text-white">One Click. Hundreds of Status Updates.</h3>
                  <p className="text-slate-400 text-lg leading-relaxed">
                    Your marketing team uploads a creative once. Our system <b className="text-white">instantly personalizes it</b> with the photo, name, and phone number of every single agent in your network. Your project floods WhatsApp, Instagram, and LinkedIn simultaneously.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center gap-3 text-slate-300">
                      <CheckCircle2 className="w-5 h-5 text-amber-500"/> Instant WhatsApp Status Distribution
                    </li>
                    <li className="flex items-center gap-3 text-slate-300">
                      <CheckCircle2 className="w-5 h-5 text-amber-500"/> Auto-stamping of Agent Details
                    </li>
                  </ul>
               </div>
               <div className="flex-1 bg-slate-950 p-8 rounded-3xl border border-slate-800 relative">
                  {/* Visual representation of branding */}
                  <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/5 to-transparent rounded-3xl"/>
                  <div className="grid grid-cols-2 gap-4 relative z-10">
                     <div className="bg-slate-800 p-2 rounded-lg opacity-50 scale-90">
                        <div className="aspect-square bg-slate-700 rounded mb-2"/>
                        <div className="h-2 bg-slate-600 rounded w-1/2"/>
                     </div>
                     <div className="bg-slate-800 p-2 rounded-lg border-2 border-amber-500 shadow-xl transform scale-105">
                        <div className="aspect-square bg-slate-700 rounded mb-2 flex items-end p-2">
                           <div className="bg-black/60 backdrop-blur-sm p-1 px-2 rounded text-[10px] text-white w-full">
                             Contact: Agent Rahul
                           </div>
                        </div>
                        <div className="h-2 bg-slate-600 rounded w-full mb-1"/>
                        <div className="h-2 bg-slate-600 rounded w-2/3"/>
                     </div>
                  </div>
               </div>
            </div>

            {/* Feature 2: Gamification */}
            <div className="flex flex-col md:flex-row-reverse items-center gap-12">
               <div className="flex-1 space-y-6">
                  <div className="w-12 h-12 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <Trophy className="text-white w-6 h-6" />
                  </div>
                  <h3 className="text-3xl font-bold text-white">Turn Selling Into a Sport.</h3>
                  <p className="text-slate-400 text-lg leading-relaxed">
                    We implement a live "XP and Leaderboard" system. Agents earn points for sharing content, logging site visits, and closing deals. Watch your partners fight for the top spot on the weekly leaderboard.
                  </p>
               </div>
               <div className="flex-1 bg-slate-950 p-8 rounded-3xl border border-slate-800">
                  <div className="space-y-4">
                     {[1, 2, 3].map((rank) => (
                       <div key={rank} className="flex items-center gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${rank === 1 ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-500'}`}>
                            {rank}
                          </div>
                          <div className="w-10 h-10 rounded-full bg-slate-700" />
                          <div className="flex-1">
                            <div className="h-3 w-24 bg-slate-700 rounded mb-1"/>
                            <div className="h-2 w-16 bg-slate-800 rounded"/>
                          </div>
                          <div className="text-amber-500 font-mono text-sm">2,4{rank}0 XP</div>
                       </div>
                     ))}
                  </div>
               </div>
            </div>

          </div>
        </div>
      </section>

      {/* --- META ADS FEATURE --- */}
      <section className="py-24 bg-slate-950 border-y border-slate-900">
        <div className="max-w-7xl mx-auto px-6">
           <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-3xl p-8 md:p-16 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-1/2 h-full bg-indigo-500/10 blur-[100px]"/>
              
              <div className="relative z-10 flex flex-col md:flex-row items-center gap-12">
                <div className="flex-1">
                  <h3 className="text-3xl font-bold text-white mb-6">Stop Spending. Start Empowering.</h3>
                  <p className="text-indigo-200 mb-8 text-lg">
                    Why should you pay for all the visibility? Our ecosystem allows your top partners to launch pre-approved, brand-safe ad campaigns for <b>your project</b> using <b>their budget</b>.
                  </p>
                  <button className="bg-white text-indigo-900 px-6 py-3 rounded-xl font-bold hover:bg-indigo-50 transition-colors">
                    Explore Decentralized Ads
                  </button>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4 opacity-80">
                   <div className="bg-white/5 p-4 rounded-xl backdrop-blur-sm border border-white/10">
                      <div className="text-xs text-indigo-300 uppercase mb-2">Partner Spend</div>
                      <div className="text-2xl font-bold text-white">₹12.5L</div>
                   </div>
                   <div className="bg-white/5 p-4 rounded-xl backdrop-blur-sm border border-white/10">
                      <div className="text-xs text-indigo-300 uppercase mb-2">Impressions</div>
                      <div className="text-2xl font-bold text-white">3.2M</div>
                   </div>
                </div>
              </div>
           </div>
        </div>
      </section>

      {/* --- SERVICE MODEL --- */}
      <section id="service" className="py-24 bg-slate-950">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">Not Just Platform. Partnership.</h2>
          <p className="text-lg text-slate-400 mb-12">We don't just hand you a login and walk away. We operate the machine for you.</p>
          
          <div className="grid md:grid-cols-3 gap-8">
             <div className="text-left">
                <div className="text-amber-500 font-bold text-xl mb-2">01.</div>
                <h4 className="text-white font-bold text-lg mb-2">We Onboard</h4>
                <p className="text-slate-500 text-sm">Our team handles the training and activation of your CP network via webinars and offline events.</p>
             </div>
             <div className="text-left">
                <div className="text-amber-500 font-bold text-xl mb-2">02.</div>
                <h4 className="text-white font-bold text-lg mb-2">We Create</h4>
                <p className="text-slate-500 text-sm">Our creative strategists design the high-converting assets that get uploaded to the ecosystem.</p>
             </div>
             <div className="text-left">
                <div className="text-amber-500 font-bold text-xl mb-2">03.</div>
                <h4 className="text-white font-bold text-lg mb-2">We Manage</h4>
                <p className="text-slate-500 text-sm">We structure the rewards and XP systems that drive maximum agent behavior.</p>
             </div>
          </div>
        </div>
      </section>

      {/* --- FOOTER / CTA --- */}
      <section className="py-24 bg-slate-900 border-t border-slate-800">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-8 tracking-tight">
            Your Inventory is Waiting. <br/>
            Your Partners are Ready.
          </h2>
          <p className="text-slate-400 mb-10 text-lg">
            Let's build the infrastructure that sells your properties on autopilot.
          </p>
          
          <div className="bg-slate-950 p-2 rounded-2xl inline-flex flex-col sm:flex-row gap-2 border border-slate-800 shadow-2xl">
             <input 
               type="email" 
               placeholder="Enter your work email" 
               className="bg-transparent text-white px-6 py-4 outline-none w-full sm:w-80 placeholder:text-slate-600"
             />
             <button className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-8 py-4 rounded-xl font-bold transition-all whitespace-nowrap">
               Book Strategy Audit
             </button>
          </div>
          <p className="mt-6 text-xs text-slate-600">
            Limited slots available for Q3. No commitment required.
          </p>
        </div>
      </section>
      
      {/* Footer Links */}
      <footer className="bg-slate-950 py-12 border-t border-slate-900">
         <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-slate-800 rounded flex items-center justify-center">
                <Building2 className="text-slate-400 w-3 h-3" />
              </div>
              <span className="text-sm font-bold text-slate-500">AdRolls.ai</span>
            </div>
            
            <div className="text-slate-600 text-sm order-3 md:order-2">
               &copy; 2024 AdRolls Intelligence Pvt Ltd. All rights reserved.
            </div>

            <div className="flex flex-wrap justify-center gap-6 order-2 md:order-3">
              <Link
                href="/privacy-policy"
                className="text-sm text-slate-500 hover:text-amber-500 transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms-and-conditions"
                className="text-sm text-slate-500 hover:text-amber-500 transition-colors"
              >
                Terms & Conditions
              </Link>
              <Link
                href="/refund-policy"
                className="text-sm text-slate-500 hover:text-amber-500 transition-colors"
              >
                Refund Policy
              </Link>
            </div>
         </div>
      </footer>

    </div>
  )
}