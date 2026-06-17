const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com
    const targetPixelId = '1344722394272912'; // Adrolls Pixel

    console.log("=== Updating Page Pixels in DB ===");
    const { data: pages, error: fetchErr } = await supabaseAdmin
        .from('landing_pages')
        .select('id, slug, pixel_id')
        .eq('user_id', userId);

    if (fetchErr) {
        console.error("Error fetching pages:", fetchErr);
        return;
    }

    console.log("Found pages:", pages);

    for (const page of pages) {
        console.log(`Updating page ${page.slug} (${page.id}) to pixel ID: ${targetPixelId}`);
        const { error: updateErr } = await supabaseAdmin
            .from('landing_pages')
            .update({ pixel_id: targetPixelId })
            .eq('id', page.id);

        if (updateErr) {
            console.error(`Error updating page ${page.slug}:`, updateErr);
        } else {
            console.log(`✅ Successfully updated ${page.slug}`);
        }
    }

    // Also update the profile pixel_id just in case it was modified
    console.log(`Updating profile pixel_id to ${targetPixelId}...`);
    const { error: profileErr } = await supabaseAdmin
        .from('profiles')
        .update({ pixel_id: targetPixelId })
        .eq('id', userId);

    if (profileErr) {
        console.error("Error updating profile pixel:", profileErr);
    } else {
        console.log("✅ Successfully updated profile pixel ID.");
    }
}

run().catch(console.error);
