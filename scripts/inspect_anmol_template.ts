import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function inspect() {
  const { data: broadcast } = await supabaseAdmin
    .from('whatsapp_broadcasts')
    .select('*')
    .eq('id', '76c3c2c6-17f2-4c4f-9b07-30432e09d503')
    .single();

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, business_name')
    .eq('id', broadcast!.user_id)
    .single();

  const wabaId = profile!.whatsapp_waba_id;
  const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=anmol_plotting`, {
    headers: { Authorization: `Bearer ${profile!.whatsapp_access_token}` }
  });
  const data = await res.json();
  console.log('Template details:', JSON.stringify(data, null, 2));

  const { data: msgs } = await supabaseAdmin
    .from('whatsapp_messages')
    .select('media_url, media_type, message_text')
    .ilike('message_text', '%anmol_plotting%')
    .order('created_at', { ascending: false })
    .limit(1);

  console.log('Latest message media info:', msgs);
}
inspect().catch(console.error);
