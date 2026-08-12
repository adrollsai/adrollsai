const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectAllCounts() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

    const { data: teamProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, role')
        .or(`parent_id.eq.${ownerId},agency_id.eq.${ownerId},id.eq.${ownerId}`);

    console.log('--- LEADS COUNTS BY TEAM MEMBER IN DB ---');
    for (const p of (teamProfiles || [])) {
        const { count: assignedCount } = await supabaseAdmin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_to', p.id);

        const { count: ownedCount } = await supabaseAdmin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', p.id);

        console.log(`User: ${p.full_name || p.email} (${p.id}) | Role: ${p.role} | Assigned Leads: ${assignedCount} | User Owned Leads: ${ownedCount}`);
    }
}

inspectAllCounts().catch(console.error);
