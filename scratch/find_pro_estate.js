const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name');

    if (error) {
        console.error(error);
        return;
    }

    profiles.forEach(p => {
        if (/pro|estate/i.test(p.business_name || '') || /pro|estate/i.test(p.email || '')) {
            console.log(`FOUND: ${p.business_name} | ${p.email} | ${p.id}`);
        }
    });
}

run().catch(console.error);
