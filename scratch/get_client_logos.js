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
        .select('id, email, business_name, logo_url');

    if (error) {
        console.error(error);
        return;
    }

    profiles.forEach(p => {
        if (p.logo_url && p.logo_url.trim() !== '') {
            console.log(`Business: ${p.business_name} | Email: ${p.email} | Logo: ${p.logo_url} | ID: ${p.id}`);
        }
    });
}

run().catch(console.error);
