const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

    console.log('--- FETCHING BLUE SQUARE INFRA LEADS & CHATS ---');
    
    // Check leads
    const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, created_at, source, ad_name, pipeline_stage')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

    console.log(`Fetched ${leads ? leads.length : 0} sample leads for Blue Square Infra`);
    if (leads && leads.length > 0) {
        console.log('Sample leads:', leads.slice(0, 5));
    }

    // Check chats
    const { data: chats } = await supabaseAdmin
        .from('whatsapp_chats')
        .select('id, recipient_phone, recipient_name, updated_at, last_message_text')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(50);

    console.log(`Fetched ${chats ? chats.length : 0} chats for Blue Square Infra`);
    if (chats && chats.length > 0) {
        console.log('Sample chats:', chats.slice(0, 5));
    }
}

run().catch(console.error);
