const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getNewestActivities() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('facebook_token, ad_account_id')
    .eq('id', bioqueId)
    .single();

  const token = profile.facebook_token;
  const actId = profile.ad_account_id;

  // Let's get the ad account activities with order_by or just fetch pages
  let url = `https://graph.facebook.com/v20.0/${actId}/activities?fields=actor_name,date_time_in_timezone,event_type,extra_data,object_id,object_name&limit=100`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  console.log(`Found ${data.data?.length || 0} activities`);
  for (const item of (data.data || []).slice(0, 30)) {
    console.log(`[${item.date_time_in_timezone}] ${item.actor_name} -> ${item.event_type} on ${item.object_name}`);
    if (item.extra_data) console.log('  Data:', item.extra_data);
  }
}

getNewestActivities();
