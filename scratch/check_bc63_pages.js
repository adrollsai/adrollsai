const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const { data, error } = await supabase
        .from('landing_pages')
        .select('id, user_id, slug, product_name, html_content')
        .eq('user_id', 'bc63c065-9bcc-4793-bedc-f0960406425b');
        
    if (error) {
        console.error(error);
        return;
    }

    console.log(`Found ${data.length} pages for bc63c065:`);
    data.forEach(p => {
        const hasSurvey = p.html_content?.includes('data-page-type="survey"');
        const hasContainer = p.html_content?.includes('id="qualification-form-container"');
        console.log(`Slug: ${p.slug} | hasSurvey: ${hasSurvey} | hasContainer: ${hasContainer}`);
    });
}

run();
