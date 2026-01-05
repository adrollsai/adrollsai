'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Wallet, History, Info, RefreshCw } from 'lucide-react'

export default function WalletPage() {
    const supabase = createClient()
    const [balance, setBalance] = useState(0)
    const [transactions, setTransactions] = useState<any[]>([])
    const [refreshing, setRefreshing] = useState(false)

    // Helper function to fetch data (used by Init, Realtime, and Manual Refresh)
    const loadWalletData = async () => {
        setRefreshing(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if(!user) return

            // 1. Get Balance
            const { data: profile } = await supabase.from('profiles').select('ad_credits').eq('id', user.id).single()
            if(profile) setBalance(profile.ad_credits || 0)

            // 2. Get History
            const { data: txs } = await supabase
                .from('transactions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(20)
            
            if(txs) setTransactions(txs)
        } catch (error) {
            console.error("Wallet Load Error:", error)
        } finally {
            setRefreshing(false)
        }
    }

    useEffect(() => {
        let channel: any;

        const init = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if(!user) return

            // 1. Initial Load
            loadWalletData()

            // 2. Realtime Subscription (Listen for Balance Updates)
            channel = supabase
                .channel('page_wallet_sub')
                .on(
                    'postgres_changes',
                    { 
                        event: 'UPDATE', 
                        schema: 'public', 
                        table: 'profiles', 
                        filter: `id=eq.${user.id}` 
                    },
                    (payload) => { 
                        if (payload.new) {
                            setBalance(payload.new.ad_credits)
                            // Reload transactions to show the new entry
                            loadWalletData() 
                        }
                    }
                )
                .subscribe()
        }

        init()

        // 3. PWA Visibility Handler (Robustness Fix)
        // Forces a refresh when the user switches back to the app tab/window
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log("App foregrounded: Refreshing wallet...")
                loadWalletData() 
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            if(channel) supabase.removeChannel(channel)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [])

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-8 mt-12">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Wallet className="text-slate-900"/> My Wallet
                </h1>
                {/* Manual Refresh Button (Fallback) */}
                <button 
                    onClick={() => loadWalletData()} 
                    disabled={refreshing}
                    className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
                    title="Refresh Balance"
                >
                    <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
                </button>
            </div>

            {/* BALANCE CARD */}
            <div className="bg-slate-900 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden transition-all duration-300">
                <div className="relative z-10">
                    <p className="text-slate-400 text-sm font-medium mb-1">Available Credits</p>
                    {/* Animate value change */}
                    <h2 className="text-5xl font-bold transition-all">₹{balance.toLocaleString()}</h2>
                </div>
                <div className="absolute right-[-20px] top-[-20px] opacity-10">
                    <Wallet size={200} />
                </div>
            </div>

            {/* INFO SECTION */}
            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex items-start gap-4">
                <div className="bg-blue-100 p-2 rounded-full text-blue-600">
                    <Info size={24} />
                </div>
                <div>
                    <h3 className="font-bold text-blue-900 mb-1">Need more credits?</h3>
                    <p className="text-sm text-blue-700 leading-relaxed">
                        Credit top-ups are currently managed by your organization administrator. 
                        Please contact your admin to add funds to your wallet for running ad campaigns.
                    </p>
                </div>
            </div>

            {/* HISTORY */}
            <div>
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <History size={18} /> Transaction History
                </h3>
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    {transactions.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-sm">No transactions yet.</div>
                    ) : (
                        transactions.map((tx, index) => (
                            <div key={tx.id || index} className="p-4 border-b border-slate-100 last:border-0 flex justify-between items-center hover:bg-slate-50">
                                <div>
                                    <p className="font-bold text-slate-800 text-sm">
                                        {tx.ad_id ? 'Ad Campaign Purchase' : 'Wallet Update'}
                                    </p>
                                    <p className="text-xs text-slate-400 font-mono">{tx.order_id}</p>
                                </div>
                                <div className="text-right">
                                    <p className={`font-bold text-sm ${tx.status === 'SUCCESS' ? 'text-green-600' : 'text-slate-500'}`}>
                                        {tx.status === 'SUCCESS' ? '+' : ''}₹{(tx.amount / 100).toLocaleString()}
                                    </p>
                                    <p className="text-[10px] text-slate-400">{new Date(tx.created_at).toLocaleDateString()}</p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}