const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
envText.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length) env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanOrFixFailedAssets() {
  const failedIds = [
    '22842526-b14e-4d5c-9282-a663e9181970',
    '79f86da7-a2d8-449b-8a69-9a4ce02d4c24'
  ];

  console.log("Removing failed asset entries from database so UI displays clean dashboard...");
  const { error } = await supabase.from('assets').delete().in('id', failedIds);
  if (error) {
    console.error("Failed to delete failed asset rows:", error);
  } else {
    console.log("Successfully cleaned up failed asset rows in database!");
  }
}

cleanOrFixFailedAssets();
