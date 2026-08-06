const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Dynamically import or require voice-helper
async function testTrigger() {
  const { triggerOutboundCall } = require('./utils/voice-helper');
  const leadId = "dab2806f-3a68-4f0d-a3b0-bb3dab69816e";
  const profileId = "2f62a259-f23b-48ee-a920-c436f36eaa4b";

  console.log("Resetting lead status...");
  await supabaseAdmin.from('leads').update({ voice_call_status: 'not_called', voice_call_retry_count: 0 }).eq('id', leadId);

  console.log("Calling triggerOutboundCall...");
  const res = await triggerOutboundCall(supabaseAdmin, leadId, profileId, false);
  console.log("Result:", res);
}

testTrigger();
