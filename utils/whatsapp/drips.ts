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

        const flow = flows?.[0];
        if (!flow) {
            console.log('[DRIP TRIGGER] No active welcome flow found for campaign:', campaignName);
            return;
        }

        console.log(`[DRIP TRIGGER] Found active welcome flow: ${flow.title} (Template: ${flow.template_name})`);

        // Fetch owner's WhatsApp credentials
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, business_name')
            .eq('id', ownerId)
            .single();

        if (!profile || !profile.whatsapp_access_token || !profile.whatsapp_phone_number_id) {
            console.warn('[DRIP TRIGGER] Owner WhatsApp credentials not configured.');
            return;
        }

        const cleanPhone = leadPhone.replace(/\D/g, '');
        if (!cleanPhone) return;

        // Dynamic Variable Mapping Evaluation
        const mapping = flow.variables_mapping || {};
        const parameters: any[] = [];
        const maxVarIndex = 20; // safe limit for checking template params

        for (let i = 1; i <= maxVarIndex; i++) {
            const field = mapping[String(i)];
            if (!field) {
                // Backward-compatibility defaults if no mapping is saved
                if (i === 1) parameters.push({ type: 'text', text: leadName || 'Valued Lead' });
                else if (i === 2) parameters.push({ type: 'text', text: campaignName || 'General Campaign' });
                else if (i === 3) parameters.push({ type: 'text', text: profile.business_name || 'Adrolls Partner' });
                else break;
            } else {
                let resolvedText = '';
                if (field === 'lead_name') resolvedText = leadName || 'Valued Lead';
                else if (field === 'lead_phone') resolvedText = leadPhone;
                else if (field === 'campaign_name') resolvedText = campaignName || 'General Campaign';
                else if (field === 'company_name') resolvedText = profile.business_name || 'Adrolls Partner';
                else resolvedText = field; // custom text typed by user

                parameters.push({ type: 'text', text: resolvedText });
            }
        }

        const components: any[] = [
            {
                type: 'body',
                parameters
            }
        ];

        // Handle Image Header / Media Template support
        if (flow.header_media_url) {
            components.push({
                type: 'header',
                parameters: [
                    {
                        type: 'image',
                        image: {
                            link: flow.header_media_url
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
                name: flow.template_name || 'real_estate_welcome_1',
                language: { code: 'en_US' },
                components
            }
        };

        const metaUrl = `https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}/messages`;
        
        console.log(`[DRIP TRIGGER] Dispatching WhatsApp welcome message to ${cleanPhone}...`);
        const metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(messagePayload)
        });

        const metaData = await metaRes.json();
        if (metaData.error) {
            console.error('[DRIP TRIGGER] Meta API send failed:', metaData.error);
        } else {
            console.log(`[DRIP TRIGGER] WhatsApp welcome sent successfully: ${metaData.messages?.[0]?.id}`);
            // Insert lead activity log
            await supabaseAdmin.from('lead_history').insert({
                lead_id: leadId,
                action_type: 'REMARK',
                description: `💬 Automated WhatsApp welcome message dispatched: "${flow.template_name}"`
            });
        }
    } catch (err) {
        console.error('[DRIP TRIGGER] Error in triggerWelcomeDrip:', err);
    }
}
