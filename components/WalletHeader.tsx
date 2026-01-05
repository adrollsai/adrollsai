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
        <Link 
            href="/dashboard/wallet"
            className="bg-slate-900 text-white px-3 py-1.5 rounded-full shadow-sm flex items-center gap-2 hover:bg-slate-800 transition-colors border border-slate-800"
        >
            <Wallet size={12} className="text-green-400" />
            <span className="text-[10px] font-bold tracking-wide">₹{credits.toLocaleString()}</span>
        </Link>
    )
}