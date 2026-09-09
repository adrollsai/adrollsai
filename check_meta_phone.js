const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPhone() {
  const { data: p } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_access_token, facebook_token, whatsapp_waba_id')
    .eq('id', 'd838c956-1761-4bce-9d91-32f3abecc222')
    .single();

  const token = p.whatsapp_access_token || p.facebook_token;
  const phoneId = p.whatsapp_phone_number_id;

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?access_token=${token}`);
  const data = await res.json();
  console.log('Phone details from Meta:', JSON.stringify(data, null, 2));

  // Also check subscribed apps for WABA
  const subRes = await fetch(`https://graph.facebook.com/v20.0/${p.whatsapp_waba_id}/subscribed_apps?access_token=${token}`);
  const subData = await subRes.json();
  console.log('Subscribed apps for WABA:', JSON.stringify(subData, null, 2));
}

checkPhone().catch(console.error);
