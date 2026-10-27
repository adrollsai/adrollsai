const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const campId = '12d36fab-1334-4872-9cd1-8a78487f2418';
  
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status')
    .eq('voice_campaign_id', campId);

  const leadIds = leads.map(l => l.id);
  const leadMap = new Map(leads.map(l => [l.id, l]));

  let allHist = [];
  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    const { data: hist, error } = await supabase
      .from('lead_history')
      .select('*')
      .in('lead_id', chunk)
      .gte('created_at', '2026-10-24T00:00:00Z')
      .order('created_at', { ascending: true });

    if (error) console.error('Error fetching chunk:', error);
    if (hist) allHist = allHist.concat(hist);
  }

  console.log(`Total history entries found for the 500 leads: ${allHist.length}`);
  allHist.forEach(h => {
    const l = leadMap.get(h.lead_id);
    console.log(`[${h.created_at}] Lead: ${l?.name} (${l?.phone}) | Type: ${h.action_type} | User: ${h.user_id} | Desc: ${h.description}`);
  });
}

check().catch(console.error);
