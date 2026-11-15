/**
 * Proves the two outbound tools actually reach out — on the owner's own number only.
 *
 * The tools used to answer with fiction (see lib/agent/tools/outbound.ts). This script calls the
 * same helpers the tools now use, and reports the provider's own words, so "it worked" is never
 * a claim made by our code alone.
 *
 * SAFETY: every recipient passes through outboundRecipient(), and OUTBOUND_TEST_MODE in
 * .env.local pins it to OUTBOUND_TEST_NUMBER (the owner's phone). No lead, no customer, no list.
 *
 *   npm run verify:outbound-live -- --whatsapp <template_name>
 *   npm run verify:outbound-live -- --call
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppTemplate, dispatchVoiceCall } from '../lib/agent/tools/outbound';

dotenv.config({ path: '.env.local', quiet: true });

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const OWNER_EMAIL = 'rchopra489@gmail.com';
const KIND = args.includes('--call') ? 'call' : 'whatsapp';
const TEMPLATE = flag('template', 'hello_world') as string;
// The templates approved on this WABA are all en_US, not en.
const LANG = flag('lang', 'en_US') as string;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

console.log(`test mode : ${process.env.OUTBOUND_TEST_MODE}`);
console.log(`test number: ${process.env.OUTBOUND_TEST_NUMBER}`);

const { data: profile } = await admin
  .from('profiles')
  .select('id, business_name, contact_number')
  .eq('email', OWNER_EMAIL)
  .maybeSingle();
if (!profile?.id) {
  console.error('owner profile not found');
  process.exit(1);
}
console.log(`account   : ${profile.business_name} (${String(profile.id).slice(0, 8)}…)\n`);

if (KIND === 'whatsapp') {
  console.log(`▸ sending WhatsApp template "${TEMPLATE}" (recipient is forced to the test number)\n`);
  const result = await sendWhatsAppTemplate({
    supabase: admin,
    userId: profile.id,
    phone: process.env.OUTBOUND_TEST_NUMBER || String(profile.contact_number || ''),
    templateName: TEMPLATE,
    languageCode: LANG,
    variables: [],
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.success) {
    console.log(`\nPASS — Meta accepted the message for ${result.to} (id ${result.messageId})`);
  } else {
    console.log(`\nNOT SENT — ${result.error}`);
    process.exitCode = 1;
  }
} else {
  console.log('▸ placing one AI voice call (recipient is forced to the test number)\n');
  const result = await dispatchVoiceCall({
    supabase: admin,
    userId: profile.id,
    phone: process.env.OUTBOUND_TEST_NUMBER || String(profile.contact_number || ''),
    objective: 'This is a test call from Nobogent. Say hello and end the call.',
    leadName: 'Owner test call',
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.success) {
    console.log(`\nPASS — call placed to ${result.to} (${result.callSid || result.callId})`);
  } else {
    console.log(`\nNOT PLACED — ${result.error}`);
    process.exitCode = 1;
  }
}
