/**
 * Does an agent-placed call actually get a voice?
 *
 * The bug this covers was the worst kind: calls connected, billed and were silent. Vobiz reported 12 s and 9 s of
 * a real answered call, and the caller heard nothing. The cause was not the dialler — it was WHICH PIPELINE answered.
 * The default answer route points at the Gemini Live bridge, which accepts the media socket, completes its setup
 * handshake, and then emits zero audio frames; the Gemini TTS-Flash bridge, on a separate deployment, is the one the
 * demo page uses successfully.
 *
 * So this asserts three things:
 *   1. the TTS-Flash bridge is up and its answer webhook returns a real <Stream> (not a Hangup),
 *   2. the agent's dispatcher DIALS that pipeline, with a voice named, and does not fall back to the Live route,
 *   3. the option actually survives the hop from the tool into the telephony helper — it did not, which is exactly
 *      why the first fix attempt looked right and behaved identically.
 *
 * Point 2 and 3 are read from source with comments stripped, because a comment explaining a fix must never be
 * enough to satisfy the test for that fix.
 *
 *   npx esbuild scripts/verify-voice-pipeline.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-voice-pipeline.mjs && node .tmp-voice-pipeline.mjs
 *
 * Read-only: it asks the bridge for its health and its answer XML. It never dials.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { resolveTtsFlashBridgeHttpUrl, resolveVoiceBridgeHttpUrl } from '../utils/app-url';

dotenv.config({ path: '.env.local', quiet: true });

const LEAD = '8fa9376d-e44f-4467-b590-1e8d4e490058';
const PROFILE = 'bc63c065-9bcc-4793-bedc-f0960406425b';

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

/** Source with comments removed, so an explanation cannot satisfy its own assertion. */
const codeOf = (path: string) =>
  fs
    .readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');

// ── 1. The pipeline that works.
console.log('▸ the TTS-Flash bridge is up and answers with a stream');
const tts = resolveTtsFlashBridgeHttpUrl();
const live = resolveVoiceBridgeHttpUrl();
console.log(`  TTS-Flash : ${tts}`);
console.log(`  Live      : ${live}`);
check('the two pipelines are different deployments', tts !== live, 'if these ever collapse to one, re-measure both');

const health = await fetch(`${tts}/tts-flash-health`, { signal: AbortSignal.timeout(30_000) })
  .then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => ({}))) as any }))
  .catch(() => ({ ok: false, body: {} as any }));
check('its health endpoint reports ok', health.ok && health.body?.ok === true, JSON.stringify(health.body).slice(0, 120));
check(
  'and names the TTS model it will speak with',
  /tts/.test(JSON.stringify(health.body?.models ?? {})),
  JSON.stringify(health.body?.models ?? {}).slice(0, 120),
);

const answer = await fetch(`${tts}/tts-flash-xml?leadId=${LEAD}&profileId=${PROFILE}&voiceId=voice_rfag7y46pcq0&gender=female`, {
  method: 'POST',
  signal: AbortSignal.timeout(40_000),
})
  .then(async (r) => ({ status: r.status, body: await r.text() }))
  .catch((e) => ({ status: 0, body: String(e?.message) }));
console.log(`  answer webhook: HTTP ${answer.status}`);
check('the answer webhook returns a media stream, not a hangup', /<Stream\b/.test(answer.body) && !/<Hangup/.test(answer.body), answer.body.replace(/\s+/g, ' ').slice(0, 140));
check(
  'and it points at the TTS-Flash stream endpoint',
  /\/tts-flash-stream\?/.test(answer.body),
  (answer.body.match(/wss:\/\/[^<\s]+/) ?? ['none'])[0].split('?')[0],
);
check(
  'with the audio format the carrier streams',
  /contentType="audio\/x-l16;rate=16000"/.test(answer.body),
  'L16 16 kHz bidirectional',
);
check(
  'and the voice it must speak in',
  /voiceId=/.test(answer.body) && /gender=/.test(answer.body),
  (answer.body.match(/voiceId=[^&\s<]+/) ?? ['no voiceId'])[0],
);

// ── 2. What the agent dials.
console.log('\n▸ the agent dials that pipeline, with a voice, and not the silent one');
const outbound = codeOf('lib/agent/tools/outbound.ts');
check('the dispatcher names the TTS-Flash answer path', /tts-flash-xml/.test(outbound), 'answerPath to the working bridge');
check('it resolves the TTS bridge rather than the Live one', /resolveTtsFlashBridgeHttpUrl\s*\(/.test(outbound));
check(
  'it does NOT point the answer at the Live bridge',
  !/resolveVoiceBridgeHttpUrl\s*\(/.test(outbound),
  'the Live bridge is the silent one',
);
check('it sends a voice id and a gender', /answerParams\s*:\s*\{[^}]*voiceId/.test(outbound) && /gender/.test(outbound));
check('it prewarms the opener on the TTS bridge', /tts-flash-prewarm/.test(outbound));
// The greeting is built from `reason`, inside the sentence "aapne <reason> ke baare mein enquiry ki thi na?". So the
// reason has to be a SUBJECT. The first real call passed the whole objective, the bridge rendered a 25.7 s monologue,
// the callee interrupted at 5 s, barge-in cut the agent off and the bridge dropped its reply — twelve seconds of
// billable silence. Capping the objective to eight words then produced "...enquiry about you are an automated
// assistant calling from Nobogent", which is wrong rather than merely long.
check(
  'the spoken reason is a subject, never a clause of the brief',
  !/firstClause/.test(outbound) && /params\.reason/.test(outbound) && /ki marketing service/.test(outbound),
  'supplied, or derived from the business name — never sliced out of the objective',
);
check('and it is capped so it cannot become a monologue', /slice\(0,\s*9\)/.test(outbound), 'nine words');
check(
  'the full objective goes in instruction, where it is context rather than speech',
  /instruction:\s*params\.objective/.test(outbound),
);
// Time to first word and length of the opener are different things. The bridge pre-renders the greeting during
// prewarm, so it starts in about 0.2 s either way; clipping the greeting to "Namaste ji" made it start fast and stop
// being a greeting. What must never happen again is the opener being built from a paragraph.
check(
  'the opener is not clipped to a bare word (it already starts in ~0.2 s)',
  !/greeting,/.test(outbound) && !/Namaste \$\{firstName\} ji/.test(outbound),
  'no greeting override — the template writes a full sentence ending in a question',
);

// ── 3. The hop that was silently dropping the option.
console.log('\n▸ the option survives the hop into the telephony helper');
const helper = codeOf('utils/voice-helper.ts');
check(
  'triggerOutboundCall declares the pipeline options',
  /answerPath\?:/.test(helper) && /answerParams\?:/.test(helper) && /skipBridgeWarmup\?:/.test(helper),
);
check(
  'and forwards them to the Vobiz dialler',
  /\.\.\.\(options\?\.answerPath\s*\?/.test(helper) && /answerPath: options\.answerPath/.test(helper),
  'this is the line whose absence made the first fix a no-op',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
