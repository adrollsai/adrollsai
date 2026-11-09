const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAll() {
  console.log('--- 1. AUDIENCES TABLE ---');
  const { data: audiences, error: aErr } = await supabase.from('audiences').select('*');
  if (aErr) console.log('Audiences table err:', aErr.message);
  else console.log('Audiences:', audiences);

  console.log('\n--- 2. ALL DISTINCT CSV_AUDIENCE IN LEADS ---');
  const { data: csvAudiences, error: caErr } = await supabase.from('leads').select('csv_audience').not('csv_audience', 'is', null);
  if (csvAudiences) {
    const counts = {};
    csvAudiences.forEach(r => { counts[r.csv_audience] = (counts[r.csv_audience] || 0) + 1; });
    console.log('Distinct csv_audience in DB:', counts);
  }

  console.log('\n--- 3. NOBOGENT USERS & PROFILES ---');
  const { data: profiles, error: profErr } = await supabase.from('profiles').select('id, email, business_name, role, contact_number, whatsapp_phone_number, whatsapp_personal_number, whatsapp_phone_number_id, created_at');
  if (profErr) console.error('Profiles err:', profErr);
  const nobogentProfiles = (profiles || []).filter(p => 
    p.business_name?.toLowerCase().includes('nobogent') || 
    p.email?.toLowerCase().includes('nobogent') ||
    p.id === 'bc63c065-9bcc-4793-bedc-f0960406425b' ||
    p.id === 'b1645a6d-4b73-41ef-a197-8247d0168905'
  );
  console.log('Nobogent Profiles:', nobogentProfiles);

  console.log('\n--- 4. CLIENTS LIST (EXCLUSION LIST) ---');
  // Look at profiles with role 'client' or clients of Nobogent
  const clientProfiles = (profiles || []).filter(p => p.role === 'client' || p.role === 'agent' || p.role === 'admin' || p.role === 'agency');
  console.log(`Total non-nobogent profiles: ${clientProfiles.length}`);
  clientProfiles.forEach(p => {
    const num = p.contact_number || p.whatsapp_phone_number || p.whatsapp_personal_number;
    if (num) {
      console.log(`Client: ${p.business_name || p.email} | Phone: ${num} | Role: ${p.role}`);
    }
  });

  // Check if there is a 'clients' table
  const { data: clientsTable, error: cErr } = await supabase.from('clients').select('*');
  if (!cErr && clientsTable) {
    console.log(`Clients table entries: ${clientsTable.length}`, clientsTable);
  } else {
    console.log('No clients table or error:', cErr?.message);
  }

  console.log('\n--- 5. NOBOGENT LEADS BREAKDOWN ---');
  // Nobogent IDs
  const nobogentIds = ['bc63c065-9bcc-4793-bedc-f0960406425b', 'b1645a6d-4b73-41ef-a197-8247d0168905'];
  
  // Let's paginate to get ALL leads for nobogent
  let noboLeads = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .in('user_id', nobogentIds)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    noboLeads = noboLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Total leads owned by Nobogent: ${noboLeads.length}`);

  // Breakdown Nobogent leads
  const campaignBreakdown = {};
  const formBreakdown = {};
  const sourceBreakdown = {};
  const csvBreakdown = {};

  noboLeads.forEach(l => {
    const camp = l.campaign_name || l.campaign_id || l.ad_name || 'NONE';
    campaignBreakdown[camp] = (campaignBreakdown[camp] || 0) + 1;
    const form = l.form_name || l.form_id || 'NONE';
    formBreakdown[form] = (formBreakdown[form] || 0) + 1;
    const src = l.source || 'NONE';
    sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
    if (l.csv_audience) {
      csvBreakdown[l.csv_audience] = (csvBreakdown[l.csv_audience] || 0) + 1;
    }
  });

  console.log('\nNobogent Sources:', sourceBreakdown);
  console.log('\nNobogent CSV Audiences:', csvBreakdown);
  console.log('\nNobogent Forms:', formBreakdown);
  console.log('\nNobogent Campaigns / Ads:', campaignBreakdown);

  // Check realtor CSV leads in other users or globally
  console.log('\n--- 6. GLOBAL REALTOR / CSV LEADS ---');
  // Check leads with source CSV Import or containing realtor
  const { data: realtorLeads, count: rCount } = await supabase
    .from('leads')
    .select('id, name, phone, source, user_id, notes, csv_audience', { count: 'exact' })
    .or('source.ilike.%realtor%,source.ilike.%broker%,csv_audience.ilike.%realtor%,csv_audience.ilike.%broker%,notes.ilike.%realtor%');
  console.log(`Total leads matching realtor/broker keywords: ${rCount}`);
  if (realtorLeads && realtorLeads.length > 0) {
    console.log('Sample matching leads:', realtorLeads.slice(0, 5));
  }
}

inspectAll().catch(console.error);
