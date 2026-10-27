import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const leadId = 'f9ef9922-6845-4814-adc0-40dc6d95b608';
  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
  const { data: history } = await supabase.from('lead_history').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });

  console.log('Lead f9ef9922 status:', lead.status, 'pipeline_stage:', lead.pipeline_stage, 'next_followup:', lead.next_followup);
  console.log('Lead notes:', lead.notes);
  console.log('Lead custom_fields:', JSON.stringify(lead.custom_fields, null, 2));
  console.log('History count:', history?.length);
  for (const h of (history || [])) {
    console.log(`- [${h.created_at}] Action: ${h.action_type} | Desc: ${h.description}`);
  }
}

run().catch(console.error);
