'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Send } from 'lucide-react'

export default function ChatMascot() {
   const [isOpen, setIsOpen] = useState(false)

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
                              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" /> Online
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
                           Hello! I'm Rolls. 🐶 <br />How can I help you grow your business today?
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
