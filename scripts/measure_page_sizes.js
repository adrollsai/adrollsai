/* Confirms the new paginated response sizes stay well under Vercel's 4.5 MB
 * function response limit.
 *
 *   node scripts/measure_page_sizes.js
 */
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, form_name, next_followup, assigned_to, budget, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience, whatsapp_enabled';

async function pageBytes(limit, offset) {
  const url = `${SUPABASE_URL}/rest/v1/leads?user_id=eq.${OWNER_ID}`
    + `&select=${encodeURIComponent(leadFields)}`
    + `&order=created_at.desc,id.desc`;
  const t = Date.now();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Range: `${offset}-${offset + limit - 1}`,
      'Range-Unit': 'items',
    },
  });
  const text = await res.text();
  const rows = JSON.parse(text).length;
  return { limit, rows, bytes: Buffer.byteLength(text, 'utf8'), ms: Date.now() - t };
}

(async () => {
  console.log('Vercel function response limit: 4.5 MB\n');
  console.log('limit  rows  payload      time');
  for (const limit of [200, 500, 1000]) {
    const r = await pageBytes(limit, 0);
    const mb = r.bytes / (1024 * 1024);
    console.log(
      `${String(r.limit).padEnd(6)} ${String(r.rows).padEnd(5)} ${mb.toFixed(2).padStart(6)} MB  ${r.ms} ms  ${mb < 4.5 ? 'OK' : 'OVER LIMIT'}`
    );
  }
  console.log('\n(default page = 200; hard cap = 1000)');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
