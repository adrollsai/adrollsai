const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde'; // Umang Associates

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, source, ad_name, facebook_lead_id, form_id, custom_fields, created_at, voice_call_status')
    .eq('user_id', userId)
    .or('source.ilike.%facebook%,source.ilike.%meta%,facebook_lead_id.not.is.null')
    .order('created_at', { ascending: false });

  console.log(`Total Meta/Facebook leads for Umang: ${leads?.length}`);
  leads?.forEach((l, idx) => {
    console.log(`${idx + 1}. [${l.created_at}] ${l.name} | ${l.phone} | Source: "${l.source}" | FB Lead ID: ${l.facebook_lead_id} | Ad: ${l.ad_name} | Call: ${l.voice_call_status}`);
  });
}

main().catch(console.error);
