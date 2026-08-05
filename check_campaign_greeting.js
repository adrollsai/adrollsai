const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: camp } = await supabaseAdmin
    .from('voice_campaigns')
    .select('*')
    .eq('id', '65085d5d-2d7d-461b-a682-bdd0adb95b16')
    .single();

  console.log("Campaign Name:", camp.name);
  console.log("Audience Filter / Config:", JSON.stringify(camp.audience_filter, null, 2));
  console.log("\nCustom Prompt:\n", camp.custom_prompt);
}

check();
