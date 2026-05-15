import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const adAccountId = searchParams.get('adAccountId')
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('facebook_token, agency_id, parent_id').eq('id', user.id).single()
    
    let token = profile?.facebook_token
    if (!token && (profile?.agency_id || profile?.parent_id)) {
        const { data: parentProfile } = await supabase
            .from('profiles')
            .select('facebook_token')
            .eq('id', profile.agency_id || profile.parent_id)
            .single()
        token = parentProfile?.facebook_token
    }

    if (!token) return NextResponse.json({ error: 'No token' }, { status: 400 })

    try {
        const res = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}?fields=account_status,has_payment_method,disable_reason&access_token=${token}`)
        const data = await res.json()
        return NextResponse.json(data)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}