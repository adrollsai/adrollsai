import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const userId = '29937131-1975-4c5f-9b78-e5b28f918d32';
    console.log(`🧹 Deduplicating leads for The ProEstate (${userId})...`);

    let allLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data } = await supabase
            .from('leads')
            .select('id, name, phone, email, notes, custom_fields, created_at')
            .eq('user_id', userId)
            .range(from, from + 999)
            .order('created_at', { ascending: false });

        if (!data || data.length === 0) break;
        allLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    console.log(`Loaded ${allLeads.length} leads.`);

    const idsToDelete = new Set<string>();

    // 1. Deduplicate by telecrm_lead_id
    const seenTelecrm = new Map<string, any>();
    for (const l of allLeads) {
        const cf = typeof l.custom_fields === 'string' ? JSON.parse(l.custom_fields || '{}') : (l.custom_fields || {});
        const tId = cf.telecrm_lead_id;
        if (tId && tId !== '_' && tId !== '-') {
            if (seenTelecrm.has(tId)) {
                // Keep the first (newest), mark this one for deletion
                idsToDelete.add(l.id);
            } else {
                seenTelecrm.set(tId, l);
            }
        }
    }

    // 2. Deduplicate by Email
    const seenEmail = new Map<string, any>();
    for (const l of allLeads) {
        if (idsToDelete.has(l.id)) continue;
        const email = (l.email || '').toLowerCase().trim();
        if (email && email.includes('@') && !email.includes('example.com')) {
            if (seenEmail.has(email)) {
                idsToDelete.add(l.id);
            } else {
                seenEmail.set(email, l);
            }
        }
    }

    // 3. Deduplicate by Exact Name + Phone
    const seenNamePhone = new Map<string, any>();
    for (const l of allLeads) {
        if (idsToDelete.has(l.id)) continue;
        const name = (l.name || '').toLowerCase().trim();
        const phone = (l.phone || '').trim();
        if (name && phone && name !== 'lead') {
            const key = `${name}___${phone}`;
            if (seenNamePhone.has(key)) {
                idsToDelete.add(l.id);
            } else {
                seenNamePhone.set(key, l);
            }
        }
    }

    console.log(`Found ${idsToDelete.size} duplicate leads to delete.`);

    const deleteList = Array.from(idsToDelete);
    const BATCH_SIZE = 200;
    let deletedCount = 0;

    for (let i = 0; i < deleteList.length; i += BATCH_SIZE) {
        const batch = deleteList.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
            .from('leads')
            .delete()
            .in('id', batch);

        if (error) {
            console.error(`Error deleting batch ${i}:`, error.message);
        } else {
            deletedCount += batch.length;
            process.stdout.write(`\rDeleted ${deletedCount}/${deleteList.length} duplicates...`);
        }
    }

    console.log(`\n\n🎉 Deduplication complete! Removed ${deletedCount} duplicate leads.`);
}

main().catch(console.error);
