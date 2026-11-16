/**
 * Does a website form actually put a lead in the CRM?
 *
 * §3.7: "website forms posting into the CRM". The route exists
 * (app/api/shared/landing-page/lead), and reading it says the right things — source
 * "Landing Page - <slug>", pipeline_stage "New", status "active" — but reading is not proof: this
 * repo has already produced two features that looked wired and silently did nothing
 * (the catalogue search reporting 0 rows, the template locale that blocked every send).
 *
 * So this POSTs a real submission to the DEPLOYED endpoint, as a visitor's browser would, and then
 * looks for the lead in the database. It deletes the lead afterwards, so the owner's CRM is left
 * exactly as it found it.
 *
 * SAFETY: the phone number is deliberately unroutable (0000000000) so the welcome drip the route
 * fires cannot reach a real person — a test that messages a customer to prove a webhook is not a
 * test, it is an incident.
 *
 *   npx esbuild scripts/verify-form-to-crm.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-form-crm.mjs && node .tmp-form-crm.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor
const SLUG = 'index';
const HOST = process.env.FORM_PROOF_HOST || 'https://app.nobogent.com';
const STAMP = Date.now();
const NAME = `Gate Check ${STAMP}`;
const PHONE = '0000000000';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const page = await sb
  .from('landing_pages')
  .select('id, slug, title, form_id')
  .eq('user_id', ORG)
  .eq('slug', SLUG)
  .maybeSingle();
check('the account has a landing page to submit to', Boolean(page.data?.id), String(page.data?.slug ?? ''));

let leadId: string | null = null;

try {
  console.log(`\nPOST ${HOST}/api/shared/landing-page/lead`);
  const res = await fetch(`${HOST}/api/shared/landing-page/lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: HOST, Referer: `${HOST}/` },
    body: JSON.stringify({
      name: NAME,
      phone: PHONE,
      email: `gate-check-${STAMP}@example.invalid`,
      city: 'Chandigarh',
      user_id: ORG,
      slug: SLUG,
      landing_page_id: page.data?.id ?? null,
    }),
  });
  const bodyText = await res.text();
  console.log(`  -> HTTP ${res.status}  ${bodyText.slice(0, 240)}\n`);
  check('the public form endpoint accepts the submission', res.ok, `HTTP ${res.status}`);
  check(
    'the endpoint answers with JSON rather than an HTML error page',
    /^\s*[\{\[]/.test(bodyText),
    bodyText.slice(0, 80),
  );

  // The lead must exist as a lead — not just a 200.
  let row: any = null;
  for (let attempt = 0; attempt < 6 && !row; attempt++) {
    const found = await sb
      .from('leads')
      .select('id, name, phone, source, pipeline_stage, status, user_id, form_id, custom_fields')
      .eq('user_id', ORG)
      .eq('name', NAME)
      .maybeSingle();
    row = found.data ?? null;
    if (!row) await new Promise((r) => setTimeout(r, 1500));
  }

  check('a lead row was created for this submission', Boolean(row?.id), row ? `id ${String(row.id).slice(0, 8)}…` : 'not found');
  leadId = row?.id ?? null;

  if (row) {
    check('the lead belongs to the right account', row.user_id === ORG);
    check(
      'its source names the page it came from',
      String(row.source) === `Landing Page - ${SLUG}`,
      String(row.source),
    );
    check('it lands in the New pipeline stage', String(row.pipeline_stage) === 'New', String(row.pipeline_stage));
    check('it is an active lead', String(row.status) === 'active', String(row.status));
    check('the phone is stored as submitted', String(row.phone).replace(/\D/g, '') === PHONE, String(row.phone));
  }
} finally {
  if (leadId) {
    const del = await sb.from('leads').delete().eq('id', leadId);
    console.log(`\ncleanup: test lead removed (${del.error ? del.error.message : 'ok'})`);
    const still = await sb.from('leads').select('id').eq('id', leadId).maybeSingle();
    console.log(`         verified gone: ${still.data ? 'NO — still present' : 'yes'}`);
  }
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
