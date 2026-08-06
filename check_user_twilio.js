const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTwilio() {
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id, business_name, twilio_account_sid, twilio_auth_token, twilio_phone_number');
  console.log("PROFILES TWILIO CREDS:", JSON.stringify(profiles, null, 2));
}

checkTwilio();
