import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    // 1. Fetch all profiles
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, full_name, business_name, role, team_owner_id, parent_id');

    console.log('=== ALL PROFILES ===');
    for (const p of (profiles || [])) {
        const { count: leadCount } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', p.id);

        const { count: assignedCount } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_to', p.id);

        console.log(`Profile: ${p.business_name || p.full_name || p.email} (${p.id})`);
        console.log(`  Email: ${p.email} | Role: ${p.role}`);
        console.log(`  user_id leads: ${leadCount} | assigned_to leads: ${assignedCount}`);
    }

    // 2. Check total leads in DB
    const { count: totalDbLeads } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true });

    console.log(`\n=== TOTAL LEADS IN ENTIRE DATABASE: ${totalDbLeads} ===`);

    // 3. Check lead_history counts
    const { count: totalHistory } = await supabase
        .from('lead_history')
        .select('*', { count: 'exact', head: true });

    console.log(`Total lead_history entries in DB: ${totalHistory}`);
}

main().catch(console.error);
