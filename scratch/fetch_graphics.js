const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== FETCHING IMAGE ASSETS ===");
    const { data: assets, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('type', 'image')
        .limit(30);
        
    if (error) {
        console.error("Error:", error);
    } else {
        console.log(`Found ${assets.length} image assets:`);
        assets.forEach((a, idx) => {
            console.log(`${idx + 1}. URL: ${a.url || a.image_url}`);
        });
    }
}

run().catch(console.error);
