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
  const { data, error } = await s.from('voice_campaigns').select('*').limit(1);
  if (error) console.error(error);
  else console.log('voice_campaigns keys:', Object.keys(data[0] || {}));
}

run();
