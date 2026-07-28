import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function retryBroadcast() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    console.log(`--- RETRYING BROADCAST ${broadcastId} FOR BLUE SQUARE INFRA ---`);

    // Reset status of failed/pending recipients to pending
    const { error: resetErr } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .update({ status: 'pending', error_message: null })
        .eq('broadcast_id', broadcastId);

    if (resetErr) {
        console.error('Error resetting recipient status:', resetErr);
        return;
    }

    console.log('Reset recipient statuses to pending. Fetching broadcast details...');

    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

    if (!broadcast) return console.error('Broadcast not found');

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', broadcast.user_id)
        .single();

    if (!profile) return console.error('Profile not found');

    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('broadcast_id', broadcastId);

    if (!recipients || recipients.length === 0) return console.log('No recipients found');

    // Fetch leads in batches of 200
    const leadIds = recipients.map(r => r.lead_id).filter(Boolean);
    let leads: any[] = [];
    for (let i = 0; i < leadIds.length; i += 200) {
        const batch = leadIds.slice(i, i + 200);
        const { data: bLeads } = await supabaseAdmin.from('leads').select('*').in('id', batch);
        if (bLeads) leads = leads.concat(bLeads);
    }

    console.log(`Loaded ${leads.length} leads for ${recipients.length} recipients...`);

    const accessToken = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

    // Fetch template details to get exact language and parameter count
    let templateLanguageCode = 'en_US';
    let templateVarCount = 1;

    const wabaId = profile.whatsapp_waba_id;
    if (wabaId && accessToken) {
        const tplRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=${broadcast.template_name}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (tplRes.ok) {
            const tplData = await tplRes.json();
            const foundTpl = (tplData.data || []).find((t: any) => t.name === broadcast.template_name);
            if (foundTpl) {
                if (foundTpl.language) templateLanguageCode = foundTpl.language;
            }
        }
    }

    console.log(`Template: ${broadcast.template_name} | Language: ${templateLanguageCode} | Var Count: ${templateVarCount}`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const lead = (leads || []).find(l => l.id === r.lead_id);

        let cleanPhone = (r.phone_number || lead?.phone || '').replace(/\D/g, '');
        if (!cleanPhone) continue;
        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        }

        const recipientName = lead?.name || 'Valued Customer';
        const parameters = [
            { type: 'text', text: recipientName }
        ];

        const templatePayload: any = {
            name: broadcast.template_name,
            language: { code: templateLanguageCode },
            components: [
                {
                    type: 'body',
                    parameters
                }
            ]
        };

        const messagePayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'template',
            template: templatePayload
        };

        try {
            const metaRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(messagePayload)
            });

            const metaData = await metaRes.json();

            if (metaData.error) {
                failCount++;
                console.error(`[${i+1}/${recipients.length}] Failed to ${cleanPhone}:`, metaData.error.message);
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ status: 'failed', error_message: metaData.error.message || 'Meta API returned error' })
                    .eq('id', r.id);
            } else {
                successCount++;
                console.log(`[${i+1}/${recipients.length}] Sent to ${cleanPhone}! Msg ID: ${metaData.messages?.[0]?.id}`);
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ status: 'sent', sent_at: new Date().toISOString() })
                    .eq('id', r.id);
            }
        } catch (err: any) {
            failCount++;
            console.error(`[${i+1}/${recipients.length}] Error sending to ${cleanPhone}:`, err.message);
        }

        // Throttle slightly (40ms per send = ~25 msg/sec)
        await new Promise(resolve => setTimeout(resolve, 40));
    }

    console.log(`\n--- RETRY COMPLETE ---`);
    console.log(`Successfully Sent: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    await supabaseAdmin
        .from('whatsapp_broadcasts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', broadcastId);
}

retryBroadcast().catch(console.error);
