/**
 * What WhatsApp identity does the owner's profile actually hold, and what does Meta say?
 *
 * §6 of the brief says the WABA id stored in the app is wrong and the correct one for templates is
 * 1777393797025557. Before sending anything, this reads the stored values and asks Meta directly
 * which WABAs and templates the token can see, so the fix is based on Meta's answer rather than on
 * a constant someone typed.
 *
 * Read-only apart from nothing at all. Sends nothing.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const OWNER_EMAIL = 'rchopra489@gmail.com';
const EXPECTED_WABA = '1777393797025557';

const owner = await admin
  .from('profiles')
  .select('id, business_name, whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_phone_number, whatsapp_personal_number, contact_number, facebook_token, selected_page_id')
  .eq('email', OWNER_EMAIL)
  .maybeSingle();

if (!owner.data) {
  console.log('owner profile not found');
  process.exit(1);
}
const p: any = owner.data;
console.log('=== STORED ON THE PROFILE');
console.log('  whatsapp_waba_id        :', p.whatsapp_waba_id ?? '(null)');
console.log('  whatsapp_phone_number_id:', p.whatsapp_phone_number_id ?? '(null)');
console.log('  whatsapp_phone_number   :', p.whatsapp_phone_number ?? '(null)');
console.log('  contact_number          :', p.contact_number ?? '(null)');
console.log('  facebook_token          :', p.facebook_token ? `yes (${String(p.facebook_token).length} chars)` : '(null)');
console.log('  selected_page_id        :', p.selected_page_id ?? '(null)');
console.log('  EXPECTED waba (brief)   :', EXPECTED_WABA);
console.log('  WABA stored == expected :', String(p.whatsapp_waba_id ?? '') === EXPECTED_WABA);

console.log('\n=== ENV');
console.log('  DEV_WHATSAPP_WABA_ID      :', process.env.DEV_WHATSAPP_WABA_ID ?? '(unset)');
console.log('  DEV_WHATSAPP_PHONE_ID     :', process.env.DEV_WHATSAPP_PHONE_ID ?? '(unset)');
console.log('  DEV_WHATSAPP_ACCESS_TOKEN :', process.env.DEV_WHATSAPP_ACCESS_TOKEN ? 'set' : '(unset)');

const token = String(p.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || '').replace(/^["']|["']$/g, '').trim();
if (!token) {
  console.log('\nno token available to ask Meta');
  process.exit(0);
}

const g = async (path: string) => {
  const res = await fetch(`https://graph.facebook.com/v20.0/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log('\n=== META: what can this token see?');
for (const waba of [...new Set([String(p.whatsapp_waba_id ?? ''), EXPECTED_WABA].filter(Boolean))]) {
  const detail = await g(`${waba}?fields=id,name,account_review_status,message_template_namespace`);
  console.log(`  waba ${waba}: HTTP ${detail.status} ${JSON.stringify(detail.body).slice(0, 220)}`);
  const phoneNumbers = await g(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=10`);
  console.log(`    phone_numbers: HTTP ${phoneNumbers.status} ${JSON.stringify(phoneNumbers.body).slice(0, 400)}`);
  const templates = await g(`${waba}/message_templates?fields=name,status,language,id&limit=50`);
  const list = (templates.body as any)?.data ?? [];
  console.log(`    templates: HTTP ${templates.status}, ${list.length} returned`);
  for (const t of list.slice(0, 20)) {
    console.log(`      - ${t.name} [${t.language}] status=${t.status} id=${t.id}`);
  }
}
