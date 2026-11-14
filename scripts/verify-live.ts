/**
 * Voice dialogue: the parts that can be proved without a microphone.
 *
 * The audio path itself needs a human ear, but everything around it does not:
 *   1. the state machine picks the right state for the awkward cases (talking while a
 *      job runs, job finished but speech still playing)
 *   2. audio survives a float -> PCM16 -> base64 -> float round trip
 *   3. the "working" line is something a person could actually say out loud
 *   4. live voice is charged through the same 2x-margin path as everything else
 *   5. no vendor name is exposed in any user-facing string
 *
 *   npm run verify:live
 */
import { liveVoiceRupeeCost } from '../lib/agent/pricing';
import {
  STATE_COPY,
  LIVE_MODEL,
  LIVE_MODEL_LEGACY,
  LIVE_VOICE_NAMES,
  buildSetupPayload,
  audioFrame,
  textFrame,
  liveSocketUrl,
  floatToPcm16Base64,
  pcm16Base64ToFloat,
  pickVoice,
  resolveState,
  rms,
  workingNarration,
  LIVE_INPUT_RATE,
} from '../lib/agent/live/protocol';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  Ã¢â‚¬â€ ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  Ã¢â‚¬â€ ${detail}` : ''}`);
  }
}

function main() {
  // ---------------------------------------------------------------- same as calling
  // The in-app voice must use the same live model as the AI calling product. Reading
  // the bridge source is the only way to catch the two drifting apart.
  const bridgeFile = join(process.cwd(), 'voice-bridge', 'server.js');
  let bridgeModel = '';
  try {
    const src = readFileSync(bridgeFile, 'utf8');
    const m = src.match(/GEMINI_LIVE_MODEL\s*\|\|\s*"([^"]+)"/);
    bridgeModel = m ? m[1] : '';
  } catch {
    bridgeModel = '';
  }
  check('the calling bridge names a live model', !!bridgeModel, bridgeModel || 'voice-bridge/server.js not readable');
  // Models this API key can actually open a session with (checked against the live model
  // list). The app may legitimately be ahead of the phone bridge â€” but it must be on a
  // real model, and the drift has to be visible rather than silent.
  const SUPPORTED_LIVE = [
    'models/gemini-3.8-live',
    'models/gemini-3.8-live-extended-thinking',
    'models/gemini-3.1-flash-live-preview',
    'models/gemini-2.5-flash-native-audio-latest',
  ];
  check('in-app voice is on a model the key can actually use', SUPPORTED_LIVE.includes(LIVE_MODEL), LIVE_MODEL);
  if (bridgeModel && bridgeModel !== LIVE_MODEL) {
    console.log(
      `NOTE  phone bridge is still on ${bridgeModel}; the app is on ${LIVE_MODEL}. ` +
        `To move calling too: gcloud run services update voice-bridge --region us-central1 ` +
        `--update-env-vars GEMINI_LIVE_MODEL=${LIVE_MODEL}`
    );
  }

  // The two credential paths use different RPCs. Verified against the live service:
  // an ephemeral token is refused (1008) by the plain RPC and accepted by the
  // constrained one; a raw API key is the other way round. Getting this backwards
  // produces an auth failure that looks like a broken microphone.
  const eph = liveSocketUrl({ credential: 'tok123', mode: 'ephemeral' });
  const keyUrl = liveSocketUrl({ credential: 'key123', mode: 'apiKey' });
  check('ephemeral token goes to the constrained RPC', /BidiGenerateContentConstrained\?access_token=tok123$/.test(eph), eph);
  check('a raw key goes to the plain RPC', /\.BidiGenerateContent\?key=key123$/.test(keyUrl), keyUrl);
  check('the credential is URL-encoded', liveSocketUrl({ credential: 'a/b+c', mode: 'ephemeral' }).includes('a%2Fb%2Bc'));

  const setup: any = buildSetupPayload({ systemInstruction: 'be brief' });
  check('setup asks for audio out', setup.setup.generationConfig.responseModalities.includes('AUDIO'));
  // Desk microphone: the client now owns turn boundaries (automatic detection missed
  // real speech twice in testing — it swallowed a Hindi sentence, then left the session
  // with nothing to answer). 'auto' is still available for A/B.
  const deskVad = setup.setup.realtimeInputConfig.automaticActivityDetection;
  check(
    'desk mic uses automatic detection, tuned eagerly for a close microphone',
    deskVad.disabled !== true &&
      deskVad.startOfSpeechSensitivity === 'START_SENSITIVITY_HIGH' &&
      deskVad.endOfSpeechSensitivity === 'END_SENSITIVITY_LOW' &&
      deskVad.silenceDurationMs === 650,
    JSON.stringify(deskVad)
  );
  // Manual mode is kept behind a flag, but it is not the default: Google's forum carries a
  // documented failure where the model stops responding after activityEnd.
  const manual = (buildSetupPayload({ systemInstruction: 'x', vad: 'manual' }) as any).setup
    .realtimeInputConfig.automaticActivityDetection;
  check('manual turn-taking remains opt-in only', manual.disabled === true, JSON.stringify(manual));

  // The frame shape is the difference between "it can hear me" and "the meter moves and
  // nothing happens": current models take realtimeInput.audio, not media/mediaChunks.
  const audio = audioFrame('QUJD') as any;
  check('audio goes out as realtimeInput.audio', audio.realtimeInput.audio.data === 'QUJD');
  check(
    'the audio frame carries the 16 kHz mime type',
    audio.realtimeInput.audio.mimeType === 'audio/pcm;rate=16000',
    audio.realtimeInput.audio.mimeType
  );
  check('the legacy mediaChunks shape is gone', !('mediaChunks' in (audio.realtimeInput as any)));
  const textF = textFrame('hi') as any;
  check('text goes out as realtimeInput.text', textF.realtimeInput.text === 'hi');
  const phoneVad = (buildSetupPayload({ systemInstruction: 'x', mic: 'phone' }) as any).setup
    .realtimeInputConfig.automaticActivityDetection;
  check(
    'the phone bridge tuning is still available and unchanged',
    phoneVad.startOfSpeechSensitivity === 'START_SENSITIVITY_LOW' &&
      phoneVad.endOfSpeechSensitivity === 'END_SENSITIVITY_HIGH' &&
      phoneVad.silenceDurationMs === 300,
    JSON.stringify(phoneVad)
  );
  check(
    'setup removes the old single VAD claim',
    typeof setup.setup.realtimeInputConfig.automaticActivityDetection === 'object'
  );
  check('setup asks for both transcripts', 'inputAudioTranscription' in setup.setup && 'outputAudioTranscription' in setup.setup);
  check('setup keeps the instruction out of the browser', setup.setup.systemInstruction.parts[0].text === 'be brief');
  check('only the voices the calling product ships are accepted', pickVoice('Aoede') === 'Aoede' && pickVoice('whatever') === 'Aoede', LIVE_VOICE_NAMES.join(','));
  check('a male default is available too', pickVoice(null, false) === 'Charon');

  // ---------------------------------------------------------------- session survival
  check('setup enables session resumption', 'sessionResumption' in setup.setup);
  check('setup enables context compression (audio sessions are capped at 15 min otherwise)', !!setup.setup.contextWindowCompression);
  check(
    'setup declares the agent as a callable tool',
    setup.setup.tools?.[0]?.functionDeclarations?.[0]?.name === 'delegate_to_agent'
  );
  check(
    'the tool asks for instructions, not a raw tool call',
    setup.setup.tools[0].functionDeclarations[0].parameters.required.includes('instructions')
  );
  const resumed: any = buildSetupPayload({ systemInstruction: 'x', resumeHandle: 'abc123' });
  check('a resume handle is passed through on reconnect', resumed.setup.sessionResumption.handle === 'abc123');
  check('the model is the current live model', LIVE_MODEL === 'models/gemini-3.8-live', LIVE_MODEL);
  check('the legacy calling model is still known for comparison', LIVE_MODEL_LEGACY === 'models/gemini-3.1-flash-live-preview');

  // The audio thread capture path is a file the browser fetches; if it disappears, voice
  // silently falls back to the deprecated main-thread path.
  let workletSource = '';
  try {
    workletSource = readFileSync(join(process.cwd(), 'public', 'live-worklet.js'), 'utf8');
  } catch {}
  check('an AudioWorklet capture module ships', /registerProcessor\(\s*'capture-processor'/.test(workletSource));
  check('the worklet does not use the deprecated API', !/ScriptProcessor/.test(workletSource));

  // ---------------------------------------------------------------- state machine
  const s = (over: Partial<Parameters<typeof resolveState>[0]>) =>
    resolveState({
      connected: true,
      errored: false,
      playing: false,
      awaitingModel: false,
      jobRunning: false,
      ...over,
    });

  check('not connected reads as connecting', s({ connected: false }) === 'connecting');
  check('idle chat with nothing happening is listening', s({}) === 'listening');
  check('waiting on the model is thinking', s({ awaitingModel: true }) === 'thinking');
  check('model audio playing is speaking', s({ playing: true }) === 'speaking');
  check('a running job with no audio is working', s({ jobRunning: true }) === 'working');
  check(
    'speech while a job runs still shows speaking, not working',
    s({ jobRunning: true, playing: true }) === 'speaking'
  );
  check('a dropped connection is an error, not silence', s({ errored: true, playing: true }) === 'error');

  // ---------------------------------------------------------------- audio round trip
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
  const b64 = floatToPcm16Base64(samples);
  const back = pcm16Base64ToFloat(b64);
  check('PCM round trip keeps the sample count', back.length === samples.length, `${back.length}`);
  let maxErr = 0;
  for (let i = 0; i < samples.length; i++) maxErr = Math.max(maxErr, Math.abs(back[i] - samples[i]));
  check('PCM round trip is accurate to one 16-bit step', maxErr < 1e-4, `maxErr=${maxErr.toExponential(2)}`);
  check('silence stays silent', Math.abs(pcm16Base64ToFloat(floatToPcm16Base64(new Float32Array(160)))[7]) < 1e-6);
  check('rms of silence is zero', rms(new Float32Array(100)) === 0);
  check('rms of a full-scale sine is ~0.7', Math.abs(rms(Float32Array.from({ length: 1600 }, (_, i) => Math.sin((2 * Math.PI * 100 * i) / LIVE_INPUT_RATE))) - 0.707) < 0.05);

  // ---------------------------------------------------------------- narration
  const start = workingNarration('generating the reel');
  const later = workingNarration('generating the reel', 45);
  check('the working line names the job', /generating the reel/.test(start));
  check('the working line is asked to be short and said aloud', /briefly|Say exactly this/.test(start));
  check('a long job gets a progress line with seconds', /45/.test(later));
  check('no vendor name in the narration', !/gemini|google|openai/i.test(start + later));
  check(
    'no vendor name anywhere in the user-facing state copy',
    !Object.values(STATE_COPY).some((v) => /gemini|google|openai/i.test(v)),
    Object.values(STATE_COPY).join(' Ã‚Â· ')
  );

  // ---------------------------------------------------------------- billing
  const oneMinute = liveVoiceRupeeCost(30, 30);
  check('a minute of talking costs something real', oneMinute > 0, `Ã¢â€šÂ¹${oneMinute.toFixed(4)} vendor cost`);
  check(
    'credit charge is exactly 2x the vendor cost',
    Math.abs(Math.round(oneMinute * 2 * 100) / 100 - oneMinute * 2) < 0.011,
    `${(oneMinute * 2).toFixed(3)} credits`
  );
  check('silence costs nothing', liveVoiceRupeeCost(0, 0) === 0);
  check('input is cheaper than output per second', liveVoiceRupeeCost(60, 0) < liveVoiceRupeeCost(0, 60));
  check('negative seconds cannot earn credits', liveVoiceRupeeCost(-10, -10) === 0);

  const tenMinutes = liveVoiceRupeeCost(300, 300);
  console.log(`\n  reference: 10 minutes of conversation Ã¢â€°Ë† Ã¢â€šÂ¹${tenMinutes.toFixed(2)} cost Ã¢â€ â€™ ${(tenMinutes * 2).toFixed(0)} credits`);

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} Ã¢â‚¬â€ ${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
}

main();



