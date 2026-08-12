const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testMonikaHistory() {
    console.log('--- TESTING MONIKA HISTORY REMARKS ---');

    const { data: monikaLeads } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('phone', '+919316479454');

    if (!monikaLeads || monikaLeads.length === 0) {
        console.log('Monika lead not found by exact phone, searching by name...');
        const { data: nameLeads } = await supabaseAdmin
            .from('leads')
            .select('*')
            .ilike('name', '%Monika%');
        console.log('Found leads matching Monika:', nameLeads);
        return;
    }

    const lead = monikaLeads[0];
    console.log('Found Monika Lead:', lead.id, lead.name, lead.phone);

    const { data: dbHistory } = await supabaseAdmin
        .from('lead_history')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false });

    console.log(`DB lead_history rows count: ${dbHistory ? dbHistory.length : 0}`);

    let cf = lead.custom_fields;
    if (typeof cf === 'string') {
        try { cf = JSON.parse(cf); } catch (e) {}
    }

    const lastRemark = (cf?.last_followup_remark || cf?.opening_comments || lead.notes || lead.summary || '').trim();
    console.log('Extracted Last Remark from Lead Data:', lastRemark);

    let items = dbHistory || [];
    if (lastRemark) {
        const exists = items.some(item => (item.description || '').includes(lastRemark));
        if (!exists) {
            items.push({
                id: 'synthetic_last_remark',
                lead_id: lead.id,
                action_type: 'LAST_FOLLOWUP_REMARK',
                description: lastRemark,
                actor_name: 'Agent',
                created_at: cf?.last_followup_at || lead.last_call_at || lead.created_at
            });
            items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        }
    }

    console.log(`⚡ Combined History Timeline Count: ${items.length} records`);
    console.log('Combined Timeline Entries:', items);
}

testMonikaHistory().catch(console.error);
