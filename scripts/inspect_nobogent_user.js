const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectNobogentUser() {
    console.log('--- INSPECTING NOBOGENT@GMAIL.COM USER & PROFILE ---');
    
    // 1. Find profile for nobogent@gmail.com
    const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .ilike('email', '%nobogent%');

    console.log('Profiles matching nobogent:', profiles);

    if (profiles && profiles.length > 0) {
        for (const p of profiles) {
            console.log(`\nChecking assigned leads for profile: ${p.email} (ID: ${p.id}, Role: ${p.role}, Parent: ${p.parent_id}, Agency: ${p.agency_id})`);
            const { data: assignedLeads } = await supabaseAdmin
                .from('leads')
                .select('id, name, phone, assigned_to, user_id, created_at')
                .or(`assigned_to.eq.${p.id},user_id.eq.${p.id}`);

            console.log(`Leads assigned/owned by ${p.email}:`, assignedLeads);
        }
    }
}

inspectNobogentUser().catch(console.error);
