const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTables() {
  const { data: messages, count: msgCount } = await supabaseAdmin
    .from('whatsapp_messages')
    .select('id, chat_id, message_text, direction, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(10);

  console.log(`Total messages in whatsapp_messages: ${msgCount}`);
  console.log("Recent messages:\n", messages);

  const { data: leads, count: leadCount } = await supabaseAdmin
    .from('leads')
    .select('id, user_id, name, phone, email, source, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(20);

  console.log(`\nTotal leads in leads table: ${leadCount}`);
  console.log("Recent leads:\n", leads);
}

checkTables();
