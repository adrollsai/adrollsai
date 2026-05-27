const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2';
    console.log(`=== ALL ASSETS FOR USER: ${userId} ===`);
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error("Error:", error);
    } else {
        console.log(`Found ${assets.length} assets:`);
        assets.forEach(a => {
            console.log(`- ID: ${a.id}, Created: ${a.created_at}, Type: ${a.type}, Status: ${a.status}, URL: ${a.url}`);
        });
    }
}

run().catch(console.error);
