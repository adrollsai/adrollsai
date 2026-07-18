import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'

// Admin client — webhooks have no user session
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getNextRoundRobinAgent(agentIds: string[]) {
    if (!agentIds || agentIds.length === 0) return null;
    if (agentIds.length === 1) return agentIds[0];

    const { data: lastLeads } = await supabaseAdmin
        .from('leads')
        .select('assigned_to, created_at')
        .in('assigned_to', agentIds)
        .order('created_at', { ascending: false })
        .limit(200);

    const agentLastAssigned = agentIds.reduce((acc: any, id: string) => { acc[id] = 0; return acc; }, {});
    if (lastLeads) {
        lastLeads.forEach((l: any) => {
            if (l.assigned_to && agentIds.includes(l.assigned_to) && agentLastAssigned[l.assigned_to] === 0) {
                agentLastAssigned[l.assigned_to] = new Date(l.created_at).getTime();
            }
        });
    }

    let selectedAgent = agentIds[0];
    let oldestTime = Infinity;
    for (const agentId of agentIds) {
        const time = agentLastAssigned[agentId];
        if (time === 0) return agentId;
        if (time < oldestTime) {
            oldestTime = time;
            selectedAgent = agentId;
        }
    }
    return selectedAgent;
}

// GET: Health check / verification endpoint
export async function GET(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params;

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name')
        .eq('webhook_token_99acres', token)
        .single()

    if (!profile) {
        return NextResponse.json({ error: 'Invalid webhook token' }, { status: 404 })
    }

    return NextResponse.json({
        status: 'active',
        message: `99acres webhook is active for ${profile.business_name || 'this account'}.`
    })
}

