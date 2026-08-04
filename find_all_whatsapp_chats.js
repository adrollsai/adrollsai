const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findAllChats() {
  const { data: chats } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, user_id, phone_number, recipient_name, updated_at, last_message_text')
    .order('updated_at', { ascending: false });

  console.log(`Total WhatsApp chats across ALL users: ${chats?.length || 0}`);

  // Group by user_id
  const byUser = {};
  for (const c of chats || []) {
    byUser[c.user_id] = (byUser[c.user_id] || 0) + 1;
  }
  console.log("Chat counts grouped by user_id:", byUser);

  // Fetch profiles for those user_ids
  const userIds = Object.keys(byUser);
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, whatsapp_phone_number_id')
    .in('id', userIds);

  console.log("\nProfiles with chats:\n", profiles);

  // Print top 20 most recent chats across all users
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const active24h = (chats || []).filter(c => c.updated_at && new Date(c.updated_at) >= twentyFourHoursAgo);
  console.log(`\nActive 24h Freeform Chats across ALL users (${active24h.length}):\n`, active24h.map(c => ({
    user_id: c.user_id,
    name: c.recipient_name || 'Prospect',
    phone: c.phone_number,
    updated_at: c.updated_at,
    last_message: c.last_message_text?.substring(0, 60)
  })));
}

findAllChats();
