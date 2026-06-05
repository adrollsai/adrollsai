const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== GETTING HTML CONTENT ===");
    const { data: page, error } = await supabaseAdmin
        .from('landing_pages')
        .select('html_content')
        .eq('slug', 'adrolls-ai-for-smbs-8993')
        .single();
        
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("HTML length:", page.html_content.length);
        console.log("Contains form-container:", page.html_content.includes('qualification-form-container'));
    }
}

run().catch(console.error);
