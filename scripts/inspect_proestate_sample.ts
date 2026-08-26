import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function main() {
    const { data: sampleLeads } = await supabase
        .from('leads')
        .select('id, name, phone, email, source, notes, custom_fields, created_at')
        .eq('user_id', PROESTATE_USER_ID)
        .limit(10);

    console.log(`Sample leads for Pro Estate:`);
    sampleLeads?.forEach((l, i) => {
        console.log(`\n--- Lead ${i + 1} (${l.id}) ---`);
        console.log(`Name: ${l.name}, Phone: ${l.phone}, Source: ${l.source}`);
        console.log(`Created: ${l.created_at}`);
        console.log(`Custom Fields Type: ${typeof l.custom_fields}`);
        console.log(`Custom Fields:`, l.custom_fields);
    });
}

main().catch(console.error);