// POST: Receive leads from 99acres
export async function POST(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await params;

        console.log(`📥 [99acres Webhook] Incoming lead for token: ${token.slice(0, 8)}...`)

        // 1. Validate token and find user
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, business_name, enable_distribution, pixel_id, facebook_token, auto_call_new_leads')
            .eq('webhook_token_99acres', token)
            .single()

        if (profileErr || !profile) {
            console.error(`❌ [99acres Webhook] Invalid token: ${token}`)
            return NextResponse.json({ error: 'Invalid webhook token' }, { status: 404 })
        }

        // 2. Parse the incoming payload
        // 99acres may send data in various formats; we handle the common ones
        const body = await request.json()
        console.log(`📋 [99acres Webhook] Payload for user ${profile.id}:`, JSON.stringify(body, null, 2))

        // Extract lead fields — 99acres typically sends these
        const name = body.name || body.Name || body.customer_name || body.CustomerName || body.full_name || 'Unknown'
        const phone = body.phone || body.Phone || body.mobile || body.Mobile || body.contact_number || body.ContactNumber || ''
        const email = body.email || body.Email || body.customer_email || ''
        const projectName = body.project_name || body.ProjectName || body.property_name || body.listing_title || ''
        const city = body.city || body.City || body.location || body.Location || ''
        const budget = body.budget || body.Budget || body.price_range || ''
        const propertyType = body.property_type || body.PropertyType || body.type || ''
        const message = body.message || body.Message || body.query || body.Query || body.remarks || ''

        // Build custom fields from the remaining payload
        const customFields: Record<string, any> = {}
        if (city) customFields.city = city
        if (budget) customFields.budget = budget
        if (propertyType) customFields.property_type = propertyType
        if (message) customFields.message = message
        if (projectName) customFields.project_name = projectName

        // Capture any extra fields not explicitly mapped
        const mappedKeys = new Set([
            'name', 'Name', 'customer_name', 'CustomerName', 'full_name',
            'phone', 'Phone', 'mobile', 'Mobile', 'contact_number', 'ContactNumber',
            'email', 'Email', 'customer_email',
            'project_name', 'ProjectName', 'property_name', 'listing_title',
            'city', 'City', 'location', 'Location',
            'budget', 'Budget', 'price_range',
            'property_type', 'PropertyType', 'type',
            'message', 'Message', 'query', 'Query', 'remarks'
        ])
        Object.keys(body).forEach(key => {
            if (!mappedKeys.has(key) && body[key] !== null && body[key] !== undefined) {
                customFields[key] = body[key]
            }
        })

        // 3. Round-robin assignment
        let assignedAgentId: string | null = null;
        if (profile.enable_distribution) {
            const { data: teamData } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .or(`agency_id.eq.${profile.id},parent_id.eq.${profile.id}`)
                .in('role', ['admin', 'agent'])
                .neq('id', profile.id)

            if (teamData && teamData.length > 0) {
                const agentIds = teamData.map(t => t.id);
                assignedAgentId = await getNextRoundRobinAgent(agentIds);
            }
        }

        // 4. Check for existing lead by phone to prevent duplicates (with robust formatting normalization)
        if (phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            const phoneSuffix = cleanPhone.slice(-10);

            if (phoneSuffix.length === 10) {
                // Fetch potential duplicates using suffix-friendly pattern matching
                const { data: potentialDuplicates } = await supabaseAdmin
                    .from('leads')
                    .select('id, phone')
                    .eq('user_id', profile.id)
                    .or(`phone.like.%${phoneSuffix},phone.eq.${phone}`);

                if (potentialDuplicates && potentialDuplicates.length > 0) {
                    const isDuplicate = potentialDuplicates.some(lead => {
                        const leadClean = (lead.phone || '').replace(/\D/g, '');
                        return leadClean.endsWith(phoneSuffix);
                    });

                    if (isDuplicate) {
                        console.log(`[99acres Webhook] Lead with phone suffix ${phoneSuffix} already exists for user ${profile.id}. Skipping duplicate.`);
                        return NextResponse.json({ success: true, message: 'Duplicate lead skipped' }, { status: 200 });
                    }
                }
            } else {
                // Fallback to exact match check
                const { data: existingByPhone } = await supabaseAdmin
                    .from('leads')
                    .select('id')
                    .eq('user_id', profile.id)
                    .eq('phone', phone)
                    .maybeSingle();

                if (existingByPhone) {
                    console.log(`[99acres Webhook] Lead with phone ${phone} already exists for user ${profile.id}. Skipping duplicate.`);
                    return NextResponse.json({ success: true, message: 'Duplicate lead skipped' }, { status: 200 });
                }
            }
        }

        // 5. Insert lead into CRM
        const sourceLabel = projectName ? `99acres - ${projectName}` : '99acres'

        const { data: savedLead, error: insertErr } = await supabaseAdmin
            .from('leads')
            .insert({
                user_id: profile.id,
                name,
                phone,
                email,
                source: sourceLabel,
                pipeline_stage: 'New',
                status: 'active',
                custom_fields: customFields,
                assigned_to: assignedAgentId,
                budget: typeof budget === 'string' ? budget : String(budget || ''),
                ad_name: projectName || '99acres Lead',
                created_at: new Date().toISOString(),
            })
            .select()
            .single()

        if (insertErr) {
            console.error(`❌ [99acres Webhook] Insert error:`, insertErr)
            return NextResponse.json({ error: 'Failed to save lead' }, { status: 500 })
        }

        console.log(`✅ [99acres Webhook] Lead saved: ${savedLead.id} for user: ${profile.id}`)

        // 5. Send push notification
        try {
            await sendPushNotification(
                assignedAgentId || profile.id,
                "🏠 New 99acres Lead!",
                `${name} • ${phone} • ${projectName || city || '99acres'}`,
                `/dashboard/crm/${savedLead.id}`
            )
        } catch (notifErr) {
            console.error('[99acres Webhook] Push notification failed:', notifErr)
        }

        // Trigger automated WhatsApp welcome drip campaign
        if (savedLead && phone) {
            try {
                const { triggerWelcomeDrip } = await import('@/utils/whatsapp/drips')
                await triggerWelcomeDrip(
                    supabaseAdmin,
                    savedLead.id,
                    name,
                    phone,
                    profile.id,
                    projectName ? `property on 99acres (${projectName})` : 'property on 99acres'
                )
            } catch (err) {
                console.error('[DRIP TRIGGER] 99acres lead welcome drip failed:', err)
            }
        }

        // Trigger automated Voice Dialing if enabled
        if (savedLead && phone && profile.auto_call_new_leads) {
            try {
                const { triggerOutboundCall } = await import('@/utils/voice-helper')
                await triggerOutboundCall(supabaseAdmin, savedLead.id, profile.id, true)
            } catch (err) {
                console.error('[AUTO CALL] Auto voice call trigger failed:', err)
            }
        }

        return NextResponse.json({
            success: true,
            leadId: savedLead.id,
            message: 'Lead captured successfully'
        }, { status: 200 })

    } catch (error: any) {
        console.error('❌ [99acres Webhook] Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
