const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const subAccountId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d';
    const slug = 'highland-mayfield-4167';
    
    console.log("=== STEP 1: Updating pixel_id to '1039854950770272' for page in DB ===");
    const { error: updateErr } = await supabaseAdmin
        .from('landing_pages')
        .update({ pixel_id: '1039854950770272' })
        .eq('user_id', subAccountId)
        .eq('slug', slug);

    if (updateErr) {
        console.error("Failed to update page pixel:", updateErr.message);
        return;
    }
    console.log("Successfully set page pixel to '1039854950770272' in DB!");

    console.log("\n=== STEP 2: Fetching page HTML from local server ===");
    try {
        const url = `http://localhost:3000/shared/${subAccountId}/${slug}`;
        console.log(`Sending GET request to: ${url}`);
        const res = await fetch(url);
        const html = await res.text();
        
        console.log(`HTTP Status: ${res.status}`);
        
        // Find if fbq('init', ...) is present and inspect its value
        const fbqInitMatch = html.match(/fbq\('init',\s*'([0-9]+)'\)/);
        if (fbqInitMatch) {
            console.log(`\n🎉 Success! Found initialized pixel ID: ${fbqInitMatch[1]}`);
            if (fbqInitMatch[1] === '1039854950770272') {
                console.log("MATCH SUCCESS: The custom pixel was correctly initialized!");
            } else {
                console.log("MATCH MISMATCH: The pixel ID does not match the custom pixel!");
            }
        } else {
            console.log("\n❌ Did not find fbq('init', ...) in the fetched HTML.");
        }

        // Check CAPI proxy body parameter
        const capiMatch = html.match(/pixelId:\s*'([0-9]+)'/);
        if (capiMatch) {
            console.log(`🎉 Success! Found proxy CAPI pixel ID: ${capiMatch[1]}`);
        } else {
            console.log("❌ Did not find pixelId parameter in proxy CAPI fetch.");
        }
    } catch (e) {
        console.error("Failed to fetch from local server:", e.message);
        console.log("Make sure npm run dev is running on port 3000.");
    }
}

run().catch(console.error);
