const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getKhushiRamDetails() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id; // 1222478707610202

  console.log("Profile Data:\n", {
    id: profile.id,
    email: profile.email,
    business_name: profile.business_name,
    phone_id: profile.whatsapp_phone_number_id,
    waba_id: profile.whatsapp_waba_id,
    whatsapp_phone_number: profile.whatsapp_phone_number
  });

  // Query Meta API for phone number details
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name,quality_rating,status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  console.log("\nMeta WABA Phone Details:\n", JSON.stringify(data, null, 2));
}

getKhushiRamDetails();
