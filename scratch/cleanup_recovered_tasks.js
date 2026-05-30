const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const assetId = 'e10fa0af-1599-40fb-89aa-0d194e9adcef';
    console.log(`Deleting video task records for Asset ID: ${assetId}`);

    const { error } = await supabase
        .from('video_tasks')
        .delete()
        .eq('asset_id', assetId);

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log("Success! Task records deleted.");
}

run();
