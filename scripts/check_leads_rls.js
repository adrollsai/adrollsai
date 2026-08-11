const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLeadsRLS() {
    console.log('--- CHECKING LEADS FOR NOBOGENT@GMAIL.COM ---');
    const agentUserId = 'b1645a6d-4b73-41ef-a197-8247d0168905'; // nobogent@gmail.com

    const { data: leadsForAgent, error } = await supabaseAdmin
        .from('leads')
        .select('*')
        .or(`assigned_to.eq.${agentUserId},user_id.eq.${agentUserId}`);

    console.log(`Error:`, error);
    console.log(`Leads returned by supabaseAdmin for agent (${agentUserId}):`, leadsForAgent ? leadsForAgent.length : 0);
    console.log('Leads detail:', JSON.stringify(leadsForAgent, null, 2));

    // Also check what leads exist for parent user
    const parentUserId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const { data: parentLeads } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, assigned_to, user_id')
        .eq('user_id', parentUserId);

    console.log(`Total leads for parent user (${parentUserId}):`, parentLeads ? parentLeads.length : 0);
    const assignedInParent = (parentLeads || []).filter(l => l.assigned_to === agentUserId);
    console.log(`Leads assigned to agent in parent's leads:`, assignedInParent.length, assignedInParent);
}

checkLeadsRLS().catch(console.error);
