import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function analyzeBroadcast() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';

    // Group error messages
    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('status, error_message, sent_at')
        .eq('broadcast_id', broadcastId);

    const errorCounts: Record<string, number> = {};
    let minSentAt = null;
    let maxSentAt = null;
    let sentCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    for (const r of (recipients || [])) {
        if (r.status === 'sent') {
            sentCount++;
            if (!minSentAt || r.sent_at < minSentAt) minSentAt = r.sent_at;
            if (!maxSentAt || r.sent_at > maxSentAt) maxSentAt = r.sent_at;
        } else if (r.status === 'failed') {
            failedCount++;
            const err = r.error_message || 'UNKNOWN_ERROR';
            errorCounts[err] = (errorCounts[err] || 0) + 1;
        } else if (r.status === 'pending') {
            pendingCount++;
        }
    }

    console.log('Total recipients:', recipients?.length);
    console.log('Sent:', sentCount, 'between', minSentAt, 'and', maxSentAt);
    console.log('Pending:', pendingCount);
    console.log('Failed:', failedCount);
    console.log('Error breakdown:', errorCounts);

    // Also check current Meta phone number and WABA status for this account
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token')
        .eq('id', '2f62a259-f23b-48ee-a920-c436f36eaa4b')
        .single();

    if (profile?.whatsapp_phone_number_id && profile?.whatsapp_access_token) {
        // Check phone number details
        const phoneRes = await fetch(`https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,status,throughput`, {
            headers: { 'Authorization': `Bearer ${profile.whatsapp_access_token}` }
        });
        const phoneData = await phoneRes.json();
        console.log('\n--- META PHONE NUMBER STATUS ---');
        console.log(JSON.stringify(phoneData, null, 2));

        // Check WABA details
        if (profile.whatsapp_waba_id) {
            const wabaRes = await fetch(`https://graph.facebook.com/v20.0/${profile.whatsapp_waba_id}?fields=id,name,currency,timezone_id,account_review_status,message_template_namespace`, {
                headers: { 'Authorization': `Bearer ${profile.whatsapp_access_token}` }
            });
            const wabaData = await wabaRes.json();
            console.log('\n--- META WABA STATUS ---');
            console.log(JSON.stringify(wabaData, null, 2));
        }

        // Test sending a dry run / check template
        const tplRes = await fetch(`https://graph.facebook.com/v20.0/${profile.whatsapp_waba_id}/message_templates?name=anmol_avenu_wp_template`, {
            headers: { 'Authorization': `Bearer ${profile.whatsapp_access_token}` }
        });
        const tplData = await tplRes.json();
        console.log('\n--- TEMPLATE anmol_avenu_wp_template ---');
        console.log(JSON.stringify(tplData, null, 2));
    }
}

analyzeBroadcast().catch(console.error);
