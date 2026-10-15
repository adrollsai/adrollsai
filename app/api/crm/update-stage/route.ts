import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, newStage, notes } = await request.json()

  try {
    // Initialize admin client to securely bypass RLS for hierarchical checks and updates
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Check access: Caller must be owner, assigned agent, or staff of the owner
    const { data: checkLead, error: checkError } = await supabase
        .from('leads')
        .select('user_id, assigned_to, pixel_id')
        .eq('id', leadId)
        .single()

    if (checkError || !checkLead) {
        return NextResponse.json({ error: 'Lead not found or access denied' }, { status: 404 })
    }

    // Fetch caller's profile and lead owner's profile using admin client to securely verify hierarchy
    const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('parent_id, agency_id, role')
        .eq('id', user.id)
        .single();

    const { data: ownerProfile } = await supabaseAdmin
        .from('profiles')
        .select('parent_id, agency_id, role')
        .eq('id', checkLead.user_id)
        .single();

    const isOwner = checkLead.user_id === user.id;
    const isAssigned = checkLead.assigned_to === user.id;
    
    let isAuthorized = isOwner || isAssigned;

    if (!isAuthorized && callerProfile) {
        const callerRole = callerProfile.role;
        const callerParentId = callerProfile.parent_id;
        const callerAgencyId = callerProfile.agency_id;

        if (callerRole === 'super_admin') {
            isAuthorized = true;
        } else if (ownerProfile) {
            const ownerParentId = ownerProfile.parent_id;
            const ownerAgencyId = ownerProfile.agency_id;

            // 1. Check if caller is the agency owner/admin of the lead's owner
            const isAgencyOwner = (ownerAgencyId === user.id || ownerParentId === user.id);

            // 2. Check if caller is staff directly under the lead's owner
            const isDirectStaff = (callerParentId === checkLead.user_id || callerAgencyId === checkLead.user_id);

            // 3. Check if caller and lead's owner share the same parent or agency root
            const callerRoot = callerParentId || callerAgencyId || user.id;
            const ownerRoot = ownerParentId || ownerAgencyId || checkLead.user_id;
            const isCoStaff = callerRoot === ownerRoot;

            if (isAgencyOwner || isDirectStaff || isCoStaff) {
                isAuthorized = true;
            }
        }
    }

    if (!isAuthorized) {
        return NextResponse.json({ error: 'Forbidden: Unauthorized lead access' }, { status: 403 })
    }


    let cf = (checkLead as any).custom_fields || {}
    if (typeof cf === 'string') { try { cf = JSON.parse(cf) } catch (e) {} }
    const stageLower = (newStage || '').toLowerCase()
    const isCompletedVisit = 
      !stageLower.includes('planned') && 
      !stageLower.includes('scheduled') && 
      (
        stageLower === 'visit done' || 
        stageLower === 'visited' || 
        stageLower === 'revisit done' || 
        stageLower === 're-visited' || 
        stageLower === 'revisit' || 
        stageLower === 'appointment done' ||
        stageLower.includes('visit done') || 
        stageLower.includes('site visit done') || 
        stageLower.includes('revisit done') ||
        stageLower.includes('appointment done')
      );

    if (isCompletedVisit) {
      cf.has_visited = true
      if (!cf.visited_at) cf.visited_at = new Date().toISOString()
    }

    const { data: lead, error } = await supabaseAdmin
        .from('leads')
        .update({ 
            status: newStage,
            pipeline_stage: newStage, 
            notes: notes || undefined,
            custom_fields: cf
        })
        .eq('id', leadId)
        .select()
        .single()

    if (error) throw error;

    // 2. Trigger CAPI if stage warrants it
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token, selected_page_token, pixel_id')
        .eq('id', checkLead.user_id)
        .single();

    const accessToken = profile?.facebook_token || profile?.selected_page_token;
    const pixelId = checkLead?.pixel_id || profile?.pixel_id;

    if (accessToken && pixelId) {
        let eventName = '';
        if (newStage === 'Contacted' || newStage === 'Qualified') eventName = 'Lead';
        if (newStage === 'Appointment Booked' || newStage === 'Appointment booked') eventName = 'Schedule';
        if (newStage === 'Visit Done' || newStage === 'Appointment done') eventName = 'Other';
        if (newStage === 'Deal/Token' || newStage === 'Closed') eventName = 'Purchase';

        if (eventName) {
            // Split name if possible
            const nameParts = (lead.name || '').split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            // Extract client environment details for rich Event Match Quality (EMQ)
            const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || '127.0.0.1';
            const clientUa = request.headers.get('user-agent') || '';
            const referer = request.headers.get('referer') || '';
            const host = request.headers.get('host') || 'adrolls.in';
            const protocol = host.includes('localhost') || host.includes('ngrok') ? 'http' : 'https';
            const sourceUrl = referer || `${protocol}://${host}/shared/${user.id}`;

            await sendCAPIEvent(
                accessToken, 
                pixelId, 
                eventName, 
                { 
                    email: lead.email, 
                    phone: lead.phone,
                    firstName,
                    lastName,
                    externalId: lead.id
                },
                newStage === 'Closed' ? 50000 : 0, // Assigning a default value for Closed leads
                clientIp,
                clientUa,
                sourceUrl
            );
        }
    }

    // 3. Trigger Automated WhatsApp Stage Message for Umang Associates
    const UMANG_USER_ID = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde';
    const isUmangAccount = checkLead.user_id === UMANG_USER_ID;

    if (isUmangAccount && lead.phone) {
        dispatchUmangStageWhatsApp(supabaseAdmin, lead, newStage).catch(err => {
            console.error('[UMANG WA STAGE TRIGGER] Non-blocking dispatch error:', err);
        });
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// Background handler for Umang Associates Stage Change WhatsApp Messaging
async function dispatchUmangStageWhatsApp(supabaseAdmin: any, lead: any, newStage: string) {
    const stageLower = (newStage || '').toLowerCase().trim();

    // Map stages to respective template names
    let stageKey = '';
    let targetTemplateName = '';

    if (stageLower.includes('planned') || stageLower === 'visit planned' || stageLower === 'appointment booked') {
        stageKey = 'visit_planned';
        targetTemplateName = 'umang_stage_visit_planned';
    } else if (stageLower.includes('visit done') || stageLower === 'visited' || stageLower === 'visit done' || stageLower === 'appointment done') {
        stageKey = 'visit_done';
        targetTemplateName = 'umang_stage_visit_done';
    } else if (stageLower === 'closed' || stageLower === 'deal/token' || stageLower === 'won') {
        stageKey = 'deal_closed';
        targetTemplateName = 'umang_stage_deal_closed';
    }

    if (!stageKey) {
        console.log(`[UMANG WA STAGE] Stage "${newStage}" does not have an automated stage message configured. Skipping.`);
        return;
    }

    // Anti-duplicate check: Do not re-send the same stage message to this lead
    let cf = lead.custom_fields || {};
    if (typeof cf === 'string') {
        try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
    }
    const stageWaLog = cf.stage_wa_sent || {};
    if (stageWaLog[stageKey]) {
        console.log(`[UMANG WA STAGE] Stage message "${stageKey}" already sent to lead ${lead.id} on ${stageWaLog[stageKey]}. Skipping.`);
        return;
    }

    // Fetch Umang Associates WhatsApp credentials
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token, business_name')
        .eq('id', 'b685d287-7d54-4c9c-ae03-a46bb96ebdde')
        .single();

    const token = profile?.whatsapp_access_token || profile?.facebook_token;
    const phoneId = profile?.whatsapp_phone_number_id || '1465196976677120';
    const wabaId = profile?.whatsapp_waba_id || '1603442687285990';

    if (!token || !phoneId) {
        console.warn('[UMANG WA STAGE] WhatsApp token or phone ID missing.');
        return;
    }

    let cleanPhone = (lead.phone || '').replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
    if (!cleanPhone) return;

    // Resolve Lead first name - strictly single variable {{1}}
    let leadFirstName = 'there';
    if (lead.name) {
        const cleanName = lead.name.replace(/[^\w\s]/gi, '').trim();
        if (cleanName && !/^(lead|prospect|valued customer)$/i.test(cleanName)) {
            leadFirstName = cleanName.split(' ')[0] || 'there';
        }
    }

    // Verify template existence on Meta or fall back to approved interactive template
    let effectiveTemplate = targetTemplateName;
    try {
        const checkRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=${targetTemplateName}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const checkData = await checkRes.json();
        const found = (checkData.data || []).find((t: any) => t.name === targetTemplateName && t.status === 'APPROVED');
        if (!found) {
            console.log(`[UMANG WA STAGE] Target template ${targetTemplateName} not yet approved on Meta. Using approved fallback template: real_estate_tailored_inventory`);
            effectiveTemplate = 'real_estate_tailored_inventory';
        }
    } catch (e) {
        effectiveTemplate = 'real_estate_tailored_inventory';
    }

    // Construct Meta Message Payload
    const templatePayload: any = {
        name: effectiveTemplate,
        language: { code: 'en_US' }
    };

    // Only supply body component if the template has {{1}} variable
    if (effectiveTemplate !== 'real_estate_tailored_inventory') {
        templatePayload.components = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: leadFirstName }
                ]
            }
        ];
    }

    const messagePayload = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: templatePayload
    };

    console.log(`[UMANG WA STAGE] Dispatching "${effectiveTemplate}" to ${cleanPhone} for stage "${newStage}"...`);

    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
    });

    const metaData = await metaRes.json();
    console.log(`[UMANG WA STAGE] Meta response status: ${metaRes.status}`, metaData);

    if (metaRes.ok && metaData.messages) {
        // Record anti-duplicate flag
        stageWaLog[stageKey] = new Date().toISOString();
        cf.stage_wa_sent = stageWaLog;
        await supabaseAdmin
            .from('leads')
            .update({ custom_fields: cf })
            .eq('id', lead.id);

        // Record in whatsapp_messages & whatsapp_chats
        try {
            let { data: chat } = await supabaseAdmin
                .from('whatsapp_chats')
                .select('id')
                .eq('user_id', 'b685d287-7d54-4c9c-ae03-a46bb96ebdde')
                .eq('recipient_phone', cleanPhone)
                .maybeSingle();

            if (!chat) {
                const { data: newChat } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .insert({
                        user_id: 'b685d287-7d54-4c9c-ae03-a46bb96ebdde',
                        recipient_phone: cleanPhone,
                        recipient_name: lead.name || 'Valued Lead',
                        last_message_text: `Stage Update (${newStage}): Sent ${effectiveTemplate}`,
                        last_message_time: new Date().toISOString()
                    })
                    .select('id')
                    .single();
                chat = newChat;
            } else {
                await supabaseAdmin
                    .from('whatsapp_chats')
                    .update({
                        last_message_text: `Stage Update (${newStage}): Sent ${effectiveTemplate}`,
                        last_message_time: new Date().toISOString()
                    })
                    .eq('id', chat.id);
            }

            if (chat) {
                await supabaseAdmin
                    .from('whatsapp_messages')
                    .insert({
                        chat_id: chat.id,
                        direction: 'outbound',
                        message_text: `[Automated Stage Notification: ${newStage}] Template: ${effectiveTemplate}`
                    });
            }
        } catch (logErr) {
            console.warn('[UMANG WA STAGE] Chat logging notice:', logErr);
        }
    }
}