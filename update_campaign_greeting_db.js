const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function updateGreeting() {
  const campaignId = '65085d5d-2d7d-461b-a682-bdd0adb95b16';
  
  const { data: camp } = await supabaseAdmin
    .from('voice_campaigns')
    .select('audience_filter')
    .eq('id', campaignId)
    .single();

  const currentFilter = camp.audience_filter || {};
  currentFilter.greeting = 'Namaste {name} ji! Kaise hain aap?';

  await supabaseAdmin
    .from('voice_campaigns')
    .update({ audience_filter: currentFilter })
    .eq('id', campaignId);

  console.log("Updated campaign greeting to: Namaste {name} ji! Kaise hain aap?");
}

updateGreeting();
