const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkProfile() {
  const userId = "2f62a259-f23b-48ee-a920-c436f36eaa4b";
  const { data: profile } = await supabaseAdmin.from('profiles').select('id, email, voice_twilio_sid, voice_twilio_token, voice_twilio_number').eq('id', userId).single();
  console.log("PROFILE VOICE CREDS:", profile);
}

checkProfile();
