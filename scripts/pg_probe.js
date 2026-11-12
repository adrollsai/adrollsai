/* Runs read-only SQL against the live Supabase project via the Management API.
 *
 *   node scripts/pg_probe.js "<label>" <file-with-sql>
 *   node scripts/pg_probe.js --inline "<label>" "<sql>"
 */
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const TOKEN = env.SUPABASE_MANAGEMENT_TOKEN;
const REF = 'hpssqssdewmkmafxlfud';

async function run(label, query) {
  const started = Date.now();
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  const ms = Date.now() - started;
  console.log(`\n--- ${label} (HTTP ${res.status}, ${ms}ms) ---`);
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { console.log(text.slice(0, 1200)); return; }
  console.log(JSON.stringify(parsed, null, 2).slice(0, 3000));
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  (async () => {
    if (args[0] === '--inline') {
      await run(args[1], args[2]);
    } else {
      await run(args[0], fs.readFileSync(args[1], 'utf8'));
    }
  })().catch((e) => { console.error('FATAL', e); process.exit(1); });
}
