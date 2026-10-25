import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const FB_MARKETING_URL = "https://graph.facebook.com/v20.0"

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')
    let token = searchParams.get('token')
    const impersonateId = searchParams.get('impersonate')

    if (!q || q.trim().length === 0) {
        return NextResponse.json({ data: [] })
    }

    // Resolve token if not provided in query param
    if (!token) {
        try {
            const supabase = await createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }

            const { createClient: createAdminClient } = await import('@supabase/supabase-js')
            const supabaseAdmin = createAdminClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY!
            )

            let targetUserId = user.id
            const { data: ownProfile } = await supabaseAdmin
                .from('profiles')
                .select('role, parent_id, agency_id, facebook_token')
                .eq('id', user.id)
                .single()

            if (ownProfile?.role === 'agent' && (ownProfile?.parent_id || ownProfile?.agency_id)) {
                targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string
            }

            if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
                targetUserId = impersonateId
            }

            const { data: targetProfile } = await supabaseAdmin
                .from('profiles')
                .select('facebook_token')
                .eq('id', targetUserId)
                .single()

            token = targetProfile?.facebook_token || ownProfile?.facebook_token || null
        } catch (e) {
            console.error('[SearchInterests] Failed to resolve token:', e)
        }
    }

    if (!token) {
        return NextResponse.json({ error: 'No Meta access token found' }, { status: 400 })
    }

    try {
        const url = `${FB_MARKETING_URL}/search?type=adinterest&q=${encodeURIComponent(q.trim())}&limit=25&access_token=${token}`
        const res = await fetch(url)
        const data = await res.json()

        if (!res.ok || data.error) {
            console.error('[SearchInterests] Meta API Error:', data.error)
            return NextResponse.json({ 
                error: data.error?.message || 'Failed to search interests on Meta', 
                data: [] 
            }, { status: 200 })
        }

        return NextResponse.json({ data: data.data || [] })
    } catch (error: any) {
        console.error('[SearchInterests] Unexpected error:', error)
        return NextResponse.json({ error: error.message, data: [] }, { status: 500 })
    }
}
