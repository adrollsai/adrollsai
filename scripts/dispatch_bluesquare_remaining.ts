import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runRemainingDispatch() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

    console.log(`\n======================================================`);
    console.log(`[DISPATCH RUNNER] Starting remaining sends for Blue Square...`);
    console.log(`Broadcast ID: ${broadcastId}`);
    console.log(`======================================================\n`);

    // 1. Fetch broadcast
    const { data: broadcast, error: bErr } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

    if (bErr || !broadcast) {
        console.error('Broadcast not found:', bErr);
        return;
    }

    // 2. Fetch profile
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    const accessToken = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const templateName = broadcast.template_name;

    console.log(`Using Phone ID: ${phoneId}, Template: ${templateName}`);

    // Verify template structure
    const templateLanguageCode = 'en_US';
    const templatePayload = {
        name: templateName,
        language: { code: templateLanguageCode },
        components: [
            {
                type: 'header',
                parameters: [
                    {
                        type: 'image',
                        image: {
                            link: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/templates/bc63c065-9bcc-4793-bedc-f0960406425b/webinar_thursday_official.png'
                        }
                    }
                ]
            }
        ]
    };

    // 3. Loop through pending recipients in chunks of 50
    let totalSentSession = 0;
    let totalFailedSession = 0;
    let keepRunning = true;

    while (keepRunning) {
        const { data: batch, error: rErr } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('id, lead_id, phone_number')
            .eq('broadcast_id', broadcastId)
            .eq('status', 'pending')
            .limit(100);

        if (rErr) {
            console.error('Error fetching pending batch:', rErr);
            break;
        }

        if (!batch || batch.length === 0) {
            console.log('🎉 No more pending recipients! Broadcast complete.');
            await supabaseAdmin
                .from('whatsapp_broadcasts')
                .update({ status: 'sent', sent_at: new Date().toISOString() })
                .eq('id', broadcastId);
            break;
        }

        console.log(`\n--- Processing batch of ${batch.length} recipients (Total Sent so far: ${totalSentSession}) ---`);

        // Fetch lead names
        const currentBatch = batch || [];
        const leadIds = currentBatch.map(r => r.lead_id).filter(Boolean);
        const { data: leads } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone')
            .in('id', leadIds);
        const leadMap = new Map((leads || []).map(l => [l.id, l]));

        // Process with controlled concurrency of 3
        const CONCURRENCY = 3;
        let batchIdx = 0;

        async function worker() {
            while (batchIdx < currentBatch.length && keepRunning) {
                const r = currentBatch[batchIdx++];
                if (!r) break;

                const lead = leadMap.get(r.lead_id);
                let cleanPhone = (r.phone_number || lead?.phone || '').replace(/\D/g, '');
                if (!cleanPhone) {
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ status: 'failed', error_message: 'Missing or empty phone number' })
                        .eq('id', r.id);
                    totalFailedSession++;
                    continue;
                }
                if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

                const messageBody = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanPhone,
                    type: 'template',
                    template: templatePayload
                };

                try {
                    const res = await fetch(metaUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(messageBody)
                    });

                    const data = await res.json();

                    if (data.error) {
                        const errCode = data.error.code;
                        const errMsg = data.error.message || '';

                        // Circuit breaker on payment or rate limit
                        if (errCode === 131042 || errMsg.includes('131042') || errMsg.includes('payment') || errCode === 429 || errCode === 130429) {
                            console.error(`\n🚨 CIRCUIT BREAKER TRIPPED! Meta Error ${errCode}: ${errMsg}`);
                            console.error(`Halting dispatch to prevent burning leads. Leaving remaining as pending.\n`);
                            await supabaseAdmin
                                .from('whatsapp_broadcasts')
                                .update({ status: 'paused' })
                                .eq('id', broadcastId);
                            keepRunning = false;
                            break;
                        }

                        // Lead-level failure (e.g. not on WhatsApp 131026)
                        await supabaseAdmin
                            .from('whatsapp_broadcast_recipients')
                            .update({ status: 'failed', error_message: errMsg })
                            .eq('id', r.id);
                        totalFailedSession++;
                        process.stdout.write('F');
                    } else {
                        // Success!
                        const nowIso = new Date().toISOString();
                        await supabaseAdmin
                            .from('whatsapp_broadcast_recipients')
                            .update({ status: 'sent', sent_at: nowIso, error_message: null })
                            .eq('id', r.id);
                        totalSentSession++;
                        process.stdout.write('.');

                        // Update chat log
                        try {
                            const recipientName = lead?.name || 'Prospect';
                            const summaryText = `Sent Template: ${templateName}`;

                            let { data: chat } = await supabaseAdmin
                                .from('whatsapp_chats')
                                .select('id')
                                .eq('user_id', userId)
                                .eq('recipient_phone', cleanPhone)
                                .maybeSingle();

                            if (!chat) {
                                const { data: newChat } = await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .insert({
                                        user_id: userId,
                                        recipient_phone: cleanPhone,
                                        recipient_name: recipientName,
                                        lead_id: lead?.id || null,
                                        last_message_text: summaryText,
                                        unread_count: 0,
                                        flow_answers: {},
                                        flow_completed: false,
                                        updated_at: nowIso
                                    })
                                    .select('id')
                                    .maybeSingle();
                                chat = newChat;
                            } else {
                                await supabaseAdmin
                                    .from('whatsapp_chats')
                                    .update({
                                        last_message_text: summaryText,
                                        recipient_name: recipientName,
                                        updated_at: nowIso
                                    })
                                    .eq('id', chat.id);
                            }

                            if (chat) {
                                await supabaseAdmin
                                    .from('whatsapp_messages')
                                    .insert({
                                        chat_id: chat.id,
                                        direction: 'outbound',
                                        message_text: summaryText,
                                        media_type: 'image',
                                        created_at: nowIso
                                    });
                            }
                        } catch (crmErr) {
                            // CRM log error ignored
                        }
                    }
                } catch (err: any) {
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ status: 'failed', error_message: err.message })
                        .eq('id', r.id);
                    totalFailedSession++;
                    process.stdout.write('E');
                }

                // 100ms throttle per worker = ~25 msgs/sec steady pace
                await new Promise(res => setTimeout(res, 100));
            }
        }

        const workers = Array.from({ length: CONCURRENCY }, () => worker());
        await Promise.all(workers);
        console.log(`\nBatch finished. Sent so far: ${totalSentSession}, Failed: ${totalFailedSession}`);

        // Small 500ms breather between batches
        await new Promise(res => setTimeout(res, 500));
    }

    console.log(`\n======================================================`);
    console.log(`[DISPATCH COMPLETE]`);
    console.log(`Total Sent in this session: ${totalSentSession}`);
    console.log(`Total Failed in this session: ${totalFailedSession}`);
    console.log(`======================================================\n`);
}

runRemainingDispatch().catch(console.error);
