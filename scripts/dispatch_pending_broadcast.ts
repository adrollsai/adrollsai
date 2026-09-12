import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function dispatchPending() {
    const broadcastId = '76c3c2c6-17f2-4c4f-9b07-30432e09d503';
    console.log(`--- DISPATCHING PENDING RECIPIENTS FOR BROADCAST ${broadcastId} ---`);

    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

    if (!broadcast) {
        console.error('Broadcast not found');
        process.exit(1);
    }

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', broadcast.user_id)
        .single();

    if (!profile) {
        console.error('Profile not found');
        process.exit(1);
    }

    // Fetch pending recipients
    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');

    if (!recipients || recipients.length === 0) {
        console.log('No pending recipients found! All messages already processed.');
        await supabaseAdmin
            .from('whatsapp_broadcasts')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', broadcastId);
        process.exit(0);
    }

    console.log(`Found ${recipients.length} pending recipients. Fetching lead details...`);

    // Fetch leads in batches of 100
    const leadIds = recipients.map(r => r.lead_id).filter(Boolean);
    let leadsMap = new Map();
    for (let i = 0; i < leadIds.length; i += 100) {
        const batch = leadIds.slice(i, i + 100);
        const { data: bLeads } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone')
            .in('id', batch);
        if (bLeads) {
            for (const l of bLeads) leadsMap.set(l.id, l);
        }
    }

    const accessToken = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const templateName = 'anmol_plotting';
    const headerMediaUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/whatsapp_headers/2f62a259-f23b-48ee-a920-c436f36eaa4b/1789190583313-anmol.jpeg';

    let successCount = 0;
    let failCount = 0;
    let processed = 0;
    const total = recipients.length;

    console.log(`Starting concurrent dispatch (Concurrency: 6) for ${total} recipients...`);

    // Worker pool
    const CONCURRENCY = 6;
    let currIdx = 0;

    async function worker() {
        while (currIdx < recipients.length) {
            const index = currIdx++;
            const r = recipients[index];
            const lead = leadsMap.get(r.lead_id);

            let cleanPhone = (r.phone_number || lead?.phone || '').replace(/\D/g, '');
            if (!cleanPhone) {
                failCount++;
                continue;
            }
            if (cleanPhone.length === 10) {
                cleanPhone = '91' + cleanPhone;
            }

            const messagePayload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: 'en_US' },
                    components: [
                        {
                            type: 'header',
                            parameters: [
                                {
                                    type: 'image',
                                    image: { link: headerMediaUrl }
                                }
                            ]
                        }
                    ]
                }
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
                    console.error(`[${processed + 1}/${total}] ❌ Failed for ${cleanPhone}:`, metaData.error.message);
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ status: 'failed', error_message: metaData.error.message || 'Meta API error' })
                        .eq('id', r.id);
                } else {
                    successCount++;
                    const nowIso = new Date().toISOString();
                    await supabaseAdmin
                        .from('whatsapp_broadcast_recipients')
                        .update({ status: 'sent', sent_at: nowIso, error_message: null })
                        .eq('id', r.id);

                    // Sync to chat & message
                    try {
                        const recipientName = lead?.name || 'Prospect';
                        const summaryText = `Sent Template: ${templateName}`;

                        let { data: chat } = await supabaseAdmin
                            .from('whatsapp_chats')
                            .select('id')
                            .eq('user_id', broadcast.user_id)
                            .eq('recipient_phone', cleanPhone)
                            .maybeSingle();

                        if (!chat) {
                            const { data: newChat } = await supabaseAdmin
                                .from('whatsapp_chats')
                                .insert({
                                    user_id: broadcast.user_id,
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
                                    media_url: headerMediaUrl,
                                    media_type: 'image',
                                    created_at: nowIso
                                });
                        }
                    } catch (chatErr) {
                        // ignore secondary chat logging errors
                    }
                }
            } catch (err: any) {
                failCount++;
                console.error(`[${processed + 1}/${total}] ⚠️ Exception for ${cleanPhone}:`, err.message);
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ status: 'failed', error_message: err.message })
                    .eq('id', r.id);
            }

            processed++;
            if (processed % 25 === 0 || processed === total) {
                console.log(`[PROGRESS] ${processed}/${total} processed (${successCount} sent, ${failCount} failed)`);
            }

            // Small 40ms breather between requests on this worker
            await new Promise(res => setTimeout(res, 40));
        }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    console.log(`\n--- ALL PENDING RECIPIENTS FINISHED ---`);
    console.log(`Total Processed: ${processed}`);
    console.log(`Successfully Sent: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    // Mark broadcast complete
    await supabaseAdmin
        .from('whatsapp_broadcasts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', broadcastId);

    console.log(`Broadcast ${broadcastId} status marked as 'sent'.`);
    process.exit(0);
}

dispatchPending().catch(err => {
    console.error('Fatal dispatch error:', err);
    process.exit(1);
});
