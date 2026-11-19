import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { canActForUser } from '@/utils/route-auth'
import {
    MAX_SEND_ATTEMPTS,
    explainMetaError,
    finalStatusFor,
    isFatalError,
    isRetryableError,
    pauseBroadcast,
    refreshBroadcastStats,
} from '@/lib/whatsapp/broadcast-progress'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Max 5 minutes for serverless processing

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}))
        const { broadcastId } = body

        if (!broadcastId) {
            return NextResponse.json({ error: 'Missing broadcastId' }, { status: 400 })
        }

        // Authorization: a valid cron / QStash secret, or an authenticated user
        // who may act for the broadcast's owner.
        //
        // The previous expression was `!process.env.CRON_SECRET || …`, so when no
        // secret was configured EVERY request counted as "cron authorized" and no
        // user check ran at all — anyone could POST a broadcast id and trigger
        // real, billable Meta sends to another tenant's audience.
        const authHeader = req.headers.get('authorization')
        const upstashAuth = req.headers.get('upstash-forward-authorization')
        const cronSecret = process.env.CRON_SECRET
        const isCronAuthorized = Boolean(
            cronSecret &&
            (authHeader === `Bearer ${cronSecret}` || upstashAuth === `Bearer ${cronSecret}`)
        )

        let userId: string | null = null
        if (!isCronAuthorized) {
            const supabase = await createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            userId = user.id
        }

        // Fetch broadcast record
        const { data: broadcast, error: bErr } = await supabaseAdmin
            .from('whatsapp_broadcasts')
            .select('*')
            .eq('id', broadcastId)
            .single()

        if (bErr || !broadcast) {
            return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
        }

        // A signed-in caller may only drive broadcasts in their own workspace.
        if (!isCronAuthorized && userId) {
            if (!(await canActForUser(userId, String((broadcast as any).user_id)))) {
                return NextResponse.json({ error: 'Forbidden: not your workspace.' }, { status: 403 })
            }
        }

        // Fetch profile credentials
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, business_name, avatar_url')
            .eq('id', broadcast.user_id)
            .single()

        if (!profile?.whatsapp_access_token || !profile?.whatsapp_phone_number_id) {
            return NextResponse.json({ error: 'WhatsApp credentials not configured for broadcast owner' }, { status: 400 })
        }

        // ── CLAIM A SLICE
        //
        // Selecting `pending` rows and then working through them lets a cron tick and a manual kick
        // pick the SAME rows up, which is how a recipient gets two "Sent Template" bubbles. Each row
        // is flipped to `processing` with a conditional update first, and only the rows this run won
        // are sent. `next_attempt_at` is honoured so a backoff is respected.
        const BATCH_LIMIT = 400
        const nowIsoForClaim = new Date().toISOString()
        const { data: candidates, error: rErr } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('id')
            .eq('broadcast_id', broadcastId)
            .eq('status', 'pending')
            .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIsoForClaim}`)
            .order('id', { ascending: true })
            .limit(BATCH_LIMIT)

        if (rErr) {
            return NextResponse.json({ error: rErr.message }, { status: 500 })
        }

        const candidateIds = (candidates || []).map((r: any) => r.id)
        let pendingRecipients: any[] = []

        if (candidateIds.length > 0) {
            const { data: claimed } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .update({ status: 'processing', updated_at: new Date().toISOString() })
                .in('id', candidateIds)
                .eq('status', 'pending')
                .select('*')
            pendingRecipients = claimed || []
        }

        if (pendingRecipients.length === 0) {
            // Nothing claimable. Either the campaign is finished or everything is waiting on a backoff.
            const { count: totalRemainingPending } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .select('id', { count: 'exact', head: true })
                .eq('broadcast_id', broadcastId)
                .eq('status', 'pending')

            if (!totalRemainingPending || totalRemainingPending === 0) {
                const counts = await refreshBroadcastStats(supabaseAdmin, broadcastId)
                await supabaseAdmin
                    .from('whatsapp_broadcasts')
                    .update({ status: finalStatusFor(counts), sent_at: new Date().toISOString() })
                    .eq('id', broadcastId)
            }

            return NextResponse.json({
                success: true,
                message: totalRemainingPending
                    ? `Nothing due yet; ${totalRemainingPending} recipient(s) are waiting out a retry backoff.`
                    : 'No pending recipients remaining for this broadcast.',
                remainingPending: totalRemainingPending || 0
            })
        }

        // Fetch lead information for these recipients
        const leadIds = pendingRecipients.map(r => r.lead_id).filter(Boolean)
        let leadsMap = new Map()
        for (let i = 0; i < leadIds.length; i += 100) {
            const batch = leadIds.slice(i, i + 100)
            const { data: bLeads } = await supabaseAdmin
                .from('leads')
                .select('id, name, phone, email, property_id, csv_audience, pipeline_stage')
                .in('id', batch)
            if (bLeads) {
                for (const l of bLeads) leadsMap.set(l.id, l)
            }
        }

        // Fetch user properties for template dynamic replacements
        const { data: properties } = await supabaseAdmin
            .from('properties')
            .select('id, title')
            .eq('user_id', broadcast.user_id)

        const accessToken = profile.whatsapp_access_token
        const phoneId = profile.whatsapp_phone_number_id
        const businessName = profile.business_name || 'Nobogent Partner'
        const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
        const templateName = broadcast.template_name

        // Fetch template details to get exact language, header format, and parameter count
        let templateLanguageCode = 'en_US'
        let templateVarCount = 0
        let headerFormat: string | null = null

        try {
            const wabaId = profile.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID
            if (wabaId && accessToken) {
                const tplRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=${templateName}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                })
                if (tplRes.ok) {
                    const tplData = await tplRes.json()
                    const foundTpl = (tplData.data || []).find((t: any) => t.name === templateName)
                    if (foundTpl) {
                        if (foundTpl.language) templateLanguageCode = foundTpl.language
                        const bodyComp = (foundTpl.components || []).find((c: any) => c.type === 'BODY')
                        if (bodyComp && bodyComp.text) {
                            const matches = bodyComp.text.match(/\{\{(\d+)\}\}/g) || []
                            const parsed = matches.map((m: string) => parseInt(m.replace(/\D/g, '')))
                            templateVarCount = new Set(parsed).size
                        }

                        const headerComp = (foundTpl.components || []).find((c: any) => c.type === 'HEADER')
                        if (headerComp && headerComp.format) {
                            headerFormat = headerComp.format.toUpperCase()
                        }
                    }
                }
            }
        } catch (tplErr) {
            console.warn('[BROADCAST WORKER] Error fetching template info from Meta:', tplErr)
        }

        // Resolve header media URL if template requires a media header
        let resolvedHeaderUrl: string | null = null
        if (headerFormat) {
            try {
                // Check recent message for this broadcast
                const { data: prevMsg } = await supabaseAdmin
                    .from('whatsapp_messages')
                    .select('media_url')
                    .ilike('message_text', `%${templateName}%`)
                    .not('media_url', 'is', null)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()

                if (prevMsg?.media_url) resolvedHeaderUrl = prevMsg.media_url
            } catch (mErr) {
                // ignore
            }

            if (!resolvedHeaderUrl) {
                try {
                    const { data: flow } = await supabaseAdmin
                        .from('whatsapp_flows')
                        .select('header_media_url')
                        .eq('user_id', broadcast.user_id)
                        .eq('template_name', templateName)
                        .maybeSingle()
                    if (flow?.header_media_url) resolvedHeaderUrl = flow.header_media_url
                } catch (flowErr) {
                    // ignore
                }

                if (!resolvedHeaderUrl) {
                    if (headerFormat === 'IMAGE') {
                        resolvedHeaderUrl = templateName === 'webinar_thursday'
                            ? 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/templates/bc63c065-9bcc-4793-bedc-f0960406425b/webinar_thursday_official.png'
                            : (profile.avatar_url || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/templates/bc63c065-9bcc-4793-bedc-f0960406425b/webinar_thursday_official.png')
                    } else if (headerFormat === 'VIDEO') {
                        resolvedHeaderUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785757278763.mp4'
                    }
                }
            }
        }

        let sentCount = 0
        let failedCount = 0
        let retriedCount = 0
        let circuitBreakerTripped = false
        let breakerReason = ''
        // Modest concurrency with a small throttle: Meta's own guidance is to stay well inside the
        // account's throughput, and a stalled campaign costs far more than a few extra seconds.
        const CONCURRENCY = 6
        let currIdx = 0

        async function worker() {
            while (currIdx < pendingRecipients.length && !circuitBreakerTripped) {
                const index = currIdx++
                const r = pendingRecipients[index]
                if (!r) break
                const lead = leadsMap.get(r.lead_id)

                let cleanPhone = (r.phone_number || lead?.phone || '').replace(/\D/g, '')
                if (!cleanPhone) continue
                if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone

                const property = (properties || []).find((p: any) => p.id === lead?.property_id)
                const propertyTitle = property ? property.title : 'Premium Listings'

                let bodyParameters: any[] = []
                if (templateVarCount > 0) {
                    for (let i = 1; i <= templateVarCount; i++) {
                        let val = i === 1 ? (lead?.name || 'Valued Customer') : i === 2 ? propertyTitle : businessName
                        val = val.replace(/[\u3164\u200B-\u200D\uFEFF]/g, '').trim() || 'Valued Customer'
                        bodyParameters.push({ type: 'text', text: val })
                    }
                }

                const components: any[] = []
                if (headerFormat && resolvedHeaderUrl) {
                    if (headerFormat === 'IMAGE') {
                        components.push({ type: 'header', parameters: [{ type: 'image', image: { link: resolvedHeaderUrl } }] })
                    } else if (headerFormat === 'VIDEO') {
                        components.push({ type: 'header', parameters: [{ type: 'video', video: { link: resolvedHeaderUrl } }] })
                    } else if (headerFormat === 'DOCUMENT') {
                        components.push({ type: 'header', parameters: [{ type: 'document', document: { link: resolvedHeaderUrl } }] })
                    }
                }

                if (templateVarCount > 0 && bodyParameters.length > 0) {
                    components.push({ type: 'body', parameters: bodyParameters })
                }

                const messagePayload: any = {
                    messaging_product: 'whatsapp',
                    to: cleanPhone,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: templateLanguageCode },
                        ...(components.length > 0 ? { components } : {})
                    }
                }

                try {
                    const metaRes = await fetch(metaUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(messagePayload)
                    })

                    const metaData = await metaRes.json()

                    if (metaData.error) {
                        const errCode = metaData.error.code
                        const errMsg = metaData.error.message || ''
                        const friendly = explainMetaError(errCode, errMsg)

                        if (isFatalError(errCode, errMsg)) {
                            // NOT just this recipient: Meta is refusing the account, so every remaining
                            // send fails the same way. Pause the campaign, mark what is left blocked
                            // with the reason, and stop all workers (they share this flag).
                            console.error(`[BROADCAST WORKER] ⚠️ Fatal Meta error ${errCode}: ${errMsg}. Pausing and blocking the remainder.`)
                            circuitBreakerTripped = true
                            breakerReason = friendly
                            await supabaseAdmin
                                .from('whatsapp_broadcast_recipients')
                                .update({ status: 'failed', error_message: friendly, error_code: String(errCode ?? ''), attempts: (r.attempts || 0) + 1, updated_at: new Date().toISOString() })
                                .eq('id', r.id)
                            failedCount++
                            break
                        }

                        if (isRetryableError(errCode, errMsg)) {
                            const attempts = (r.attempts || 0) + 1
                            if (attempts < MAX_SEND_ATTEMPTS) {
                                // Backoff: 30s, then 2min. It goes back to pending, not failed.
                                const delayMs = attempts === 1 ? 30_000 : 120_000
                                retriedCount++
                                await supabaseAdmin
                                    .from('whatsapp_broadcast_recipients')
                                    .update({
                                        status: 'pending',
                                        attempts,
                                        error_message: friendly,
                                        error_code: String(errCode ?? ''),
                                        next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
                                        updated_at: new Date().toISOString(),
                                    })
                                    .eq('id', r.id)
                                continue
                            }
                        }

                        failedCount++
                        await supabaseAdmin
                            .from('whatsapp_broadcast_recipients')
                            .update({
                                status: 'failed',
                                error_message: friendly,
                                error_code: String(errCode ?? ''),
                                attempts: (r.attempts || 0) + 1,
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', r.id)
                    } else {
                        sentCount++
                        const nowIso = new Date().toISOString()
                        await supabaseAdmin
                            .from('whatsapp_broadcast_recipients')
                            .update({ status: 'sent', sent_at: nowIso, error_message: null, error_code: null, attempts: (r.attempts || 0) + 1, updated_at: nowIso })
                            .eq('id', r.id)

                        // Update CRM inbox
                        try {
                            const recipientName = lead?.name || 'Prospect'
                            const summaryText = `Sent Template: ${templateName}`

                            let { data: chat } = await supabaseAdmin
                                .from('whatsapp_chats')
                                .select('id')
                                .eq('user_id', broadcast.user_id)
                                .eq('recipient_phone', cleanPhone)
                                .maybeSingle()

                            if (!chat) {
                                const { data: newChat } = await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .insert({
                                        user_id: broadcast.user_id,
                                        recipient_phone: cleanPhone,
                                        recipient_name: recipientName,
                                        lead_id: lead?.id || null,
                                        last_message_text: summaryText,
                                        unread_count: 0,
                                        flow_answers: {},
                                        flow_completed: false,
                                        updated_at: nowIso
                                    })
                                    .select('id')
                                    .maybeSingle()
                                chat = newChat
                            } else {
                                await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .update({
                                        last_message_text: summaryText,
                                        recipient_name: recipientName,
                                        updated_at: nowIso
                                    })
                                    .eq('id', chat.id)
                            }

                            if (chat) {
                                await supabaseAdmin
                                    .from('whatsapp_messages')
                                    .insert({
                                        chat_id: chat.id,
                                        direction: 'outbound',
                                        message_text: summaryText,
                                        media_url: resolvedHeaderUrl || null,
                                        media_type: headerFormat === 'IMAGE' ? 'image' : headerFormat === 'VIDEO' ? 'video' : null,
                                        created_at: nowIso
                                    })
                            }
                        } catch (crmErr) {
                            // ignore CRM chat log failure
                        }
                    }
                } catch (sendErr: any) {
                    // A network/provider failure is worth another go; the row goes back to pending
                    // with a backoff instead of being written off.
                    const attempts = (r.attempts || 0) + 1
                    if (attempts < MAX_SEND_ATTEMPTS) {
                        retriedCount++
                        await supabaseAdmin
                            .from('whatsapp_broadcast_recipients')
                            .update({
                                status: 'pending',
                                attempts,
                                error_message: String(sendErr?.message || sendErr),
                                next_attempt_at: new Date(Date.now() + (attempts === 1 ? 30_000 : 120_000)).toISOString(),
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', r.id)
                        continue
                    }
                    failedCount++
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ status: 'failed', error_message: String(sendErr?.message || sendErr), attempts, updated_at: new Date().toISOString() })
                        .eq('id', r.id)
                }

                await new Promise(res => setTimeout(res, 80))
            }
        }

        const workers = Array.from({ length: Math.min(CONCURRENCY, pendingRecipients.length) }, () => worker())
        await Promise.all(workers)

        // A campaign stopped by Meta is paused with the REASON ON THE CAMPAIGN and its untouched rows
        // marked blocked — not left pending, which reads as "still working" for ever.
        if (circuitBreakerTripped && breakerReason) {
            const paused = await pauseBroadcast(supabaseAdmin, broadcastId, { reason: breakerReason, blockRemaining: true })
            return NextResponse.json({
                success: false,
                broadcastId,
                paused: true,
                pauseReason: breakerReason,
                processed: pendingRecipients.length,
                sent: sentCount,
                failed: failedCount,
                retried: retriedCount,
                blocked: paused.blocked,
                message: `Campaign paused. ${breakerReason}`,
            })
        }

        const counts = await refreshBroadcastStats(supabaseAdmin, broadcastId)

        if (counts.pending === 0 && counts.processing === 0) {
            await supabaseAdmin
                .from('whatsapp_broadcasts')
                .update({ status: finalStatusFor(counts), sent_at: new Date().toISOString() })
                .eq('id', broadcastId)
        }

        return NextResponse.json({
            success: true,
            broadcastId,
            processed: pendingRecipients.length,
            sent: sentCount,
            failed: failedCount,
            retried: retriedCount,
            remainingPending: counts.pending + counts.processing,
            totals: counts,
        })

    } catch (err: any) {
        console.error('[BROADCAST WORKER] Uncaught error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
