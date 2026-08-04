const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkKhushiRamWaba() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token')
    .eq('id', userId)
    .single();

  console.log("Khushi Ram Profile:", {
    id: profile?.id,
    business_name: profile?.business_name,
    hasToken: !!(profile?.whatsapp_access_token || profile?.facebook_token),
    whatsapp_phone_number_id: profile?.whatsapp_phone_number_id,
    whatsapp_waba_id: profile?.whatsapp_waba_id
  });

  const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const wabaId = profile?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;

  if (wabaId && token) {
    console.log(`\nFetching existing Meta WhatsApp templates for WABA ID: ${wabaId}...`);
    const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=100`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.data) {
      console.log(`Found ${data.data.length} templates:`);
      data.data.forEach(t => console.log(`- ${t.name} (${t.status}) [${t.category}]`));
    } else {
      console.error("Meta Template Fetch Error:", data);
    }
  } else {
    console.error("WABA ID or Access Token not found!");
  }
}

checkKhushiRamWaba();
