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

    const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, badges')
        .contains('badges', [`__WEBHOOK_TOKEN_HOUSING__:${token}`])

    const profile = profiles && profiles.length > 0 ? profiles[0] : null

    if (!profile) {
        return NextResponse.json({ error: 'Invalid Housing webhook token' }, { status: 404 })
    }

    return NextResponse.json({
        status: 'active',
        message: `Housing.com webhook is active for ${profile.business_name || 'this account'}.`
    })
}

// POST: Receive leads from Housing.com
export async function POST(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await params;

        console.log(`📥 [Housing Webhook] Incoming lead for token: ${token.slice(0, 8)}...`)

        // 1. Validate token and find user
        const { data: profiles, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, business_name, enable_distribution, pixel_id, facebook_token, auto_call_new_leads')
            .contains('badges', [`__WEBHOOK_TOKEN_HOUSING__:${token}`])

        const profile = profiles && profiles.length > 0 ? profiles[0] : null

        if (profileErr || !profile) {
            console.error(`❌ [Housing Webhook] Invalid token: ${token}`)
            return NextResponse.json({ error: 'Invalid Housing webhook token' }, { status: 404 })
        }

        // 2. Parse the incoming payload (supports JSON and form-urlencoded)
        let body: any = {}
        const contentType = request.headers.get('content-type') || ''
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const formData = await request.formData()
            formData.forEach((value, key) => {
                body[key] = value.toString()
            })
        } else {
            try {
                body = await request.json()
            } catch (e) {
                const text = await request.text()
                try { body = JSON.parse(text) } catch (err) { body = { raw: text } }
            }
        }

        console.log(`📋 [Housing Webhook] Payload for user ${profile.id}:`, JSON.stringify(body, null, 2))

        // Extract lead fields — Housing.com format variations
        const name = body.name || body.Name || body.customer_name || body.CustomerName || body.customerName || body.fullName || body.full_name || body.clientName || 'Housing Lead'
        const phone = body.phone || body.Phone || body.mobile || body.Mobile || body.phone_number || body.customerPhone || body.contact_number || body.ContactNumber || body.phoneNo || ''
        const email = body.email || body.Email || body.customer_email || body.customerEmail || body.emailId || ''
        const projectName = body.project_name || body.ProjectName || body.projectName || body.property_name || body.propertyTitle || body.listing_title || body.title || ''
        const city = body.city || body.City || body.locality || body.Locality || body.location || body.Location || ''
        const budget = body.budget || body.Budget || body.price_range || body.price || ''
        const propertyType = body.property_type || body.PropertyType || body.propertyType || body.type || body.leadType || ''
        const message = body.message || body.Message || body.query || body.Query || body.remarks || body.comments || ''

        // Build custom fields
        const customFields: Record<string, any> = {}
        if (city) customFields.city = city
        if (budget) customFields.budget = budget
        if (propertyType) customFields.property_type = propertyType
        if (message) customFields.message = message
        if (projectName) customFields.project_name = projectName
        customFields.webhook_provider = 'housing.com'

        // Capture remaining extra fields
        const mappedKeys = new Set([
            'name', 'Name', 'customer_name', 'CustomerName', 'customerName', 'fullName', 'full_name', 'clientName',
            'phone', 'Phone', 'mobile', 'Mobile', 'phone_number', 'customerPhone', 'contact_number', 'ContactNumber', 'phoneNo',
            'email', 'Email', 'customer_email', 'customerEmail', 'emailId',
            'project_name', 'ProjectName', 'projectName', 'property_name', 'propertyTitle', 'listing_title', 'title',
            'city', 'City', 'locality', 'Locality', 'location', 'Location',
            'budget', 'Budget', 'price_range', 'price',
            'property_type', 'PropertyType', 'propertyType', 'type', 'leadType',
            'message', 'Message', 'query', 'Query', 'remarks', 'comments'
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

        // 4. Check for existing lead by phone
        let existingLeadToReopen: any = null;
        if (phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            const phoneSuffix = cleanPhone.slice(-10);

            if (phoneSuffix.length >= 7) {
                const { data: matchingLeads } = await supabaseAdmin
                    .from('leads')
                    .select('id, name, pipeline_stage, status, notes, assigned_to, user_id, custom_fields')
                    .or(`user_id.eq.${profile.id},assigned_to.eq.${profile.id}`)
                    .ilike('phone', `%${phoneSuffix}`)
                    .order('created_at', { ascending: false })
                    .limit(1)

                if (matchingLeads && matchingLeads.length > 0) {
                    existingLeadToReopen = matchingLeads[0]
                }
            }
        }

        const leadNotes = `[Opening Remarks]: Integrated from Housing.com\n${projectName ? `Project: ${projectName}\n` : ''}${city ? `Location: ${city}\n` : ''}${propertyType ? `Type: ${propertyType}\n` : ''}${budget ? `Budget: ${budget}\n` : ''}${message ? `Query: ${message}\n` : ''}`

        let savedLeadId: string | null = null;
        let actionMessage = '';

        if (existingLeadToReopen) {
            // Reopen existing lead into Fresh
            savedLeadId = existingLeadToReopen.id;
            const combinedNotes = `${leadNotes}\n\n--- Previous Notes ---\n${existingLeadToReopen.notes || ''}`.trim()
            const updatedCustomFields = { ...(existingLeadToReopen.custom_fields || {}), ...customFields }

            const updateData: any = {
                pipeline_stage: 'New Lead',
                status: 'New Lead',
                notes: combinedNotes,
                custom_fields: updatedCustomFields,
                updated_at: new Date().toISOString()
            }
            if (assignedAgentId) {
                updateData.assigned_to = assignedAgentId
            }

            await supabaseAdmin.from('leads').update(updateData).eq('id', existingLeadToReopen.id)

            await supabaseAdmin.from('lead_history').insert({
                lead_id: existingLeadToReopen.id,
                user_id: assignedAgentId || profile.id,
                action_type: 'REOPENED',
                description: `Lead re-enquired via Housing.com. Reset to New Lead.`
            })

            actionMessage = 'Existing lead reopened into Fresh pipeline from Housing.com.'
        } else {
            // Insert new lead
            const newLeadData: any = {
                user_id: profile.id,
                name: name || 'Housing Lead',
                phone: phone || null,
                email: email || null,
                source: 'Housing.com',
                pipeline_stage: 'New Lead',
                status: 'New Lead',
                notes: leadNotes,
                custom_fields: customFields,
                assigned_to: assignedAgentId || profile.id,
                created_at: new Date().toISOString()
            }

            const { data: newLead, error: insertErr } = await supabaseAdmin
                .from('leads')
                .insert(newLeadData)
                .select('id')
                .single()

            if (insertErr) {
                console.error('❌ [Housing Webhook] Lead insertion error:', insertErr)
                return NextResponse.json({ error: 'Failed to save Housing.com lead' }, { status: 500 })
            }

            savedLeadId = newLead?.id || null;

            if (savedLeadId) {
                await supabaseAdmin.from('lead_history').insert({
                    lead_id: savedLeadId,
                    user_id: assignedAgentId || profile.id,
                    action_type: 'CREATED',
                    description: `Lead created from Housing.com integration.`
                })
            }

            actionMessage = 'New lead created successfully from Housing.com.'
        }

        // Push Notifications
        const recipientUserId = assignedAgentId || profile.id;
        try {
            await sendPushNotification(
                recipientUserId,
                `🏠 New Housing.com Lead: ${name}`,
                `${phone ? `Phone: ${phone} • ` : ''}${projectName ? `Project: ${projectName}` : 'Housing.com Enquiry'}`,
                `/dashboard/crm/${savedLeadId || ''}`
            )
        } catch (e) {
            console.error('Failed to send push notification:', e)
        }

        return NextResponse.json({
            success: true,
            message: actionMessage,
            leadId: savedLeadId
        })
    } catch (err: any) {
        console.error('❌ [Housing Webhook] Unexpected error:', err)
        return NextResponse.json({ error: err.message || 'Internal webhook error' }, { status: 500 })
    }
}
