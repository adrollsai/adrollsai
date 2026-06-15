const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: page, error } = await supabase.from('landing_pages').select('html_content').order('updated_at', { ascending: false }).limit(1).single();
    if (error) {
        console.error(error);
        return;
    }
    
    // Find all <style> blocks
    const styleBlocks = page.html_content.match(/<style[\s\S]*?<\/style>/gi);
    console.log("=== STYLE BLOCKS ===");
    if (styleBlocks) {
        styleBlocks.forEach((block, i) => {
            console.log(`Block ${i + 1}:`);
            console.log(block);
        });
    } else {
        console.log("No style blocks found.");
    }

    // Check for button overrides or qualification-form-container attributes
    console.log("\n=== FORM CONTAINER ATTRIBUTES ===");
    const match = page.html_content.match(/<div[^>]*id="qualification-form-container"[^>]*>[\s\S]*?<\/div>/i) || page.html_content.match(/<div[^>]*id="qualification-form-container"[^>]*>/i);
    console.log(match ? match[0] : "Not found");
}

run().catch(console.error);
