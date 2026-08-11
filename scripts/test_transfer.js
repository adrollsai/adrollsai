const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testTransfer() {
    console.log('--- TESTING TRANSFER OF UNASSIGNED LEADS WITHOUT UPDATED_AT ---');
    const agentUserId = 'b1645a6d-4b73-41ef-a197-8247d0168905'; // nobogent@gmail.com
    const parentUserId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // Main account

    const { data: unassignedLeads } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, assigned_to')
        .eq('user_id', parentUserId)
        .is('assigned_to', null)
        .limit(2);

    console.log('Unassigned leads selected:', unassignedLeads);

    if (unassignedLeads && unassignedLeads.length >= 2) {
        const leadIds = unassignedLeads.map(l => l.id);
        
        const { error } = await supabaseAdmin
            .from('leads')
            .update({ assigned_to: agentUserId })
            .in('id', leadIds);

        console.log('Update Error:', error);

        const { data: agentLeads } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, assigned_to, user_id')
            .or(`assigned_to.eq.${agentUserId},user_id.eq.${agentUserId}`);

        console.log(`Verified total leads assigned to nobogent@gmail.com:`, agentLeads ? agentLeads.length : 0);
        console.log('Assigned leads detail:', agentLeads);
    }
}

testTransfer().catch(console.error);
