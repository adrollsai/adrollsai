const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLeads() {
    const parentUserId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, assigned_to, created_at')
        .eq('user_id', parentUserId)
        .order('created_at', { ascending: false })
        .limit(20);

    console.log('Recent 20 leads for parent:', JSON.stringify(leads, null, 2));
}

checkLeads().catch(console.error);
