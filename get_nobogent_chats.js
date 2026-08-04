const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getNobogentChats() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  console.log("Nobogent Profile:", {
    id: profile.id,
    email: profile.email,
    business_name: profile.business_name,
    phone_id: profile.whatsapp_phone_number_id,
    token: (profile.whatsapp_access_token || profile.facebook_token)?.substring(0, 20) + '...'
  });

  const { data: chats } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  console.log(`\nWhatsApp Chats for ${profile.email} (${chats?.length || 0}):\n`);
  for (const c of chats || []) {
    console.log({
      id: c.id,
      name: c.recipient_name,
      phone: c.recipient_phone,
      updated_at: c.updated_at,
      last_message: c.last_message_text
    });
  }
}

getNobogentChats();
