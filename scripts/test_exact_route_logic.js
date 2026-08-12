const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testExactRouteLogic() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra
    const start = Date.now();

    let query = supabaseAdmin
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .range(0, 999)
        .or(`user_id.eq.${ownerId},assigned_to.eq.${ownerId}`);

    const { data: leads, error } = await query;

    console.log(`⚡ Line 59 query fetched ${leads ? leads.length : 0} leads in ${Date.now() - start}ms! Error:`, error);
}

testExactRouteLogic().catch(console.error);
