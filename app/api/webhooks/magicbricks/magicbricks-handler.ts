import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPushNotification, sendAdminMultiChannelNotification } from '@/utils/notification-helper'
import { matchesCampaignRule } from '@/utils/campaign-matcher'

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

export async function handleMagicbricksGet(request: Request, explicitToken?: string) {
    try {
        const url = new URL(request.url)
        const token = explicitToken || url.searchParams.get('api_key') || url.searchParams.get('token') || request.headers.get('x-api-key')

        if (!token) {
            return NextResponse.json({
                status: 'ready',
                message: 'Magicbricks webhook endpoint is live. Provide your token or api_key to verify account status.'
            }, { status: 200 })
        }

        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, business_name, badges')
            .contains('badges', [`__WEBHOOK_TOKEN_MAGICBRICKS__:${token}`])

        const profile = profiles && profiles.length > 0 ? profiles[0] : null

        if (!profile) {
            return NextResponse.json({ error: 'Invalid Magicbricks webhook token or API key' }, { status: 404 })
        }

        return NextResponse.json({
            status: 'active',
            message: `Magicbricks webhook is active for ${profile.business_name || 'this account'}.`
        })
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
    }
}

export async function handleMagicbricksPost(request: Request, explicitToken?: string) {
    try {
        const url = new URL(request.url)

        // 1. Parse incoming payload (supports multipart/form-data, application/x-www-form-urlencoded, and JSON)
        let body: Record<string, any> = {}
        const contentType = request.headers.get('content-type') || ''

        if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
            try {
                const formData = await request.formData()
                formData.forEach((value, key) => {
                    body[key] = typeof value === 'string' ? value.trim() : value
                })
            } catch (err) {
                console.warn('[Magicbricks Webhook] Could not parse form data, trying text:', err)
            }
        } else {
            try {
                body = await request.json()
            } catch (e) {
                try {
                    const text = await request.text()
                    body = JSON.parse(text)
                } catch (err) {
                    body = {}
                }
            }
        }

        // Merge query parameters if body fields are empty
        url.searchParams.forEach((val, k) => {
            if (body[k] === undefined || body[k] === '') {
                body[k] = val
            }
        })

        // 2. Extract Token / API Key from all possible sources
        const token = explicitToken ||
            body.api_key ||
            body.apiKey ||
            body.token ||
            body.key ||
            url.searchParams.get('api_key') ||
            url.searchParams.get('token') ||
            request.headers.get('x-api-key') ||
            (request.headers.get('authorization') ? request.headers.get('authorization')!.replace(/^Bearer\s+/i, '') : '')

        if (!token) {
            console.error('❌ [Magicbricks Webhook] Missing API key or token in request')
            return NextResponse.json({
                error: 'Missing api_key or webhook token. Provide api_key in form-data/body, query string, or URL path.'
            }, { status: 400 })
        }

        console.log(`📥 [Magicbricks Webhook] Incoming lead for token: ${String(token).slice(0, 8)}...`)

        // 3. Find user profile matching the token in badges
        const { data: profiles, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, business_name, enable_distribution, pixel_id, facebook_token, auto_call_new_leads')
            .contains('badges', [`__WEBHOOK_TOKEN_MAGICBRICKS__:${token}`])

        const profile = profiles && profiles.length > 0 ? profiles[0] : null

        if (profileErr || !profile) {
            console.error(`❌ [Magicbricks Webhook] Invalid token: ${token}`)
            return NextResponse.json({ error: 'Invalid Magicbricks webhook token or api_key' }, { status: 404 })
        }

        console.log(`📋 [Magicbricks Webhook] Payload for user ${profile.id}:`, JSON.stringify(body, null, 2))

        // 4. Extract lead fields — Magicbricks standard parameters & common aliases
        const rawName = body.name || body.lead_name || body.customer_name || body.leadname || body.fullName || body.full_name || body.clientName || 'Magicbricks Lead'
        const rawPhone = body.mobile || body.phone || body.contact_number || body.contact_no || body.phone_number || body.cell || body.phoneNo || ''
        const isd = String(body.isd || body.isd_code || body.country_code || body.dial_code || '91').replace(/\D/g, '') || '91'
        const email = body.email || body.email_id || body.emailId || body.customer_email || ''
        const projectName = body.project || body.project_name || body.projectName || body.property_name || body.propertyTitle || body.property_title || body.listing_title || body.title || ''
        const city = body.city || body.City || body.locality || body.Locality || body.location || ''
        const budget = body.budget || body.Budget || body.price || body.price_range || ''
        const propertyType = body.property_type || body.PropertyType || body.propertyType || body.type || body.leadType || ''
        const message = body.msg || body.message || body.query || body.remarks || body.comments || body.requirement || ''
        const psId = body.ps_id || body.psid || body.property_id || body.propertyId || ''
        const enquiryId = body.lead_id || body.leadId || body.enquiry_id || body.enquiryId || ''

        // Format phone number cleanly
        const cleanDigits = String(rawPhone).replace(/\D/g, '')
        let formattedPhone = ''
        if (cleanDigits) {
            if (cleanDigits.length === 10) {
                formattedPhone = `+${isd}${cleanDigits}`
            } else if (cleanDigits.startsWith(isd)) {
                formattedPhone = `+${cleanDigits}`
            } else if (cleanDigits.startsWith('0') && cleanDigits.length === 11) {
                formattedPhone = `+${isd}${cleanDigits.slice(1)}`
            } else {
                formattedPhone = `+${cleanDigits}`
            }
        }

        // Build custom fields
        const customFields: Record<string, any> = {
            source: 'Magicbricks',
            webhook_provider: 'magicbricks'
        }
        if (city) customFields.city = city
        if (budget) customFields.budget = budget
        if (propertyType) customFields.property_type = propertyType
        if (message) customFields.message = message
        if (projectName) customFields.project_name = projectName
        if (psId) customFields.magicbricks_ps_id = psId
        if (enquiryId) customFields.magicbricks_enquiry_id = enquiryId
        if (isd) customFields.isd = isd

        // Unmapped extra fields
        const mappedKeys = new Set([
            'api_key', 'apiKey', 'token', 'key',
            'name', 'lead_name', 'customer_name', 'leadname', 'fullName', 'full_name', 'clientName',
            'mobile', 'phone', 'contact_number', 'contact_no', 'phone_number', 'cell', 'phoneNo',
            'isd', 'isd_code', 'country_code', 'dial_code',
            'email', 'email_id', 'emailId', 'customer_email',
            'project', 'project_name', 'projectName', 'property_name', 'propertyTitle', 'property_title', 'listing_title', 'title',
            'city', 'City', 'locality', 'Locality', 'location',
            'budget', 'Budget', 'price', 'price_range',
            'property_type', 'PropertyType', 'propertyType', 'type', 'leadType',
            'msg', 'message', 'query', 'remarks', 'comments', 'requirement',
            'ps_id', 'psid', 'property_id', 'propertyId', 'lead_id', 'leadId', 'enquiry_id', 'enquiryId'
        ])
        Object.keys(body).forEach(key => {
            if (!mappedKeys.has(key) && body[key] !== null && body[key] !== undefined && body[key] !== '') {
                customFields[key] = body[key]
            }
        })

        // 5. Evaluate Group-Distribution automation rules
        let assignedAgentId: string | null = null;
        let _assignedAgentName = '';

        try {
            const { data: groupAutomations } = await supabaseAdmin
                .from('automations')
                .select('*')
                .eq('user_id', profile.id)
                .like('title', 'Group-Distribution:%')
                .eq('is_active', true);

            if (groupAutomations && groupAutomations.length > 0) {
                const leadCtx = {
                    source: 'Magicbricks',
                    campaignName: projectName || null,
                    adName: projectName || 'Magicbricks Lead',
                    adCampaignString: projectName || null
                };

                for (const aut of groupAutomations) {
                    try {
                        const parsedGroup = JSON.parse(aut.description || '{}');
                        const groupCampaigns: string[] = Array.isArray(parsedGroup.campaigns) ? parsedGroup.campaigns : [];
                        const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];
                        const activeMembers = groupMembers.filter((m: any) => m.is_active !== false);

                        if (activeMembers.length > 0 && groupCampaigns.length > 0) {
                            const matchesCamp = groupCampaigns.some(gc => matchesCampaignRule(gc, leadCtx));

                            if (matchesCamp) {
                                const weightedPool: any[] = [];
                                activeMembers.forEach(m => {
                                    for (let i = 0; i < Math.max(1, m.weight || 1); i++) {
                                        weightedPool.push(m);
                                    }
                                });

                                let currentIdx = 0;
                                if (parsedGroup.last_assigned_user_id) {
                                    const lastIdx = weightedPool.findIndex(m => m.userId === parsedGroup.last_assigned_user_id);
                                    if (lastIdx !== -1) {
                                        currentIdx = (lastIdx + 1) % weightedPool.length;
                                    }
                                }

                                const selectedMember = weightedPool[currentIdx];
                                assignedAgentId = selectedMember.userId;
                                _assignedAgentName = selectedMember.name || '';

                                parsedGroup.last_assigned_user_id = selectedMember.userId;
                                parsedGroup.last_assigned_user_name = selectedMember.name;
                                parsedGroup.last_assigned_at = new Date().toISOString();

                                const updatedGroupJson = JSON.stringify(parsedGroup);
                                aut.description = updatedGroupJson;

                                await supabaseAdmin
                                    .from('automations')
                                    .update({ description: updatedGroupJson })
                                    .eq('id', aut.id);

                                console.log(`[Magicbricks Webhook] Group distribution assigned lead to ${selectedMember.name} (${selectedMember.userId}) for rule ${aut.title}`);
                                break;
                            }
                        }
                    } catch (pErr) {
                        console.error('[Magicbricks Webhook] Error evaluating group rule:', pErr);
                    }
                }
            }
        } catch (distErr) {
            console.error('[Magicbricks Webhook] Error evaluating group distribution:', distErr);
        }

        // Fallback distribution: active group or team members
        if (!assignedAgentId) {
            try {
                const { data: fallbackGroupAutomations } = await supabaseAdmin
                    .from('automations')
                    .select('*')
                    .eq('user_id', profile.id)
                    .like('title', 'Group-Distribution:%')
                    .eq('is_active', true);

                if (fallbackGroupAutomations && fallbackGroupAutomations.length > 0) {
                    for (const aut of fallbackGroupAutomations) {
                        try {
                            const parsedGroup = JSON.parse(aut.description || '{}');
                            const groupMembers: any[] = Array.isArray(parsedGroup.members) ? parsedGroup.members : [];
                            const activeMembers = groupMembers.filter((m: any) => m.is_active !== false);

                            if (activeMembers.length > 0) {
                                const weightedPool: any[] = [];
                                activeMembers.forEach(m => {
                                    for (let i = 0; i < Math.max(1, m.weight || 1); i++) {
                                        weightedPool.push(m);
                                    }
                                });

                                let currentIdx = 0;
                                if (parsedGroup.last_assigned_user_id) {
                                    const lastIdx = weightedPool.findIndex(m => m.userId === parsedGroup.last_assigned_user_id);
                                    if (lastIdx !== -1) {
                                        currentIdx = (lastIdx + 1) % weightedPool.length;
                                    }
                                }

                                const selectedMember = weightedPool[currentIdx];
                                assignedAgentId = selectedMember.userId;
                                _assignedAgentName = selectedMember.name || '';

                                parsedGroup.last_assigned_user_id = selectedMember.userId;
                                parsedGroup.last_assigned_user_name = selectedMember.name;
                                parsedGroup.last_assigned_at = new Date().toISOString();

                                const updatedGroupJson = JSON.stringify(parsedGroup);
                                aut.description = updatedGroupJson;

                                await supabaseAdmin
                                    .from('automations')
                                    .update({ description: updatedGroupJson })
                                    .eq('id', aut.id);

                                console.log(`[Magicbricks Webhook] Fallback group distribution assigned lead to ${selectedMember.name} (${selectedMember.userId}) for rule ${aut.title}`);
                                break;
                            }
                        } catch (pErr) {
                            console.error('[Magicbricks Webhook] Error evaluating fallback group rule:', pErr);
                        }
                    }
                }

                // If still not assigned, check if profile has active team members
                if (!assignedAgentId) {
                    const { data: teamMembers } = await supabaseAdmin
                        .from('profiles')
                        .select('id, full_name, business_name')
                        .or(`parent_id.eq.${profile.id},agency_id.eq.${profile.id}`)
                        .eq('role', 'agent');

                    if (teamMembers && teamMembers.length > 0) {
                        const agentIds = teamMembers.map(t => t.id);
                        assignedAgentId = await getNextRoundRobinAgent(agentIds);
                    }
                }
            } catch (fbDistErr) {
                console.error('[Magicbricks Webhook] Error evaluating fallback distribution:', fbDistErr);
            }
        }

        // 6. Check for existing lead by phone
        let existingLeadToReopen: any = null;
        const phoneToMatch = formattedPhone || cleanDigits;
        if (phoneToMatch) {
            const cleanPhone = phoneToMatch.replace(/\D/g, '');
            const phoneSuffix = cleanPhone.slice(-10);

            if (phoneSuffix.length >= 7) {
                const { data: matchingLeads } = await supabaseAdmin
                    .from('leads')
                    .select('id, name, email, pipeline_stage, status, notes, assigned_to, user_id, custom_fields, ad_name')
                    .or(`user_id.eq.${profile.id},assigned_to.eq.${profile.id}`)
                    .ilike('phone', `%${phoneSuffix}`)
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (matchingLeads && matchingLeads.length > 0) {
                    existingLeadToReopen = matchingLeads[0];
                }
            }
        }

        const sourceLabel = projectName ? `Magicbricks - ${projectName}` : 'Magicbricks';
        const sourceDetail = projectName || message || (propertyType ? `${propertyType}${city ? ` - ${city}` : ''}` : '') || 'Magicbricks Enquiry';
        const leadNotes = `[Opening Remarks]: Integrated from Magicbricks\n${projectName ? `Project: ${projectName}\n` : ''}${message ? `Requirement: ${message}\n` : ''}${city ? `Location: ${city}\n` : ''}${propertyType ? `Type: ${propertyType}\n` : ''}${budget ? `Budget: ${budget}\n` : ''}${psId ? `Property ID: ${psId}\n` : ''}`;

        let savedLeadId: string | null = null;
        let actionMessage = '';

        if (existingLeadToReopen) {
            // Reopen existing lead into Fresh pipeline stage
            savedLeadId = existingLeadToReopen.id;
            const combinedNotes = `${leadNotes}\n\n--- Previous Notes ---\n${existingLeadToReopen.notes || ''}`.trim();
            const updatedCustomFields = { ...(existingLeadToReopen.custom_fields || {}), ...customFields };

            const updateData: any = {
                pipeline_stage: 'New Lead',
                status: 'New Lead',
                notes: combinedNotes,
                custom_fields: updatedCustomFields,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            if (!existingLeadToReopen.ad_name) {
                updateData.ad_name = sourceDetail;
            }
            if (assignedAgentId) {
                updateData.assigned_to = assignedAgentId;
            }

            await supabaseAdmin.from('leads').update(updateData).eq('id', existingLeadToReopen.id);

            await supabaseAdmin.from('lead_history').insert({
                lead_id: existingLeadToReopen.id,
                user_id: assignedAgentId || profile.id,
                action_type: 'REOPENED',
                description: `Lead re-enquired via Magicbricks.\nSource Details: ${sourceDetail}\nReset to New Lead.`,
                created_at: new Date().toISOString()
            });

            // Send notifications for reopened lead
            try {
                await sendAdminMultiChannelNotification({
                    ownerUserId: profile.id,
                    title: "🔄 Magicbricks Lead Reopened!",
                    body: `Lead: ${rawName || existingLeadToReopen.name}\nPhone: ${formattedPhone || cleanDigits || 'N/A'}\nProject: ${projectName || 'N/A'}\nSource: ${sourceLabel}`,
                    url: `/dashboard/crm/${existingLeadToReopen.id}`,
                    type: 'fresh_lead',
                    leadPhone: formattedPhone || cleanDigits,
                    leadName: rawName || existingLeadToReopen.name,
                    leadId: existingLeadToReopen.id,
                    leadSource: sourceLabel
                }).catch(() => {});

                const agentId = assignedAgentId || existingLeadToReopen.assigned_to;
                if (agentId && agentId !== profile.id) {
                    await sendAdminMultiChannelNotification({
                        ownerUserId: agentId,
                        title: "🔄 Reopened Magicbricks Lead Assigned to You!",
                        body: `Lead: ${rawName || existingLeadToReopen.name}\nPhone: ${formattedPhone || cleanDigits || 'N/A'}\nProject: ${projectName || 'N/A'}\nSource: ${sourceDetail}`,
                        url: `/dashboard/crm/${existingLeadToReopen.id}`,
                        type: 'lead_assigned',
                        leadPhone: formattedPhone || cleanDigits,
                        leadName: rawName || existingLeadToReopen.name,
                        leadId: existingLeadToReopen.id,
                        leadSource: sourceLabel
                    }).catch(() => {});
                }
            } catch (notifErr) {
                console.error('[Magicbricks Webhook] Multi-channel notification failed for reopen:', notifErr);
            }

            actionMessage = 'Existing lead reopened into Fresh pipeline from Magicbricks.';
        } else {
            // Insert new lead
            const newLeadData: any = {
                user_id: profile.id,
                name: rawName,
                phone: formattedPhone || cleanDigits || null,
                email: email || null,
                source: 'Magicbricks',
                ad_name: sourceDetail,
                pipeline_stage: 'New Lead',
                status: 'New Lead',
                notes: leadNotes,
                custom_fields: customFields,
                assigned_to: assignedAgentId || null,
                created_at: new Date().toISOString()
            };

            const { data: newLead, error: insertErr } = await supabaseAdmin
                .from('leads')
                .insert(newLeadData)
                .select('id')
                .single();

            if (insertErr) {
                console.error('❌ [Magicbricks Webhook] Lead insertion error:', insertErr);
                return NextResponse.json({ error: 'Failed to save Magicbricks lead' }, { status: 500 });
            }

            savedLeadId = newLead?.id || null;

            if (savedLeadId) {
                await supabaseAdmin.from('lead_history').insert({
                    lead_id: savedLeadId,
                    user_id: assignedAgentId || profile.id,
                    action_type: 'CREATED',
                    description: `Lead created from Magicbricks integration.\nSource Details: ${sourceDetail}`
                });
            }

            // Multi-channel notifications for fresh lead
            try {
                await sendAdminMultiChannelNotification({
                    ownerUserId: profile.id,
                    title: `🏠 New Magicbricks Lead: ${rawName}`,
                    body: `Lead: ${rawName}\nPhone: ${formattedPhone || cleanDigits || 'N/A'}\nProject: ${projectName || 'N/A'}\nSource: ${sourceDetail}`,
                    url: `/dashboard/crm/${savedLeadId || ''}`,
                    type: 'fresh_lead',
                    leadPhone: formattedPhone || cleanDigits,
                    leadName: rawName,
                    leadId: savedLeadId || undefined,
                    leadSource: 'Magicbricks'
                }).catch(() => {});

                if (assignedAgentId && assignedAgentId !== profile.id) {
                    await sendAdminMultiChannelNotification({
                        ownerUserId: assignedAgentId,
                        title: "🏠 New Magicbricks Lead Assigned to You!",
                        body: `Lead: ${rawName}\nPhone: ${formattedPhone || cleanDigits || 'N/A'}\nProject: ${projectName || 'N/A'}\nSource: ${sourceDetail}`,
                        url: `/dashboard/crm/${savedLeadId || ''}`,
                        type: 'lead_assigned',
                        leadPhone: formattedPhone || cleanDigits,
                        leadName: rawName,
                        leadId: savedLeadId || undefined,
                        leadSource: 'Magicbricks'
                    }).catch(() => {});
                }
            } catch (notifErr) {
                console.error('[Magicbricks Webhook] Multi-channel notification failed:', notifErr);
            }

            actionMessage = 'New lead created successfully from Magicbricks.';
        }

        // Push Notifications
        const recipientUserId = assignedAgentId || profile.id;
        try {
            await sendPushNotification(
                recipientUserId,
                `🏠 New Magicbricks Lead: ${rawName}`,
                `${formattedPhone ? `Phone: ${formattedPhone} • ` : ''}${projectName ? `Project: ${projectName}` : 'Magicbricks Enquiry'}`,
                `/dashboard/crm/${savedLeadId || ''}`
            );
        } catch (e) {
            console.error('Failed to send push notification:', e);
        }

        // Trigger automated WhatsApp welcome drip campaign
        if (savedLeadId && (formattedPhone || cleanDigits)) {
            try {
                const { triggerWelcomeDrip } = await import('@/utils/whatsapp/drips');
                await triggerWelcomeDrip(
                    supabaseAdmin,
                    savedLeadId,
                    rawName,
                    formattedPhone || cleanDigits,
                    profile.id,
                    projectName ? `property on Magicbricks (${projectName})` : 'property on Magicbricks'
                );
            } catch (err) {
                console.error('[DRIP TRIGGER] Magicbricks lead welcome drip failed:', err);
            }
        }

        // Trigger automated Voice Dialing if enabled on profile
        if (savedLeadId && (formattedPhone || cleanDigits) && profile.auto_call_new_leads) {
            try {
                const { triggerOutboundCall } = await import('@/utils/voice-helper');
                await triggerOutboundCall(supabaseAdmin, savedLeadId, profile.id, true);
            } catch (err) {
                console.error('[AUTO CALL] Magicbricks auto voice call trigger failed:', err);
            }
        }

        return NextResponse.json({
            success: true,
            status: 'success',
            message: actionMessage,
            leadId: savedLeadId
        }, { status: 200 });

    } catch (err: any) {
        console.error('❌ [Magicbricks Webhook] Unexpected error:', err);
        return NextResponse.json({ error: err.message || 'Internal webhook error' }, { status: 500 });
    }
}
