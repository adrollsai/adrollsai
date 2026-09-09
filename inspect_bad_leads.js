const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectBadLeads() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, csv_audience, custom_fields, notes, created_at')
    .eq('user_id', userId);

  console.log(`Total leads in DB for Bioque: ${leads.length}`);

  const badLeads = [];
  const goodLeads = [];

  for (const l of leads) {
    let clean = (l.phone || '').replace(/\D/g, '');
    if (clean.length === 10) clean = '91' + clean;
    if (clean.length >= 10 && clean.length <= 15) {
      goodLeads.push(l);
    } else {
      badLeads.push(l);
    }
  }

  console.log(`Valid Phone Leads: ${goodLeads.length}`);
  console.log(`Invalid Phone Leads: ${badLeads.length}\n`);

  badLeads.forEach((l, i) => {
    console.log(`[Bad Lead #${i + 1}] ID: ${l.id}`);
    console.log(`   Name: "${l.name}"`);
    console.log(`   Phone field: "${l.phone}"`);
    console.log(`   Email: "${l.email}"`);
    console.log(`   Audience: "${l.csv_audience}"`);
    console.log(`   Custom Fields:`, l.custom_fields);
    console.log(`   Notes:`, l.notes);
    console.log('----------------------------------------------------');
  });
}

inspectBadLeads();
