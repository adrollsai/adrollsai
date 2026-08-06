const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function prepare() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';

  const [leadsRes, chatsRes] = await Promise.all([
    supabaseAdmin.from('leads').select('id, name, phone').eq('user_id', userId),
    supabaseAdmin.from('whatsapp_chats').select('id, recipient_name, recipient_phone').eq('user_id', userId)
  ]);

  const recipientMap = new Map();

  (leadsRes.data || []).forEach(l => {
    if (!l.phone) return;
    const cleanDigits = l.phone.replace(/\D/g, '');
    if (cleanDigits.length < 10) return;
    const formatted = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
    recipientMap.set(formatted, {
      name: l.name && !l.name.includes('+') ? l.name.split(' ')[0] : 'there',
      phone: formatted,
      lead_id: l.id
    });
  });

  (chatsRes.data || []).forEach(c => {
    if (!c.recipient_phone) return;
    const cleanDigits = c.recipient_phone.replace(/\D/g, '');
    if (cleanDigits.length < 10) return;
    const formatted = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
    if (!recipientMap.has(formatted)) {
      recipientMap.set(formatted, {
        name: c.recipient_name && !c.recipient_name.includes('+') ? c.recipient_name.split(' ')[0] : 'there',
        phone: formatted,
        chat_id: c.id
      });
    }
  });

  console.log(`Prepared total ${recipientMap.size} UNIQUE broadcast recipients for account rchopra489@gmail.com:`);
  let count = 0;
  recipientMap.forEach((val, key) => {
    count++;
    if (count <= 10) {
      console.log(`  ${count}. Phone: +${val.phone}, Name: ${val.name}`);
    }
  });
  if (count > 10) {
    console.log(`  ... and ${count - 10} more recipients.`);
  }
}

prepare();
