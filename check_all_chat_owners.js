const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkChatOwners() {
  const { data: chats } = await supabaseAdmin.from('whatsapp_chats').select('id, user_id, recipient_phone, recipient_name, updated_at');
  
  const userCounts = {};
  for (const c of chats || []) {
    userCounts[c.user_id] = (userCounts[c.user_id] || 0) + 1;
  }
  console.log("User chat counts:", userCounts);

  const userIds = Object.keys(userCounts);
  const { data: profiles } = await supabaseAdmin.from('profiles').select('id, email, business_name, whatsapp_phone_number_id').in('id', userIds);

  console.log("\nOwners breakdown:\n", profiles?.map(p => ({
    id: p.id,
    email: p.email,
    business_name: p.business_name,
    chat_count: userCounts[p.id]
  })));

  // Check 24h active chats for ALL profiles!
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const active24h = (chats || []).filter(c => c.updated_at && new Date(c.updated_at) >= twentyFourHoursAgo);
  console.log(`\nTotal Active 24h Freeform Chats across system: ${active24h.length}`);
  console.log("Active 24h Chats List:\n", active24h.map(c => ({
    user_id: c.user_id,
    phone: c.recipient_phone,
    name: c.recipient_name,
    updated_at: c.updated_at
  })));
}

checkChatOwners();
