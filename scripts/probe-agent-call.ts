/**
 * One call, on the pipeline the demo uses, to prove the AI actually speaks.
 *
 * The two conversations before this one connected and billed while nobody spoke, because the agent dialled the
 * Gemini Live bridge, which sends no audio. This places a single call through the Gemini TTS-Flash bridge — the
 * same one the demo page uses successfully — and prints what the dispatcher chose, so the bridge logs can be read
 * afterwards and the call can be confirmed as audio rather than assumed.
 *
 *   npx esbuild scripts/probe-agent-call.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-probe-call.mjs && node .tmp-probe-call.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dispatchVoiceCall } from '../lib/agent/tools/outbound';
import { resolveTtsFlashBridgeHttpUrl, resolveVoiceBridgeHttpUrl } from '../utils/app-url';

dotenv.config({ path: '.env.local', quiet: true });

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const NUMBER = '+918288835235'; // the only number outbound tests may reach

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

console.log('▸ the two bridges, so the choice is on the record');
console.log('  Live bridge  (was used, silent):', resolveVoiceBridgeHttpUrl());
console.log('  TTS-Flash bridge (demo, works) :', resolveTtsFlashBridgeHttpUrl());

const ttsHealth = await fetch(`${resolveTtsFlashBridgeHttpUrl()}/tts-flash-health`, { signal: AbortSignal.timeout(30_000) })
  .then(async (r) => ({ status: r.status, body: await r.text() }))
  .catch((e) => ({ status: 0, body: String(e?.message) }));
console.log('  tts-flash-health:', ttsHealth.status, ttsHealth.body.slice(0, 220));

const started = Date.now();
const result = await dispatchVoiceCall({
  supabase: sb,
  userId: ADMIN,
  phone: NUMBER,
  leadName: 'Owner',
  objective:
    'You are an automated assistant calling from Nobogent. Introduce yourself as an AI assistant, ask if you can be ' +
    'heard clearly, explain in one sentence that Nobogent is an AI marketing department starting at 999 rupees for ' +
    'the first month, ask whether they would like a call back from the team, and close politely. Keep it under 30 ' +
    'seconds. Never pretend to be a human.',
});

console.log('\n▸ dispatch result');
console.log(JSON.stringify(result, null, 1).slice(0, 800));
console.log(`\n  dispatch took ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('\n  Now read the TTS bridge logs to confirm it produced audio, not just accepted a socket.');
