'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Wallet } from 'lucide-react'
import Link from 'next/link'
import { useOrganization } from '@/components/OrganizationWrapper'

export default function WalletHeader() {
    const supabase = createClient()
    const { userRole } = useOrganization()
    const [credits, setCredits] = useState<number | null>(null)

    useEffect(() => {
        let channel: any;

        const fetchData = async () => {
            if (userRole !== 'agent') return;
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Fetch latest data
            const { data } = await supabase.from('profiles').select('ad_credits').eq('id', user.id).single()
            if (data) setCredits(data.ad_credits || 0)
        }

        const setupRealtime = async () => {
            if (userRole !== 'agent') return;
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Channel Subscription
            channel = supabase.channel('header_wallet_sub')
                .on('postgres_changes', 
                    { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
                    (payload) => { if (payload.new) setCredits(payload.new.ad_credits) }
                )
                .subscribe()
        }

        // 1. Initial Load
        fetchData()
        setupRealtime()

        // 2. PWA Visibility Handler (Robustness Fix)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log("App foregrounded: Refreshing wallet...")
                fetchData() // Force refresh when app comes back
                
                // Optional: Reconnect socket if needed
                if(channel?.state === 'closed') setupRealtime() 
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            if (channel) supabase.removeChannel(channel)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [userRole])

    if (userRole !== 'agent' || credits === null) return null

    return (
        <Link 
            href="/dashboard/wallet"
            className="bg-slate-900 text-white px-3 py-1.5 rounded-full shadow-sm flex items-center gap-2 hover:bg-slate-800 transition-colors border border-slate-800"
        >
            <Wallet size={12} className="text-green-400" />
            <span className="text-[10px] font-bold tracking-wide animate-in fade-in">₹{credits.toLocaleString()}</span>
        </Link>
    )
}