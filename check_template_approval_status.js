const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  const wabaId = profile.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;
  const token = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=nobogent_offer_promo_v1`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const data = await res.json();
  console.log("Template Status:\n", JSON.stringify(data, null, 2));
}

checkStatus();
