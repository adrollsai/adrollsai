'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Wallet, CreditCard, History, ArrowUpRight, Loader2 } from 'lucide-react'

export default function WalletPage() {
    const supabase = createClient()
    const [balance, setBalance] = useState(0)
    const [amount, setAmount] = useState(1000)
    const [loading, setLoading] = useState(false)
    const [transactions, setTransactions] = useState<any[]>([])

    useEffect(() => {
        loadWalletData()
    }, [])

    const loadWalletData = async () => {
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
    }

    const handleTopUp = async () => {
        if(amount < 1000 || amount % 1000 !== 0) {
            alert("Amount must be a multiple of ₹1000 (Min ₹1000)")
            return
        }
        setLoading(true)
        try {
            const res = await fetch('/api/phonepe/pay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount }) // No adId
            })
            const data = await res.json()
            if(data.url) window.location.href = data.url
            else alert("Error initiating payment")
        } catch(e) { console.error(e); alert("Payment Error") }
        setLoading(false)
    }

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-8 mt-12">
            <h1 className="text-2xl font-bold flex items-center gap-2">
                <Wallet className="text-slate-900"/> My Wallet
            </h1>

            {/* BALANCE CARD */}
            <div className="bg-slate-900 text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
                <div className="relative z-10">
                    <p className="text-slate-400 text-sm font-medium mb-1">Available Credits</p>
                    <h2 className="text-5xl font-bold">₹{balance.toLocaleString()}</h2>
                </div>
                <div className="absolute right-[-20px] top-[-20px] opacity-10">
                    <Wallet size={200} />
                </div>
            </div>

            {/* TOP UP SECTION */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <ArrowUpRight size={18} /> Add Funds
                </h3>
                <div className="flex gap-4 items-center">
                    <div className="relative flex-1">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                        <input 
                            type="number" 
                            step="1000"
                            min="1000"
                            value={amount}
                            onChange={(e) => setAmount(parseInt(e.target.value))}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 pl-8 pr-4 font-bold text-lg outline-none focus:ring-2 focus:ring-slate-900"
                        />
                    </div>
                    <button 
                        onClick={handleTopUp}
                        disabled={loading}
                        className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 rounded-xl font-bold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="animate-spin"/> : <CreditCard size={20} />}
                        Pay Now
                    </button>
                </div>
                <p className="text-xs text-slate-400 mt-2 ml-1">Minimum ₹1,000. Multiples of ₹1,000 only.</p>
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
                        // FIX: Added index as fallback key to prevent uniqueness error
                        transactions.map((tx, index) => (
                            <div key={tx.id || index} className="p-4 border-b border-slate-100 last:border-0 flex justify-between items-center hover:bg-slate-50">
                                <div>
                                    <p className="font-bold text-slate-800 text-sm">
                                        {tx.ad_id ? 'Ad Campaign Purchase' : 'Wallet Top Up'}
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