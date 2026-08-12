const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectUserIds() {
    const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('id, user_id, assigned_to, name, created_at')
        .limit(30);

    console.log('Sample 30 leads:', leads);

    const userIds = Array.from(new Set(leads.map(l => l.user_id).filter(Boolean)));
    const assignedIds = Array.from(new Set(leads.map(l => l.assigned_to).filter(Boolean)));

    console.log('Unique user_ids in sample:', userIds);
    console.log('Unique assigned_to in sample:', assignedIds);

    const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, role')
        .in('id', [...userIds, ...assignedIds]);

    console.log('Matching profiles for sample leads:', profiles);
}

inspectUserIds().catch(console.error);
