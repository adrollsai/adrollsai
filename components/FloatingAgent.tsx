'use client'

import React, { useState, useEffect } from 'react'
import { X, Send } from 'lucide-react'
import { motion, AnimatePresence, useScroll } from 'framer-motion'

export default function FloatingAgent() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [mood, setMood] = useState('idle') // idle, happy, cool

  // --- MOOD LOGIC (Optional: Reacts to scroll) ---
  useEffect(() => {
    const handleScroll = () => {
      const scrollP = window.scrollY
      const windowH = window.innerHeight
      const docH = document.body.scrollHeight
      const scrollPercent = scrollP / (docH - windowH)

      if (scrollPercent < 0.3) {
        setMood('idle')
      } else if (scrollPercent >= 0.3 && scrollPercent < 0.85) {
        setMood('happy')
      } else {
        setMood('cool')
      }
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <>
      {/* --- THE CHAT WINDOW --- */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            // Positioned higher (bottom-32) to clear mobile nav bars
            className="fixed bottom-32 right-4 md:right-6 z-[70] w-[300px] md:w-[350px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden font-sans"
          >
            {/* Header */}
            <div className="bg-[#003D6F] p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-white font-bold">
                  <span className="text-xs">AI</span>
                </div>
                <div>
                  <h4 className="text-white font-bold text-sm">AI Assistant</h4>
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
                  Woof! I'm Rolls. 🐶 <br/>Ready to help you run your business?
                </p>
              </div>
              
              {/* Example Suggestions */}
              <div className="flex flex-col gap-2 mt-2">
                 <button className="text-xs bg-blue-50 text-blue-700 px-3 py-2 rounded-lg text-left hover:bg-blue-100 transition-colors">
                   🚀 Launch a new ad campaign
                 </button>
                 <button className="text-xs bg-blue-50 text-blue-700 px-3 py-2 rounded-lg text-left hover:bg-blue-100 transition-colors">
                   📈 How are my leads performing?
                 </button>
              </div>
            </div>

            {/* Input */}
            <div className="p-3 border-t border-slate-100 bg-white flex gap-2">
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a command..." 
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#003D6F]"
              />
              <button className="bg-[#003D6F] text-white p-2 rounded-lg hover:bg-[#002a4d]">
                <Send size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- THE DOG BUTTON (Mascot) --- */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        // Positioned at bottom-20 to sit ABOVE the mobile bottom nav
        className="fixed bottom-20 right-4 md:right-6 z-[60] cursor-pointer group flex flex-col items-end"
      >
        {/* Dog Container */}
        <motion.div 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-20 h-20 md:w-24 md:h-24 relative filter drop-shadow-xl"
        >
          <svg viewBox="0 0 200 200" className="w-full h-full overflow-visible">
              
              {/* 1. BODY (Fluffy White with Brown Spot) */}
              <path d="M50,140 
                       Q45,130 50,125 Q40,120 55,115 Q50,105 65,105
                       Q80,100 120,100 
                       Q135,105 130,115 Q145,120 135,125 Q145,130 140,140
                       Q145,155 135,165 Q120,175 100,175 
                       Q80,175 65,165 Q55,155 50,140 Z" 
                    fill="white" stroke="black" strokeWidth="4" strokeLinejoin="round"/>
              
              {/* Brown Spot */}
              <path d="M70,115 Q85,110 100,112 Q115,110 130,115 Q135,130 125,140 Q115,150 100,150 Q85,150 75,140 Q65,130 70,115 Z" 
                    fill="#8B4513" opacity="1" stroke="black" strokeWidth="2" strokeLinejoin="round"/>

              {/* 2. PAWS */}
              <g transform="translate(0, 5)">
                  <path d="M70,175 Q68,182 75,185 Q82,188 90,185 Q92,178 90,175" fill="white" stroke="black" strokeWidth="3" />
                  <path d="M110,175 Q108,182 115,185 Q122,188 130,185 Q132,178 130,175" fill="white" stroke="black" strokeWidth="3" />
              </g>

              {/* 3. COLLAR */}
              <path d="M72,132 Q100,142 128,132" stroke="#B22B31" strokeWidth="8" strokeLinecap="round" fill="none" />
              <circle cx="100" cy="138" r="6" fill="#F4B429" stroke="black" strokeWidth="2" />

              {/* 4. HEAD (Bobbing Animation) */}
              <motion.g 
                transform="translate(0, -15)"
                animate={{ y: [0, -3, 0] }}
                transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
              >
                  {/* Ears */}
                  <path d="M55,75 Q45,95 50,110 Q55,125 70,120 Q80,115 75,90" fill="#8B4513" stroke="black" strokeWidth="3" strokeLinejoin="round"/>
                  <path d="M145,75 Q155,95 150,110 Q145,125 130,120 Q120,115 125,90" fill="#8B4513" stroke="black" strokeWidth="3" strokeLinejoin="round"/>

                  {/* Head Shape */}
                  <path d="M100,50 
                           Q120,50 135,65 Q145,80 140,100 
                           Q135,120 115,135 Q100,140 85,135 
                           Q65,120 60,100 Q55,80 65,65 
                           Q80,50 100,50 Z"
                        fill="white" stroke="black" strokeWidth="3" strokeLinejoin="round"/>

                  {/* Top Tuft */}
                  <path d="M90,55 Q100,40 110,55" stroke="black" strokeWidth="3" fill="white"/>

                  {/* Eye Patches */}
                  <ellipse cx="80" cy="90" rx="18" ry="22" fill="#8B4513" transform="rotate(-10 80 90)" />
                  <ellipse cx="120" cy="90" rx="18" ry="22" fill="#8B4513" transform="rotate(10 120 90)" />

                  {/* Blush */}
                  <ellipse cx="75" cy="115" rx="8" ry="5" fill="#FFC0CB" opacity="0.6" />
                  <ellipse cx="125" cy="115" rx="8" ry="5" fill="#FFC0CB" opacity="0.6" />

                  {/* EYES (Blinking) */}
                  <motion.g 
                     animate={{ scaleY: [1, 1, 0.1, 1] }} 
                     transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.95, 1] }}
                  >
                      <circle cx="82" cy="92" r="7" fill="black" />
                      <circle cx="118" cy="92" r="7" fill="black" />
                      <circle cx="84" cy="90" r="2.5" fill="white" />
                      <circle cx="120" cy="90" r="2.5" fill="white" />
                  </motion.g>

                  {/* SNOUT */}
                  <ellipse cx="100" cy="105" rx="14" ry="10" fill="#F3F4F6" stroke="black" strokeWidth="1" />
                  <ellipse cx="100" cy="100" rx="7" ry="5" fill="black" />
                  <path d="M92,112 Q100,118 108,112" stroke="black" strokeWidth="2.5" fill="none" strokeLinecap="round" />

                  {/* TONGUE (Happy only) */}
                  <motion.path 
                    d="M96,114 Q100,128 104,114" fill="#FB7185" stroke="black" strokeWidth="1"
                    animate={{ opacity: mood === 'happy' ? 1 : 0 }}
                  />
              </motion.g>

              {/* 5. BIG DEAL WITH IT GLASSES (Appear on rapid scroll) */}
              <motion.g 
                 initial={{ y: -150, opacity: 0 }}
                 animate={mood === 'cool' ? { y: -15, opacity: 1 } : { y: -150, opacity: 0 }}
                 transition={{ type: "spring", stiffness: 120, damping: 12 }}
              >
                  {/* Left Lens */}
                  <rect x="60" y="80" width="40" height="20" fill="black" />
                  <rect x="60" y="80" width="5" height="5" fill="white" opacity="0.4" />
                  <rect x="65" y="85" width="5" height="5" fill="white" opacity="0.4" />
                  
                  {/* Right Lens */}
                  <rect x="105" y="80" width="40" height="20" fill="black" />
                  <rect x="105" y="80" width="5" height="5" fill="white" opacity="0.4" />
                  <rect x="110" y="85" width="5" height="5" fill="white" opacity="0.4" />
                  
                  {/* Bridge */}
                  <rect x="100" y="82" width="5" height="5" fill="black" />
                  
                  {/* Arms */}
                  <rect x="145" y="80" width="10" height="5" fill="black" />
                  <rect x="50" y="80" width="10" height="5" fill="black" />
              </motion.g>

          </svg>
        </motion.div>
        
        {/* Helper Caption (Hidden when open) */}
        {!isOpen && (
            <div className="mt-1 bg-[#003D6F] px-3 py-1 rounded-full shadow-lg border border-white/20 animate-in fade-in zoom-in duration-300">
            <p className="text-white font-bold text-[10px] md:text-xs whitespace-nowrap">
                Ask me!
            </p>
            </div>
        )}
      </div>
    </>
  )
}