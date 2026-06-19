const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: pages, error } = await supabaseAdmin
        .from('landing_pages')
        .select('id, user_id, slug, product_name, html_content')
        .eq('slug', 'highland-mayfield');
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log(`Found ${pages.length} records with slug highland-mayfield:`);
    pages.forEach(p => {
        console.log({
            id: p.id,
            user_id: p.user_id,
            slug: p.slug,
            product_name: p.product_name,
            hasSurveyAttr: p.html_content?.includes('data-page-type="survey"'),
            hasSurveyContainer: p.html_content?.includes('id="qualification-form-container"'),
            hasSurveyWizardId: p.html_content?.includes('id="survey-wizard-container"')
        });
    });
}

run().catch(console.error);
