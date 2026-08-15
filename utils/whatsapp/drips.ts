import { createClient } from '@supabase/supabase-js'

export async function triggerWelcomeDrip(
    supabaseAdmin: any, 
    leadId: string, 
    leadName: string,
    leadPhone: string,
    ownerId: string, 
    campaignName: string
) {
    try {
        console.log(`[DRIP TRIGGER] Checking drip campaigns for owner: ${ownerId}, campaign: ${campaignName}`);

        // Find active welcome flows for this user
        // 1. Check for campaign-specific instant welcome flow
        let flowQuery = supabaseAdmin
            .from('whatsapp_flows')
            .select('*')
            .eq('user_id', ownerId)
            .eq('is_active', true)
            .eq('title', 'Instant Lead Welcome');

        if (campaignName && campaignName !== 'All') {
            flowQuery = flowQuery.eq('campaign_name', campaignName);
        } else {
            flowQuery = flowQuery.eq('campaign_name', 'All');
        }

        let { data: flows, error: flowsErr } = await flowQuery;

        // 2. Fallback to default/global ('All' campaigns) if campaign-specific isn't found
        if ((!flows || flows.length === 0) && campaignName && campaignName !== 'All') {
            const { data: globalFlows } = await supabaseAdmin
                .from('whatsapp_flows')
                .select('*')
                .eq('user_id', ownerId)
                .eq('is_active', true)
                .eq('title', 'Instant Lead Welcome')
                .eq('campaign_name', 'All');
            flows = globalFlows;
        }

        let flow = flows?.[0];
        if (!flow) {
            console.log('[DRIP TRIGGER] No custom welcome flow found. Using default Nobogent VSL Video Welcome flow.');
            flow = {
                title: 'Instant Lead Welcome',
                template_name: 'nobogent_vsl_system_welcome_v3',
                header_media_url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785757278763.mp4'
            };
        }

        console.log(`[DRIP TRIGGER] Active welcome flow: ${flow.title} (Template: ${flow.template_name})`);

        // Fetch owner's WhatsApp credentials
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name')
            .eq('id', ownerId)
            .single();

        const token = profile?.whatsapp_access_token || profile?.facebook_token;
        const phoneId = profile?.whatsapp_phone_number_id;

        if (!profile || !token || !phoneId) {
            console.warn('[DRIP TRIGGER] Owner WhatsApp credentials not configured.');
            return;
        }

        let cleanPhone = leadPhone.replace(/\D/g, '');
        if (cleanPhone.startsWith('00')) {
            cleanPhone = cleanPhone.substring(2);
        }
        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
            cleanPhone = '91' + cleanPhone.substring(1);
        }
        if (!cleanPhone) return;

        const mediaUrl = flow.header_media_url || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785757278763.mp4';
        const leadDisplayName = leadName || 'Valued Lead';

        const captionText = `Hey ${leadDisplayName}! 👋\n\nThank you for reaching out to ${profile.business_name || 'Nobogent AI'}! 🚀\n\nWatch the breakdown video above to see how our system automates client acquisition, lead qualification, and 24/7 sales engine for your business. 🎥✨\n\nBook a 1-on-1 strategy call with our team: https://app.nobogent.com/book/${ownerId}`;

        // PRIORITY 1: Free-Form Video Message
        try {
            console.log(`[DRIP TRIGGER] Attempting Priority 1: Free-Form Video Message to ${cleanPhone}...`);
            const ffPayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'video',
                video: {
                    link: mediaUrl,
                    caption: captionText
                }
            };

            const ffRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(ffPayload)
            });

            const ffData = await ffRes.json();
            if (ffRes.ok && ffData.messages?.[0]?.id) {
                console.log(`[DRIP TRIGGER] Free-Form video welcome message sent successfully: ${ffData.messages[0].id}`);
                await supabaseAdmin.from('lead_history').insert({
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `🎥 Free-Form Video Welcome message dispatched`
                });
                return;
            } else {
                console.warn('[DRIP TRIGGER] Free-Form video send failed/outside window, falling back to Template video:', ffData.error?.message || ffData);
            }
        } catch (ffErr) {
            console.warn('[DRIP TRIGGER] Free-Form video attempt threw error:', ffErr);
        }

        // PRIORITY 2: Template Video Message
        // Dynamic Variable Mapping Evaluation
        const mapping = flow.variables_mapping || {};
        const parameters: any[] = [];
        const maxVarIndex = 20;

        for (let i = 1; i <= maxVarIndex; i++) {
            const field = mapping[String(i)];
            if (!field) {
                if (i === 1) parameters.push({ type: 'text', text: leadDisplayName });
                else if (i === 2) parameters.push({ type: 'text', text: campaignName || 'General Campaign' });
                else if (i === 3) parameters.push({ type: 'text', text: profile.business_name || 'Nobogent Partner' });
                else break;
            } else {
                let resolvedText = '';
                if (field === 'lead_name') resolvedText = leadDisplayName;
                else if (field === 'lead_phone') resolvedText = leadPhone;
                else if (field === 'campaign_name') resolvedText = campaignName || 'General Campaign';
                else if (field === 'company_name') resolvedText = profile.business_name || 'Nobogent Partner';
                else resolvedText = field;

                parameters.push({ type: 'text', text: resolvedText });
            }
        }

        const components: any[] = [];
        if (flow.template_name !== 'hello_world') {
            components.push({
                type: 'body',
                parameters
            });
        }

        // Handle Media Header (Image, Video, Document) support
        if (mediaUrl) {
            const isVideo = mediaUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)/) || (flow.template_name && flow.template_name.includes('vsl')) || (flow.template_name && flow.template_name.includes('video'));
            const isDocument = mediaUrl.toLowerCase().match(/\.(pdf|doc|docx)/);
            const mediaType = isVideo ? 'video' : isDocument ? 'document' : 'image';

            components.push({
                type: 'header',
                parameters: [
                    {
                        type: mediaType,
                        [mediaType]: {
                            link: mediaUrl
                        }
                    }
                ]
            });
        }

        const messagePayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'template',
            template: {
                name: flow.template_name || 'nobogent_vsl_system_welcome_v3',
                language: { code: 'en_US' },
                components
            }
        };

        const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
        
        console.log(`[DRIP TRIGGER] Dispatching WhatsApp welcome template (${flow.template_name}) to ${cleanPhone}...`);
        const metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(messagePayload)
        });

        const metaData = await metaRes.json();
        if (metaData.error) {
            console.error('[DRIP TRIGGER] Meta API template send failed:', metaData.error);
        } else {
            console.log(`[DRIP TRIGGER] WhatsApp welcome template sent successfully: ${metaData.messages?.[0]?.id}`);
            await supabaseAdmin.from('lead_history').insert({
                lead_id: leadId,
                action_type: 'REMARK',
                description: `💬 Automated WhatsApp welcome template dispatched: "${flow.template_name}"`
            });
        }
    } catch (err) {
        console.error('[DRIP TRIGGER] Error in triggerWelcomeDrip:', err);
    }
}

