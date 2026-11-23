import { NextResponse } from 'next/server'
import { META_GRAPH_URL } from '@/lib/ads/graph-version'
import { requireUser, serviceAdmin, canActForUser } from '@/utils/route-auth'

export const dynamic = 'force-dynamic'

/**
 * Meta ad-geolocation search.
 *
 * Two things were wrong here:
 *  1. It had no authentication, so it was an open Graph proxy that would forward
 *     whatever token the caller supplied.
 *  2. The token travelled in the query string (`?token=…`) from the browser,
 *     which put a long-lived tenant credential into history, proxy logs and
 *     Referer headers.
 *
 * The token is now read server-side from the tenant's profile; the client only
 * says which account it is acting for.
 */
export async function GET(request: Request) {
    const caller = await requireUser(request)
    if (!caller) {
        return NextResponse.json({ error: 'Unauthorized', data: [] }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')
    const impersonateId = searchParams.get('impersonate')
    // Older clients still send `token`; it is deliberately ignored.
    const targetUserId = impersonateId && impersonateId !== 'null' && impersonateId !== 'undefined'
        ? impersonateId
        : caller.id

    if (!q) return NextResponse.json({ data: [] })

    if (targetUserId !== caller.id && !(await canActForUser(caller.id, targetUserId))) {
        return NextResponse.json({ error: 'Forbidden', data: [] }, { status: 403 })
    }

    try {
        const { data: profile } = await serviceAdmin()
            .from('profiles')
            .select('facebook_token')
            .eq('id', targetUserId)
            .maybeSingle()

        const token = (profile as any)?.facebook_token
        if (!token) {
            return NextResponse.json({ data: [], error: 'No Meta account connected.' })
        }

        const res = await fetch(
            `${META_GRAPH_URL}/search?type=adgeolocation&q=${encodeURIComponent(q)}&access_token=${token}`
        )
        const data = await res.json()
        return NextResponse.json({ data: data.data || [] })
    } catch (error) {
        return NextResponse.json({ data: [] })
    }
}
