/**
 * Does a FORWARDED call actually reach the receptionist?
 *
 * The carrier leg belongs to the user's phone, so the part that can be proven here is everything
 * after it: a Vobiz-shaped answer request arrives with no leadId and no campaign (that is what a
 * forwarded call looks like), and the webhook must
 *
 *   1. resolve the DIALED number to the business that owns that inbound line - not to whichever
 *      super-admin happens to be first in the table;
 *   2. hand the media bridge the receptionist's OWN campaign, so the greeting, the language, the
 *      voice and the catalogue are the business's, not a generic bot's;
 *   3. create the caller as a lead in that business's CRM with the call linked to the campaign;
 *   4. say "no" when the dialled number belongs to nobody, rather than guessing.
 *
 * It posts exactly the body Vobiz posts (form-encoded From/To/CallUUID) to the live answer route.
 *
 *   npm run verify:inbound -- --base=http://localhost:3124
 *
 * Writes only the receptionist config for the test tenant, and restores it at the end.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import {
  DEFAULT_INBOUND_DID,
  buildReceptionistPrompt,
  catalogueDigest,
  ensureInboundCampaign,
  parseBusinessInfo,
  resolveDidOwner,
  sanitiseConfig,
  saveReceptionist,
  defaultReceptionist,
} from '../lib/inbound/receptionist';

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}
const arg = (name: string, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg('base', 'http://localhost:3124');
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const PROBE_CALLER = '+919999911111';

const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    const text = detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.log(`  FAIL ${name}${text ? `  — ${String(text).slice(0, 320)}` : ''}`);
  }
};

async function main() {
  const { data: before } = await admin
    .from('profiles')
    .select('business_info, business_name')
    .eq('id', OWNER)
    .maybeSingle();
  const originalInfo = (before as any)?.business_info ?? null;

  try {
    // ---- 0. sanity of the pure layer
    console.log('\n▸ the receptionist config itself');
    const did = arg('did', DEFAULT_INBOUND_DID || '+917965480715');
    const base = defaultReceptionist({ businessName: (before as any)?.business_name, industry: 'real_estate' });
    const bad = sanitiseConfig({ voiceName: 'Barry' }, base);
    check('an unknown voice is refused', bad.ok === false, bad.error);
    const badLang = sanitiseConfig({ language: 'klingon' }, base);
    check('an unknown language is refused', badLang.ok === false, badLang.error);
    const longGreeting = sanitiseConfig({ greeting: 'x'.repeat(400) }, base);
    check('a greeting too long to speak first is refused', longGreeting.ok === false, longGreeting.error);
    check(
      'a DID is normalised to one E.164 form',
      sanitiseConfig({ did: '7965480539' }, base).config.did === '+917965480539' &&
        sanitiseConfig({ did: '+91 79654 0539' }, base).config.did === '+917965480539',
    );

    // ---- 1. save a distinctive config so the assertions cannot pass by accident
    console.log('\n▸ saving a line the assertions can recognise');
    const config = {
      ...base,
      did,
      voiceName: 'Kore' as const,
      language: 'hinglish',
      greeting: 'Namaste, Blue Square Infra se baat kar rahe hain. Main aapki kaise madad kar sakti hoon?',
      script: 'Ask what they are looking for, offer the closest live project, and take a callback time.',
      includeCatalogue: true,
    };

    const catalogue = await catalogueDigest(admin, OWNER);
    const prompt = buildReceptionistPrompt({
      config,
      businessName: (before as any)?.business_name,
      industry: 'real_estate',
      catalogue,
    });
    check('the prompt speaks the greeting verbatim', prompt.includes(config.greeting));
    check('and carries the rules that keep it honest', /never claim to be a human/i.test(prompt));
    check('and the owner instructions', prompt.includes('Ask what they are looking for'));
    check(
      'and the catalogue as facts (or says there is none)',
      catalogue ? prompt.includes('CATALOGUE') && /- /.test(prompt) : /CATALOGUE: none on file/.test(prompt),
      catalogue ? `${catalogue.split('\n').length} products` : 'no catalogue on this account',
    );

    const ensured = await ensureInboundCampaign(admin, OWNER, config, {
      businessName: (before as any)?.business_name,
      industry: 'real_estate',
    });
    config.campaignId = ensured.campaignId;
    check('a campaign row is prepared for the bridge', !!ensured.campaignId, ensured.error);

    const { data: campaign } = await admin
      .from('voice_campaigns')
      .select('id, name, custom_prompt, audience_filter')
      .eq('id', ensured.campaignId as string)
      .maybeSingle();
    check(
      'it is marked as an inbound receptionist line',
      (campaign as any)?.audience_filter?.is_inbound === true &&
        (campaign as any)?.audience_filter?.is_receptionist === true,
    );
    check(
      'with this business\'s greeting and voice on it',
      (campaign as any)?.audience_filter?.greeting === config.greeting &&
        (campaign as any)?.audience_filter?.voice_name === 'Kore',
    );
    check(
      'and the full script as its prompt',
      String((campaign as any)?.custom_prompt || '').includes(config.greeting),
      `${String((campaign as any)?.custom_prompt || '').length} chars`,
    );

    // Saved a second time: the row must be reused, not duplicated.
    const again = await ensureInboundCampaign(admin, OWNER, config, {
      businessName: (before as any)?.business_name,
      industry: 'real_estate',
    });
    check('saving twice reuses the same campaign', again.campaignId === ensured.campaignId);

    await saveReceptionist(admin, OWNER, config);
    const owner = await resolveDidOwner(admin, did);
    check('the DID now resolves to this business', owner?.userId === OWNER, owner?.userId);
    check('with its voice', owner?.config.voiceName === 'Kore', owner?.config.voiceName);
    check(
      'and an unrelated number resolves to nobody',
      (await resolveDidOwner(admin, '+919000000000')) === null,
      'a call to an unclaimed DID must not be answered as a random business',
    );

    // ---- 2. the forwarded call itself
    console.log('\n▸ a forwarded call arrives (the exact body Vobiz posts)');
    const form = new URLSearchParams({
      From: PROBE_CALLER,
      To: did,
      CallUUID: `verify-inbound-${Date.now().toString(36)}`,
      CallStatus: 'in-progress',
      Direction: 'inbound',
      Event: 'StartApp',
    });
    const res = await fetch(`${BASE}/api/voice/vobiz/xml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const xml = await res.text();
    console.log('   answer XML:', xml.replace(/\s+/g, ' ').slice(0, 300));

    check('the answer webhook accepts it', res.ok, res.status);
    check('and answers with a bidirectional media stream', /<Stream\b[^>]*bidirectional="true"/.test(xml), xml.slice(0, 200));
    check('not a hangup', !/<Hangup/.test(xml));

    // The XML escapes `&` as `&amp;` (correct XML), so unescape before reading query params.
    const ws = ((xml.match(/>\s*(wss?:\/\/[^<\s]+)\s*</) || [])[1] || '').replace(/&amp;/g, '&');
    check('pointing at the voice bridge', /gemini|bridge/.test(ws), ws.split('?')[0]);
    check('flagged as inbound', /[?&]inbound=true/.test(ws), 'so the bot knows the caller rang us');
    check(
      'with the receptionist campaign attached',
      ws.includes(`campaignId=${ensured.campaignId}`),
      (ws.match(/[?&]campaignId=([^&]+)/) || [])[1],
    );
    check('and the line\'s own voice', /[?&]voiceName=Kore/.test(ws), (ws.match(/[?&]voiceName=([^&]+)/) || [])[1]);
    check(
      'and the audio format the carrier streams',
      /contentType="audio\/x-l16;rate=16000"/.test(xml),
      'L16 16 kHz',
    );

    // ---- 3. the caller became a lead in the right CRM
    await new Promise((r) => setTimeout(r, 1200));
    const { data: leads } = await admin
      .from('leads')
      .select('id, user_id, name, phone, source, voice_campaign_id')
      .eq('user_id', OWNER)
      .eq('phone', PROBE_CALLER)
      .order('created_at', { ascending: false })
      .limit(3);
    const lead = (leads ?? [])[0] as any;
    check('the caller exists as a lead in that business\'s CRM', !!lead, leads?.length);
    check('tagged as an inbound call', /inbound/i.test(String(lead?.source || '')), lead?.source);
    check('linked to the receptionist campaign', lead?.voice_campaign_id === ensured.campaignId, lead?.voice_campaign_id);

    // ---- 4. a DID nobody owns is not answered as somebody's business
    const strangerForm = new URLSearchParams({
      From: PROBE_CALLER,
      To: '+919000000000',
      CallUUID: `verify-inbound-unclaimed-${Date.now().toString(36)}`,
    });
    const stranger = await fetch(`${BASE}/api/voice/vobiz/xml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: strangerForm.toString(),
    });
    const strangerXml = await stranger.text();
    check(
      'an unclaimed DID is not attached to the receptionist campaign',
      !strangerXml.includes(String(ensured.campaignId)),
      strangerXml.replace(/\s+/g, ' ').slice(0, 160),
    );
  } finally {
    // ---- restore
    await admin.from('profiles').update({ business_info: originalInfo }).eq('id', OWNER);
    await admin.from('leads').delete().eq('user_id', OWNER).eq('phone', PROBE_CALLER);
  }

  const { data: afterProfile } = await admin.from('profiles').select('business_info').eq('id', OWNER).maybeSingle();
  const restored = (() => {
    try {
      return JSON.stringify(parseBusinessInfo((afterProfile as any)?.business_info).inbound_receptionist?.did || '') === '""';
    } catch {
      return false;
    }
  })();
  console.log(`\nrestored: ${restored ? 'the profile blob is back to its original value' : 'check business_info manually'}`);

  console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error('verify:inbound failed:', e?.stack || e?.message || e);
  process.exitCode = 1;
});
