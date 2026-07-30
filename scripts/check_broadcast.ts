import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBroadcastStatus() {
    console.log('--- CHECKING BROADCAST STATUS FOR BLUE SQUARE INFRA ---');

    // 1. Find profile
    const { data: profiles, error: pErr } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, business_name, whatsapp_phone_number, whatsapp_phone_number_id, whatsapp_access_token')
        .or('business_name.ilike.%bluesquare%,business_name.ilike.%blue square%,email.ilike.%bluesquare%,full_name.ilike.%bluesquare%');

    // Fetch Meta template info for investment_inquiry
    const profile = (profiles || []).find((p: any) => p.email === 'infobluesquareinfra@gmail.com');
    if (profile) {
        const wabaId = '1961706644524869'; // profile.whatsapp_waba_id
        const token = profile.whatsapp_access_token;
        const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=investment_inquiry`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        console.log('\n--- META TEMPLATE DETAILS FOR investment_inquiry ---');
        console.log(JSON.stringify(data, null, 2));
    }

    // 2. Fetch recent broadcasts
    const { data: broadcasts, error: bErr } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('\n--- RECENT BROADCASTS ---');
    console.log(JSON.stringify(broadcasts, null, 2));

    if (broadcasts && broadcasts.length > 0) {
        const latest = broadcasts[0];
        console.log('\n--- LATEST BROADCAST DETAILS ---');
        console.log(`ID: ${latest.id}`);
        console.log(`Title: ${latest.title}`);
        console.log(`Status: ${latest.status}`);
        console.log(`Template: ${latest.template_name}`);
        console.log(`Stage: ${latest.recipient_stage}`);
        console.log(`CSV Audience: ${latest.recipient_csv_audience}`);
        console.log(`Created At: ${latest.created_at}`);

        // Check recipients table
        const { count: totalR } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('id', { count: 'exact', head: true }).eq('broadcast_id', latest.id);
        const { count: sentR } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('id', { count: 'exact', head: true }).eq('broadcast_id', latest.id).eq('status', 'sent');
        const { count: failedR } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('id', { count: 'exact', head: true }).eq('broadcast_id', latest.id).eq('status', 'failed');
        const { count: pendingR } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('id', { count: 'exact', head: true }).eq('broadcast_id', latest.id).eq('status', 'pending');

        console.log(`\n--- RECIPIENTS BREAKDOWN FOR BROADCAST ${latest.id} ---`);
        console.log(`Total Recipients in Table: ${totalR}`);
        console.log(`Sent: ${sentR}`);
        console.log(`Failed: ${failedR}`);
        console.log(`Pending: ${pendingR}`);

        // Fetch sample failed reason if any
        if (failedR && failedR > 0) {
            const { data: failedSamples } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('phone_number, status, error_message').eq('broadcast_id', latest.id).eq('status', 'failed').limit(3);
            console.log('Sample Failed Recipients:', failedSamples);
        }
    }
}

checkBroadcastStatus().catch(console.error);
