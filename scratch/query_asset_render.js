const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const id = "c2eafc61-0dce-4421-a614-adb7e6090966";
    console.log(`=== SPECIFIC ASSET INFO (${id}) ===`);
    const { data: asset, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        console.error("Error:", error.message);
    } else {
        console.log(JSON.stringify(asset, null, 2));
    }
}

run().catch(console.error);
