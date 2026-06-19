const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const slug = 'test-adrolls-1592';
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const formId = 'b1c4d7e5-c16f-4b2c-90aa-0c685f4a85e5'; // Highland Mayfield with questions

    const { data: page, error: fetchErr } = await supabaseAdmin
        .from('landing_pages')
        .select('*')
        .eq('user_id', userId)
        .eq('slug', slug)
        .single();

    if (fetchErr) throw fetchErr;

    let html = page.html_content || '';
    
    // Inject the survey container if not exists or replace it
    if (html.includes('id="qualification-form-container"')) {
        // Replace existing one
        const containerRegex = /<div\s+[^>]*id="qualification-form-container"[^>]*>([\s\S]*?)<\/div>/gi;
        html = html.replace(containerRegex, '<div id="qualification-form-container" data-page-type="survey" data-button-text="Start Survey"></div>');
    } else {
        // Append inside body
        html = html.replace('</body>', '<div id="qualification-form-container" data-page-type="survey" data-button-text="Start Survey"></div></body>');
    }

    const { error: updateErr } = await supabaseAdmin
        .from('landing_pages')
        .update({
            html_content: html,
            form_id: formId
        })
        .eq('id', page.id);

    if (updateErr) throw updateErr;

    console.log(`Successfully converted landing page "${slug}" to survey type!`);
}

run().catch(console.error);
