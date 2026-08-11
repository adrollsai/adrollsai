const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log('--- ALL BROADCASTS IN WHATSAPP_BROADCASTS ---');
    const { data: broadcasts } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*');

    console.log('Total broadcasts:', broadcasts ? broadcasts.length : 0);
    console.log('Broadcasts:', JSON.stringify(broadcasts, null, 2));
}

run().catch(console.error);
