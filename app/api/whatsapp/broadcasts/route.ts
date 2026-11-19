import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Max 5 minutes for processing broadcasts

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { searchParams } = new URL(req.url)
        const impersonateId = searchParams.get('impersonate')
        const broadcastId = searchParams.get('broadcastId')
        const targetUserId = impersonateId || user.id

        // If specific broadcastId stats requested
        if (broadcastId) {
            const { data: broadcast } = await supabase
                .from('whatsapp_broadcasts')
                .select('*')
                .eq('id', broadcastId)
                .single()

            if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })

            // ── EXACT COUNTS + A PAGED RECIPIENT LIST
            //
            // This branch used to load EVERY recipient with `.select('*')` and count them in JS. A
            // PostgREST `.select()` stops at the database's max-rows (1,000 here), so a campaign with
            // 16,317 recipients reported "1,000 recipients, 122 sent" — the number the owner saw and
            // quite reasonably did not believe. Counts are exact head-counts now, and the list is
            // paged on purpose.
            const { exactCounts } = await import('@/lib/whatsapp/broadcast-progress')
            const counts = await exactCounts(supabaseAdmin, broadcastId)
            const wantsCsv = searchParams.get('export') === 'csv' || searchParams.get('format') === 'csv'
            const requestedLimit = Number(searchParams.get('limit') ?? 200) || 200
            const pageLimit = wantsCsv ? counts.total : Math.min(Math.max(requestedLimit, 1), 500)
            const pageOffset = wantsCsv ? 0 : Math.max(Number(searchParams.get('offset') ?? 0) || 0, 0)

            let recipients: any[] = []
            const need = Math.min(pageLimit, Math.max(counts.total - pageOffset, 0))
            for (let from = pageOffset; from < pageOffset + need; from += 1000) {
                const to = Math.min(from + 999, pageOffset + need - 1)
                const { data } = await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .select('*')
                    .eq('broadcast_id', broadcastId)
                    .order('id', { ascending: true })
                    .range(from, to)
                recipients.push(...(data ?? []))
            }

            // A campaign that predates recipient tracking has no rows to show. Say that, rather than
            // inventing "sent" rows for people we have no record of messaging.
            const legacy = counts.total === 0

            const total = counts.total
            const sent = counts.sent
            const failed = counts.failed
            const pending = counts.pending + counts.processing

            const recipientPhones = (recipients || []).map(r => r.phone_number.replace(/\D/g, '')).filter(Boolean)
            
            // Batch fetch whatsapp_chats in chunks of 100
            let chats: any[] = []
            for (let i = 0; i < recipientPhones.length; i += 100) {
                const batch = recipientPhones.slice(i, i + 100)
                const { data: bChats } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .select('id, recipient_phone, recipient_name, updated_at, last_message_text')
                    .eq('user_id', targetUserId)
                    .in('recipient_phone', batch)
                if (bChats) chats = chats.concat(bChats)
            }

            const chatMap = new Map((chats || []).map(c => [c.recipient_phone, c]))
            const chatIds = (chats || []).map(c => c.id).filter(Boolean)

            // Batch fetch inbound messages for these chat IDs created after broadcast start time
            let inboundMsgs: any[] = []
            const broadcastStartTime = broadcast.sent_at || broadcast.created_at
            for (let i = 0; i < chatIds.length; i += 100) {
                const batch = chatIds.slice(i, i + 100)
                let msgQuery = supabaseAdmin
                    .from('whatsapp_messages')
                    .select('chat_id, message_text, created_at')
                    .in('chat_id', batch)
                    .eq('direction', 'inbound')
                    .order('created_at', { ascending: false })
                
                if (broadcastStartTime) {
                    msgQuery = msgQuery.gte('created_at', broadcastStartTime)
                }

                const { data: bMsgs } = await msgQuery
                if (bMsgs) inboundMsgs = inboundMsgs.concat(bMsgs)
            }

            // Map latest inbound message by chat_id
            const latestInboundMap = new Map()
            for (const msg of inboundMsgs) {
                if (!latestInboundMap.has(msg.chat_id)) {
                    latestInboundMap.set(msg.chat_id, msg)
                }
            }

            // Batch fetch leads in chunks of 100
            const leadIds = (recipients || []).map(r => r.lead_id).filter(Boolean)
            let leadsMap = new Map()
            for (let i = 0; i < leadIds.length; i += 100) {
                const batch = leadIds.slice(i, i + 100)
                const { data: bLeads } = await supabaseAdmin
                    .from('leads')
                    .select('id, name, phone')
                    .in('id', batch)
                if (bLeads) {
                    for (const l of bLeads) {
                        leadsMap.set(l.id, l)
                    }
                }
            }

            let replyCount = 0
            let buttonClickCount = 0

            const recipientDetails = (recipients || []).map(r => {
                const cleanPhone = r.phone_number.replace(/\D/g, '')
                const lead = leadsMap.get(r.lead_id)
                const chat = chatMap.get(cleanPhone) || chatMap.get('91' + cleanPhone)

                const name = lead?.name || chat?.recipient_name || 'Valued Lead'
                const latestInbound = chat ? latestInboundMap.get(chat.id) : null
                const hasReplied = !!latestInbound
                if (hasReplied) replyCount++

                const leadResponseText = latestInbound?.message_text || null
                const isButtonClick = r.status === 'clicked' || Boolean(hasReplied && (
                    leadResponseText?.toLowerCase().includes('interested') ||
                    leadResponseText?.toLowerCase().includes('button') ||
                    leadResponseText === 'View Properties'
                ))
                if (isButtonClick) buttonClickCount++

                return {
                    id: r.id,
                    phone: r.phone_number,
                    name,
                    status: r.status,
                    sent_at: r.sent_at,
                    error_message: r.error_message,
                    has_replied: hasReplied,
                    is_button_click: isButtonClick,
                    last_message: leadResponseText
                }
            })

            const deliveryRate = total > 0 ? ((sent / total) * 100).toFixed(1) : '0'
            const responseRate = sent > 0 ? ((replyCount / sent) * 100).toFixed(1) : '0'
            const clickRate = total > 0 ? ((buttonClickCount / total) * 100).toFixed(1) : '0'

            // Support direct 1-click CSV download of broadcast leads / clickers
            if (searchParams.get('export') === 'csv' || searchParams.get('format') === 'csv') {
                const onlyClicked = searchParams.get('filter') === 'clicked'
                const recordsToExport = onlyClicked ? recipientDetails.filter(r => r.is_button_click) : recipientDetails
                const csvRows = [
                    ['Lead Name', 'Phone Number', 'Campaign', 'Template', 'Status', 'Clicked Interested', 'Sent At'].join(',')
                ]
                recordsToExport.forEach(r => {
                    csvRows.push([
                        `"${(r.name || '').replace(/"/g, '""')}"`,
                        `"${r.phone}"`,
                        `"${(broadcast.title || '').replace(/"/g, '""')}"`,
                        `"${(broadcast.template_name || '').replace(/"/g, '""')}"`,
                        `"${r.status}"`,
                        `"${r.is_button_click ? 'Yes (Clicked Interested!)' : 'No'}"`,
                        `"${r.sent_at || ''}"`
                    ].join(','))
                })

                const csvContent = csvRows.join('\n')
                const fileName = `${(broadcast.title || 'campaign').replace(/[^a-zA-Z0-9_-]/g, '_')}_${onlyClicked ? 'clicked_leads' : 'all_recipients'}.csv`
                return new Response(csvContent, {
                    headers: {
                        'Content-Type': 'text/csv; charset=utf-8',
                        'Content-Disposition': `attachment; filename="${fileName}"`
                    }
                })
            }

            return NextResponse.json({
                success: true,
                broadcast: {
                    ...broadcast,
                    // The stored counters are authoritative for the list; these are live-exact.
                    total_recipients: total,
                    sent_count: sent,
                    failed_count: failed,
                    pending_count: pending,
                    blocked_count: counts.blocked,
                    pause_reason: broadcast.pause_reason ?? null,
                },
                legacy,
                stats: {
                    total,
                    sent,
                    failed,
                    pending,
                    blocked: counts.blocked,
                    completed: counts.done,
                    percentComplete: counts.percentComplete,
                    replyCount,
                    buttonClickCount,
                    deliveryRate,
                    responseRate,
                    clickRate,
                },
                page: {
                    offset: pageOffset,
                    limit: pageLimit,
                    returned: recipientDetails.length,
                    total,
                    hasMore: pageOffset + recipientDetails.length < total,
                },
                recipients: recipientDetails
            })
        }

        // Fetch broadcasts
        const { data: broadcasts, error: bErr } = await supabase
            .from('whatsapp_broadcasts')
            .select('*')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false })

        if (bErr) {
            console.error('[BROADCAST API] Error fetching broadcasts:', bErr)
            return NextResponse.json({ error: bErr.message }, { status: 500 })
        }

        // ── PER-CAMPAIGN PROGRESS, WITHOUT SCANNING RECIPIENTS
        //
        // This used to pull every recipient row for every listed campaign in one query and count them
        // in JS. `.in('broadcast_id', …)` is still capped at the database's max-rows (1,000), so a
        // tenant with 16,317 recipients in flight had its counts computed from a truncated sample —
        // the "1,000 recipients" the owner saw. The counters written by the worker (and backfilled by
        // migration 20261120030000) are exact and cost one row per campaign.
        const broadcastIds = (broadcasts || []).map(b => b.id).filter(Boolean)
        let recipientsMap = new Map<string, { total: number; sent: number; failed: number; pending: number; blocked: number; clicked: number }>()

        const missingCounters = (broadcasts || []).filter(b => b.total_recipients === null || b.total_recipients === undefined)
        if (missingCounters.length > 0 && broadcastIds.length > 0) {
            // Legacy rows written before the counters existed: fall back to a head-count per campaign,
            // which is exact even though it costs a query each.
            for (const b of missingCounters) {
                const { count } = await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .select('id', { count: 'exact', head: true })
                    .eq('broadcast_id', b.id)
                recipientsMap.set(b.id, { total: count ?? 0, sent: b.sent_count ?? 0, failed: b.failed_count ?? 0, pending: b.pending_count ?? 0, blocked: b.blocked_count ?? 0, clicked: 0 })
            }
        }

        // Clicked counts still come from one small aggregate query (a click is a rare status).
        if (broadcastIds.length > 0) {
            const { data: clickedRows } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .select('broadcast_id')
                .in('broadcast_id', broadcastIds)
                .eq('status', 'clicked')
            for (const row of clickedRows ?? []) {
                const st = recipientsMap.get(row.broadcast_id) || { total: 0, sent: 0, failed: 0, pending: 0, blocked: 0, clicked: 0 }
                st.clicked += 1
                recipientsMap.set(row.broadcast_id, st)
            }
        }

        const resolvedBroadcasts = (broadcasts || []).map(b => {
            const stored = recipientsMap.get(b.id)
            const st = {
                total: b.total_recipients ?? stored?.total ?? 0,
                sent: b.sent_count ?? stored?.sent ?? 0,
                failed: b.failed_count ?? stored?.failed ?? 0,
                pending: b.pending_count ?? stored?.pending ?? 0,
                blocked: b.blocked_count ?? stored?.blocked ?? 0,
                clicked: stored?.clicked ?? 0,
            }
            const ctr = st.total > 0 ? ((st.clicked / st.total) * 100).toFixed(1) : '0'
            const done = st.sent + st.failed + st.blocked
            return {
                ...b,
                stats: {
                    ...st,
                    clickRate: ctr,
                    completed: done,
                    percentComplete: st.total > 0 ? Math.round((done / st.total) * 100) : 0,
                },
            }
        })

        return NextResponse.json({ success: true, broadcasts: resolvedBroadcasts })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json()
        const { title, templateName, headerMediaUrl, mediaUrl, recipientStage, recipientPropertyId, recipientCsvAudience, scheduledAt, impersonateId, variableMappings, audienceFilter, flowId, flowTitle, limit, maxRecipients } = body
        const targetUserId = impersonateId || user.id
        const effectiveHeaderMediaUrl = headerMediaUrl || mediaUrl || null

        if (!title || !templateName) {
            return NextResponse.json({ error: 'Missing required broadcast parameters (title, templateName)' }, { status: 400 })
        }

        const effectiveTitle = flowId
            ? `[Flow: ${flowTitle || 'Campaign'}] ${title} [flow:${flowId}]`
            : title

        // Fetch credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, business_name, avatar_url')
            .eq('id', targetUserId)
            .single()

        if (!profile || !profile.whatsapp_access_token || !profile.whatsapp_phone_number_id) {
            return NextResponse.json({ 
                error: 'WhatsApp credentials not connected for the target profile.' 
            }, { status: 400 })
        }

        /**
         * PRE-FLIGHT: is this account actually able to deliver right now?
         *
         * A Blue Square Infra campaign created 16,317 recipients, delivered 122 and then had every
         * remaining send refused with 131042 (payment/eligibility). The blocking condition was already
         * knowable from Meta before the campaign was created — this reads it and refuses, so a doomed
         * campaign is never built. `force` is available for a false positive, and every warning is
         * returned either way so the screen can show it.
         */
        const { whatsAppHealth } = await import('@/lib/whatsapp/health')
        const health = await whatsAppHealth(supabaseAdmin, targetUserId)
        const force = Boolean(body.force)
        if (!health.ok && !force) {
            return NextResponse.json(
                {
                    error:
                        'This campaign was not started: ' +
                        health.blockers.join(' ') +
                        ' Nothing has been queued. Fix that, then launch again.',
                    blockers: health.blockers,
                    warnings: health.warnings,
                    health,
                },
                { status: 409 }
            )
        }
        if (!health.ok && force) {
            console.warn('[BROADCAST API] launching despite health blockers (force=true):', health.blockers)
        }

        // Create the broadcast record with fallback
        let broadcast: any = null
        const { data: bData, error: cErr } = await supabase
            .from('whatsapp_broadcasts')
            .insert({
                user_id: targetUserId,
                title: effectiveTitle,
                template_name: templateName,
                recipient_stage: recipientStage || 'All',
                recipient_property_id: recipientPropertyId || null,
                recipient_csv_audience: recipientCsvAudience || null,
                scheduled_at: scheduledAt || null,
                status: scheduledAt ? 'pending' : 'processing',
                created_at: new Date().toISOString()
            })
            .select()
            .single()

        if (cErr) {
            const { data: bDataFallback, error: cErrFallback } = await supabase
                .from('whatsapp_broadcasts')
                .insert({
                    user_id: targetUserId,
                    title: effectiveTitle,
                    template_name: templateName,
                    recipient_stage: recipientStage || 'All',
                    recipient_property_id: recipientPropertyId || null,
                    scheduled_at: scheduledAt || null,
                    status: scheduledAt ? 'pending' : 'processing',
                    created_at: new Date().toISOString()
                })
                .select()
                .single()

            if (cErrFallback) {
                console.error('[BROADCAST API] Error creating broadcast:', cErrFallback)
                return NextResponse.json({ error: cErrFallback.message }, { status: 500 })
            }
            broadcast = bDataFallback
        } else {
            broadcast = bData
        }

        // Link broadcast to automation flow if triggered from Flow Builder
        if (flowId) {
            try {
                const { data: currentAuto } = await supabaseAdmin
                    .from('automations')
                    .select('description')
                    .eq('id', flowId)
                    .maybeSingle()
                if (currentAuto) {
                    const desc = typeof currentAuto.description === 'string'
                        ? JSON.parse(currentAuto.description || '{}')
                        : (currentAuto.description || {})
                    desc.lastBroadcastId = broadcast.id
                    desc.lastBroadcastAt = new Date().toISOString()
                    desc.lastBroadcastAudience = audienceFilter?.audienceGroupName || recipientCsvAudience || 'Target Audience'
                    desc.lastBroadcastRecipients = 0
                    await supabaseAdmin
                        .from('automations')
                        .update({ description: JSON.stringify(desc) })
                        .eq('id', flowId)
                    console.log(`[BROADCAST API] 🔗 Linked broadcast ${broadcast.id} to flow ${flowId}`)
                }
            } catch (autoErr) {
                console.warn('[BROADCAST API] Warning: could not update automation with broadcast metadata:', autoErr)
            }
        }

        // Fetch and filter matching leads with zero discrepancies (paginating through all user leads)
        const { count: totalLeadsCount } = await supabaseAdmin
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', targetUserId)

        const totalUserLeads = totalLeadsCount || 0
        const pageSize = 1000
        const numPages = Math.min(Math.ceil(totalUserLeads / pageSize), 30) // up to 30,000 leads
        const fetchPromises = []

        for (let p = 0; p < numPages; p++) {
            fetchPromises.push(
                supabaseAdmin
                    .from('leads')
                    .select('id, name, phone, source, ad_name, csv_audience, pipeline_stage, property_id, custom_fields, created_at, whatsapp_enabled')
                    .eq('user_id', targetUserId)
                    .range(p * pageSize, (p + 1) * pageSize - 1)
            )
        }

        const fetchResults = await Promise.all(fetchPromises)
        let allUserLeads: any[] = []
        for (const r of fetchResults) {
            if (r.data) allUserLeads = allUserLeads.concat(r.data)
        }

        // Filter leads based on broadcast criteria
        const leads = allUserLeads.filter(lead => {
            if (lead.whatsapp_enabled === false) return false;

            if (audienceFilter) {
                // Pre-built Audience Group target
                if (audienceFilter.targetType === 'audience_group') {
                    const groupName = audienceFilter.audienceGroupName || ''
                    if (!groupName) return false
                    const csvList = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                    let cf = lead.custom_fields
                    if (typeof cf === 'string') {
                        try { cf = JSON.parse(cf) } catch (e) { cf = {} }
                    }
                    const groups = Array.isArray(cf?.audience_groups) ? cf.audience_groups : (cf?.audience_groups ? [cf.audience_groups] : [])
                    return csvList.includes(groupName) || groups.includes(groupName)
                }

                // Custom multi-filter target
                if (audienceFilter.targetType === 'custom') {
                    const { csvAudiences, sources, metaCampaigns, pipelineStages, propertyIds } = audienceFilter

                    if (csvAudiences && Array.isArray(csvAudiences) && csvAudiences.length > 0) {
                        const csvList = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                        const matchesCsv = csvAudiences.some((aud: string) => csvList.includes(aud))
                        if (!matchesCsv) return false
                    }

                    if (sources && Array.isArray(sources) && sources.length > 0) {
                        if (!lead.source || !sources.includes(lead.source)) return false
                    }

                    if (pipelineStages && Array.isArray(pipelineStages) && pipelineStages.length > 0) {
                        if (!lead.pipeline_stage || !pipelineStages.includes(lead.pipeline_stage)) return false
                    }

                    if (propertyIds && Array.isArray(propertyIds) && propertyIds.length > 0) {
                        if (!lead.property_id || !propertyIds.includes(lead.property_id)) return false
                    }

                    if (metaCampaigns && Array.isArray(metaCampaigns) && metaCampaigns.length > 0) {
                        let camp = lead.ad_name ? lead.ad_name.trim() : null
                        if (!camp && lead.custom_fields) {
                            let cf = lead.custom_fields
                            if (typeof cf === 'string') {
                                try { cf = JSON.parse(cf) } catch (e) { cf = null }
                            }
                            camp = cf?.lead_source_details?.trim() || cf?.meta_ad_origin?.campaign_name?.trim() || null
                        }
                        if (!camp || !metaCampaigns.includes(camp)) return false
                    }

                    return true
                }
            }

            // Fallback to basic legacy filters
            if (recipientStage && recipientStage !== 'All') {
                if (lead.pipeline_stage !== recipientStage) return false
            }

            if (recipientPropertyId) {
                if (lead.property_id !== recipientPropertyId) return false
            }

            if (recipientCsvAudience) {
                const csvList = (lead.csv_audience || '').split(',').map((s: string) => s.trim())
                if (!csvList.includes(recipientCsvAudience)) return false
            }

            return true
        })



        let selectedLeads = leads
        const maxLimit = limit || maxRecipients
        if (maxLimit) {
            const parsedLimit = parseInt(maxLimit)
            if (!isNaN(parsedLimit) && parsedLimit > 0) {
                selectedLeads = selectedLeads.slice(0, parsedLimit)
            }
        }

        if (!selectedLeads || selectedLeads.length === 0) {
            // No matching leads, mark sent/empty
            await supabase
                .from('whatsapp_broadcasts')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', broadcast.id)

            return NextResponse.json({ 
                success: true, 
                broadcast, 
                recipientsCount: 0,
                message: 'Broadcast created but no matching leads found.'
            })
        }

        // Insert pending recipient records
        const recipientPayloads = selectedLeads.map(l => ({
            broadcast_id: broadcast.id,
            lead_id: l.id,
            user_id: targetUserId,
            phone_number: l.phone || l.custom_fields?.whatsapp_number || l.custom_fields?.phone_number || '',
            status: 'pending'
        })).filter(r => !!r.phone_number)

        if (recipientPayloads.length === 0) {
            await supabase
                .from('whatsapp_broadcasts')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', broadcast.id)

            return NextResponse.json({ 
                success: true, 
                broadcast, 
                recipientsCount: 0,
                message: 'Broadcast created but leads lacked valid phone numbers.'
            })
        }

        const { error: insErr } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .insert(recipientPayloads)

        if (insErr) {
            console.error('[BROADCAST API] Error creating recipients:', insErr)
            return NextResponse.json({ error: insErr.message }, { status: 500 })
        }

        // If scheduled in the future, we stop here and let the scheduler handle it later
        if (scheduledAt) {
            return NextResponse.json({ 
                success: true, 
                broadcast, 
                recipientsCount: recipientPayloads.length,
                message: 'Broadcast scheduled successfully for ' + scheduledAt
            })
        }

        // ── HAND THE CAMPAIGN TO THE WORKER, DO NOT SEND FROM THIS REQUEST
        //
        // This used to run `executeBroadcastImmediately(...)` inline: one request with a 300-second
        // budget trying to send thousands of template messages. When it ran out of time the campaign
        // sat half-sent until the 10-minute cron picked it up, and a crash mid-flight left rows in
        // limbo. The worker (which claims rows, retries with backoff, and trips a real circuit
        // breaker) is the only sender now, and it is kicked immediately so the campaign starts now
        // rather than at the next tick.
        await supabaseAdmin
            .from('whatsapp_broadcasts')
            .update({
                status: 'processing',
                total_recipients: recipientPayloads.length,
                pending_count: recipientPayloads.length,
                sent_count: 0,
                failed_count: 0,
                blocked_count: 0,
                pause_reason: null,
                last_progress_at: new Date().toISOString(),
            })
            .eq('id', broadcast.id)

        const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
        void fetch(`${base}/api/whatsapp/broadcasts/worker`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
            },
            body: JSON.stringify({ broadcastId: broadcast.id }),
        }).catch((kickErr) => console.warn('[BROADCAST API] worker kick failed (the cron will pick it up):', kickErr))

        return NextResponse.json({ 
            success: true, 
            broadcast, 
            recipientsCount: recipientPayloads.length,
            message:
                `Campaign queued for ${recipientPayloads.length} recipient(s). The worker sends them in ` +
                'batches and records each result; open the campaign to watch progress.'
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

// The inline sender that lived here (`executeBroadcastImmediately`) is gone.
//
// It sent template messages from inside the HTTP request: a 300-second budget trying to deliver a
// whole campaign, a 3-way loop that paused the campaign on a Meta refusal while the other two loops
// kept sending, and no retry bookkeeping. When it ran out of time the campaign sat half-sent until a
// cron tick, and a crash left rows in limbo.
//
// app/api/whatsapp/broadcasts/worker is the only sender now: it claims a slice by flipping rows to
// `processing`, retries a recoverable failure with backoff, trips a breaker that pauses the campaign
// AND blocks the untouched rows with Meta's own reason, and leaves exact counters behind.
