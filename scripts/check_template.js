const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function checkImmigrationTemplate() {
  const wabaId = '1446302204023665';
  const token = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=immigration_trial`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  console.log('Template immigration_trial:\n', JSON.stringify(data, null, 2));
}
checkImmigrationTemplate();
