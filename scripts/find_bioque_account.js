const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8');
const envVars = {};
env.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
    envVars[key] = val;
  }
});

const { createClient } = require('@supabase/supabase-js');
const s = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: p } = await s.from('profiles').select('*').eq('id', '68b55a31-a16d-454d-a20f-11adabf590b0').single();
  console.log('Bioque Profile Details:');
  console.log('Credits:', p.credits);
  console.log('Voice twilio number:', p.voice_twilio_number);
  console.log('Voice provider:', p.voice_provider);
  console.log('Business Info:', p.business_info);
}

run();
