const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testActionManagerFiltering() {
    const harmanId = '7ce0408f-b03f-4af8-a32d-852b6c22da2a'; // Harman

    const { data: harmanLeads } = await supabaseAdmin
        .from('leads')
        .select('id, name, status, pipeline_stage, next_followup, custom_fields')
        .or(`assigned_to.eq.${harmanId},user_id.eq.${harmanId}`);

    console.log(`Total Harman leads in DB: ${harmanLeads.length}`);

    const isLostOrClosed = (status, stage, clientSt) => {
        const s = ((status || '') + ' ' + (stage || '') + ' ' + (clientSt || '')).toLowerCase().trim();
        return (
            s.includes('lost') ||
            s.includes('ni') ||
            s.includes('not interested') ||
            s.includes('junk') ||
            s.includes('unqualified') ||
            s.includes('closed') ||
            s.includes('deal/token') ||
            s.includes('won')
        );
    };

    const activeActionLeads = (harmanLeads || []).filter(l => {
        let cf = l.custom_fields;
        if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch (e) {}
        }
        if (isLostOrClosed(l.status, l.pipeline_stage, cf?.client_status)) return false;
        return !!(l.next_followup || cf?.next_action_date);
    });

    console.log(`⚡ Active Action Manager leads for Harman (excluding Lost/NI): ${activeActionLeads.length}`);
    console.log('Sample Active Action Leads:', activeActionLeads.slice(0, 3));
}

testActionManagerFiltering().catch(console.error);
