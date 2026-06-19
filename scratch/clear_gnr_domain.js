const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const targetUserId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
    console.log(`Clearing custom domain for user: ${targetUserId}`);
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ 
            custom_domain: null,
            domain_verify_status: null,
            domain_verify_token: null
        })
        .eq('id', targetUserId)
        .select();
        
    if (error) {
        console.error("Update Error:", error);
    } else {
        console.log("Updated profile:", JSON.stringify(data, null, 2));
    }
}

run().catch(console.error);
