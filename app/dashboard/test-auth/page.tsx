'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function TestAuthPage() {
    const supabase = createClient()
    const [debugInfo, setDebugInfo] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function check() {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                setDebugInfo({ error: 'Not logged in' })
                setLoading(false)
                return
            }

            const { data: profile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single()

            const { data: agencyProfile } = profile?.agency_id 
                ? await supabase.from('profiles').select('id, business_name, role, facebook_token').eq('id', profile.agency_id).single()
                : { data: null }

            setDebugInfo({
                currentUser: {
                    id: user.id,
                    email: user.email,
                    role: profile?.role,
                    agency_id: profile?.agency_id,
                    parent_id: profile?.parent_id
                },
                resolvedAgency: agencyProfile ? {
                    id: agencyProfile.id,
                    name: agencyProfile.business_name,
                    hasToken: !!agencyProfile.facebook_token
                } : 'NONE FOUND'
            })
            setLoading(false)
        }
        check()
    }, [])

    if (loading) return <div className="p-10">Checking...</div>

    return (
        <div className="p-10 bg-slate-900 text-white min-h-screen">
            <h1 className="text-2xl font-bold mb-5">Admin Diagnostic Tool</h1>
            <pre className="bg-black p-5 rounded border border-slate-700 overflow-auto">
                {JSON.stringify(debugInfo, null, 2)}
            </pre>
            <div className="mt-10 p-5 bg-blue-900/30 border border-blue-500 rounded">
                <h2 className="font-bold">What this means:</h2>
                <ul className="list-disc ml-5 mt-2">
                    <li>If <strong>agency_id</strong> is null, the Admin is not linked to you.</li>
                    <li>If <strong>resolvedAgency</strong> is "NONE FOUND", the link is broken.</li>
                    <li>If <strong>hasToken</strong> is false, the Admin can't see Facebook.</li>
                </ul>
            </div>
        </div>
    )
}
