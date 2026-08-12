const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectNewLeadsRemarks() {
    console.log('--- INSPECTING NEW LEADS REMARKS IN SUPABASE ---');

    const phones = ['+16239648955', '+919915771524', '+919418155558'];

    for (const phone of phones) {
        const { data: leads } = await supabaseAdmin
            .from('leads')
            .select('*')
            .eq('phone', phone);

        if (leads && leads.length > 0) {
            const l = leads[0];
            console.log(`\nLead: ${l.name} (${l.phone})`);
            console.log('  notes:', l.notes);
            console.log('  summary:', l.summary);
            console.log('  custom_fields raw:', l.custom_fields);
        } else {
            console.log(`\nLead phone ${phone} not found directly, searching by clean 10-digit...`);
            const cleanP = phone.replace(/\D/g, '').slice(-10);
            const { data: leads2 } = await supabaseAdmin
                .from('leads')
                .select('*')
                .ilike('phone', `%${cleanP}%`);

            if (leads2 && leads2.length > 0) {
                const l = leads2[0];
                console.log(`  Found Lead: ${l.name} (${l.phone})`);
                console.log('    notes:', l.notes);
                console.log('    summary:', l.summary);
                console.log('    custom_fields:', l.custom_fields);
            }
        }
    }
}

inspectNewLeadsRemarks().catch(console.error);
