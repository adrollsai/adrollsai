const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: page, error } = await supabaseAdmin
        .from('landing_pages')
        .select('html_content')
        .eq('slug', 'test-adrolls-1808')
        .single();
        
    if (error) {
        console.error("Error:", error);
    } else {
        const html = page.html_content;
        console.log("HTML length:", html.length);
        
        // Search for form container variations
        const matches = html.match(/<div[^>]*qualification-form-container[^>]*>([\s\S]*?)<\/div>/i) || html.match(/<div[^>]*id="qualification-form-container"[^>]*>/i);
        if (matches) {
            console.log("Found match:", matches[0]);
        } else {
            console.log("No container found matching 'qualification-form-container'");
        }
    }
}

run().catch(console.error);
