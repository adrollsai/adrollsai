const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectNextFollowups() {
    console.log('--- INSPECTING EXISTING NEXT FOLLOWUPS IN DATABASE ---');

    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, user_id, assigned_to, next_followup, custom_fields')
        .not('next_followup', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

    console.log(`Found ${leads ? leads.length : 0} leads with active next_followup set:`);
    if (leads) {
        leads.forEach(l => {
            console.log(`Lead ID: ${l.id} (${l.name}) | next_followup DB: ${l.next_followup} | IST Display: ${new Date(l.next_followup).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}`);
        });
    }
}

inspectNextFollowups().catch(console.error);
