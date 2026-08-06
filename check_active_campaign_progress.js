const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkProgress() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';

  const { data: camps } = await supabaseAdmin
    .from('voice_campaigns')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log("Latest voice campaign:\n", camps[0]);

  if (camps[0]) {
    const { data: leads } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, voice_call_status, updated_at')
      .eq('voice_campaign_id', camps[0].id);

    const counts = {};
    for (const l of leads || []) {
      const status = l.voice_call_status || 'queued';
      counts[status] = (counts[status] || 0) + 1;
    }

    console.log(`\nTotal Leads for campaign "${camps[0].name}": ${leads?.length || 0}`);
    console.log("Status Breakdown:\n", counts);
    console.log("\nSample 5 leads in queue:\n", (leads || []).filter(l => !l.voice_call_status || l.voice_call_status === 'queued').slice(0, 5));
  }
}

checkProgress();
