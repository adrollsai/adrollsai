const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createFlow() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const token = profile.whatsapp_access_token || profile.facebook_token;
  const wabaId = profile.whatsapp_waba_id;

  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/flows`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'creative_selector',
      categories: ['OTHER']
    })
  });

  const data = await res.json();
  console.log('Create Flow Result:', JSON.stringify(data, null, 2));
}

createFlow().catch(console.error);
