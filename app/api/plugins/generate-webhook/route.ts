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
        const service = body.service || '99acres' // '99acres' | 'housing'

        // Admin client to bypass RLS
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Check profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('webhook_token_99acres, badges')
            .eq('id', targetUserId)
            .single()

        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
        }

        const baseUrl = getBaseUrl(request)

        if (service === 'housing') {
            // Read housing token from badges
            const badges: string[] = Array.isArray(profile.badges) ? profile.badges : []
            const existingBadge = badges.find(b => typeof b === 'string' && b.startsWith('__WEBHOOK_TOKEN_HOUSING__:'))
            const existingToken = existingBadge ? existingBadge.replace('__WEBHOOK_TOKEN_HOUSING__:', '') : null

            if (existingToken && !regenerate) {
                return NextResponse.json({
                    webhookUrl: `${baseUrl}/api/webhooks/housing/${existingToken}`,
                    token: existingToken
                })
            }

            // Generate new token
            const newToken = randomUUID().replace(/-/g, '')
            const updatedBadges = badges.filter(b => typeof b !== 'string' || !b.startsWith('__WEBHOOK_TOKEN_HOUSING__:'))
            updatedBadges.push(`__WEBHOOK_TOKEN_HOUSING__:${newToken}`)

            const { error: updateErr } = await supabaseAdmin
                .from('profiles')
                .update({ badges: updatedBadges })
                .eq('id', targetUserId)

            if (updateErr) {
                console.error('[Generate Webhook Housing] Update error:', updateErr)
                return NextResponse.json({ error: 'Failed to generate Housing webhook URL' }, { status: 500 })
            }

            return NextResponse.json({
                webhookUrl: `${baseUrl}/api/webhooks/housing/${newToken}`,
                token: newToken
            })
        } else {
            // 99acres
            if (profile.webhook_token_99acres && !regenerate) {
                return NextResponse.json({
                    webhookUrl: `${baseUrl}/api/webhooks/99acres/${profile.webhook_token_99acres}`,
                    token: profile.webhook_token_99acres
                })
            }

            const newToken = randomUUID().replace(/-/g, '')
            const { error: updateErr } = await supabaseAdmin
                .from('profiles')
                .update({ webhook_token_99acres: newToken })
                .eq('id', targetUserId)

            if (updateErr) {
                console.error('[Generate Webhook 99acres] Update error:', updateErr)
                return NextResponse.json({ error: 'Failed to generate 99acres webhook URL' }, { status: 500 })
            }

            return NextResponse.json({
                webhookUrl: `${baseUrl}/api/webhooks/99acres/${newToken}`,
                token: newToken
            })
        }
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
