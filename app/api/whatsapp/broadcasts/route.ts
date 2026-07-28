import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { searchParams } = new URL(req.url)
        const impersonateId = searchParams.get('impersonate')
        const targetUserId = impersonateId || user.id

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

        // Fetch status stats for each broadcast
        const resolvedBroadcasts = await Promise.all((broadcasts || []).map(async (b) => {
            const { data: recipients } = await supabase
                .from('whatsapp_broadcast_recipients')
                .select('status')
                .eq('broadcast_id', b.id)

            const total = recipients?.length || 0
            const sent = recipients?.filter(r => r.status === 'sent').length || 0
            const failed = recipients?.filter(r => r.status === 'failed').length || 0

            return {
                ...b,
                stats: { total, sent, failed }
            }
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
        const { title, templateName, recipientStage, recipientPropertyId, scheduledAt, impersonateId } = body
        const targetUserId = impersonateId || user.id

        if (!title || !templateName) {
            return NextResponse.json({ error: 'Missing required broadcast parameters (title, templateName)' }, { status: 400 })
        }

        // Fetch credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, business_name')
            .eq('id', targetUserId)
            .single()

        if (!profile || !profile.whatsapp_access_token || !profile.whatsapp_phone_number_id) {
            return NextResponse.json({ 
                error: 'WhatsApp credentials not connected for the target profile.' 
            }, { status: 400 })
        }

        // Create the broadcast record
        const { data: broadcast, error: cErr } = await supabase
            .from('whatsapp_broadcasts')
            .insert({
                user_id: targetUserId,
                title,
                template_name: templateName,
                recipient_stage: recipientStage || 'All',
                recipient_property_id: recipientPropertyId || null,
                scheduled_at: scheduledAt || null,
                status: scheduledAt ? 'pending' : 'processing'
            })
            .select()
            .single()

        if (cErr) {
            console.error('[BROADCAST API] Error creating broadcast:', cErr)
            return NextResponse.json({ error: cErr.message }, { status: 500 })
        }

        // Filter and find matching leads in DB
        let leadQuery = supabaseAdmin
            .from('leads')
            .select('*')
            .eq('user_id', targetUserId)

        if (recipientStage && recipientStage !== 'All') {
            leadQuery = leadQuery.eq('pipeline_stage', recipientStage)
        }

        if (recipientPropertyId) {
            leadQuery = leadQuery.eq('property_id', recipientPropertyId)
        }

        const { data: leads } = await leadQuery

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
        executeBroadcastImmediately(broadcast.id, targetUserId, profile, templateName, leads, recipientPayloads).catch(console.error)

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
    recipients: any[]
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

    for (const r of recipients) {
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

        // Map template variables
        const parameters = [
            { type: 'text', text: lead.name || 'Valued Lead' },
            { type: 'text', text: propertyTitle },
            { type: 'text', text: businessName }
        ]

        const messagePayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'template',
            template: {
                name: templateName,
                language: { code: 'en_US' },
                components: [
                    {
                        type: 'body',
                        parameters
                    }
                ]
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
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ 
                        status: 'sent', 
                        sent_at: new Date().toISOString() 
                    })
                    .eq('broadcast_id', broadcastId)
                    .eq('lead_id', r.lead_id)
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
    }

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
