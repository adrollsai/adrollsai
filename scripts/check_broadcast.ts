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

    console.log('Matched Profiles:', profiles);

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

        // Check leads count matching this user / filters
        let leadQ = supabaseAdmin.from('leads').select('id, name, phone, csv_audience, pipeline_stage', { count: 'exact' }).eq('user_id', latest.user_id);
        if (latest.recipient_csv_audience) {
            leadQ = leadQ.eq('csv_audience', latest.recipient_csv_audience);
        }
        const { count, data: sampleLeads } = await leadQ.limit(5);
        console.log(`\nTargeted Matching Leads Count: ${count}`);
        console.log('Sample Leads:', sampleLeads);

        // Check outbound messages created for this chat / broadcast
        const { count: msgCount } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('id', { count: 'exact', head: true })
            .ilike('message_text', `%${latest.template_name}%`);

        console.log(`Messages logged for template '${latest.template_name}': ${msgCount}`);
    }
}

checkBroadcastStatus().catch(console.error);
