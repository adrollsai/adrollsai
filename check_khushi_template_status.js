const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_access_token, facebook_token')
    .eq('id', 'd838c956-1761-4bce-9d91-32f3abecc222')
    .single();

  const token = profile.whatsapp_access_token || profile.facebook_token;
  const templateId = '1062674976649541';

  const res = await fetch(`https://graph.facebook.com/v20.0/${templateId}?access_token=${token}`);
  const data = await res.json();
  console.log('Template status:', data.status, data.rejected_reason || '');
  return data.status;
}

if (require.main === module) {
  checkStatus().catch(console.error);
}

module.exports = { checkStatus };
