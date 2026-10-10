const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function listLeads() {
  const gnrId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, ad_name, voice_call_status, voice_call_summary, created_at')
    .eq('user_id', gnrId)
    .ilike('source', '%housing%')
    .order('created_at', { ascending: false });

  console.log('Total GNR housing leads:', leads?.length);
  const statusCounts = {};
  leads?.forEach(l => {
    const st = l.voice_call_status || 'not_called';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });
  console.log('Breakdown by voice_call_status:', statusCounts);

  console.log('\nTop 15 most recent leads:');
  leads?.slice(0, 15).forEach((l, i) => {
    console.log((i + 1) + '. [' + l.id + '] ' + l.name + ' (' + l.phone + ') - ' + l.ad_name + ' | status: ' + l.voice_call_status);
  });
}
listLeads();
