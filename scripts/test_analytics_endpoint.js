const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testEndpointLogic() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

    const { data: myProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role, parent_id, agency_id, business_name, full_name, email')
        .eq('id', ownerId)
        .single();

    const myRole = myProfile?.role?.toLowerCase() || 'admin';
    const isTeamUser = myRole === 'agent' || myRole === 'team_member';
    let targetOwnerId = ownerId;

    let workspaceTeamIds = [targetOwnerId];
    const { data: workspaceTeamProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`parent_id.eq.${targetOwnerId},agency_id.eq.${targetOwnerId},id.eq.${targetOwnerId}`);

    if (workspaceTeamProfiles && workspaceTeamProfiles.length > 0) {
        workspaceTeamIds = Array.from(new Set(workspaceTeamProfiles.map(p => p.id)));
    }

    console.log('Role:', myRole, 'isTeamUser:', isTeamUser, 'TargetOwnerId:', targetOwnerId);
    console.log('Workspace Team IDs:', workspaceTeamIds);

    const workspaceOrConditions = workspaceTeamIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',');
    
    const { data: pageLeads, count: exactCount, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, status, assigned_to', { count: 'exact' })
        .or(workspaceOrConditions)
        .limit(10);

    console.log('API Lead Count Found:', exactCount, 'Error:', error);
    console.log('Sample leads fetched:', pageLeads ? pageLeads.length : 0);
}

testEndpointLogic().catch(console.error);
