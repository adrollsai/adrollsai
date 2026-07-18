import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const mediaUrl = url.searchParams.get('url')
        if (!mediaUrl) {
            return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
        }

        // Get user's WhatsApp access token
        const supabaseAdmin = createSupabaseAdmin(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Resolve the effective owner (handle agents and impersonation)
        const impersonateId = url.searchParams.get('impersonate')
        let ownerUserId = user.id

        if (impersonateId && impersonateId !== user.id) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            const role = authProfile?.role?.toLowerCase() || ''
            if (['super_admin', 'agency', 'admin'].includes(role)) {
                ownerUserId = impersonateId
            }
        } else {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role, parent_id, agency_id')
                .eq('id', user.id)
                .single()
            const role = profile?.role?.toLowerCase() || 'admin'
            const parentId = profile?.parent_id || profile?.agency_id
            ownerUserId = (role === 'agent' && parentId) ? parentId : user.id
        }

        const { data: ownerProfile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, facebook_token, email')
            .eq('id', ownerUserId)
            .single()

        const isMaster = ownerProfile?.email === 'rchopra489@gmail.com' || ownerProfile?.email === 'infobluesquareinfra@gmail.com'
        const token = ownerProfile?.whatsapp_access_token || ownerProfile?.facebook_token || (isMaster ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null)

        if (!token) {
            return NextResponse.json({ error: 'No WhatsApp token available' }, { status: 400 })
        }

        // Fetch the media from Meta's servers using the access token
        const mediaRes = await fetch(mediaUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })

        if (!mediaRes.ok) {
            return NextResponse.json({ error: 'Failed to fetch media from Meta' }, { status: 502 })
        }

        const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream'
        const body = mediaRes.body

        return new NextResponse(body, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'private, max-age=3600',
            }
        })
    } catch (e: any) {
        console.error('[Media Proxy] Error:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
