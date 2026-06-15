'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Loader2, Send } from 'lucide-react'

export default function ContactForm() {
   const [contactName, setContactName] = useState('')
   const [contactEmail, setContactEmail] = useState('')
   const [contactPhone, setContactPhone] = useState('')
   const [contactMessage, setContactMessage] = useState('')
   const [budget, setBudget] = useState('10k - 20k')
   const [timeline, setTimeline] = useState('Immediately')
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
               message: contactMessage,
               budget,
               timeline
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

   return (
      <form onSubmit={handleContactSubmit} className="md:col-span-7 space-y-5 flex flex-col justify-center">
         {submitSuccess ? (
            <motion.div
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center"
            >
               <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3 border border-green-200 text-green-600">
                  <CheckCircle2 size={24} />
               </div>
               <h4 className="text-xl font-black text-[#003D6F] mb-1">Message Sent!</h4>
               <p className="text-slate-600 font-bold text-xs leading-relaxed">
                  🐶 Thank you! We have received your query. Our sales assistant will get in touch with you shortly.
               </p>
            </motion.div>
         ) : (
            <>
               {submitError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold flex items-center gap-2">
                     <span className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
                     {submitError}
                  </div>
               )}

               {/* Qualification Questions */}
               <div className="space-y-4 bg-slate-50/60 p-4.5 rounded-2xl border border-slate-200/50 mb-2">
                  <div className="space-y-2">
                     <label className="text-[10px] text-[#003D6F] font-black uppercase tracking-wider block">What is your monthly marketing budget?</label>
                     <div className="grid grid-cols-3 gap-2">
                        {['10k - 20k', '20k - 30k', '50k+'].map(opt => (
                           <button
                              type="button"
                              key={opt}
                              onClick={() => setBudget(opt)}
                              className={`py-2.5 text-xs font-black rounded-xl border text-center transition-all cursor-pointer ${
                                 budget === opt 
                                 ? 'bg-[#003D6F] text-white border-[#003D6F] shadow-sm' 
                                 : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                           >
                              {opt}
                           </button>
                        ))}
                     </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] text-[#003D6F] font-black uppercase tracking-wider block">When are you looking to get started?</label>
                     <div className="grid grid-cols-3 gap-2">
                        {['Immediately', 'This Week', 'Next Week'].map(opt => (
                           <button
                              type="button"
                              key={opt}
                              onClick={() => setTimeline(opt)}
                              className={`py-2.5 text-xs font-black rounded-xl border text-center transition-all cursor-pointer ${
                                 timeline === opt 
                                 ? 'bg-[#003D6F] text-white border-[#003D6F] shadow-sm' 
                                 : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                              }`}
                           >
                              {opt}
                           </button>
                        ))}
                     </div>
                  </div>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                     <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Full Name</label>
                     <input
                        type="text"
                        required
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        placeholder="Your Name"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] transition-all"
                     />
                  </div>
                  <div className="space-y-1">
                     <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Phone Number</label>
                     <input
                        type="tel"
                        required
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="e.g. +91 99999 99999"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] transition-all"
                     />
                  </div>
               </div>

               <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Email Address</label>
                  <input
                     type="email"
                     required
                     value={contactEmail}
                     onChange={(e) => setContactEmail(e.target.value)}
                     placeholder="email@example.com"
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] transition-all"
                  />
               </div>

               <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-wider">Your Message</label>
                  <textarea
                     required
                     rows={3}
                     value={contactMessage}
                     onChange={(e) => setContactMessage(e.target.value)}
                     placeholder="How can we help your business grow?"
                     className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-[#003D6F] placeholder:text-slate-400 focus:outline-none focus:border-[#003D6F] transition-all resize-none"
                  />
               </div>

               <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 bg-[#B22B31] hover:bg-[#902227] disabled:bg-slate-400 text-white rounded-xl font-black text-base transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
               >
                  {isSubmitting ? (
                     <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                     </>
                  ) : (
                     <>
                        Send Query <Send size={14} />
                     </>
                  )}
               </button>
            </>
         )}
      </form>
   )
}
