import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function main() {
    console.log(`🧹 Removing any older duplicate TeleCRM records so only clean XLSX records remain...`);

    let allLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, name, phone, email, source, custom_fields, created_at')
            .eq('user_id', PROESTATE_USER_ID)
            .range(from, from + 999)
            .order('created_at', { ascending: false });

        if (!data || data.length === 0) break;
        allLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    console.log(`Total leads retrieved: ${allLeads.length}`);

    // If a phone number ends with 000000 (from previous exponential notation), mark for deletion!
    const idsToDelete = new Set<string>();
    const seenTelecrmId = new Map<string, string>();
    const seenPhone = new Map<string, string>();

    for (const l of allLeads) {
        // 1. If phone has exponential corrupted pattern (ends with 000000 or is shorter than 10 digits unless organic)
        if (l.source !== 'Facebook Ads' && l.source !== 'Facebook' && l.source !== 'WhatsApp Inbound') {
            if (l.phone && l.phone.endsWith('000000')) {
                idsToDelete.add(l.id);
                continue;
            }
        }

        // 2. Deduplicate by telecrm_lead_id (keep newest)
        let cf: any = l.custom_fields;
        if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
        }
        const tId = cf?.telecrm_lead_id;
        if (tId) {
            if (seenTelecrmId.has(tId)) {
                idsToDelete.add(l.id);
                continue;
            } else {
                seenTelecrmId.set(tId, l.id);
            }
        }

        // 3. Deduplicate by clean phone
        if (l.phone && l.phone.length >= 10) {
            if (seenPhone.has(l.phone)) {
                idsToDelete.add(l.id);
                continue;
            } else {
                seenPhone.set(l.phone, l.id);
            }
        }
    }

    console.log(`Identified ${idsToDelete.size} duplicate/old records to delete.`);

    const deleteList = Array.from(idsToDelete);
    const BATCH_SIZE = 250;
    let deletedCount = 0;

    for (let i = 0; i < deleteList.length; i += BATCH_SIZE) {
        const batch = deleteList.slice(i, i + BATCH_SIZE);
        await supabase.from('lead_history').delete().in('lead_id', batch);
        await supabase.from('leads').delete().in('id', batch);
        deletedCount += batch.length;
        process.stdout.write(`\rDeleted ${deletedCount}/${deleteList.length}...`);
    }

    console.log(`\n\n🎉 Cleanup Complete!`);

    // Final total
    const { count: finalTotal } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`🔒 Final Clean Total Leads for Pro Estate: ${finalTotal}`);

    // Sample check 10 leads to verify phone numbers are 100% clean
    const { data: sample } = await supabase
        .from('leads')
        .select('name, phone, email, source, pipeline_stage, created_at')
        .eq('user_id', PROESTATE_USER_ID)
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('\nSample 10 verified leads in CRM:');
    sample?.forEach((l, i) => {
        console.log(`  ${i + 1}. ${l.name} | Phone: ${l.phone} | Stage: ${l.pipeline_stage} | Source: ${l.source} | Date: ${l.created_at}`);
    });
}

main().catch(console.error);
