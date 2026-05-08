'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { X, Check, Zap, ShieldCheck, Loader2, ArrowRight, CalendarDays, Lock } from 'lucide-react'
import { toast } from 'sonner'

export default function BillingPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [loading, setLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [renewalDate, setRenewalDate] = useState<string | null>(null)

  // Check Subscription Status on Load
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.push('/')
            return
        }
        setUserEmail(user.email || '')

        // FIXED: Using the exact column names from your database screenshot
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('subscription_status, subscription_valid_until, subscription_plan')
          .eq('id', user.id)
          .single()

        if (error) {
            console.error("Supabase error fetching profile:", error)
            throw error
        }

        const currentStatus = profile?.subscription_status?.toLowerCase() || ''
        
        if (currentStatus === 'active' || currentStatus === 'trialing' || currentStatus === 'pro') {
          setIsActive(true)
          
          // Use your exact column name for the date
          if (profile?.subscription_valid_until) {
              setRenewalDate(new Date(profile.subscription_valid_until).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }))
          } else {
              const nextMonth = new Date()
              nextMonth.setMonth(nextMonth.getMonth() + 1)
              setRenewalDate(nextMonth.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }))
          }
        }
      } catch (error) {
        console.error("Error checking subscription:", error)
      } finally {
        setLoading(false)
      }
    }
    checkStatus()
  }, [router, supabase])

  // Handle Payment Initiation
  const handleSubscribe = async () => {
    setIsProcessing(true)
    try {
      const res = await fetch('/api/payment/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            amount: 9999,
            plan: 'Pro All-Access Monthly'
        })
      })
      
      const data = await res.json()
      
      if (!res.ok) throw new Error(data.error || 'Failed to initiate payment')
      
      if (data.redirectUrl) {
          window.location.href = data.redirectUrl
      } else {
          toast.error("Payment gateway configuration error.")
      }

    } catch (error: any) {
      toast.error('Payment Error', { description: error.message })
      setIsProcessing(false)
    }
  }

  const features = [
    "80 AI Creatives per month",
    "10 Campaign Launches per month",
    "10 AI Ad Optimizations per month",
    "10 Remarketing Campaigns per month",
    "30 AI SEO Articles per month",
    "Social Media Posting to Meta",
    "Unlimited Inventory Products",
    "10 GB Cloud Storage",
    "Custom Whitelabeled App",
    "Unlimited CRM & Team Members",
    "Unlimited Lead Form Syncs",
    "Priority WhatsApp Support"
  ]

  if (loading) {
      return (
          <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
              <Loader2 className="animate-spin text-blue-600" size={28} />
              <p className="text-sm text-slate-500 font-medium">Loading billing details...</p>
          </div>
      )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24 font-sans">
      
      {/* Sleek Top Navigation */}
      <div className="bg-white sticky top-0 z-40 border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
              <ShieldCheck size={20} className="text-blue-600" />
              <h1 className="text-base font-semibold text-slate-900">Subscription & Billing</h1>
          </div>
          
          <button 
              onClick={() => router.push('/dashboard/profile')}
              className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors"
              title="Close"
          >
              <X size={20} />
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16">
          
          <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-widest mb-4 border border-blue-100">
                  <Zap size={12} fill="currentColor" /> Limited period offer
              </div>
              <h2 className="text-3xl font-bold text-slate-900 tracking-tight mb-3">
                  Early Bird Plan
              </h2>
              <p className="text-slate-500 text-sm sm:text-base max-w-lg mx-auto">
                  Unlock the full power of AI-driven marketing with our exclusive Early Bird offer. <strong>No onboarding charges</strong> for a limited time.
              </p>
          </div>

          {/* Premium Pricing Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
              
              {isActive && (
                  <div className="bg-green-50 border-b border-green-100 px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5 text-green-700">
                          <Check className="w-5 h-5" />
                          <div>
                              <p className="text-sm font-semibold">Your subscription is active</p>
                              <p className="text-xs text-green-600/80">You have access to all Early Bird features.</p>
                          </div>
                      </div>
                      {renewalDate && (
                          <div className="flex items-center gap-2 text-sm text-slate-600 bg-white px-3 py-1.5 rounded-md border border-green-100 shadow-sm">
                              <CalendarDays size={14} className="text-slate-400" />
                              <span>Valid Until <span className="font-semibold text-slate-800">{renewalDate}</span></span>
                          </div>
                      )}
                  </div>
              )}

              <div className="p-6 sm:p-10 flex flex-col md:flex-row gap-10">
                  
                  {/* Left Column: Pricing & CTA */}
                  <div className="flex-1 flex flex-col">
                      <div className="mb-2">
                          <h3 className="text-lg font-semibold text-slate-900">Early Bird Access</h3>
                          <p className="text-xs text-blue-600 font-bold mt-1 uppercase tracking-tight">Free Onboarding Included</p>
                      </div>

                      <div className="my-6">
                          <div className="flex items-baseline gap-1">
                              <span className="text-2xl font-semibold text-slate-400">₹</span>
                              <span className="text-5xl font-bold text-slate-900 tracking-tight">9,999</span>
                              <span className="text-base text-slate-500 font-medium ml-1">/ mo</span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-2">Inclusive of all taxes</p>
                      </div>

                      <div className="mt-auto pt-4">
                          {isActive ? (
                              <button 
                                  disabled
                                  className="w-full bg-slate-100 text-slate-400 py-3 rounded-lg text-sm font-semibold flex items-center justify-center cursor-not-allowed border border-slate-200 gap-2"
                              >
                                  <ShieldCheck size={18} className="text-slate-400" /> Current Plan
                              </button>
                          ) : (
                              <button 
                                  onClick={handleSubscribe} 
                                  disabled={isProcessing}
                                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-70 group"
                              >
                                  {isProcessing ? (
                                      <Loader2 size={18} className="animate-spin" />
                                  ) : (
                                      <>
                                          <Zap size={16} className="text-blue-200" /> 
                                          Claim Offer
                                      </>
                                  )}
                              </button>
                          )}
                          
                          {!isActive && (
                              <p className="text-center text-xs text-slate-400 mt-4 flex items-center justify-center gap-1.5">
                                  <Lock size={12} /> Secure Checkout
                              </p>
                          )}
                      </div>
                  </div>

                  {/* Right Column: Features List */}
                  <div className="flex-1 md:pl-10 md:border-l border-slate-100">
                      <h4 className="text-xs font-semibold text-slate-900 mb-6 uppercase tracking-wider">Plan Highlights</h4>
                      <ul className="space-y-3">
                          {features.map((feature, idx) => (
                              <li key={idx} className="flex items-start gap-3">
                                  <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100">
                                      <Check size={12} className="text-blue-600" strokeWidth={3} />
                                  </div>
                                  <span className="text-sm text-slate-600 font-medium">{feature}</span>
                              </li>
                          ))}
                      </ul>
                  </div>

              </div>
          </div>
          
      </div>
    </div>
  )
}