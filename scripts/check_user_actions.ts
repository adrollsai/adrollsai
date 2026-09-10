import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkUserActions() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';

    // Get leads for this user
    const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone')
        .eq('user_id', userId);

    console.log(`Total leads for rchopra: ${leads?.length}`);
    const leadIds = (leads || []).map(l => l.id);

    if (leadIds.length > 0) {
        // Check lead_history in the last 48 hours
        const { data: history } = await supabaseAdmin
            .from('lead_history')
            .select('*')
            .in('lead_id', leadIds.slice(0, 100))
            .order('created_at', { ascending: false })
            .limit(30);

        console.log('Recent lead history for rchopra leads:', history);
    }
}

checkUserActions().catch(console.error);
