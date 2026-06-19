const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation
    const { data: pages, error } = await supabaseAdmin
        .from('landing_pages')
        .select('id, slug, product_name, html_content')
        .eq('user_id', userId);

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Found ${pages.length} pages:`);
    pages.forEach(p => {
        const hasSurveyAttr = p.html_content?.includes('data-page-type="survey"');
        const hasSurveyId = p.html_content?.includes('id="survey-form-container"');
        const hasFormContainer = p.html_content?.includes('id="qualification-form-container"');
        console.log({
            slug: p.slug,
            product_name: p.product_name,
            hasSurveyAttr,
            hasSurveyId,
            hasFormContainer
        });
        if (p.slug.includes('highland-mayfield')) {
            // Find the form container substring
            const match = p.html_content?.match(/<div\s+[^>]*id="qualification-form-container"[^>]*>([\s\S]*?)<\/div>/i);
            console.log(`Match for ${p.slug}:`, match ? match[0] : 'None');
        }
    });
}

run().catch(console.error);
