/* Measure the real payload of /api/crm/leads for the Bluesquare tenant.
 * The route fetches 1000 + up to 10 more pages of 1000 = up to 11,000 leads
 * in a single JSON body. Measure bytes and wall-clock for that exact work.
 *
 *   node scripts/measure_leads_payload.js
 */
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, form_name, next_followup, assigned_to, budget, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience, whatsapp_enabled';

const TEAM_IDS = [
  '2f62a259-f23b-48ee-a920-c436f36eaa4b', 'd9c567eb-1b2d-43bc-bbbc-33e0b8d05e83',
  '46b07e70-637b-4381-8523-8db5b764b4a6', '66c4d255-db7c-4bf6-b442-cc2ca446d14a',
  '4f0f8667-d56c-498b-a4cc-1260e722c2e1', 'a2a09a5e-8a30-4bfa-81f3-53b48a27e8fc',
  '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe', 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab',
  '07db7180-6fac-4055-86ee-8b3748590f56', 'ef43e688-6481-4e92-9a61-87183bee128c',
  'f88a0f59-be26-4a5f-ace8-9c30549f7c03', '68883e34-9f71-4f9e-9c66-4338b90e9384',
  '1e4780ac-4e5b-40d0-bb0f-bea7145259d1',
];

const orConds = TEAM_IDS.flatMap((id) => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',');

async function page(idx) {
  const from = idx * 1000;
  const to = (idx + 1) * 1000 - 1;
  const url = `${SUPABASE_URL}/rest/v1/leads?or=(${orConds})&select=${encodeURIComponent(leadFields)}&order=created_at.desc,id.desc`;
  const t = Date.now();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      Range: `${from}-${to}`,
      'Range-Unit': 'items',
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
    },
  });
  const text = await res.text();
  return { idx, ms: Date.now() - t, bytes: Buffer.byteLength(text, 'utf8'), status: res.status, text };
}

(async () => {
  const started = Date.now();
  // Page 0 first (mirrors the route), then the rest in parallel.
  const first = await page(0);
  const totalRowCount = Number((first.text && '') || 0);
  console.log(`page 0: status=${first.status} ms=${first.ms} bytes=${first.bytes}`);

  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?or=(${orConds})&select=id&limit=1`,
    { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, Prefer: 'count=exact' } }
  );
  const cr = countRes.headers.get('content-range') || '';
  const total = Number(cr.split('/')[1] || 0);
  console.log(`totalCount = ${total}`);

  const extra = Math.min(Math.ceil(total / 1000) - 1, 10);
  console.log(`the route will fetch ${extra} additional pages -> ${1000 + extra * 1000} leads max`);

  const t2 = Date.now();
  const rest = await Promise.all(Array.from({ length: extra }, (_, i) => page(i + 1)));
  console.log(`extra pages done in ${Date.now() - t2}ms`);

  let bytes = first.bytes;
  let rows = 0;
  try { rows += (JSON.parse(first.text) || []).length; } catch (e) { rows += 1000; }
  for (const r of rest) {
    bytes += r.bytes;
    try { rows += (JSON.parse(r.text) || []).length; } catch (e) { /* ignore */ }
    console.log(`  page ${r.idx}: status=${r.status} ms=${r.ms} bytes=${r.bytes}`);
  }

  const mb = bytes / (1024 * 1024);
  console.log('\n=== RESULT ===');
  console.log(`rows assembled : ${rows}`);
  console.log(`payload size   : ${mb.toFixed(2)} MB (JSON body the API must return)`);
  console.log(`total wallclock: ${Date.now() - started}ms`);
  console.log(`Vercel response body limit is 4.5 MB for serverless functions.`);
  console.log(mb > 4.5 ? '>>> OVER THE 4.5 MB LIMIT — the response cannot be delivered.' : '>>> within the limit');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
