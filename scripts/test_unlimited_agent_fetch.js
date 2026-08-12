const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testFetchAllLeads(userId, role) {
    const start = Date.now();
    const isTeamUser = role === 'agent' || role === 'team_member';

    let allLeads = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    let hasMore = true;

    while (hasMore && page < 15) { // up to 15,000 leads
        let query = supabaseAdmin
            .from('leads')
            .select('*')
            .order('created_at', { ascending: false })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (isTeamUser) {
            query = query.or(`assigned_to.eq.${userId},user_id.eq.${userId}`);
        } else {
            query = query.or(`user_id.eq.${userId},assigned_to.eq.${userId}`);
        }

        const { data: batch, error } = await query;
        if (error) {
            console.error('Fetch error:', error);
            break;
        }

        if (!batch || batch.length === 0) {
            hasMore = false;
        } else {
            allLeads = allLeads.concat(batch);
            page++;
            if (batch.length < PAGE_SIZE) hasMore = false;
        }
    }

    console.log(`⚡ Fetched ALL ${allLeads.length} leads for user ${userId} in ${Date.now() - start}ms!`);
}

async function run() {
    await testFetchAllLeads('7ce0408f-b03f-4af8-a32d-852b6c22da2a', 'agent'); // Harman (2,460 leads)
    await testFetchAllLeads('399b2252-ebd6-41c6-a70f-c46a005104c5', 'agent'); // Meghna (2,996 leads)
    await testFetchAllLeads('ac1d3d22-1c96-462f-b2b5-9bc26ada4bab', 'agent'); // Gunheer (36 leads)
    await testFetchAllLeads('d9c567eb-1b2d-43bc-bbbc-33e0b8d05e83', 'agent'); // Amish (17 leads)
}

run().catch(console.error);
