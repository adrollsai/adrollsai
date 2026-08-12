const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectTeamRoles() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

    const { data: teamProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, role, parent_id, agency_id')
        .or(`parent_id.eq.${ownerId},agency_id.eq.${ownerId},id.eq.${ownerId}`);

    console.log('Blue Square Infra Profiles in DB:', teamProfiles);
}

inspectTeamRoles().catch(console.error);
