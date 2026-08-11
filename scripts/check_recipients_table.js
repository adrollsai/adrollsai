const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTable() {
    const { data: cols, error: cErr } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .insert([{
            broadcast_id: '2997f5e6-18af-4d2f-abad-9da087b67178',
            lead_id: 'b9291aef-b101-4755-8cbb-a5263f0e00e2',
            user_id: '2f62a259-f23b-48ee-a920-c436f36eaa4b',
            phone_number: '+917087920923',
            status: 'sent',
            sent_at: new Date().toISOString()
        }])
        .select();

    console.log('Insert Result:', cols);
    console.log('Insert Error:', cErr);
}

checkTable().catch(console.error);
