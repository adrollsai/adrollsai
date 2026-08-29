import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BLUESQUARE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';

async function checkCrmHistory() {
    console.log('=== CHECKING CRM REMARKS LOGGED BY SHUBHA IN DB ===\n');

    // 1. Check lead_history entries authored by or mentioning Shubha
    const { data: shubhaHistories, error } = await supabase
        .from('lead_history')
        .select('*')
        .or(`user_id.eq.${SHUBHA_ID},description.ilike.%Shubha%`)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) console.error('Error fetching shubha histories:', error);

    const { count: totalShubhaHistories } = await supabase
        .from('lead_history')
        .select('id', { count: 'exact', head: true })
        .or(`user_id.eq.${SHUBHA_ID},description.ilike.%Shubha%`);

    console.log(`Total live CRM lead_history entries authored by or associated with Shubha: ${totalShubhaHistories}`);

    console.log('\nSample live CRM activity entries from Shubha:');
    shubhaHistories?.slice(0, 10).forEach((h, i) => {
        console.log(`  ${i + 1}. [${h.created_at}] Lead ID: ${h.lead_id} | Action: ${h.action_type || h.type} | Desc: ${h.description?.replace(/\n/g, ' ').substring(0, 120)}...`);
    });
}

checkCrmHistory().catch(console.error);
