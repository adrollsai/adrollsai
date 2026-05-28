const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== SCANNING FOR ALL STUCK 'Rendering' ASSETS ===");
    
    const { data: stuckAssets, error: fetchError } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('status', 'Rendering');
        
    if (fetchError) {
        console.error("Failed to query stuck assets:", fetchError.message);
        return;
    }
    
    if (!stuckAssets || stuckAssets.length === 0) {
        console.log("No stuck assets in 'Rendering' status found! DB is clean.");
        return;
    }
    
    console.log(`Found ${stuckAssets.length} stuck asset(s). Updating all to 'Failed'...`);
    
    for (const asset of stuckAssets) {
        console.log(`Recovering Asset: ${asset.id} (User: ${asset.user_id})`);
        const { error: updateError } = await supabaseAdmin
            .from('assets')
            .update({ status: 'Failed' })
            .eq('id', asset.id);
            
        if (updateError) {
            console.error(`Failed to update asset ${asset.id}:`, updateError.message);
        } else {
            console.log(`Asset ${asset.id} successfully updated to 'Failed'.`);
        }
    }
    
    console.log("=== DB RECOVERY COMPLETED ===");
}

run().catch(console.error);
