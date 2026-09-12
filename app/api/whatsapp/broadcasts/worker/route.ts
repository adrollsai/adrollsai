import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

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

        // Authorization check: User session OR Cron Secret / QStash
        const authHeader = req.headers.get('authorization')
        const upstashAuth = req.headers.get('upstash-forward-authorization')
        const isCronAuthorized = 
            !process.env.CRON_SECRET ||
            authHeader === `Bearer ${process.env.CRON_SECRET}` ||
            upstashAuth === `Bearer ${process.env.CRON_SECRET}`

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

        // Fetch profile credentials
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, business_name, avatar_url')
            .eq('id', broadcast.user_id)
            .single()

        if (!profile?.whatsapp_access_token || !profile?.whatsapp_phone_number_id) {
            return NextResponse.json({ error: 'WhatsApp credentials not configured for broadcast owner' }, { status: 400 })
        }

        // Fetch pending recipients (up to 400 per run to stay well within timeout)
        const BATCH_LIMIT = 400
        const { data: pendingRecipients, error: rErr } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('*')
            .eq('broadcast_id', broadcastId)
            .eq('status', 'pending')
            .limit(BATCH_LIMIT)

        if (rErr) {
            return NextResponse.json({ error: rErr.message }, { status: 500 })
        }

        if (!pendingRecipients || pendingRecipients.length === 0) {
            // Check if any recipients are still pending in total
            const { count: totalRemainingPending } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .select('id', { count: 'exact', head: true })
                .eq('broadcast_id', broadcastId)
                .eq('status', 'pending')

            if (!totalRemainingPending || totalRemainingPending === 0) {
                await supabaseAdmin
                    .from('whatsapp_broadcasts')
                    .update({ status: 'sent', sent_at: new Date().toISOString() })
                    .eq('id', broadcastId)
            }

            return NextResponse.json({
                success: true,
                message: 'No pending recipients remaining for this broadcast.',
                remainingPending: 0
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
            }
        }

        let sentCount = 0
        let failedCount = 0
        const CONCURRENCY = 8
        let currIdx = 0

        async function worker() {
            while (currIdx < pendingRecipients.length) {
                const index = currIdx++
                const r = pendingRecipients[index]
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
                        failedCount++
                        await supabaseAdmin
                            .from('whatsapp_broadcast_recipients')
                            .update({ status: 'failed', error_message: metaData.error.message || 'Meta error' })
                            .eq('id', r.id)
                    } else {
                        sentCount++
                        const nowIso = new Date().toISOString()
                        await supabaseAdmin
                            .from('whatsapp_broadcast_recipients')
                            .update({ status: 'sent', sent_at: nowIso, error_message: null })
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
                    failedCount++
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ status: 'failed', error_message: sendErr.message })
                        .eq('id', r.id)
                }

                await new Promise(res => setTimeout(res, 40))
            }
        }

        const workers = Array.from({ length: Math.min(CONCURRENCY, pendingRecipients.length) }, () => worker())
        await Promise.all(workers)

        // Check remaining pending recipients
        const { count: remainingPending } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('id', { count: 'exact', head: true })
            .eq('broadcast_id', broadcastId)
            .eq('status', 'pending')

        if (!remainingPending || remainingPending === 0) {
            await supabaseAdmin
                .from('whatsapp_broadcasts')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', broadcastId)
        }

        return NextResponse.json({
            success: true,
            broadcastId,
            processed: pendingRecipients.length,
            sent: sentCount,
            failed: failedCount,
            remainingPending: remainingPending || 0
        })

    } catch (err: any) {
        console.error('[BROADCAST WORKER] Uncaught error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
