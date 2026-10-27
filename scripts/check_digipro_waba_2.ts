import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: p } = await supabase.from('profiles').select(`
    id, email, business_name, contact_number,
    whatsapp_business_account_id, whatsapp_phone_number_id,
    whatsapp_access_token, whatsapp_waba_id, whatsapp_phone_number,
    whatsapp_personal_number, selected_page_id, selected_page_name
  `).eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single();

  console.log('DigiPro WhatsApp & Contact Fields:', p);

  // Check the whatsapp_phone_number_id directly using whatsapp_access_token
  if (p?.whatsapp_phone_number_id && p?.whatsapp_access_token) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${p.whatsapp_phone_number_id}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating`, {
      headers: { Authorization: `Bearer ${p.whatsapp_access_token}` }
    });
    console.log('WhatsApp Phone Node:', await res.json());
  }

  // Check templates under whatsapp_business_account_id
  const wabaId = p?.whatsapp_business_account_id || p?.whatsapp_waba_id;
  if (wabaId && p?.whatsapp_access_token) {
    const tRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      headers: { Authorization: `Bearer ${p.whatsapp_access_token}` }
    });
    console.log('Templates in WABA:', await tRes.json());
  }
}

run().then(() => process.exit(0)).catch(console.error);
