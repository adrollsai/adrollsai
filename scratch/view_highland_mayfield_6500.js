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
        .eq('slug', 'highland-mayfield-6500')
        .single();

    if (error) {
        console.error(error);
        return;
    }

    console.log("=== HTML CONTENT ===");
    console.log(page.html_content);
}

run().catch(console.error);
