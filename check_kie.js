const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length) env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
});

const KIE_API_KEY = env.KIE_API_KEY;

async function checkKieTasks() {
  const taskIds = ['e3026a885b88a56f7ace12dc1e8692b7', '8b632229dd7e36bf0329dedefa705f66'];
  for (const tid of taskIds) {
    try {
      const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${tid}`, {
        headers: { 'Authorization': `Bearer ${KIE_API_KEY}` }
      });
      const data = await res.json();
      console.log(`Task ${tid}:`, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`Task ${tid} fetch error:`, e.message);
    }
  }
}

checkKieTasks();
