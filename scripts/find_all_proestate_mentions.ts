import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    // Check if any leads in entire database mention proestate
    const { data: proLeads } = await supabase
        .from('leads')
        .select('id, name, phone, email, source, user_id, custom_fields, created_at')
        .or('source.ilike.%proestate%,campaign_name.ilike.%proestate%,ad_name.ilike.%proestate%,notes.ilike.%proestate%');

    console.log(`Leads with proestate in source/campaign/ad/notes (${proLeads?.length || 0}):`);
    proLeads?.forEach(l => {
        console.log(`- ${l.name} | ${l.phone} | User: ${l.user_id} | Source: ${l.source} | Created: ${l.created_at}`);
    });
}

main().catch(console.error);
