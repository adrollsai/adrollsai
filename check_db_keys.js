const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkKeys() {
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id, email, gemini_api_key').not('gemini_api_key', 'is', null);
  console.log("PROFILES WITH CUSTOM GEMINI API KEY:", profiles);
}

checkKeys();
