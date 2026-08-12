const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testBlueSquareLeads() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

    // Fetch team members
    const { data: teamProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`parent_id.eq.${ownerId},agency_id.eq.${ownerId},id.eq.${ownerId}`);

    const teamIds = teamProfiles ? Array.from(new Set(teamProfiles.map(p => p.id))) : [ownerId];
    console.log('Team IDs for Blue Square Infra:', teamIds);

    // Old Way: eq('user_id', ownerId)
    const { data: oldLeads, error: oldErr } = await supabaseAdmin
        .from('leads')
        .select('id')
        .eq('user_id', ownerId);

    console.log('Old Query Count (user_id = ownerId):', oldLeads ? oldLeads.length : 0, 'Error:', oldErr);

    // Correct Workspace Way: Build OR list of eq conditions
    const orConditions = [];
    teamIds.forEach(id => {
        orConditions.push(`user_id.eq.${id}`);
        orConditions.push(`assigned_to.eq.${id}`);
    });

    const { data: workspaceLeads, error: wsErr } = await supabaseAdmin
        .from('leads')
        .select('id')
        .or(orConditions.join(','));

    console.log('Correct Workspace Query Count:', workspaceLeads ? workspaceLeads.length : 0, 'Error:', wsErr);
}

testBlueSquareLeads().catch(console.error);
