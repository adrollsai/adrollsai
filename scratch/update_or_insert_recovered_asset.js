const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing required credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function updateOrInsertAsset() {
    const targetUserId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    const failedAssetId = 'a06353d9-ab70-4355-be23-5e263d91cfad';
    const persistedUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/stitched_recovered_1779812071492.mp4';

    console.log(`Checking if asset ${failedAssetId} exists...`);
    const { data: existingAsset, error: fetchErr } = await supabase
        .from('assets')
        .select('*')
        .eq('id', failedAssetId)
        .maybeSingle();

    if (fetchErr) {
        console.error("Error fetching asset:", fetchErr);
        return;
    }

    if (existingAsset) {
        console.log("Asset exists. Updating status to Draft with R2 URL...");
        const { data, error } = await supabase
            .from('assets')
            .update({
                url: persistedUrl,
                status: 'Draft'
            })
            .eq('id', failedAssetId)
            .select()
            .single();

        if (error) {
            console.error("Error updating asset:", error);
        } else {
            console.log("Asset successfully updated!");
            console.log(JSON.stringify(data, null, 2));
        }
    } else {
        console.log("Asset does not exist (likely deleted by cleanup cron). Inserting a new Draft asset card...");
        const { data, error } = await supabase
            .from('assets')
            .insert({
                user_id: targetUserId,
                type: 'video',
                status: 'Draft',
                url: persistedUrl,
                caption: '🏡 Ananta Aspire Luxury Living ad for HOMCOM REALTORS. Sustainable organic eco-luxury green homes in Mohali!'
            })
            .select()
            .single();

        if (error) {
            console.error("Error inserting asset:", error);
        } else {
            console.log("New Draft asset successfully inserted!");
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

updateOrInsertAsset();