export async function sendInstantFormCatalogMessage(
    supabaseAdmin: any,
    leadId: string,
    leadName: string,
    leadPhone: string,
    ownerId: string,
    campaignName?: string
) {
    try {
        console.log(`[INSTANT CATALOG WA] Dispatching instant form WhatsApp welcome template to lead: ${leadName} (${leadPhone}), owner: ${ownerId}`);

        // Fetch owner's WhatsApp credentials & Business profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name, custom_domain')
            .eq('id', ownerId)
            .maybeSingle();

        const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
        const phoneId = profile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;

        if (!token || !phoneId) {
            console.warn('[INSTANT CATALOG WA] Owner WhatsApp credentials not fully configured.');
            return;
        }

        let cleanPhone = leadPhone.replace(/\D/g, '');
        if (cleanPhone.startsWith('00')) {
            cleanPhone = cleanPhone.substring(2);
        }
        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
            cleanPhone = '91' + cleanPhone.substring(1);
        }
        if (!cleanPhone) return;

        const companyName = profile?.business_name || 'our company';
        const catalogUrlParam = ownerId;
        const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

        // 1. Try sending auto_lead_welcome (Utility category, highest deliverability)
        let messageSent = false;
        let sentMessageText = '';

        try {
            const welcomePayload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'template',
                template: {
                    name: 'auto_lead_welcome',
                    language: { code: 'en_US' },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                { type: 'text', text: leadName || 'Valued Client' },
                                { type: 'text', text: companyName },
                                { type: 'text', text: campaignName || 'our premium properties' }
                            ]
                        }
                    ]
                }
            };

            const autoRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(welcomePayload)
            });
            const autoData = await autoRes.json();
            if (autoRes.ok && autoData.messages?.[0]?.id) {
                messageSent = true;
                sentMessageText = `Hi ${leadName || 'Valued Client'}, thank you for reaching out to ${companyName}. We have received your inquiry regarding ${campaignName || 'our premium properties'} and our team will get back to you shortly. In the meantime, if you have any questions, feel free to reply directly to this message!`;
                console.log(`[INSTANT CATALOG WA] Sent 'auto_lead_welcome' to ${cleanPhone}: ${autoData.messages[0].id}`);
            } else {
                console.warn('[INSTANT CATALOG WA] auto_lead_welcome failed, trying instant_lead_catalog_welcome fallback:', autoData);
            }
        } catch (autoErr) {
            console.warn('[INSTANT CATALOG WA] auto_lead_welcome exception:', autoErr);
        }

        // 2. Fallback to instant_lead_catalog_welcome
        if (!messageSent) {
            const catalogPayload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'template',
                template: {
                    name: 'instant_lead_catalog_welcome',
                    language: { code: 'en_US' },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                { type: 'text', text: leadName || 'Valued Client' },
                                { type: 'text', text: companyName }
                            ]
                        },
                        {
                            type: 'button',
                            sub_type: 'url',
                            index: '0',
                            parameters: [
                                { type: 'text', text: catalogUrlParam }
                            ]
                        }
                    ]
                }
            };

            const metaRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(catalogPayload)
            });
            const metaData = await metaRes.json();
            if (metaRes.ok && metaData.messages?.[0]?.id) {
                messageSent = true;
                sentMessageText = `Hi ${leadName || 'Valued Client'}, thank you for showing interest in ${companyName}! We have received your inquiry. Click the button below to view our complete inventory catalog and current listings:`;
                console.log(`[INSTANT CATALOG WA] Sent 'instant_lead_catalog_welcome' to ${cleanPhone}: ${metaData.messages[0].id}`);
            } else {
                console.error('[INSTANT CATALOG WA] instant_lead_catalog_welcome also failed:', metaData);
            }
        }

        if (messageSent) {
            // Log to whatsapp_chats and whatsapp_messages
            try {
                let { data: existingChat } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .select('id')
                    .eq('user_id', ownerId)
                    .eq('recipient_phone', cleanPhone)
                    .maybeSingle();

                let chatId = existingChat?.id;
                if (!chatId) {
                    const { data: newChat } = await supabaseAdmin
                        .from('whatsapp_chats')
                        .insert({
                            user_id: ownerId,
                            recipient_phone: cleanPhone,
                            recipient_name: leadName || null,
                            lead_id: leadId || null,
                            last_message_text: sentMessageText,
                            unread_count: 0
                        })
                        .select('id')
                        .single();
                    chatId = newChat?.id;
                } else {
                    await supabaseAdmin
                        .from('whatsapp_chats')
                        .update({
                            last_message_text: sentMessageText,
                            lead_id: leadId || undefined,
                            recipient_name: leadName || undefined,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', chatId);
                }

                if (chatId) {
                    await supabaseAdmin
                        .from('whatsapp_messages')
                        .insert({
                            chat_id: chatId,
                            direction: 'outbound',
                            message_text: sentMessageText
                        });
                }
            } catch (chatLogErr) {
                console.error('[INSTANT CATALOG WA] Error logging welcome chat message:', chatLogErr);
            }

            await supabaseAdmin.from('lead_history').insert({
                lead_id: leadId,
                action_type: 'REMARK',
                description: `💬 Instant WhatsApp welcome message sent to lead`
            });
        }
    } catch (err: any) {
        console.error('[INSTANT CATALOG WA] Exception sending instant catalog message:', err);
    }
}
