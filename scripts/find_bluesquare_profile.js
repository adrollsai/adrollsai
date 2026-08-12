const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findProfile() {
    const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, business_name, role, parent_id, agency_id')
        .or('business_name.ilike.%Blue Square%,email.ilike.%bluesquare%');

    console.log('Found Blue Square Profiles:', profiles);
}

findProfile().catch(console.error);
