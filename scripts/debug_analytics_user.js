const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugUser() {
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra agency user
    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    console.log('Blue Square Profile:', profile);

    // Fetch team members linked to this profile or parent
    const { data: team } = await supabaseAdmin.from('profiles').select('id, email, role, parent_id, agency_id')
        .or(`agency_id.eq.${userId},parent_id.eq.${userId},id.eq.${userId}`);
    console.log('Team profiles count:', team ? team.length : 0);
    console.log('Team profiles:', team);

    const teamUserIds = team ? team.map(t => t.id) : [userId];

    // Fetch leads where user_id in teamUserIds or assigned_to in teamUserIds
    const { count } = await supabaseAdmin.from('leads').select('*', { count: 'exact', head: true })
        .or(`user_id.in.(${teamUserIds.join(',')}),assigned_to.in.(${teamUserIds.join(',')})`);
    console.log('Leads matching workspace team IDs count:', count);
}

debugUser().catch(console.error);
