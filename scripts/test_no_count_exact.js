const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testNoCountExact() {
    const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra
    const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, facebook_lead_id, external_id, summary, value, next_followup, assigned_to, budget, timeline, priority_status, facebook_created_at, form_id, form_name, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience';

    console.log('--- TESTING WITHOUT COUNT: EXACT ---');
    const start = Date.now();

    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select(leadFields)
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
        .limit(2000);

    console.log(`Fetched ${leads ? leads.length : 0} leads for Blue Square Infra in ${Date.now() - start}ms! Error:`, error);
}

testNoCountExact().catch(console.error);
