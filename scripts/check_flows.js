const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFlows() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const token = profile.whatsapp_access_token || profile.facebook_token;
  const wabaId = profile.whatsapp_waba_id;
  console.log('Testing WABA ID:', wabaId, 'Phone Number ID:', profile.whatsapp_phone_number_id);

  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/flows?access_token=${token}`);
  const data = await res.json();
  console.log('Existing flows:', JSON.stringify(data, null, 2));
}

checkFlows().catch(console.error);
