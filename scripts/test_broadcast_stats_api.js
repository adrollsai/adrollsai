const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testApi() {
    const bId = '2997f5e6-18af-4d2f-abad-9da087b67178';
    
    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', bId)
        .single();

    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('broadcast_id', bId);

    console.log('Broadcast:', broadcast ? broadcast.title : null);
    console.log('Recipients count:', recipients ? recipients.length : 0);

    const total = recipients?.length || 0;
    const sent = recipients?.filter(r => r.status === 'sent').length || 0;
    console.log(`Stats -> Total: ${total}, Sent: ${sent}`);
}

testApi().catch(console.error);
