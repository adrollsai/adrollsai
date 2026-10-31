const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('email, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  if (error || !profile) {
    console.error('Profile fetch failed:', error);
    return;
  }

  console.log('Profile WABA:', profile.whatsapp_waba_id);
  console.log('Phone ID:', profile.whatsapp_phone_number_id);

  const tokens = [
    { name: 'facebook_token', token: profile.facebook_token },
    { name: 'whatsapp_access_token', token: profile.whatsapp_access_token },
    { name: 'DEV_WHATSAPP_ACCESS_TOKEN', token: process.env.DEV_WHATSAPP_ACCESS_TOKEN }
  ].filter(t => !!t.token);

  for (const { name, token } of tokens) {
    console.log(`\n--- Trying token: ${name} (prefix: ${token.slice(0, 15)}...) ---`);
    const res = await fetch(`https://graph.facebook.com/v21.0/${profile.whatsapp_waba_id}/message_templates?limit=100`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.data) {
      console.log(`Found ${data.data.length} templates:`);
      for (const t of data.data) {
        console.log(`\n• ${t.name} [${t.status}] (${t.language}) category: ${t.category}`);
        if (t.components) {
          t.components.forEach(c => {
            console.log(`   [${c.type}] ${c.text || c.format || ''}`);
            if (c.example) console.log(`     example:`, JSON.stringify(c.example));
          });
        }
      }
      return;
    } else {
      console.log(`Token ${name} failed:`, data.error?.message || data);
    }
  }
}

check().catch(console.error);

