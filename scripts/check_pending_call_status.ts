import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const { data: msgs } = await supabase
    .from('whatsapp_messages')
    .select('*')
    .eq('lead_id', 'ed68841f-9e2e-4500-b993-b2072ff0d55b');
  console.log('WhatsApp messages for Ramandeep:', msgs?.length);

  const { data: policy } = await supabase
    .from('agent_policies')
    .select('*')
    .eq('user_id', '68b55a31-a16d-454d-a20f-11adabf590b0')
    .maybeSingle();
  console.log('Bioque Estates Agent Policy:', policy);
}

check().catch(console.error);
