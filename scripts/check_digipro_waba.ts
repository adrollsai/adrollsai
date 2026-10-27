import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data: p } = await supabase.from('profiles').select('*').eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single();
  console.log('DigiPro Profile keys:', Object.keys(p));
  console.log('whatsapp_phone_number_id:', p.whatsapp_phone_number_id);
  console.log('phone_number:', p.phone_number);
  console.log('whatsapp_access_token:', p.whatsapp_access_token ? p.whatsapp_access_token.substring(0, 15) + '...' : null);
  console.log('waba_id:', p.waba_id);

  // If whatsapp_access_token exists on p, query Meta graph with that token
  const token = p.whatsapp_access_token || p.facebook_token;
  if (p.whatsapp_phone_number_id && token) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${p.whatsapp_phone_number_id}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,whatsapp_business_account`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Meta Phone Graph with token:', await res.json());
  }

  // Also check if there's any other profile or agency with WABA
  const { data: agency } = await supabase.from('profiles').select('id, email, business_name, whatsapp_phone_number_id, whatsapp_access_token, phone_number').eq('id', p.agency_id).single();
  console.log('Agency Profile:', agency ? { id: agency.id, email: agency.email, phone_id: agency.whatsapp_phone_number_id, phone: agency.phone_number } : null);
}

run().then(() => process.exit(0)).catch(console.error);
