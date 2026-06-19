const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const pageId2b03 = '182ecb26-0c53-4c32-8d07-2ca52125b6f7';
    const pageIdc890 = '40192996-31ef-437d-bf86-16802d599157';

    console.log(`Fetching restructured HTML from page ${pageIdc890}...`);
    const { data: pagec890, error: fetchErr } = await supabaseAdmin
        .from('landing_pages')
        .select('html_content')
        .eq('id', pageIdc890)
        .single();

    if (fetchErr) {
        console.error("Error fetching c890 page HTML:", fetchErr);
        return;
    }

    if (!pagec890 || !pagec890.html_content) {
        console.error("No HTML content found for page c890.");
        return;
    }

    console.log("Replacing user IDs and updating logo reference...");
    const updatedHtml = pagec890.html_content.replaceAll(
        'c890a11f-84ce-4592-ab8f-8682927b1a9d',
        '2b0312dc-c1fc-4798-ab1c-339939271229'
    );

    console.log(`Updating page ${pageId2b03} with the survey layout...`);
    const { error: updateErr } = await supabaseAdmin
        .from('landing_pages')
        .update({ html_content: updatedHtml })
        .eq('id', pageId2b03);

    if (updateErr) {
        console.error("Error updating page 2b03:", updateErr);
    } else {
        console.log("Successfully converted page 2b03 to survey layout!");
    }
}

run().catch(console.error);
