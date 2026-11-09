const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspect() {
  console.log('=== 1. CHECKING PROFILES / CLIENTS ===');
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
  if (pErr) console.error('Profiles err:', pErr);
  else {
    console.log(`Found ${profiles.length} profiles:`);
    profiles.forEach(p => {
      console.log(`  - [${p.id}] ${p.email} | ${p.business_name} | Phone: ${p.phone || p.phone_number || 'N/A'} | Role: ${p.role}`);
    });
  }

  // Check subscriptions or clients table if any
  const { data: subs, error: sErr } = await supabase.from('subscriptions').select('*').limit(50);
  if (!sErr && subs) {
    console.log(`\nFound ${subs.length} subscriptions`);
  }

  // Check all distinct sources in leads table
  console.log('\n=== 2. CHECKING LEADS TABLE SOURCES ===');
  // Since supabase limit is 1000 per call, let's fetch all leads with pagination
  let allLeads = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email, source, ad_name, form_id, form_name, campaign_id, user_id, assigned_to, created_at, custom_fields, notes, status, pipeline_stage')
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('Leads fetch error:', error);
      break;
    }
    allLeads = allLeads.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(`Total leads in DB: ${allLeads.length}`);

  // Count leads by user_id
  const byUser = {};
  allLeads.forEach(l => {
    byUser[l.user_id] = (byUser[l.user_id] || 0) + 1;
  });
  console.log('Leads count by user_id:', byUser);

  // Sources breakdown
  const sources = {};
  allLeads.forEach(l => {
    const s = l.source || 'UNKNOWN';
    sources[s] = (sources[s] || 0) + 1;
  });
  console.log('Sources breakdown:', sources);

  // Check CSV uploads / realtors leads
  const csvLeads = allLeads.filter(l => {
    const s = (l.source || '').toLowerCase();
    const notes = (l.notes || '').toLowerCase();
    let cfStr = '';
    try { cfStr = JSON.stringify(l.custom_fields || {}).toLowerCase(); } catch(e) {}
    return s.includes('csv') || s.includes('upload') || s.includes('excel') || s.includes('import') ||
           notes.includes('csv') || notes.includes('realtor') || cfStr.includes('csv') || cfStr.includes('realtor');
  });
  console.log(`\nPotential CSV / Realtor leads found: ${csvLeads.length}`);
  if (csvLeads.length > 0) {
    console.log('Sample CSV/Realtor leads:');
    csvLeads.slice(0, 10).forEach(l => {
      console.log(`  - ${l.name} | ${l.phone} | User: ${l.user_id} | Source: ${l.source} | Notes: ${l.notes}`);
    });
  }

  // Meta campaigns breakdown
  console.log('\n=== 3. META CAMPAIGNS BREAKDOWN ===');
  const metaCampaigns = {};
  allLeads.forEach(l => {
    if (l.campaign_id || l.form_name || l.ad_name || (l.source && l.source.toLowerCase().includes('meta'))) {
      const key = `${l.ad_name || 'NO_AD'} | Form: ${l.form_name || 'NO_FORM'} | Camp: ${l.campaign_id || 'NO_CAMP'}`;
      metaCampaigns[key] = (metaCampaigns[key] || 0) + 1;
    }
  });
  console.log('Meta Campaign Groups:');
  Object.entries(metaCampaigns).forEach(([k, count]) => {
    console.log(`  [${count}] ${k}`);
  });
}

inspect().catch(console.error);

