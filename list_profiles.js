const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listProfiles() {
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id, email, business_name, whatsapp_phone_number_id, whatsapp_phone_number');
  console.log("All Profiles:\n", profiles);
}

listProfiles();
