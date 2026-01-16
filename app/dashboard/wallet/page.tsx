'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Wallet, CreditCard, ExternalLink, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export default function WalletPage() {
    const supabase = createClient()
    const [adAccountId, setAdAccountId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if(user) {
                const { data } = await supabase.from('profiles').select('ad_account_id').eq('id', user.id).single()
                setAdAccountId(data?.ad_account_id || null)
            }
            setLoading(false)
        }
        load()
    }, [])

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-8 mt-12">
            <h1 className="text-2xl font-bold flex items-center gap-2">
                <Wallet className="text-slate-900"/> Billing & Payments
            </h1>

            <div className="bg-white p-8 rounded-3xl shadow-lg border border-slate-100 text-center">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CreditCard size={32} />
                </div>
                
                <h2 className="text-xl font-bold text-slate-900 mb-2">Manage Ad Payments</h2>
                <p className="text-slate-500 mb-8 max-w-md mx-auto">
                    Your ads are billed directly to your Meta Ad Account. Manage your payment methods and view invoices securely on Facebook.
                </p>

                {loading ? (
                    <p className="text-slate-400">Loading...</p>
                ) : adAccountId ? (
                    <a 
                        href={`https://secure.facebook.com/ads/manager/billing_history/summary/?act=${adAccountId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
                    >
                        <ExternalLink size={18} /> Go to Meta Billing
                    </a>
                ) : (
                    <Link href="/dashboard/profile" className="inline-flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-xl font-bold">
                        Connect Ad Account
                    </Link>
                )}
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 flex gap-4">
                <ShieldCheck className="text-green-600 shrink-0" size={24} />
                <div>
                    <h3 className="font-bold text-slate-900">Decentralized Billing</h3>
                    <p className="text-sm text-slate-500 mt-1">
                        We no longer hold your funds. You pay Facebook directly. This ensures complete transparency and control over your ad spend.
                    </p>
                </div>
            </div>
        </div>
    )
}