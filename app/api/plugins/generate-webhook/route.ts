import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const targetUserId = body.targetUserId || user.id
        const regenerate = body.regenerate === true

        // Admin client to bypass RLS
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Check if user already has a webhook token
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('webhook_token_99acres')
            .eq('id', targetUserId)
            .single()

        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
        }

        // If token exists and not regenerating, return existing
        if (profile.webhook_token_99acres && !regenerate) {
            const baseUrl = getBaseUrl(request)
            return NextResponse.json({
                webhookUrl: `${baseUrl}/api/webhooks/99acres/${profile.webhook_token_99acres}`,
                token: profile.webhook_token_99acres
            })
        }

        // Generate a new unique token
        const newToken = randomUUID().replace(/-/g, '')

        const { error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update({ webhook_token_99acres: newToken })
            .eq('id', targetUserId)

        if (updateErr) {
            console.error('[Generate Webhook] Update error:', updateErr)
            return NextResponse.json({ error: 'Failed to generate webhook URL' }, { status: 500 })
        }

        const baseUrl = getBaseUrl(request)

        return NextResponse.json({
            webhookUrl: `${baseUrl}/api/webhooks/99acres/${newToken}`,
            token: newToken
        })
    } catch (err: any) {
        console.error('[Generate Webhook] Error:', err)
        return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
    }
}

function getBaseUrl(request: Request): string {
    const host = request.headers.get('host') || 'localhost:3000'
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${host}`
}
