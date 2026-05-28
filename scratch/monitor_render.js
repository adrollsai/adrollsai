const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const TARGET_USER = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2';

async function monitor() {
    console.log(`=== Monitoring recent assets for user ${TARGET_USER} ===\n`);
    
    // Get recent assets for this user
    const { data: assets, error } = await supabase
        .from('assets')
        .select('id, status, type, url, created_at')
        .eq('user_id', TARGET_USER)
        .order('created_at', { ascending: false })
        .limit(5);
    
    if (error) {
        console.error("Error fetching assets:", error.message);
        return;
    }
    
    if (!assets || assets.length === 0) {
        console.log("No assets found for this user.");
        return;
    }
    
    for (const asset of assets) {
        console.log(`--- Asset: ${asset.id} ---`);
        console.log(`  Status:     ${asset.status}`);
        console.log(`  Type:       ${asset.type}`);
        console.log(`  URL:        ${asset.url ? asset.url.substring(0, 80) + '...' : 'None'}`);
        console.log(`  Created:    ${asset.created_at}`);
        console.log('');
    }
}

monitor().catch(console.error);
