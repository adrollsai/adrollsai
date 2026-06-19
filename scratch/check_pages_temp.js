const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const { data, error } = await supabase
        .from('landing_pages')
        .select('id, user_id, slug, html_content')
        .in('user_id', ['c890a11f-84ce-4592-ab8f-8682927b1a9d', '2b0312dc-c1fc-4798-ab1c-339939271229']);
        
    if (error) {
        console.error(error);
        return;
    }

    data.forEach(p => {
        const hasSurveyAttr = p.html_content?.includes('data-page-type="survey"');
        const hasFormContainer = p.html_content?.includes('id="qualification-form-container"');
        console.log(`User: ${p.user_id} | Slug: ${p.slug} | hasSurveyAttr: ${hasSurveyAttr} | hasFormContainer: ${hasFormContainer}`);
    });
}

run();
