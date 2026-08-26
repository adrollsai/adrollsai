import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    console.log('--- ALL LEADS GROUPED BY USER_ID ---');
    const { data: leads, error } = await supabase
        .from('leads')
        .select('user_id, assigned_to');

    if (error) {
        console.error(error);
        return;
    }

    const userCount: Record<string, number> = {};
    const assignedCount: Record<string, number> = {};

    leads?.forEach(l => {
        const u = l.user_id || 'null';
        userCount[u] = (userCount[u] || 0) + 1;
        const a = l.assigned_to || 'unassigned';
        assignedCount[a] = (assignedCount[a] || 0) + 1;
    });

    console.log('By user_id:');
    for (const [uid, cnt] of Object.entries(userCount)) {
        const { data: p } = await supabase.from('profiles').select('email, business_name, full_name').eq('id', uid).maybeSingle();
        console.log(`  ${p?.business_name || p?.full_name || p?.email || 'Unknown'} (${uid}): ${cnt} leads`);
    }

    console.log('\nBy assigned_to:');
    for (const [aid, cnt] of Object.entries(assignedCount)) {
        const { data: p } = await supabase.from('profiles').select('email, business_name, full_name').eq('id', aid).maybeSingle();
        console.log(`  ${p?.business_name || p?.full_name || p?.email || 'Unassigned'} (${aid}): ${cnt} leads`);
    }
}

main().catch(console.error);
