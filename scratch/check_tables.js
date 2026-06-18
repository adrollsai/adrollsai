const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Listing Tables ===");
    // We can query information_schema or run a simple query on common tables
    const tables = [
        'profiles',
        'inventories', 'inventory',
        'assets', 'media', 'videos', 'audios',
        'leads', 'crm_leads', 'contacts',
        'campaigns', 'ad_campaigns',
        'landing_pages', 'pages'
    ];

    for (const table of tables) {
        const { data, error } = await supabaseAdmin
            .from(table)
            .select('*')
            .limit(1);
        if (error) {
            console.log(`Table '${table}': NOT FOUND or ERROR (${error.message})`);
        } else {
            console.log(`Table '${table}': EXISTS (found ${data.length} records in limit 1)`);
        }
    }
}

run().catch(console.error);
