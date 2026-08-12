const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testAnalyticsFullCount() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Bhavdeep Singh / Blue Square Infra

    console.log('--- TESTING ANALYTICS ENDPOINT DATA ---');
    const start = Date.now();

    const { data: workspaceTeamProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`parent_id.eq.${ownerId},agency_id.eq.${ownerId},id.eq.${ownerId}`);

    const workspaceTeamIds = Array.from(new Set((workspaceTeamProfiles || []).map(p => p.id)));

    let rawLeadsBatch = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    const workspaceOrConditions = workspaceTeamIds.flatMap(id => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',');

    while (hasMore && page < 20) {
        const { data: pageLeads } = await supabaseAdmin
            .from('leads')
            .select('id, name, created_at, user_id, assigned_to')
            .range(page * pageSize, (page + 1) * pageSize - 1)
            .or(workspaceOrConditions);

        if (!pageLeads || pageLeads.length === 0) {
            hasMore = false;
        } else {
            rawLeadsBatch = rawLeadsBatch.concat(pageLeads);
            page++;
            if (pageLeads.length < pageSize) hasMore = false;
        }
    }

    const leadMap = new Map();
    rawLeadsBatch.forEach(l => leadMap.set(l.id, l));

    const totalLeads = Array.from(leadMap.values());
    console.log(`⚡ Analytics Total Workspace Leads for Bhavdeep Singh: ${totalLeads.length} leads in ${Date.now() - start}ms!`);
}

testAnalyticsFullCount().catch(console.error);
