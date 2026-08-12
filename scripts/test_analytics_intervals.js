const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testAnalyticsIntervals() {
    console.log('--- TESTING LEADERBOARD & ANALYTICS TIME INTERVAL FILTERING ---');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { count: todayCount } = await supabaseAdmin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart);

    const { count: sevenDaysCount } = await supabaseAdmin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo);

    const { count: allTimeCount } = await supabaseAdmin
        .from('leads')
        .select('*', { count: 'exact', head: true });

    console.log(`Leads Created Today: ${todayCount}`);
    console.log(`Leads Created Last 7 Days: ${sevenDaysCount}`);
    console.log(`Leads Created All-Time: ${allTimeCount}`);
}

testAnalyticsIntervals().catch(console.error);
