const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const stuckAssetId = '33fb42c1-9015-4217-b9d9-b0e70893ee29';
    console.log(`=== RECOVERING STUCK ASSET: ${stuckAssetId} ===`);
    
    // Check if asset exists and current status
    const { data: asset, error: fetchError } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', stuckAssetId)
        .single();
        
    if (fetchError || !asset) {
        console.error("Asset not found:", fetchError?.message || "Not found");
        return;
    }
    
    console.log(`Current status: ${asset.status}`);
    
    if (asset.status === 'Rendering') {
        console.log("Updating status to 'Failed' so the user can re-trigger it...");
        const { data: updated, error: updateError } = await supabaseAdmin
            .from('assets')
            .update({ status: 'Failed' })
            .eq('id', stuckAssetId)
            .select()
            .single();
            
        if (updateError) {
            console.error("Update failed:", updateError.message);
        } else {
            console.log("Asset recovered successfully! New status:", updated.status);
        }
    } else {
        console.log("Asset is not in 'Rendering' status. No recovery needed.");
    }
}

run().catch(console.error);
