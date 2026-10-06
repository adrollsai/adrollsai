const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .or('campaign_name.ilike.%Binghatti%,campaign_name.ilike.%Bioque%,ad_name.ilike.%Binghatti%,ad_name.ilike.%Bioque%,notes.ilike.%Binghatti%,source.ilike.%Binghatti%')
    .order('created_at', { ascending: false });

  console.log('Error:', error);
  console.log('Total matches:', leads?.length);
  if (leads && leads.length > 0) {
    leads.forEach((l, idx) => {
      console.log(`\nLead ${idx + 1}:`);
      console.log('ID:', l.id);
      console.log('Name:', l.name);
      console.log('Phone:', l.phone);
      console.log('Email:', l.email);
      console.log('Created At:', l.created_at);
      console.log('Campaign Name:', l.campaign_name);
      console.log('Ad Name:', l.ad_name);
      console.log('Source:', l.source);
      console.log('Custom Fields:', JSON.stringify(l.custom_fields, null, 2));
      console.log('Notes:', l.notes);
      console.log('User ID:', l.user_id);
    });
  } else {
    // Let's get the 10 most recent leads in the entire database
    const { data: recent } = await supabase
      .from('leads')
      .select('id, name, phone, email, created_at, campaign_name, ad_name, source, custom_fields, notes, user_id')
      .order('created_at', { ascending: false })
      .limit(10);
    console.log('\n10 Most Recent Leads in DB:');
    console.log(JSON.stringify(recent, null, 2));
  }
}

check();
