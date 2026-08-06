const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const { data: chats, error } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, user_id, recipient_phone, recipient_name, lead_id');

  if (error) {
    console.error("Error fetching chats:", error);
    return;
  }

  console.log(`Total WhatsApp Chats in DB: ${chats.length}`);

  let missingLeadCount = 0;
  for (const c of chats) {
    let lead = null;
    if (c.lead_id) {
      const { data: l } = await supabaseAdmin.from('leads').select('id, name').eq('id', c.lead_id).maybeSingle();
      lead = l;
    }
    if (!lead && c.recipient_phone) {
      const cleanDigits = c.recipient_phone.replace(/\D/g, '').slice(-10);
      const { data: lByPhone } = await supabaseAdmin
        .from('leads')
        .select('id, name')
        .eq('user_id', c.user_id)
        .ilike('phone', `%${cleanDigits}%`)
        .maybeSingle();
      lead = lByPhone;
    }

    if (!lead) {
      missingLeadCount++;
      console.log(`Unsaved WhatsApp Chat: Phone=${c.recipient_phone}, Name=${c.recipient_name || 'NONE'}, UserID=${c.user_id}`);
    }
  }

  console.log(`\nUnsaved WhatsApp chats without a CRM Lead: ${missingLeadCount}`);
}

check();
