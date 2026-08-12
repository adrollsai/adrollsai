const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testNewLeadsExtraction() {
    console.log('--- TESTING NEW LEADS REMARK EXTRACTION ---');

    const phones = ['+16239648955', '+919915771524', '+919418155558'];

    const extractLastRemark = (lead) => {
        let cf = lead.custom_fields;
        if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch (e) {}
        }

        let lastRemark = (cf?.last_followup_remark || '').trim();
        if (!lastRemark && cf?.opening_comments) {
            lastRemark = cf.opening_comments.trim();
        }
        if (!lastRemark && lead.notes && typeof lead.notes === 'string') {
            let cleaned = lead.notes.trim();
            if (cleaned.includes('[Last Remarks]:')) {
                cleaned = cleaned.split('[Last Remarks]:')[1]?.trim() || cleaned;
            }
            lastRemark = cleaned;
        }
        if (!lastRemark && lead.summary) lastRemark = lead.summary.trim();
        return lastRemark;
    };

    for (const phone of phones) {
        const { data: leads } = await supabaseAdmin
            .from('leads')
            .select('*')
            .ilike('phone', `%${phone.replace(/\D/g, '').slice(-10)}%`);

        if (leads && leads.length > 0) {
            const l = leads[0];
            const remark = extractLastRemark(l);
            console.log(`\n⚡ Lead: ${l.name} (${l.phone})`);
            console.log(`   Extracted Last Remark: "${remark}"`);
        }
    }
}

testNewLeadsExtraction().catch(console.error);
