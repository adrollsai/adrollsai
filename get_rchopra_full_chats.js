const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getRChopraFullData() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';

  // 1. Get profile details
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  console.log("Profile:", {
    id: profile.id,
    email: profile.email,
    business_name: profile.business_name,
    phone_id: profile.whatsapp_phone_number_id,
    token: (profile.whatsapp_access_token || profile.facebook_token)?.substring(0, 15) + '...',
    personal_phone: profile.whatsapp_personal_number || profile.contact_number
  });

  // 2. Fetch chats linked to userId or leads of userId
  const { data: userLeads } = await supabaseAdmin.from('leads').select('id, name, phone, created_at').eq('user_id', userId);
  console.log(`Total leads for user ${profile.email}: ${userLeads?.length || 0}`);
  
  if (userLeads && userLeads.length > 0) {
    console.log("Sample leads:", userLeads.slice(0, 5));
  }

  // 3. Search whatsapp_chats
  const { data: chats } = await supabaseAdmin.from('whatsapp_chats').select('*');
  console.log(`Total whatsapp_chats in DB: ${chats?.length || 0}`);
  if (chats && chats.length > 0) {
    console.log("All chats sample:", chats);
  }

  // 4. Search whatsapp_messages
  const { data: messages } = await supabaseAdmin.from('whatsapp_messages').select('*').limit(10);
  console.log(`Total whatsapp_messages sample:`, messages);
}

getRChopraFullData();
