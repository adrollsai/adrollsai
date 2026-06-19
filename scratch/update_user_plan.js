const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const targetUserId = '29937131-1975-4c5f-9b78-e5b28f918d32';
    console.log(`Updating subscription plan to growth for user: ${targetUserId}`);
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ subscription_plan: 'growth' })
        .eq('id', targetUserId)
        .select();
        
    if (error) {
        console.error("Update Error:", error);
    } else {
        console.log("Updated profile:", JSON.stringify(data, null, 2));
    }
}

run().catch(console.error);
