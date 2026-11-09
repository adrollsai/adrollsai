const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkNobogentLeads() {
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const childId = 'b1645a6d-4b73-41ef-a197-8247d0168905';

  let allLeads = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email, source, ad_name, form_id, form_name, campaign_id, user_id, assigned_to, created_at, custom_fields, notes, status, pipeline_stage, csv_audience')
      .or(`user_id.eq.${nobogentId},user_id.eq.${childId},assigned_to.eq.${nobogentId},assigned_to.eq.${childId}`)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`Total Nobogent leads: ${allLeads.length}`);

  // Group by source
  const bySource = {};
  allLeads.forEach(l => {
    bySource[l.source] = (bySource[l.source] || 0) + 1;
  });
  console.log('\n--- BY SOURCE ---', bySource);

  // Group by csv_audience
  const byCsvAudience = {};
  allLeads.forEach(l => {
    if (l.csv_audience || l.source === 'CSV Import') {
      const key = l.csv_audience || 'NO_CSV_AUDIENCE';
      byCsvAudience[key] = (byCsvAudience[key] || 0) + 1;
    }
  });
  console.log('\n--- CSV LEADS BREAKDOWN ---', byCsvAudience);

  // Group Meta campaigns / ads
  const byAdName = {};
  const byFormName = {};
  allLeads.forEach(l => {
    if (l.source !== 'CSV Import') {
      const ad = l.ad_name || 'NO_AD';
      byAdName[ad] = (byAdName[ad] || 0) + 1;
      const form = l.form_name || 'NO_FORM';
      byFormName[form] = (byFormName[form] || 0) + 1;
    }
  });
  console.log('\n--- BY AD NAME ---', byAdName);
  console.log('\n--- BY FORM NAME ---', byFormName);

  // Check unique phone numbers
  const phones = new Set();
  allLeads.forEach(l => {
    if (l.phone) {
      const clean = l.phone.replace(/[^0-9]/g, '');
      if (clean) phones.add(clean);
    }
  });
  console.log(`\nTotal unique clean phone numbers in Nobogent leads: ${phones.size}`);
}

checkNobogentLeads().catch(console.error);

