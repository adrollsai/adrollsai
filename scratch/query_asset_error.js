const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const assetId = 'e10fa0af-1599-40fb-89aa-0d194e9adcef';
    console.log(`Querying Asset: ${assetId}`);

    const { data: asset, error: assetErr } = await supabase
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .single();

    if (assetErr) {
        console.error("Error:", assetErr);
        return;
    }

    console.log("Status:", asset.status);
    console.log("Metadata:", JSON.stringify(asset.metadata, null, 2));
}

run();
