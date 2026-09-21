import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectTwoResponders() {
  const chatIds = [
    '8fadf6db-7460-4976-b14b-60856a34001f',
    '2d7bc1c2-b34d-4549-95fb-67a0ab3bf164'
  ];

  const { data: chats } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, lead_id, recipient_phone, recipient_name, last_message_text, updated_at')
    .in('id', chatIds);

  console.log('Responders chat details:');
  console.log(JSON.stringify(chats, null, 2));

  const leadIds = (chats || []).map(c => c.lead_id).filter(Boolean);
  if (leadIds.length > 0) {
    const { data: leads } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, csv_audience, pipeline_stage')
      .in('id', leadIds);
    console.log('Lead details:', JSON.stringify(leads, null, 2));
  }
}

inspectTwoResponders().then(() => process.exit(0)).catch(console.error);
