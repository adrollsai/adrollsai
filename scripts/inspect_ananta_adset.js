const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findAdset() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('facebook_token, ad_account_id')
    .eq('email', 'infobluesquareinfra@gmail.com')
    .single();

  const token = profile.facebook_token;
  const adAccountId = profile.ad_account_id;

  console.log('Querying Ad Account:', adAccountId);

  // Fetch campaigns first
  const campRes = await fetch(`https://graph.facebook.com/v20.0/${adAccountId}/campaigns?fields=id,name,status&limit=100`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const campData = await campRes.json();
  console.log('Campaigns count:', campData.data?.length);

  // Fetch adsets
  let adsetsUrl = `https://graph.facebook.com/v20.0/${adAccountId}/adsets?fields=id,name,status,created_time,campaign{id,name}&limit=100`;
  const allAdsets = [];
  while (adsetsUrl) {
    const res = await fetch(adsetsUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.error) {
      console.error('Meta API Error:', data.error);
      break;
    }
    if (data.data) allAdsets.push(...data.data);
    adsetsUrl = data.paging?.next || null;
  }

  console.log('Total adsets fetched:', allAdsets.length);
  const matching = allAdsets.filter(a => 
    a.name.toLowerCase().includes('ananta') || 
    a.name.toLowerCase().includes('d+i') ||
    a.name.toLowerCase().includes('targetted') ||
    a.name.toLowerCase().includes('targeted')
  );
  console.log('Matching adsets:', JSON.stringify(matching, null, 2));

  // If no direct name match, let's list the top 20 most recent adsets
  console.log('\nTop 20 most recent adsets:');
  allAdsets.slice(0, 20).forEach(a => {
    console.log(`- [${a.id}] ${a.name} | Status: ${a.status} | Created: ${a.created_time} | Campaign: ${a.campaign?.name}`);
  });
}

findAdset().catch(console.error);
