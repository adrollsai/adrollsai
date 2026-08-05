const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFilter() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const { data: camps } = await supabaseAdmin
    .from('voice_campaigns')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log("Latest Campaign:", camps[0]?.name, camps[0]?.id);
  console.log("Audience Filter:\n", JSON.stringify(camps[0]?.audience_filter, null, 2));

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, voice_campaign_id')
    .eq('voice_campaign_id', camps[0]?.id);

  console.log(`\nLeads tagged for this campaign (${camps[0]?.id}): ${leads?.length || 0}`);
}

checkFilter();
