const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2';
    console.log(`=== RECENT VIDEO ASSETS FOR USER ${userId} ===`);
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'video')
        .order('created_at', { ascending: false })
        .limit(5);
    
    if (error) {
        console.error("Error fetching assets:", error);
        return;
    }
    console.log(JSON.stringify(assets, null, 2));
}

run().catch(console.error);
