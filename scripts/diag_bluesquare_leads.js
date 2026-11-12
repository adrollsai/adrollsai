/* Diagnostic: reproduce the exact /api/crm/leads query for the Bluesquare Infra tenant.
 * Read-only. Reports PostgREST errors, row counts and timing.
 *
 *   node scripts/diag_bluesquare_leads.js
 */
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const OWNER_EMAIL = 'infobluesquareinfra@gmail.com';
const leadFields = 'id, created_at, user_id, name, email, phone, notes, status, pipeline_stage, source, ad_name, form_name, next_followup, assigned_to, budget, custom_fields, booked_time, pixel_id, property_id, campaign_id, csv_audience, whatsapp_enabled';

async function q(path, label) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const started = Date.now();
  let res, text, json;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'count=exact',
      },
    });
    text = await res.text();
    try { json = JSON.parse(text); } catch (e) { json = null; }
  } catch (e) {
    console.log(`  [${label}] NETWORK FAIL: ${e.message}`);
    return { ok: false, error: e.message };
  }
  const ms = Date.now() - started;
  const countHeader = res.headers.get('content-range');
  if (!res.ok) {
    console.log(`  [${label}] HTTP ${res.status} in ${ms}ms -> ${(text || '').slice(0, 400)}`);
    return { ok: false, status: res.status, error: text };
  }
  console.log(`  [${label}] OK ${res.status} in ${ms}ms | rows=${Array.isArray(json) ? json.length : 'n/a'} | content-range=${countHeader}`);
  return { ok: true, data: json, ms };
}

(async () => {
  console.log('=== 1. Profiles lookup ===');
  const prof = await q(`profiles?email=eq.${encodeURIComponent(OWNER_EMAIL)}&select=id,email,full_name,business_name,role,parent_id,agency_id`, 'owner profile');
  if (!prof.ok || !prof.data || !prof.data[0]) {
    console.log('Owner profile NOT FOUND for', OWNER_EMAIL);
    // fall back: search by business name
    await q(`profiles?business_name=ilike.*bluesquare*&select=id,email,full_name,business_name,role`, 'by business name');
    return;
  }
  const owner = prof.data[0];
  const ownerId = owner.id;
  console.log(`  owner id=${ownerId} business="${owner.business_name}" role=${owner.role}`);

  console.log('\n=== 2. Team members (agency_id/parent_id = owner) ===');
  const team = await q(`profiles?or=(parent_id.eq.${ownerId},agency_id.eq.${ownerId},id.eq.${ownerId})&select=id,email,full_name,role`, 'team');
  const ids = [];
  if (team.ok && Array.isArray(team.data)) {
    for (const m of team.data) {
      ids.push(m.id);
      console.log(`  - ${m.id} | ${m.email} | ${m.role}`);
    }
  }
  const workspaceTeamIds = Array.from(new Set([ownerId, ...ids]));
  console.log(`  workspaceTeamIds count = ${workspaceTeamIds.length}`);

  console.log('\n=== 3. leads table reachable at all ===');
  await q(`leads?select=id&limit=1`, 'leads any (limit 1)');
  await q(`leads?select=id&user_id=eq.${ownerId}&limit=1`, 'leads by owner user_id (limit 1)');

  console.log('\n=== 4. Exact API filter: .or(user_id.eq.*,assigned_to.eq.*) ===');
  const orConds = workspaceTeamIds.flatMap((id) => [`user_id.eq.${id}`, `assigned_to.eq.${id}`]).join(',');
  console.log(`  OR string length = ${orConds.length}`);
  await q(`leads?or=(${orConds})&select=id&limit=1`, 'or-filter limit 1');

  console.log('\n=== 5. Full leadFields select with the OR filter (what the API really selects) ===');
  const full = await q(`leads?or=(${orConds})&select=${encodeURIComponent(leadFields)}&order=created_at.desc,id.desc&limit=1000`, 'first 1000 (API page 1)');

  console.log('\n=== 6. Exact count query the API runs ===');
  await q(`leads?or=(${orConds})&select=*&limit=1`, 'count');

  console.log('\n=== 7. Per-column sanity: which selected column is missing from the table? ===');
  const cols = leadFields.split(',').map((c) => c.trim());
  const missing = [];
  for (const c of cols) {
    const r = await q(`leads?select=${c}&limit=1`, `col ${c}`);
    if (!r.ok) missing.push({ col: c, error: (r.error || '').slice(0, 200) });
  }
  if (missing.length === 0) console.log('  all selected columns exist ✔');
  else missing.forEach((m) => console.log(`  MISSING/BROKEN COLUMN ${m.col}: ${m.error}`));

  console.log('\n=== 8. Data shape issues that break PostgREST casts ===');
  // assigned_to / user_id are uuid columns: a non-uuid value in an indexed comparison
  // would make the whole .or() filter 400. Report the raw distinct counts instead.
  await q(`leads?select=assigned_to&assigned_to=is.null&limit=1`, 'assigned_to null');
  await q(`leads?select=user_id&order=created_at.desc&limit=5`, 'sample user_id');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
