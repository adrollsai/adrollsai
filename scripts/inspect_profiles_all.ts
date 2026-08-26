import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const { data: profiles, error } = await supabase.from('profiles').select('*');
    if (error) {
        console.error('Error fetching profiles:', error);
        return;
    }
    console.log(`Found ${profiles?.length} profiles:`);
    for (const p of (profiles || [])) {
        const { count: leadCount } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', p.id);

        console.log(`- ${p.business_name || p.full_name || p.email} (${p.email}) [ID: ${p.id}] -> Leads: ${leadCount}`);
    }
}

main().catch(console.error);
