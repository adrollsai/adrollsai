require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const assetId = "fb9eb32d-1dc1-4b03-b334-beb07b3d72bb";

async function main() {
    const { data: asset, error } = await supabase
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .single();

    if (error) {
        console.error("Error fetching asset:", error);
    } else {
        console.log("Asset details:", {
            id: asset.id,
            status: asset.status,
            url: asset.url,
            updated_at: asset.updated_at,
            metadata: asset.metadata
        });
    }
}

main();
