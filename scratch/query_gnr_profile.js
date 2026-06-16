const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = "bc63c065-9bcc-4793-bedc-f0960406425b";
    console.log(`=== PROFILE FOR GNR HOMES (${userId}) ===`);
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('business_name, contact_number, role')
        .eq('id', userId)
        .single();
    console.log(JSON.stringify(profile, null, 2));
}

run().catch(console.error);
