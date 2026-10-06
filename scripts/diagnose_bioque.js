const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectBioque() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';

  // 1. Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, facebook_token, ad_account_id, selected_page_id, selected_page_token')
    .eq('id', bioqueId)
    .single();

  console.log('Profile:', { id: profile.id, email: profile.email, full_name: profile.full_name, ad_account_id: profile.ad_account_id });

  // 2. Get leads for Bioque
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', bioqueId)
    .order('created_at', { ascending: false });

  console.log(`\nTotal Leads for Bioque in DB: ${leads?.length || 0}`);
  leads?.forEach((l, i) => {
    console.log(`\n--- Lead ${i + 1} ---`);
    console.log(`Name: ${l.name}`);
    console.log(`Phone: ${l.phone}`);
    console.log(`Email: ${l.email}`);
    console.log(`Source: ${l.source}`);
    console.log(`Ad Name: ${l.ad_name}`);
    console.log(`Created At: ${l.created_at}`);
    console.log(`Notes / Status: ${l.notes} | ${l.status}`);
    console.log(`Custom Fields:`, l.custom_fields);
  });

  // 3. Inspect Meta Ad Account campaigns, ad sets, and ads
  if (profile.facebook_token && profile.ad_account_id) {
    const actId = profile.ad_account_id.startsWith('act_') ? profile.ad_account_id : 'act_' + profile.ad_account_id;
    const token = profile.facebook_token;

    console.log('\n--- Fetching Meta Campaigns ---');
    const campRes = await fetch(`https://graph.facebook.com/v21.0/${actId}/campaigns?fields=id,name,status,objective,daily_budget,created_time&limit=10&access_token=${token}`);
    const campData = await campRes.json();
    console.log('Campaigns:', JSON.stringify(campData, null, 2));

    console.log('\n--- Fetching Meta Ad Sets (Targeting / Optimization) ---');
    const adsetRes = await fetch(`https://graph.facebook.com/v21.0/${actId}/adsets?fields=id,name,status,optimization_goal,billing_event,daily_budget,targeting,promoted_object,destination_type&limit=10&access_token=${token}`);
    const adsetData = await adsetRes.json();
    console.log('Ad Sets:', JSON.stringify(adsetData, null, 2));

    console.log('\n--- Fetching Meta Lead Forms ---');
    const pageId = profile.selected_page_id;
    if (pageId) {
      const formsRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/leadgen_forms?fields=id,name,status,questions,leadgen_export_csv_url&access_token=${token}`);
      const formsData = await formsRes.json();
      console.log('Lead Forms:', JSON.stringify(formsData, null, 2));
    }
  }
}

inspectBioque().catch(console.error);
