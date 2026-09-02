const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAllDuplicates() {
  const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
  let allLeads = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, created_at, source, status, custom_fields')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1);
      
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    allLeads.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  console.log('Total leads fetched for Blue Square:', allLeads.length);

  const phoneMap = {};
  allLeads.forEach(l => {
    const p = l.phone ? l.phone.replace(/\D/g, '').slice(-10) : '';
    if (p && p.length >= 7) {
      if (!phoneMap[p]) phoneMap[p] = [];
      phoneMap[p].push(l);
    }
  });

  const dupes = Object.entries(phoneMap).filter(([p, list]) => list.length > 1);
  console.log('\n--- Duplicate Phone Groups:', dupes.length, '---');
  let totalCount = 0;
  dupes.forEach(([p, list], idx) => {
    totalCount += list.length;
    console.log(`\nGroup #${idx + 1} [Phone: ${p}] (${list.length} leads):`);
    list.forEach(item => {
      console.log(`  - [ID: ${item.id}] [${item.created_at}] [Source: ${item.source}] [Stage: ${item.stage}] [Name: ${item.name}]`);
    });
  });
  console.log('\nTotal leads counted in duplicates:', totalCount);
}

inspectAllDuplicates();
