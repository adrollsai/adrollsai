const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testFastWorkspaceLeads() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

    const { data: workspaceTeamProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`parent_id.eq.${ownerId},agency_id.eq.${ownerId},id.eq.${ownerId}`);

    const workspaceTeamIds = Array.from(new Set((workspaceTeamProfiles || []).map(p => p.id)));
    if (!workspaceTeamIds.includes(ownerId)) workspaceTeamIds.push(ownerId);

    console.log('Workspace Team IDs:', workspaceTeamIds);

    const startTime = Date.now();

    // Query 1: By user_id
    const q1 = supabaseAdmin
        .from('leads')
        .select('id, name, status, pipeline_stage, assigned_to, user_id, created_at')
        .in('user_id', workspaceTeamIds)
        .order('created_at', { ascending: false })
        .limit(2000);

    // Query 2: By assigned_to
    const q2 = supabaseAdmin
        .from('leads')
        .select('id, name, status, pipeline_stage, assigned_to, user_id, created_at')
        .in('assigned_to', workspaceTeamIds)
        .order('created_at', { ascending: false })
        .limit(2000);

    const [{ data: leads1, error: err1 }, { data: leads2, error: err2 }] = await Promise.all([q1, q2]);

    console.log(`Q1 by user_id returned: ${leads1 ? leads1.length : 0}, Error: ${err1 ? err1.message : 'none'}`);
    console.log(`Q2 by assigned_to returned: ${leads2 ? leads2.length : 0}, Error: ${err2 ? err2.message : 'none'}`);

    const leadMap = new Map();
    (leads1 || []).forEach(l => leadMap.set(l.id, l));
    (leads2 || []).forEach(l => leadMap.set(l.id, l));

    const totalLeads = Array.from(leadMap.values());
    console.log(`⚡ Combined Fast Workspace Leads: ${totalLeads.length} leads in ${Date.now() - startTime}ms!`);
}

testFastWorkspaceLeads().catch(console.error);
