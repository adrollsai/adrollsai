const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getPrompts() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram
  const { data: camps } = await supabaseAdmin
    .from('voice_campaigns')
    .select('id, name, custom_prompt, audience_filter')
    .eq('user_id', userId);

  console.log("Khushi Ram Campaigns & Prompts:\n");
  for (const c of camps || []) {
    console.log(`--- CAMPAIGN: ${c.name} ---`);
    console.log("GREETING:", c.audience_filter?.greeting || 'None');
    console.log("PROMPT:\n", c.custom_prompt || 'None');
    console.log("\n=========================================\n");
  }
}

getPrompts();
