const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectClients() {
  console.log('--- 1. CHECK CLIENTS TABLE ---');
  const { data: clients, error: cErr } = await supabase.from('clients').select('*');
  console.log('Clients table:', clients ? clients.length : cErr);
  if (clients && clients.length > 0) {
    console.log('Clients sample:', clients.slice(0, 10));
  }

  console.log('\n--- 2. CHECK SUBSCRIPTIONS TABLE ---');
  const { data: subs, error: sErr } = await supabase.from('subscriptions').select('*');
  console.log('Subscriptions table:', subs ? subs.length : sErr);
  if (subs && subs.length > 0) {
    console.log('Subscriptions:', subs);
  }

  console.log('\n--- 3. CHECK WON / CLOSED / CLIENT LEADS ---');
  // Check leads with stage won, closed, converted, customer, client, or notes containing client
  const { data: wonLeads, error: wErr } = await supabase
    .from('leads')
    .select('id, name, phone, email, pipeline_stage, status, notes, custom_fields, user_id')
    .or('pipeline_stage.ilike.%won%,pipeline_stage.ilike.%close%,pipeline_stage.ilike.%client%,status.ilike.%won%,status.ilike.%close%,status.ilike.%client%');
  console.log(`Won/Closed/Client leads count across DB: ${wonLeads?.length || 0}`);
  if (wonLeads && wonLeads.length > 0) {
    wonLeads.forEach(l => {
      console.log(`  - [User: ${l.user_id}] ${l.name} | ${l.phone} | Stage: ${l.pipeline_stage} | Status: ${l.status}`);
    });
  }

  console.log('\n--- 4. CHECK NOBOGENT WON / CONVERTED LEADS SPECIFICALLY ---');
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const { data: noboLeads } = await supabase
    .from('leads')
    .select('id, name, phone, email, pipeline_stage, status, notes, custom_fields')
    .eq('user_id', nobogentId);

  const stagesInNobo = {};
  const statusInNobo = {};
  noboLeads?.forEach(l => {
    stagesInNobo[l.pipeline_stage] = (stagesInNobo[l.pipeline_stage] || 0) + 1;
    statusInNobo[l.status] = (statusInNobo[l.status] || 0) + 1;
  });
  console.log('Nobogent pipeline stages:', stagesInNobo);
  console.log('Nobogent statuses:', statusInNobo);

  // Check leads with payment, paid, converted, client in notes or custom_fields
  const convertedNobo = noboLeads?.filter(l => {
    const s = `${l.notes || ''} ${JSON.stringify(l.custom_fields || '')}`.toLowerCase();
    return s.includes('payment') || s.includes('paid') || s.includes('converted') || s.includes('onboarded') || s.includes('active client') || s.includes('subscribed');
  });
  console.log(`Nobogent leads mentioning payment/paid/onboarded: ${convertedNobo?.length}`);
  convertedNobo?.forEach(l => {
    console.log(`  * ${l.name} | ${l.phone} | Stage: ${l.pipeline_stage} | Notes: ${l.notes?.slice(0, 100)}`);
  });
}

inspectClients().catch(console.error);

