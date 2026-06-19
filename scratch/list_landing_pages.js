const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== PROFILES ===");
    const { data: profiles, error: profileErr } = await supabaseAdmin.from('profiles').select('id, business_name, custom_domain, contact_number, email');
    if (profileErr) console.error(profileErr);
    else console.log(profiles);

    console.log("\n=== QUALIFICATION FORMS ===");
    const { data: forms, error: formErr } = await supabaseAdmin.from('qualification_forms').select('id, name, custom_questions');
    if (formErr) console.error(formErr);
    else console.log(forms);

    console.log("\n=== LANDING PAGES ===");
    const { data: pages, error: pageErr } = await supabaseAdmin.from('landing_pages').select('id, user_id, product_name, slug, form_id, html_content').limit(10);
    if (pageErr) console.error(pageErr);
    else {
        pages.forEach(p => {
            const isSurvey = p.html_content?.includes('data-page-type="survey"') || p.html_content?.includes('id="survey-form-container"');
            console.log({
                id: p.id,
                user_id: p.user_id,
                product_name: p.product_name,
                slug: p.slug,
                form_id: p.form_id,
                is_survey: isSurvey
            });
        });
    }
}

run().catch(console.error);
