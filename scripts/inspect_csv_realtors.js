const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectCsvDetails() {
  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  
  // 1. Check all CSV leads for Nobogent
  const { data: noboCsv } = await supabase
    .from('leads')
    .select('id, name, phone, notes, csv_audience, source, custom_fields')
    .eq('user_id', nobogentId)
    .or('source.eq.CSV Import,csv_audience.not.is.null');

  console.log(`Total Nobogent CSV/Audience rows: ${noboCsv?.length}`);

  const audienceGroups = {};
  noboCsv?.forEach(l => {
    const key = l.csv_audience || 'NO_TAG';
    audienceGroups[key] = (audienceGroups[key] || 0) + 1;
  });
  console.log('Audience breakdown in Nobogent:', audienceGroups);

  // Check sample of 'dussehra' tag without another prefix
  const pureDussehra = noboCsv?.filter(l => l.csv_audience === 'dussehra');
  console.log(`Pure dussehra count: ${pureDussehra?.length}`);
  console.log('Sample pure dussehra:', pureDussehra?.slice(0, 3).map(l => ({ name: l.name, phone: l.phone, notes: l.notes?.slice(0, 100), cf: l.custom_fields })));

  // 2. Check if there are other CSV leads across ALL users in DB that belong to realtors
  const { data: allCsv } = await supabase
    .from('leads')
    .select('user_id, source, csv_audience')
    .eq('source', 'CSV Import');

  const csvByUser = {};
  allCsv?.forEach(l => {
    csvByUser[l.user_id] = (csvByUser[l.user_id] || 0) + 1;
  });
  console.log('\nCSV Import leads by user_id across DB:', csvByUser);

  // Check the profiles of those users who have CSV Import
  for (const uid of Object.keys(csvByUser)) {
    const { data: p } = await supabase.from('profiles').select('id, business_name, email, role').eq('id', uid).single();
    console.log(`User ${uid}: ${p?.business_name} (${p?.email}) - Count: ${csvByUser[uid]}`);
  }
}

inspectCsvDetails().catch(console.error);

