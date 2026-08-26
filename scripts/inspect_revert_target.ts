import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function main() {
    // 1. Total leads for Pro Estate
    const { count: totalCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`Total leads for Pro Estate (${PROESTATE_USER_ID}): ${totalCount}`);

    // 2. Leads with custom_fields->imported_from = 'TeleCRM'
    const { count: telecrmCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', PROESTATE_USER_ID)
        .eq('custom_fields->>imported_from', 'TeleCRM');

    console.log(`Leads with imported_from == 'TeleCRM': ${telecrmCount}`);

    // 3. Other leads (not TeleCRM)
    const { data: nonTelecrmLeads, count: nonTelecrmCount } = await supabase
        .from('leads')
        .select('id, name, phone, email, source, created_at, custom_fields')
        .eq('user_id', PROESTATE_USER_ID)
        .or('custom_fields->>imported_from.neq.TeleCRM,custom_fields.is.null')
        .limit(20);

    console.log(`Non-TeleCRM leads count: ${nonTelecrmCount}`);
    console.log(`Sample non-TeleCRM leads:`, nonTelecrmLeads);
}

main().catch(console.error);
