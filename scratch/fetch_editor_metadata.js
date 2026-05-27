const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const originalAssetId = '548e73d6-ecd4-447f-bf7b-8caa168a9df7';
    console.log(`Fetching original asset metadata for: ${originalAssetId}`);
    
    const { data: asset, error } = await supabase
        .from('assets')
        .select('*')
        .eq('id', originalAssetId)
        .single();
        
    if (error) {
        console.error("Error fetching asset:", error);
    } else {
        console.log("=== Original Asset Loaded ===");
        console.log(`URL: ${asset.url}`);
        console.log(`Metadata Keys:`, Object.keys(asset.metadata || {}));
        console.log(`Captions Count:`, asset.metadata?.captions?.length || 0);
        console.log(`Effects Count:`, asset.metadata?.effects?.length || 0);
        console.log(`Metadata JSON:`, JSON.stringify(asset.metadata, null, 2));
    }
}

run();
