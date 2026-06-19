const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: page, error } = await supabaseAdmin
        .from('landing_pages')
        .select('html_content')
        .eq('id', '40192996-31ef-437d-bf86-16802d599157')
        .single();
        
    if (error) {
        console.error(error);
        return;
    }
    
    fs.writeFileSync('scratch/highland_mayfield_db.html', page.html_content);
    console.log("Wrote HTML file! Length:", page.html_content.length);
}

run().catch(console.error);
