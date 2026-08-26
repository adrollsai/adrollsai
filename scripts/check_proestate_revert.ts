import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function main() {
    console.log(`🔍 Scanning all leads for Pro Estate (${PROESTATE_USER_ID})...`);

    let allLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, name, phone, email, source, custom_fields, created_at')
            .eq('user_id', PROESTATE_USER_ID)
            .range(from, from + 999)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Fetch error:', error);
            break;
        }
        if (!data || data.length === 0) break;
        allLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    console.log(`📊 Total leads found in DB for Pro Estate: ${allLeads.length}`);

    const importedIds: string[] = [];
    const originalLeads: any[] = [];

    for (const l of allLeads) {
        let isImported = false;
        if (l.custom_fields) {
            const cfStr = typeof l.custom_fields === 'string' ? l.custom_fields : JSON.stringify(l.custom_fields);
            if (cfStr.includes('TeleCRM') || cfStr.includes('telecrm_lead_id')) {
                isImported = true;
            }
        }
        if (l.source === 'TeleCRM Import') {
            isImported = true;
        }

        if (isImported) {
            importedIds.push(l.id);
        } else {
            originalLeads.push(l);
        }
    }

    console.log(`\n📦 Summary:`);
    console.log(`  - TeleCRM Imported Leads to revert/delete: ${importedIds.length}`);
    console.log(`  - Original (Pre-existing) Leads to KEEP intact: ${originalLeads.length}`);

    console.log(`\nOriginal leads sample:`);
    originalLeads.slice(0, 10).forEach(l => {
        console.log(`  [KEEP] ${l.name} | ${l.phone} | ${l.source} | ${l.created_at}`);
    });
}

main().catch(console.error);
