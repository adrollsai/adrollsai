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
        if (userRole === 'agent') {
            fetchCredits()
        }
    }, [userRole])

    const fetchCredits = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data } = await supabase.from('profiles').select('ad_credits').eq('id', user.id).single()
            if (data) setCredits(data.ad_credits || 0)
        }
    }

    if (userRole !== 'agent' || credits === null) return null

    return (
        // CHANGED: 'right-0' instead of 'left-0'
        <div className="fixed top-0 right-0 z-50 p-4 pointer-events-none">
            <Link 
                href="/dashboard/wallet"
                // Compact styling: text-[10px], reduced padding
                className="bg-slate-900/90 backdrop-blur-md text-white px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 pointer-events-auto hover:scale-105 transition-transform cursor-pointer border border-white/10"
            >
                <Wallet size={12} className="text-green-400" />
                <span className="text-[10px] font-bold tracking-wide">₹{credits.toLocaleString()}</span>
                <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse ml-0.5"/>
            </Link>
        </div>
    )
}