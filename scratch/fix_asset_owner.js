require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const assetId = "5338f06d-cb97-42a1-bf9d-9d8dcafa1866";
const targetSubaccountId = "9bbf6e51-283e-48d1-bbb4-8dc546cc74b2";

async function run() {
    try {
        console.log(`Fixing asset ${assetId} owner. Changing to subaccount ${targetSubaccountId}...`);
        
        const { data: asset, error: fetchError } = await supabase
            .from('assets')
            .select('*')
            .eq('id', assetId)
            .single();

        if (fetchError || !asset) {
            console.error("Asset not found or fetch error:", fetchError);
            return;
        }

        console.log("Current asset details:", {
            id: asset.id,
            user_id: asset.user_id,
            url: asset.url
        });

        const { data: updatedAsset, error: updateError } = await supabase
            .from('assets')
            .update({
                user_id: targetSubaccountId
            })
            .eq('id', assetId)
            .select()
            .single();

        if (updateError) {
            throw updateError;
        }

        console.log("Successfully updated asset ownership in database!");
        console.log("New details:", {
            id: updatedAsset.id,
            user_id: updatedAsset.user_id,
            url: updatedAsset.url
        });
    } catch (e) {
        console.error("Error executing database update:", e);
    }
}

run();
