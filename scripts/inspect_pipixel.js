const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectPipixel() {
  const pipixelId = 'c7bede84-d7ea-4b02-bbbb-017d24a37914';

  // 1. Check profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, full_name, whatsapp_phone_number_id, whatsapp_phone_number, whatsapp_access_token, whatsapp_business_account_id, whatsapp_waba_id')
    .eq('id', pipixelId)
    .single();
  console.log('Pipixel Profile:', profile);

  // 2. Count leads
  const { count: leadCount, error: countErr } = await supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', pipixelId);
  console.log('Pipixel Leads count in DB:', leadCount, countErr || '');

  // 3. Inspect a few leads
  const { data: sampleLeads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, pipeline_stage, created_at')
    .eq('user_id', pipixelId)
    .limit(5);
  console.log('Sample leads:', sampleLeads);

  // 4. Fetch Meta template 'immigration_trial'
  const wabaId = profile.whatsapp_waba_id || profile.whatsapp_business_account_id;
  const token = profile.whatsapp_access_token;
  console.log('WABA ID:', wabaId);

  if (wabaId && token) {
    const tRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=immigration_trial`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const tData = await tRes.json();
    console.log('Template immigration_trial data:\n', JSON.stringify(tData, null, 2));
  } else {
    // Try phone_number_id or inspect message_templates
    console.log('No WABA ID directly on profile, checking WABA via phone_number_id...');
    const pRes = await fetch(`https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}?fields=whatsapp_business_management_api_status,id`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Phone details:', await pRes.json());
  }
}
inspectPipixel();
