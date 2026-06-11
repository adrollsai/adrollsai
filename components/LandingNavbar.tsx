'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, ArrowRight } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

export default function LandingNavbar() {
   const [isMenuOpen, setIsMenuOpen] = useState(false)
   const [partnerLoginUrl, setPartnerLoginUrl] = useState('https://app.adrolls.in')
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
         setPartnerLoginUrl('https://app.adrolls.in')
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
                  <img
                     src="https://i.ibb.co/7dDJdPgS/bg-removed.png"
                     alt="AdRolls"
                     className="h-20 md:h-24 w-auto min-w-[150px] object-contain hover:scale-105 transition-transform duration-300 drop-shadow-sm"
                  />
               </div>

               {/* Desktop Links */}
               <div className="hidden lg:flex items-center gap-10 text-base font-extrabold text-[#003D6F]/90">
                  <a href="#features" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Features</a>
                  <a href="#showcase" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Videos</a>
                  <a href="#gallery" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Graphics</a>
                  <a href="#pricing" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Pricing</a>
                  <a href="#contact" className="hover:text-[#B22B31] transition-colors hover:underline decoration-2 underline-offset-4">Contact</a>
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
                     href={partnerLoginUrl}
                     className="bg-[#B22B31] hover:bg-[#902227] text-white px-8 py-3.5 rounded-full text-base font-extrabold transition-all shadow-[0_10px_25px_-8px_rgba(178,43,49,0.4)] active:scale-95 flex items-center gap-2"
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
                     <a href="#features" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Features</a>
                     <a href="#showcase" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Videos</a>
                     <a href="#gallery" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Graphics</a>
                     <a href="#pricing" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Pricing</a>
                     <a href="#contact" onClick={() => setIsMenuOpen(false)} className="text-[#003D6F]">Contact</a>
                     <div className="h-px w-full bg-slate-100 my-1" />
                     <Link href={partnerLoginUrl} className="text-[#B22B31]">Signup/Login</Link>
                  </motion.div>
               )}
            </AnimatePresence>
         </nav>
      </>
   )
}
