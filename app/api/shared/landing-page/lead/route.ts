import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification } from '@/utils/notification-helper'
import { sendCAPIEvent } from '@/utils/external-apis'

async function getNextRoundRobinAgent(supabaseAdmin: any, agentIds: string[]) {
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
        if (time === 0) return agentId; // Never assigned recently, pick immediately
        if (time < oldestTime) {
            oldestTime = time;
            selectedAgent = agentId;
        }
    }
    return selectedAgent;
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { 
            name, 
            phone, 
            email,
            city, 
            landing_page_id, 
            user_id, 
            slug 
        } = body

        if (!name || !phone || !user_id) {
            return NextResponse.json({ error: "Missing required contact details." }, { status: 400 })
        }

        // We use an admin client to bypass RLS so that external landing page submissions
        // are allowed to insert records into public.leads without having an active dashboard auth session.
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Parse custom questions answers
        const customFields: Record<string, any> = { city: city || '' }
        
        // Collect any custom_question_X inputs
        Object.keys(body).forEach(key => {
            if (key.startsWith('custom_question_')) {
                customFields[key] = body[key]
            }
        })

        // Fetch owner profile details including Meta CAPI credentials
        const { data: ownerProfile } = await supabaseAdmin
            .from('profiles')
            .select('facebook_token, selected_page_token, pixel_id, enable_distribution')
            .eq('id', user_id)
            .maybeSingle()

        // ASSIGNMENT LOGIC: Global Rule
        let assignedAgentId: string | null = null;
        if (ownerProfile?.enable_distribution) {
            const { data: teamData } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .or(`agency_id.eq.${user_id},parent_id.eq.${user_id}`)
                .in('role', ['admin', 'agent'])
                .neq('id', user_id) // Exclude the owner
                
            if (teamData && teamData.length > 0) {
                const agentIds = teamData.map(t => t.id);
                assignedAgentId = await getNextRoundRobinAgent(supabaseAdmin, agentIds);
            }
        }

        // Insert new lead into public.leads
        const { data: newLead, error: insertError } = await supabaseAdmin
            .from('leads')
            .insert({
                name,
                phone,
                email,
                user_id,
                source: slug ? `Landing Page - ${slug}` : 'Landing Page',
                pipeline_stage: 'New',
                custom_fields: customFields,
                status: 'active',
                assigned_to: assignedAgentId,
                budget: body.custom_question_0 || '',
                timeline: body.custom_question_1 || '',
            })
            .select()
            .single()

        if (insertError) {
            console.error("❌ Failed to capture landing page lead:", insertError)
            return NextResponse.json({ error: "Failed to submit details. Please try again." }, { status: 500 })
        }

        console.log(`✅ Landing Page Lead Captured: ${newLead.id} for Owner: ${user_id}, Assigned To: ${assignedAgentId}`)

        // Trigger Conversions API (CAPI) Lead Event
        const pixelId = ownerProfile?.pixel_id
        const accessToken = ownerProfile?.facebook_token || ownerProfile?.selected_page_token
        if (pixelId && accessToken) {
            const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                             request.headers.get('x-real-ip') || 
                             '127.0.0.1';
            const clientUa = request.headers.get('user-agent') || '';
            const sourceUrl = request.headers.get('referer') || '';
            
            const nameParts = (name || '').trim().split(/\s+/);
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            console.log(`[CAPI Lead] Dispatching standard Lead event to Meta CAPI for Pixel: ${pixelId}`)
            sendCAPIEvent(
                accessToken,
                pixelId,
                'Lead',
                {
                    phone: phone,
                    firstName: firstName,
                    lastName: lastName,
                    externalId: newLead.id
                },
                0,
                clientIp,
                clientUa,
                sourceUrl
            ).catch(err => {
                console.error("[CAPI Lead] Failed to send CAPI Lead event:", err)
            })
        }

        // Trigger CRM round-robin or staff notifications directly via the native helper
        try {
            const notifUser = assignedAgentId || user_id
            const notifTitle = assignedAgentId ? "🔥 New Lead Assigned!" : "🔥 New Landing Page Lead!"
            const notifBody = `${name} • ${phone} • ${city || 'No City'}`
            await sendPushNotification(
                notifUser,
                notifTitle,
                notifBody,
                `/dashboard/crm/${newLead.id}`
            )
        } catch (notifErr: any) {
            console.error("[Lander Lead API] Failed to send push notification:", notifErr)
        }

        return NextResponse.json({ 
            success: true, 
            leadId: newLead.id 
        })

    } catch (error: any) {
        console.error("Lander Lead API Error:", error)
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 })
    }
}
