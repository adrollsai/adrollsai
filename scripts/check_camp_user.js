const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: camp } = await supabase.from('voice_campaigns').select('*').eq('id', '12d36fab-1334-4872-9cd1-8a78487f2418').single();
  console.log('Campaign ID:', camp.id);
  console.log('Campaign Name:', camp.name);
  console.log('Campaign User ID:', camp.user_id);
  console.log('Campaign Created At:', camp.created_at);
  console.log('Campaign Status:', camp.status);
  console.log('Audience Filter:', camp.audience_filter);

  const { data: user, error: uErr } = await supabase.from('profiles').select('*').eq('id', camp.user_id).single();
  if (uErr) {
    console.error('User fetch error:', uErr);
  } else {
    console.log('User Profile found:');
    console.log('ID:', user.id);
    console.log('Email:', user.email);
    console.log('Business Name:', user.business_name);
    console.log('Role:', user.role);
    console.log('Credits:', user.credits);
    console.log('Voice Provider:', user.voice_provider);
    console.log('Voice Twilio Number:', user.voice_twilio_number);
    console.log('Voice Twilio SID:', user.voice_twilio_sid);
    console.log('Voice Vobiz Number:', user.voice_vobiz_number);
    console.log('Business Info:', JSON.stringify(user.business_info));
  }
}
check();
