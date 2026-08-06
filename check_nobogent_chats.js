const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAccountAndChats() {
  const email = 'rchorpra489@gmail.com';

  // 1. Get User Profile
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id, whatsapp_access_token, facebook_token, whatsapp_phone_number')
    .eq('email', email)
    .single();

  if (profErr || !profile) {
    console.error("Profile not found for email:", email, profErr);
    return;
  }

  console.log("Account Profile Found:", {
    id: profile.id,
    email: profile.email,
    business_name: profile.business_name,
    phone_id: profile.whatsapp_phone_number_id,
    hasToken: !!(profile.whatsapp_access_token || profile.facebook_token),
    phone_number: profile.whatsapp_phone_number
  });

  const userId = profile.id;

  // 2. Fetch active chats from whatsapp_chats
  const { data: chats, error: chatErr } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, phone_number, recipient_name, updated_at, last_message_text')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (chatErr) {
    console.error("Error fetching chats:", chatErr);
    return;
  }

  console.log(`\nTotal WhatsApp chats for Nobogent account: ${chats?.length || 0}`);

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const activeFreeformChats = (chats || []).filter(c => {
    if (!c.updated_at) return false;
    const updatedAt = new Date(c.updated_at);
    return updatedAt >= twentyFourHoursAgo;
  });

  console.log(`Chats active within 24h window (Freeform eligible): ${activeFreeformChats.length}`);
  console.log("\nFreeform eligible chats:\n", activeFreeformChats.map(c => ({
    name: c.recipient_name || 'Prospect',
    phone: c.phone_number,
    lastActive: c.updated_at
  })));
}

checkAccountAndChats();
