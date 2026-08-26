import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function main() {
    console.log(`🚀 Starting Revert of TeleCRM imported leads for Pro Estate (${PROESTATE_USER_ID})...`);

    // 1. Fetch all leads for Pro Estate
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

    console.log(`📊 Total leads retrieved: ${allLeads.length}`);

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

    console.log(`Targeting ${importedIds.length} TeleCRM imported leads for deletion.`);
    console.log(`Preserving ${originalLeads.length} original pre-existing leads.`);

    if (importedIds.length === 0) {
        console.log('No imported leads found to delete.');
        return;
    }

    const BATCH_SIZE = 250;
    let deletedLeads = 0;
    let deletedHistory = 0;

    for (let i = 0; i < importedIds.length; i += BATCH_SIZE) {
        const batch = importedIds.slice(i, i + BATCH_SIZE);

        // Delete any lead_history entries associated with these leads
        const { error: histErr } = await supabase
            .from('lead_history')
            .delete()
            .in('lead_id', batch);

        if (histErr) {
            console.warn(`Warning deleting lead_history batch ${i}:`, histErr.message);
        }

        // Delete the leads
        const { error: leadErr } = await supabase
            .from('leads')
            .delete()
            .in('id', batch);

        if (leadErr) {
            console.error(`❌ Error deleting leads batch ${i}:`, leadErr.message);
        } else {
            deletedLeads += batch.length;
            const pct = Math.round((deletedLeads / importedIds.length) * 100);
            process.stdout.write(`\r⏳ Reverting Progress: ${deletedLeads}/${importedIds.length} leads deleted (${pct}%)...`);
        }
    }

    console.log(`\n\n🎉 Revert Complete!`);
    console.log(`✅ Successfully Deleted: ${deletedLeads} imported leads`);

    // Verify remaining count
    const { count: finalCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`🔒 Final Leads count in Pro Estate account: ${finalCount}`);

    const { data: remaining } = await supabase
        .from('leads')
        .select('id, name, phone, email, source, created_at')
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`Remaining leads list:`);
    remaining?.forEach((l, i) => {
        console.log(`  ${i + 1}. ${l.name} | ${l.phone} | ${l.source} | ${l.created_at}`);
    });
}

main().catch(console.error);
