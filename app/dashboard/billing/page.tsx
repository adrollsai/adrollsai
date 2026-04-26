'use client'

import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, Rocket, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function BillingPage() {
    const router = useRouter()
    const supabase = createClient()
    const [isProcessing, setIsProcessing] = useState<string | null>(null)
    const [successMessage, setSuccessMessage] = useState(false)

    // Catch the successful return from PhonePe
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get('payment') === 'success') {
            setSuccessMessage(true)
            setTimeout(() => {
                window.location.href = '/dashboard' // Send to main app after 3 seconds
            }, 3000)
        }
    }, [])

    const handleSubscribe = async (planId: string) => {
        setIsProcessing(planId)
        try {
            const res = await fetch('/api/payment/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planId })
            })
            const data = await res.json()
            if (data.url) {
                window.location.href = data.url // Send to PhonePe
            } else {
                throw new Error(data.error)
            }
        } catch (error: any) {
            alert("Error initiating payment: " + error.message)
            setIsProcessing(null)
        }
    }

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.push('/login')
    }

    if (successMessage) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-green-50 p-6 text-center">
                <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center text-white mb-6 shadow-lg animate-bounce">
                    <CheckCircle2 size={40} />
                </div>
                <h1 className="text-3xl font-black text-green-800 mb-2">Payment Successful!</h1>
                <p className="text-green-600 font-medium">Your subscription is active. Preparing your dashboard...</p>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6 pb-24">
            <div className="max-w-5xl mx-auto mt-10">
                
                <div className="flex justify-between items-center mb-10">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900">Choose Your Plan</h1>
                        <p className="text-slate-500 mt-2 font-medium">Subscribe to unlock your AdRolls workspace.</p>
                    </div>
                    <button onClick={handleLogout} className="flex items-center gap-2 text-slate-500 font-bold hover:text-red-500 transition-colors">
                        <LogOut size={18} /> Sign Out
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* STARTER */}
                    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                        <h3 className="text-xl font-bold text-slate-800">Starter</h3>
                        <div className="mt-4 mb-6">
                            <span className="text-4xl font-black text-slate-900">₹4,999</span>
                            <span className="text-slate-500 text-sm">/mo + GST</span>
                        </div>
                        <ul className="space-y-3 mb-8 flex-1">
                            <li className="flex items-center gap-2 text-sm text-slate-600 font-medium"><CheckCircle2 size={16} className="text-green-500"/> AI Creation Studio</li>
                            <li className="flex items-center gap-2 text-sm text-slate-600 font-medium"><CheckCircle2 size={16} className="text-green-500"/> Basic CRM Access</li>
                            <li className="flex items-center gap-2 text-sm text-slate-600 font-medium"><CheckCircle2 size={16} className="text-green-500"/> 0 Agent Seats</li>
                        </ul>
                        <button onClick={() => handleSubscribe('starter')} disabled={!!isProcessing} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3.5 rounded-xl font-bold flex justify-center transition-all">
                            {isProcessing === 'starter' ? <Loader2 className="animate-spin" /> : 'Setup Auto-Pay'}
                        </button>
                    </div>

                    {/* PROFESSIONAL */}
                    <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-xl flex flex-col transform md:-translate-y-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-blue-500 text-white text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider">Most Popular</div>
                        <h3 className="text-xl font-bold text-white">Professional</h3>
                        <div className="mt-4 mb-6">
                            <span className="text-4xl font-black text-white">₹9,999</span>
                            <span className="text-slate-400 text-sm">/mo + GST</span>
                        </div>
                        <ul className="space-y-3 mb-8 flex-1">
                            <li className="flex items-center gap-2 text-sm text-slate-300 font-medium"><CheckCircle2 size={16} className="text-blue-400"/> Everything in Starter</li>
                            <li className="flex items-center gap-2 text-sm text-slate-300 font-medium"><CheckCircle2 size={16} className="text-blue-400"/> Up to 5 Team Members</li>
                            <li className="flex items-center gap-2 text-sm text-slate-300 font-medium"><CheckCircle2 size={16} className="text-blue-400"/> Meta Ads AI Integration</li>
                        </ul>
                        <button onClick={() => handleSubscribe('professional')} disabled={!!isProcessing} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-bold flex justify-center transition-all">
                            {isProcessing === 'professional' ? <Loader2 className="animate-spin" /> : 'Setup Auto-Pay'}
                        </button>
                    </div>

                    {/* ENTERPRISE */}
                    <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                        <h3 className="text-xl font-bold text-slate-800">Enterprise</h3>
                        <div className="mt-4 mb-6">
                            <span className="text-4xl font-black text-slate-900">₹14,999</span>
                            <span className="text-slate-500 text-sm">/mo + GST</span>
                        </div>
                        <ul className="space-y-3 mb-8 flex-1">
                            <li className="flex items-center gap-2 text-sm text-slate-600 font-medium"><CheckCircle2 size={16} className="text-green-500"/> Everything in Pro</li>
                            <li className="flex items-center gap-2 text-sm text-slate-600 font-medium"><CheckCircle2 size={16} className="text-green-500"/> Unlimited Agents</li>
                            <li className="flex items-center gap-2 text-sm text-slate-600 font-medium"><CheckCircle2 size={16} className="text-green-500"/> Custom Domain Support</li>
                        </ul>
                        <button onClick={() => handleSubscribe('enterprise')} disabled={!!isProcessing} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3.5 rounded-xl font-bold flex justify-center transition-all">
                            {isProcessing === 'enterprise' ? <Loader2 className="animate-spin" /> : 'Setup Auto-Pay'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}