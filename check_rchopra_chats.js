const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRChopraChats() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  console.log("Nobogent Profile:", {
    id: profile.id,
    email: profile.email,
    business_name: profile.business_name,
    phone_id: profile.whatsapp_phone_number_id,
    phone_number: profile.whatsapp_phone_number,
    hasToken: !!(profile.whatsapp_access_token || profile.facebook_token)
  });

  const { data: chats } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, phone_number, recipient_name, updated_at, last_message_text')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  console.log(`\nTotal WhatsApp chats for Nobogent account: ${chats?.length || 0}`);

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const activeChats = (chats || []).filter(c => {
    if (!c.updated_at) return false;
    const updatedAt = new Date(c.updated_at);
    return updatedAt >= twentyFourHoursAgo;
  });

  console.log(`Active chats in 24h Freeform window: ${activeChats.length}`);
  console.log("\nActive 24h Chats:\n", activeChats.map(c => ({
    id: c.id,
    name: c.recipient_name || 'Prospect',
    phone: c.phone_number,
    updated_at: c.updated_at,
    last_message: c.last_message_text?.substring(0, 50)
  })));

  // Also check overall chats in case some updated_at is older but still recent
  console.log("\nTop 15 Most Recent Chats Overall:\n", (chats || []).slice(0, 15).map(c => ({
    name: c.recipient_name || 'Prospect',
    phone: c.phone_number,
    updated_at: c.updated_at
  })));
}

checkRChopraChats();
