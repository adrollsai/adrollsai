const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const BLUE_SQUARE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const HOMCOM_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2';
const RCHOPRA_ID = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const REALTY_NATION_ID = 'c890a11f-84ce-4592-ab8f-8682927b1a9d';

async function run() {
    console.log("=== Dumping Source Account Data ===");

    // 1. Profiles
    console.log("\n--- Profiles ---");
    const ids = [BLUE_SQUARE_ID, HOMCOM_ID, RCHOPRA_ID, REALTY_NATION_ID];
    const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .in('id', ids);
    
    profiles.forEach(p => {
        console.log(`Profile: ${p.business_name} (${p.email})`);
        console.log(` - Role: ${p.role}`);
        console.log(` - Subscription Plan: ${p.subscription_plan} | Status: ${p.subscription_status}`);
        console.log(` - Logo URL: ${p.logo_url}`);
        console.log(` - FB Token (exists?): ${!!p.facebook_token}`);
        console.log(` - FB Page ID: ${p.selected_page_id} | Name: ${p.selected_page_name}`);
        console.log(` - Character Video: ${p.character_url}`);
        console.log(` - Character Audio: ${p.character_audio_url}`);
        console.log(` - Character Description: ${p.character_description}`);
    });

    // 2. Realty Nation Landing Pages
    console.log("\n--- Realty Nation Landing Pages ---");
    const { data: pages } = await supabaseAdmin
        .from('landing_pages')
        .select('id, slug, title, product_name')
        .eq('user_id', REALTY_NATION_ID);
    
    pages.forEach(p => {
        console.log(`Page: ${p.title} | Slug: ${p.slug} | Product: ${p.product_name}`);
    });

    // 3. Rchopra Campaigns
    console.log("\n--- Rchopra Campaigns ---");
    const { data: campaigns } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .eq('user_id', RCHOPRA_ID);
    
    console.log(`Found ${campaigns.length} campaigns for Rchopra.`);
    campaigns.forEach(c => {
        console.log(`Campaign: ${c.name} | Status: ${c.status} | Budget: ${c.total_budget} ${c.budget_type}`);
    });
}

run().catch(console.error);
