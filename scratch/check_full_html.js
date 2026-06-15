const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: page, error } = await supabase.from('landing_pages').select('*').order('updated_at', { ascending: false }).limit(1).single();
    if (error) {
        console.error(error);
        return;
    }
    
    fs.writeFileSync('scratch/last_page.html', page.html_content);
    console.log("HTML successfully dumped to scratch/last_page.html");
}

run().catch(console.error);
