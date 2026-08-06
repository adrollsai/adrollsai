const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectUser() {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  if (error || !profile) {
    console.error("User not found:", error);
    return;
  }

  console.log("Found Profile:\n", {
    id: profile.id,
    email: profile.email,
    business_name: profile.business_name,
    waba_id: profile.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID,
    phone_number_id: profile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID,
    has_token: !!(profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN)
  });

  const { count: leadCount } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id);

  const { count: chatCount } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id);

  console.log(`Leads in CRM for this account: ${leadCount}`);
  console.log(`WhatsApp chats for this account: ${chatCount}`);
}

inspectUser();
