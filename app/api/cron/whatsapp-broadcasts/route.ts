import { NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300 // Max 5 minutes

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    return handleReconciliation(req)
}

export async function POST(req: Request) {
    return handleReconciliation(req)
}

async function handleReconciliation(req: Request) {
    try {
        const url = new URL(req.url)
        const authHeader = req.headers.get('authorization')
        const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)

        // Verify CRON_SECRET if configured
        if (process.env.CRON_SECRET && cronSecret && cronSecret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        console.log('[BROADCAST RECONCILER CRON] Checking for incomplete broadcasts...')

        // Find broadcasts that are in 'processing' status
        const { data: activeBroadcasts, error: bErr } = await supabaseAdmin
            .from('whatsapp_broadcasts')
            .select('id, user_id, title, template_name, created_at')
            .eq('status', 'processing')
            .order('created_at', { ascending: false })
            .limit(5)

        if (bErr || !activeBroadcasts || activeBroadcasts.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No pending broadcasts require reconciliation.'
            })
        }

        const results = []

        for (const broadcast of activeBroadcasts) {
            // Check if there are pending recipients
            const { count: pendingCount } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .select('id', { count: 'exact', head: true })
                .eq('broadcast_id', broadcast.id)
                .eq('status', 'pending')

            if (!pendingCount || pendingCount === 0) {
                // All recipients finished, mark sent
                await supabaseAdmin
                    .from('whatsapp_broadcasts')
                    .update({ status: 'sent', sent_at: new Date().toISOString() })
                    .eq('id', broadcast.id)

                results.push({ broadcastId: broadcast.id, title: broadcast.title, action: 'marked_sent' })
                continue
            }

            console.log(`[BROADCAST RECONCILER CRON] Found ${pendingCount} pending recipients for broadcast ${broadcast.id} (${broadcast.title}). Triggering worker...`)

            // Trigger internal worker
            const workerUrl = `${url.origin}/api/whatsapp/broadcasts/worker`
            const workerRes = await fetch(workerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
                },
                body: JSON.stringify({ broadcastId: broadcast.id })
            }).catch(err => {
                console.error(`[BROADCAST RECONCILER CRON] Worker call failed for ${broadcast.id}:`, err)
                return null
            })

            const workerData = workerRes ? await workerRes.json().catch(() => null) : null
            results.push({
                broadcastId: broadcast.id,
                title: broadcast.title,
                pendingCount,
                workerResponse: workerData
            })
        }

        return NextResponse.json({
            success: true,
            reconciledCount: results.length,
            results
        })

    } catch (err: any) {
        console.error('[BROADCAST RECONCILER CRON] Uncaught error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
