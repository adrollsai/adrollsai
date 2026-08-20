const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkWhatsApp() {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  console.log('=== CHECKING WHATSAPP / BOT MESSAGES SINCE:', since);

  // Check tables that might store incoming/outgoing messages
  const tables = ['chat_messages', 'messages', 'whatsapp_messages', 'whatsapp_logs', 'notifications', 'lead_history'];

  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact' })
        .gte('created_at', since);

      if (!error) {
        console.log(`- Table [${table}]: ${data ? data.length : 0} rows found (total count: ${count})`);
        if (data && data.length > 0) {
          console.log(`  Sample from [${table}]:`, JSON.stringify(data[0]).slice(0, 150));
        }
      } else {
        console.log(`- Table [${table}]: error (${error.message})`);
      }
    } catch (e) {
      console.log(`- Table [${table}]: exception (${e.message})`);
    }
  }
}

checkWhatsApp();
