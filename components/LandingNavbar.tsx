'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, ArrowRight } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

export default function LandingNavbar() {
   const [isMenuOpen, setIsMenuOpen] = useState(false)
   const [partnerLoginUrl, setPartnerLoginUrl] = useState('https://app.nobogent.com')
   const [hasSession, setHasSession] = useState(false)
   const supabase = createClient()

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
         setPartnerLoginUrl('https://app.nobogent.com')
      }
   }, [])

   useEffect(() => {
      const checkSession = async () => {
         const { data: { session } } = await supabase.auth.getSession()
         if (session) setHasSession(true)
      }
      checkSession()
   }, [supabase])

   return (
      <>
         <nav className="fixed top-0 w-full z-50 border-b border-[#003D6F]/10 bg-white/95 backdrop-blur-xl transition-all duration-300">
            <div className="max-w-[1400px] mx-auto px-6 h-28 md:h-32 flex items-center justify-between">
               
               {/* Brand Logo */}
               <div className="flex items-center gap-2 shrink-0">
                  <Link href="/" className="cursor-pointer">
                     <img
                        src="/logo.png"
                        alt="Nobogent"
                        className="h-20 md:h-24 w-auto min-w-[150px] object-contain hover:scale-105 transition-transform duration-300 drop-shadow-sm"
                     />
                  </Link>
               </div>

               {/* Desktop Links */}
               <div className="hidden lg:flex items-center gap-8 xl:gap-10 text-base font-extrabold text-[#003D6F]/90">
                  <Link href="/results" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4 flex items-center gap-1.5 text-[#003D6F]">
                     <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                     Client Results
                  </Link>
                  <Link href="/#features" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Features</Link>
                  <Link href="/#showcase" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Videos</Link>
                  <Link href="/#gallery" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Graphics</Link>
                  <Link href="/#pricing" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Pricing</Link>
                  <Link href="/#contact" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Contact</Link>
               </div>

               {/* Desktop CTA */}
               <div className="hidden lg:flex items-center gap-5">
                  <Link
                     href={partnerLoginUrl}
                     className="text-[#003D6F] hover:text-[#B22B31] font-bold text-base px-2"
                  >
                     Signup/Login
                  </Link>
                  <Link
                     href="/#hero-form-section"
                     className="bg-[#B22B31] hover:bg-[#902227] text-white px-8 py-3.5 rounded-full text-base font-extrabold transition-all shadow-[0_10px_25px_-8px_rgba(178,43,49,0.4)] active:scale-95 flex items-center gap-2 cursor-pointer"
                  >
                     Get Started <ArrowRight size={16} />
                  </Link>
               </div>

               {/* Mobile Toggle */}
               <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="lg:hidden text-[#003D6F] p-2 bg-slate-100 rounded-lg">
                  {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
               </button>
            </div>

            {/* Mobile Sidebar */}
            <AnimatePresence>
               {isMenuOpen && (
                  <motion.div
                     initial={{ x: '100%' }}
                     animate={{ x: 0 }}
                     exit={{ x: '100%' }}
                     className="lg:hidden fixed top-28 md:top-32 left-0 w-full h-screen bg-white border-t border-slate-200 p-6 flex flex-col gap-5 z-50 text-lg font-bold"
                  >
                     <Link href="/results" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F] flex items-center gap-2 font-extrabold">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        Client Results
                     </Link>
                     <Link href="/#features" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Features</Link>
                     <Link href="/#showcase" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Videos</Link>
                     <Link href="/#gallery" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Graphics</Link>
                     <Link href="/#pricing" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Pricing</Link>
                     <Link href="/#contact" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Contact</Link>
                     <div className="h-px w-full bg-slate-100 my-1" />
                     <Link href={partnerLoginUrl} className="text-[#B22B31]">Signup/Login</Link>
                  </motion.div>
               )}
            </AnimatePresence>
         </nav>
      </>
   )
}
