const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testQuerySpeed() {
    console.log('--- TESTING SIMPLE LEADS QUERY SPEED ---');

    // Test 1: Simple select limit 500 without order
    const t1 = Date.now();
    const { data: d1, error: e1 } = await supabaseAdmin.from('leads').select('id, name, user_id, assigned_to, status, pipeline_stage, created_at').limit(500);
    console.log(`Test 1 (limit 500 no order): ${d1 ? d1.length : 0} leads in ${Date.now() - t1}ms! Error:`, e1);

    // Test 2: Filter by user_id limit 500 no order
    const t2 = Date.now();
    const { data: d2, error: e2 } = await supabaseAdmin.from('leads').select('id, name, user_id, assigned_to, status, pipeline_stage, created_at').eq('user_id', '2f62a259-f23b-48ee-a920-c436f36eaa4b').limit(500);
    console.log(`Test 2 (eq user_id limit 500 no order): ${d2 ? d2.length : 0} leads in ${Date.now() - t2}ms! Error:`, e2);

    // Test 3: Check sample lead user_ids and assigned_to in database
    const { data: sampleLeads } = await supabaseAdmin.from('leads').select('id, user_id, assigned_to, name, created_at').limit(10);
    console.log('Sample 10 leads from DB:', sampleLeads);
}

testQuerySpeed().catch(console.error);
