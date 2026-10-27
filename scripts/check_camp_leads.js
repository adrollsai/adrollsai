const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const campId = '12d36fab-1334-4872-9cd1-8a78487f2418';
  const blueSquareId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

  // 1. Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, business_name, role, credits, voice_provider, voice_twilio_number, voice_twilio_sid, voice_vobiz_number, business_info')
    .eq('id', blueSquareId)
    .single();

  console.log('Profile:', profile);

  // 2. Leads in campaign 12d36fab
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, source, pipeline_stage, voice_call_status, voice_call_scheduled_at, voice_call_summary, voice_call_transcript, voice_recording_url, created_at, custom_fields')
    .eq('voice_campaign_id', campId);

  console.log('\nLeads in campaign:', leads);

  // 3. Why only 4 leads? Or did the user select 500 leads, but what happened?
  // Let's check how many leads Blue Square Infra has, and how CRM bulk selection works!
  // In app/dashboard/crm/page.tsx:
  // How does bulk selection work?
  // Check the frontend code for selection!
}

main().catch(console.error);
