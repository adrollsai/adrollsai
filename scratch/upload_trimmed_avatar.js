require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = "9bbf6e51-283e-48d1-bbb4-8dc546cc74b2";
const trimmedR2Url = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/trimmed_ref_v2_b2d0b65b1c3c7614719f247dc2e52f54.mp4";

async function run() {
    try {
        console.log("1. Downloading trimmed video from R2...");
        const res = await fetch(trimmedR2Url);
        if (!res.ok) {
            throw new Error(`Failed to download trimmed video from R2: ${res.statusText}`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        console.log(`Downloaded ${buffer.length} bytes.`);

        const timestamp = Date.now();
        const fileName = `character-${userId}-${timestamp}-trimmed.mp4`;
        console.log(`2. Uploading to Supabase Storage logos bucket as: ${fileName}`);
        
        const { data: uploadData, error: uploadError } = await supabase
            .storage
            .from('logos')
            .upload(fileName, buffer, {
                contentType: 'video/mp4',
                upsert: true
            });

        if (uploadError) {
            throw uploadError;
        }

        console.log("Upload successful:", uploadData);

        console.log("3. Fetching public URL...");
        const { data: { publicUrl } } = supabase
            .storage
            .from('logos')
            .getPublicUrl(fileName);

        console.log("Public URL:", publicUrl);

        console.log("4. Updating profiles table in database...");
        const { data: updatedProfile, error: updateError } = await supabase
            .from('profiles')
            .update({
                character_url: publicUrl
            })
            .eq('id', userId)
            .select()
            .single();

        if (updateError) {
            throw updateError;
        }

        console.log("Successfully updated subaccount profile character_url!");
        console.log("- New character_url:", updatedProfile.character_url);
    } catch (e) {
        console.error("Error running script:", e);
    }
}

run();
