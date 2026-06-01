const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const subId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
    console.log(`=== PROFILE FOR SUBACCOUNT: ${subId} ===`);
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', subId)
        .single();
        
    if (error) {
        console.error("Error:", error);
    } else {
        console.log(JSON.stringify(profile, null, 2));
    }
}

run().catch(console.error);
