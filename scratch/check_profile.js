const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const subId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d';
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
