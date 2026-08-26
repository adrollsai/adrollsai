import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    console.log('🔍 Analyzing duplicate leads across the database...');

    // Fetch all leads for Pro Estate
    const userId = '29937131-1975-4c5f-9b78-e5b28f918d32';
    
    // Paginated fetch of all leads for this user
    let allLeads: any[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, user_id, name, phone, email, created_at, facebook_created_at, custom_fields, notes, pipeline_stage')
            .eq('user_id', userId)
            .range(from, from + pageSize - 1)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Fetch error:', error);
            break;
        }
        allLeads.push(...(data || []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }

    console.log(`Fetched ${allLeads.length} leads for ProEstate.`);

    // Group leads by normalized phone number or email or telecrm_id
    const phoneGroups = new Map<string, any[]>();
    const emailGroups = new Map<string, any[]>();
    const telecrmGroups = new Map<string, any[]>();
    const nameGroups = new Map<string, any[]>();

    for (const lead of allLeads) {
        const phone = (lead.phone || '').replace(/\D/g, '').slice(-10);
        if (phone && phone.length === 10 && phone !== '0000000000' && phone !== '9999999999' && phone !== '1234567890') {
            if (!phoneGroups.has(phone)) phoneGroups.set(phone, []);
            phoneGroups.get(phone)!.push(lead);
        }

        const email = (lead.email || '').toLowerCase().trim();
        if (email && email !== '_' && email !== '-' && !email.includes('example.com') && email.includes('@')) {
            if (!emailGroups.has(email)) emailGroups.set(email, []);
            emailGroups.get(email)!.push(lead);
        }

        const cf = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields || '{}') : (lead.custom_fields || {});
        const telecrmId = cf.telecrm_lead_id;
        if (telecrmId && telecrmId !== '_') {
            if (!telecrmGroups.has(telecrmId)) telecrmGroups.set(telecrmId, []);
            telecrmGroups.get(telecrmId)!.push(lead);
        }
    }

    const duplicatePhoneGroups = Array.from(phoneGroups.entries()).filter(([_, list]) => list.length > 1);
    const duplicateEmailGroups = Array.from(emailGroups.entries()).filter(([_, list]) => list.length > 1);
    const duplicateTelecrmGroups = Array.from(telecrmGroups.entries()).filter(([_, list]) => list.length > 1);

    console.log(`\n📊 Duplicates Summary:`);
    console.log(`- Duplicate Phone numbers: ${duplicatePhoneGroups.length} groups`);
    console.log(`- Duplicate Emails: ${duplicateEmailGroups.length} groups`);
    console.log(`- Duplicate TeleCRM IDs: ${duplicateTelecrmGroups.length} groups`);

    let totalDuplicatesCount = 0;
    duplicatePhoneGroups.forEach(([p, list]) => {
        totalDuplicatesCount += (list.length - 1);
    });
    console.log(`Total duplicate records to clean based on Phone: ${totalDuplicatesCount}`);
}

main().catch(console.error);
