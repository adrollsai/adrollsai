const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function previewMerge() {
  const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
  let allLeads = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    allLeads.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const phoneMap = {};
  allLeads.forEach(l => {
    const p = l.phone ? l.phone.replace(/\D/g, '').slice(-10) : '';
    if (p && p.length >= 7) {
      if (!phoneMap[p]) phoneMap[p] = [];
      phoneMap[p].push(l);
    }
  });

  const dupes = Object.entries(phoneMap).filter(([p, list]) => list.length > 1);
  console.log(`Found ${dupes.length} duplicate groups (${dupes.reduce((a, b) => a + b[1].length, 0)} leads)`);

  for (let i = 0; i < dupes.length; i++) {
    const [phone, list] = dupes[i];
    // Sort by created_at desc (newest first)
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    // The newer lead (which has live campaign, assigned agent, recent activity) is primary
    const primaryLead = list[0];
    const secondaryLeads = list.slice(1);

    console.log(`\n======================================================`);
    console.log(`Group #${i+1}: Phone ${phone}`);
    console.log(`PRIMARY LEAD (Keep): [${primaryLead.id}] Name: "${primaryLead.name}" | Created: ${primaryLead.created_at} | Source: ${primaryLead.source} | Stage: ${primaryLead.pipeline_stage || primaryLead.status} | Assigned: ${primaryLead.assigned_to}`);
    
    for (const sec of secondaryLeads) {
      console.log(`SECONDARY LEAD (Merge into Primary & Delete): [${sec.id}] Name: "${sec.name}" | Created: ${sec.created_at} | Source: ${sec.source} | Stage: ${sec.pipeline_stage || sec.status}`);
      
      const { data: hist } = await supabase.from('lead_history').select('id, action_type, description, created_at').eq('lead_id', sec.id);
      console.log(`  -> Has ${hist ? hist.length : 0} existing lead_history entries.`);
      if (sec.notes) {
        console.log(`  -> Has notes on record (${sec.notes.length} chars)`);
      }
    }
  }
}

previewMerge();
