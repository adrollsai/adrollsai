const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resetAndCall() {
  const leadId = "dab2806f-3a68-4f0d-a3b0-bb3dab69816e";
  
  console.log(`Resetting lead ${leadId} status to 'not_called'...`);
  const { error } = await supabaseAdmin
    .from('leads')
    .update({
      voice_call_status: 'not_called',
      voice_call_retry_count: 0,
      voice_call_scheduled_at: null,
      voice_call_summary: null,
      voice_call_transcript: []
    })
    .eq('id', leadId);

  if (error) {
    console.error("Reset Error:", error);
    return;
  }
  console.log("Lead reset successfully!");

  // Dispatch call via local /api/voice/call route
  console.log("Dispatching call now...");
  const payload = JSON.stringify({ leadId });

  const req = http.request("http://localhost:3000/api/voice/call", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log(`Call API Response [${res.statusCode}]:`, body);
    });
  });

  req.on('error', e => console.error("Call dispatch error:", e.message));
  req.write(payload);
  req.end();
}

resetAndCall();
