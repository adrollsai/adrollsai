const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log("=== Searching for Khushi Ram Profile & Leads ===");
  
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, business_name')
    .or('full_name.ilike.%Khushi%,business_name.ilike.%Khushi%,email.ilike.%Khushi%');
  
  console.log("Profiles matching Khushi:", profiles);

  // Search for leads named Khushi or with phone numbers or under Khushi profile
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, user_id, name, phone, email, source, ad_name, custom_fields, created_at')
    .ilike('name', '%Khushi%')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching leads:", error);
    return;
  }

  console.log(`Found ${leads ? leads.length : 0} leads with name matching 'Khushi':`);
  console.log(JSON.stringify(leads, null, 2));

  if (profiles && profiles.length > 0) {
    const khushiProfileId = profiles[0].id;
    const { data: userLeads } = await supabase
      .from('leads')
      .select('id, user_id, name, phone, email, source, facebook_lead_id, ad_name, custom_fields, created_at')
      .eq('user_id', khushiProfileId)
      .ilike('name', '%Khushi%')
      .order('created_at', { ascending: false });

    console.log(`\nLeads under Khushi Ram profile matching 'Khushi': ${userLeads ? userLeads.length : 0}`);
    console.log(JSON.stringify(userLeads, null, 2));

    // Also check all profiles if there are other leads named Khushi anywhere
    const { data: allKhushiLeads } = await supabase
      .from('leads')
      .select('id, user_id, name, phone, email, source, ad_name, custom_fields, created_at')
      .ilike('name', '%Khushi%');
    console.log(`\nALL leads across ALL profiles matching 'Khushi': ${allKhushiLeads ? allKhushiLeads.length : 0}`);
    console.log(JSON.stringify(allKhushiLeads, null, 2));
  }
}

run();
