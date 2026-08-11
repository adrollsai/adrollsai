const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function testRLS() {
    console.log('--- TESTING ANON CLIENT ON LEADS TABLE ---');
    const { data, error } = await supabase.from('leads').select('*').limit(5);
    console.log('Anon data count:', data ? data.length : 0);
    console.log('Anon error:', error);
}

testRLS().catch(console.error);
