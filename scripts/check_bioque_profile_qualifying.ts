import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBioqueProfile() {
  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0';

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, qualifying_enabled, qualifying_questions')
    .eq('id', bioqueUserId)
    .single();

  console.log('Bioque profile qualifying settings:', profile);

  const { data: questionFlows } = await supabaseAdmin
    .from('whatsapp_question_flows')
    .select('*')
    .eq('user_id', bioqueUserId);

  console.log('Bioque question flows in DB:', questionFlows);
}

checkBioqueProfile().then(() => process.exit(0)).catch(console.error);
