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

            let { data: recipients } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .select('*')
                .eq('broadcast_id', broadcastId)

            if ((!recipients || recipients.length === 0) && broadcast.status === 'sent') {
                let leadQuery = supabaseAdmin
                    .from('leads')
                    .select('id, phone')
                    .or(`user_id.eq.${broadcast.user_id},assigned_to.eq.${broadcast.user_id}`)
                    .lte('created_at', broadcast.created_at || new Date().toISOString())
                    .order('created_at', { ascending: true })

                if (broadcast.recipient_stage && broadcast.recipient_stage !== 'All') {
                    leadQuery = leadQuery.eq('pipeline_stage', broadcast.recipient_stage)
                }

                const { data: fallbackLeads } = await leadQuery
                if (fallbackLeads && fallbackLeads.length > 0) {
                    const fallbackPayloads = fallbackLeads.map(l => ({
                        broadcast_id: broadcast.id,
                        lead_id: l.id,
                        user_id: broadcast.user_id,
                        phone_number: l.phone || '',
                        status: 'sent',
                        sent_at: broadcast.sent_at || broadcast.created_at || new Date().toISOString()
                    })).filter(r => !!r.phone_number)

                    for (let i = 0; i < fallbackPayloads.length; i += 100) {
                        const batch = fallbackPayloads.slice(i, i + 100)
                        await supabaseAdmin.from('whatsapp_broadcast_recipients').insert(batch)
                    }

                    const { data: refetched } = await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .select('*')
                        .eq('broadcast_id', broadcastId)
                    if (refetched) recipients = refetched
                }
            }

            const total = recipients?.length || 0
            const sent = recipients?.filter(r => r.status === 'sent').length || 0
            const failed = recipients?.filter(r => r.status === 'failed').length || 0
            const pending = recipients?.filter(r => r.status === 'pending').length || 0

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
                const isButtonClick = hasReplied && (leadResponseText === 'View Properties' || leadResponseText?.includes('Button'))
                if (isButtonClick) buttonClickCount++

                return {
                    id: r.id,
                    phone: r.phone_number,
                    name,
                    status: r.status,
                    sent_at: r.sent_at,
                    error_message: r.error_message,
                    has_replied: hasReplied,
                    last_message: leadResponseText
                }
            })

            const deliveryRate = total > 0 ? ((sent / total) * 100).toFixed(1) : '0'
            const responseRate = sent > 0 ? ((replyCount / sent) * 100).toFixed(1) : '0'

            return NextResponse.json({
                success: true,
                broadcast,
                stats: {
                    total,
                    sent,
                    failed,
                    pending,
                    replyCount,
                    buttonClickCount,
                    deliveryRate,
                    responseRate
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

        // Batch fetch status stats for all broadcasts in a single indexed query (prevents N+1 DB connection floods)
        const broadcastIds = (broadcasts || []).map(b => b.id).filter(Boolean)
        let recipientsMap = new Map<string, { total: number; sent: number; failed: number }>()

        if (broadcastIds.length > 0) {
            const { data: allRecipients } = await supabaseAdmin
                .from('whatsapp_broadcast_recipients')
                .select('broadcast_id, status')
                .in('broadcast_id', broadcastIds)

            if (allRecipients) {
                allRecipients.forEach(r => {
                    let st = recipientsMap.get(r.broadcast_id) || { total: 0, sent: 0, failed: 0 }
                    st.total++
                    if (r.status === 'sent') st.sent++
                    if (r.status === 'failed') st.failed++
                    recipientsMap.set(r.broadcast_id, st)
                })
            }
        }

        const resolvedBroadcasts = (broadcasts || []).map(b => ({
            ...b,
            stats: recipientsMap.get(b.id) || { total: 0, sent: 0, failed: 0 }
        }))

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
        const { title, templateName, headerMediaUrl, mediaUrl, recipientStage, recipientPropertyId, recipientCsvAudience, scheduledAt, impersonateId, variableMappings, audienceFilter } = body
        const targetUserId = impersonateId || user.id
        const effectiveHeaderMediaUrl = headerMediaUrl || mediaUrl || null

        if (!title || !templateName) {
            return NextResponse.json({ error: 'Missing required broadcast parameters (title, templateName)' }, { status: 400 })
        }

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

        // Create the broadcast record with fallback
        let broadcast: any = null
        const { data: bData, error: cErr } = await supabase
            .from('whatsapp_broadcasts')
            .insert({
                user_id: targetUserId,
                title,
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
                    title,
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
                    .select('id, name, phone, source, ad_name, csv_audience, pipeline_stage, property_id, custom_fields, created_at')
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



        if (!leads || leads.length === 0) {
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
        const recipientPayloads = leads.map(l => ({
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

        // Otherwise execute immediately in background (don't block the HTTP response)
        executeBroadcastImmediately(broadcast.id, targetUserId, profile, templateName, leads, recipientPayloads, variableMappings, effectiveHeaderMediaUrl).catch(console.error)

        return NextResponse.json({ 
            success: true, 
            broadcast, 
            recipientsCount: recipientPayloads.length,
            message: 'Broadcast started successfully and is executing in the background.'
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

// Background async delivery execution function
async function executeBroadcastImmediately(
    broadcastId: string, 
    userId: string, 
    profile: any, 
    templateName: string, 
    leads: any[], 
    recipients: any[],
    variableMappings?: Record<string, string>,
    headerMediaUrl?: string | null
) {
    console.log(`[BROADCAST EXECUTION] Starting Broadcast ID ${broadcastId} for ${recipients.length} recipients...`)
    
    // Fetch user properties context for template variables
    const { data: properties } = await supabaseAdmin
        .from('properties')
        .select('id, title')
        .eq('user_id', userId)

    const accessToken = profile.whatsapp_access_token
    const phoneId = profile.whatsapp_phone_number_id
    const businessName = profile.business_name || 'Adrolls Partner'
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`

    // Fetch template details to get exact language, header format, and parameter count
    let templateLanguageCode = 'en_US'
    let templateVarCount = 0
    let headerFormat: string | null = null

    try {
        const wabaId = profile.whatsapp_waba_id || profile.whatsapp_business_account_id || process.env.DEV_WHATSAPP_WABA_ID
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
        console.error('[BROADCAST EXECUTION] Error fetching template info from Meta:', tplErr)
    }

    // Resolve header media URL if template requires a media header
    let resolvedHeaderUrl = headerMediaUrl || null
    if (headerFormat && !resolvedHeaderUrl) {
        try {
            const { data: flow } = await supabaseAdmin
                .from('whatsapp_flows')
                .select('header_media_url')
                .eq('user_id', userId)
                .eq('template_name', templateName)
                .maybeSingle()
            if (flow?.header_media_url) resolvedHeaderUrl = flow.header_media_url
        } catch (flowErr) {
            console.warn('[BROADCAST EXECUTION] Could not query flow for header media:', flowErr)
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

    const CONCURRENCY = 8
    let currIdx = 0

    async function dispatchWorker() {
        while (currIdx < recipients.length) {
            const index = currIdx++
            const r = recipients[index]
            const lead = leads.find(l => l.id === r.lead_id)
            if (!lead) continue

            let cleanPhone = r.phone_number.replace(/\D/g, '')
            if (!cleanPhone) continue
            if (cleanPhone.length === 10) {
                cleanPhone = '91' + cleanPhone; // Auto-format 10-digit Indian numbers with country code
            }

            // Resolve property title
            const property = (properties || []).find(p => p.id === lead.property_id)
            const propertyTitle = property ? property.title : 'Premium Listings'

            // Map template variables dynamically ONLY if template requires variables
            let bodyParameters: any[] = []
            
            if (templateVarCount > 0) {
                for (let i = 1; i <= templateVarCount; i++) {
                    const k = i.toString()
                    const mappedField = variableMappings?.[k] || (i === 1 ? 'name' : i === 2 ? 'property_title' : 'business_name')
                    
                    let val = ''
                    if (mappedField === 'name') val = lead.name || 'Valued Customer'
                    else if (mappedField === 'phone') val = lead.phone || ''
                    else if (mappedField === 'email') val = lead.email || ''
                    else if (mappedField === 'property_title') val = propertyTitle
                    else if (mappedField === 'business_name') val = businessName
                    else if (mappedField === 'csv_audience') val = lead.csv_audience || ''
                    else if (mappedField === 'pipeline_stage') val = lead.pipeline_stage || ''
                    else val = mappedField || 'Valued Customer'

                    // Strip non-printable unicode whitespace (e.g. U+3164) that triggers Meta Error #132018
                    val = val.replace(/[\u3164\u200B-\u200D\uFEFF]/g, '').trim() || 'Valued Customer'
                    
                    bodyParameters.push({ type: 'text', text: val })
                }
            }

            const components: any[] = []

            // 1. Header Component (IMAGE, VIDEO, DOCUMENT)
            if (headerFormat && resolvedHeaderUrl) {
                if (headerFormat === 'IMAGE') {
                    components.push({
                        type: 'header',
                        parameters: [
                            {
                                type: 'image',
                                image: { link: resolvedHeaderUrl }
                            }
                        ]
                    })
                } else if (headerFormat === 'VIDEO') {
                    components.push({
                        type: 'header',
                        parameters: [
                            {
                                type: 'video',
                                video: { link: resolvedHeaderUrl }
                            }
                        ]
                    })
                } else if (headerFormat === 'DOCUMENT') {
                    components.push({
                        type: 'header',
                        parameters: [
                            {
                                type: 'document',
                                document: { link: resolvedHeaderUrl }
                            }
                        ]
                    })
                }
            }

            // 2. Body Component (ONLY when template has {{1}} parameters)
            if (templateVarCount > 0 && bodyParameters.length > 0) {
                components.push({
                    type: 'body',
                    parameters: bodyParameters
                })
            }

            const templatePayload: any = {
                name: templateName,
                language: { code: templateLanguageCode }
            }

            if (components.length > 0) {
                templatePayload.components = components
            }

            const messagePayload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'template',
                template: templatePayload
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
                    console.error(`[BROADCAST EXECUTION] Meta API send failed for phone ${cleanPhone}:`, metaData.error)
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ 
                            status: 'failed', 
                            error_message: metaData.error.message || 'Meta API returned error' 
                        })
                        .eq('broadcast_id', broadcastId)
                        .eq('lead_id', r.lead_id)
                } else {
                    const nowIso = new Date().toISOString()
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ 
                            status: 'sent', 
                            sent_at: nowIso 
                        })
                        .eq('broadcast_id', broadcastId)
                        .eq('lead_id', r.lead_id)

                    // Log outbound chat & message in WhatsApp CRM tab
                    try {
                        const recipientName = lead.name || 'Prospect'
                        const summaryText = `Sent Template: ${templateName}`

                        let { data: chat } = await supabaseAdmin
                            .from('whatsapp_chats')
                            .select('id')
                            .eq('user_id', userId)
                            .eq('recipient_phone', cleanPhone)
                            .maybeSingle()

                        if (!chat) {
                            const { data: newChat } = await supabaseAdmin
                                .from('whatsapp_chats')
                                .insert({
                                    user_id: userId,
                                    recipient_phone: cleanPhone,
                                    recipient_name: recipientName,
                                    lead_id: lead.id,
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
                                    lead_id: lead.id,
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
                    } catch (chatErr) {
                        console.error('[BROADCAST EXECUTION] Error syncing chat message:', chatErr)
                    }
                }
            } catch (sendErr: any) {
                console.error(`[BROADCAST EXECUTION] Exception sending to phone ${cleanPhone}:`, sendErr)
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ 
                        status: 'failed', 
                        error_message: sendErr.message || 'HTTP fetch exception' 
                    })
                    .eq('broadcast_id', broadcastId)
                    .eq('lead_id', r.lead_id)
            }

            // Small throttle per worker (40ms) to ensure smooth outbound rate
            await new Promise(res => setTimeout(res, 40))
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, recipients.length) }, () => dispatchWorker())
    await Promise.all(workers)

    // Mark broadcast complete
    await supabaseAdmin
        .from('whatsapp_broadcasts')
        .update({ 
            status: 'sent', 
            sent_at: new Date().toISOString() 
        })
        .eq('id', broadcastId)
        
    console.log(`[BROADCAST EXECUTION] Broadcast ID ${broadcastId} finished executing.`)
}
