const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getTemplates() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const wabaId = profile.whatsapp_waba_id;

  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();

  console.log("Message Templates:\n", JSON.stringify(data.data, null, 2));
}

getTemplates();
