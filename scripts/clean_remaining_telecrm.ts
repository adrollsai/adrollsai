import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function main() {
    console.log(`🧹 Cleaning up any remaining TeleCRM imported leads for Pro Estate...`);

    // Fetch all leads for Pro Estate
    const { data: allLeads, error } = await supabase
        .from('leads')
        .select('id, name, phone, email, source, custom_fields, created_at')
        .eq('user_id', PROESTATE_USER_ID);

    if (error) {
        console.error('Error fetching leads:', error);
        return;
    }

    console.log(`Total leads in DB right now: ${allLeads?.length || 0}`);

    const idsToDelete: string[] = [];
    const keptLeads: any[] = [];

    allLeads?.forEach(l => {
        const cfStr = typeof l.custom_fields === 'string' ? l.custom_fields : JSON.stringify(l.custom_fields || {});
        if (l.source === 'TeleCRM Import' || cfStr.includes('TeleCRM') || cfStr.includes('telecrm_lead_id')) {
            idsToDelete.push(l.id);
        } else {
            keptLeads.push(l);
        }
    });

    console.log(`Deleting ${idsToDelete.length} remaining TeleCRM leads...`);
    console.log(`Preserving ${keptLeads.length} original leads...`);

    if (idsToDelete.length > 0) {
        const { error: delErr } = await supabase
            .from('leads')
            .delete()
            .in('id', idsToDelete);

        if (delErr) {
            console.error('Delete error:', delErr);
        } else {
            console.log(`✅ Successfully deleted ${idsToDelete.length} leads.`);
        }
    }

    // Final verification
    const { data: finalLeads } = await supabase
        .from('leads')
        .select('id, name, phone, email, source, created_at')
        .eq('user_id', PROESTATE_USER_ID)
        .order('created_at', { ascending: false });

    console.log(`\n🎉 Final leads in Pro Estate account (${finalLeads?.length || 0}):`);
    finalLeads?.forEach((l, i) => {
        console.log(`  ${i + 1}. ${l.name} | ${l.phone} | ${l.source} | ${l.created_at}`);
    });
}

main().catch(console.error);
