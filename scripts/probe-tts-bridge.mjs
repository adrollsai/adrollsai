/**
 * Does the TTS-Flash bridge actually speak?
 *
 * This is the same experiment that convicted the Gemini Live bridge, pointed at the pipeline the demo page uses.
 * Two steps, both without touching a phone:
 *
 *   1. Ask the bridge's own answer webhook what it returns for a real lead. It must return a <Stream> pointing at
 *      /tts-flash-stream; anything else (a Hangup, a 500) means the call would be silent before it started.
 *   2. Open that stream the way a carrier does — connected, start, then base64 media frames — and count the audio
 *      that comes back. Zero bytes is silence; any bytes is a voice.
 *
 *   node scripts/probe-tts-bridge.mjs
 */
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const BRIDGE = 'https://gemini-voice-bridge-tts-ikqeb7h3zq-uc.a.run.app';
const LEAD = '8fa9376d-e44f-4467-b590-1e8d4e490058';
const PROFILE = 'bc63c065-9bcc-4793-bedc-f0960406425b';

console.log('- 1. what the answer webhook returns for a real lead');
const answerUrl = `${BRIDGE}/tts-flash-xml?leadId=${LEAD}&profileId=${PROFILE}&vobizAuthId=MA_HOSGFZ86&vobizAuthToken=RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU`;
const answerRes = await fetch(answerUrl, { method: 'POST', signal: AbortSignal.timeout(40000) });
const xml = await answerRes.text();
console.log(`  HTTP ${answerRes.status}`);
console.log('  ' + xml.replace(/\s+/g, ' ').trim().slice(0, 500));

const streamMatch = /(wss:\/\/[^<\s]+)/.exec(xml);
if (!streamMatch) {
  console.log('\n  NO STREAM IN THE ANSWER — a call answered by this would be silent. Stopping here.');
  process.exit(1);
}
const streamUrl = streamMatch[1].replace(/&amp;/g, '&');
console.log(`\n  stream endpoint: ${streamUrl.split('?')[0]}`);

console.log('\n- 2. driving that stream like a carrier does (L16 / 16 kHz, JSON frames)');
const payloads = Array.from({ length: 900 }, () => Buffer.alloc(320, 0x00).toString('base64'));
const received = { messages: 0, bytes: 0, texts: [] };
const ws = new WebSocket(streamUrl);
const started = Date.now();

await new Promise((resolve) => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    try { ws.close(); } catch (e) { /* closing */ }
    resolve(undefined);
  };
  const hardStop = setTimeout(finish, 30000);

  ws.addEventListener('open', () => {
    console.log('  socket open');
    ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
    ws.send(
      JSON.stringify({
        event: 'start',
        sequenceNumber: '1',
        start: {
          streamSid: 'MZprobe',
          callSid: 'CAprobe',
          accountSid: 'MA_HOSGFZ86',
          tracks: ['inbound'],
          mediaFormat: { encoding: 'audio/x-l16', sampleRate: 16000, channels: 1 },
        },
      }),
    );
    let i = 0;
    const pump = setInterval(() => {
      if (ws.readyState !== 1 || i >= payloads.length) return clearInterval(pump);
      ws.send(
        JSON.stringify({
          event: 'media',
          sequenceNumber: String(i + 2),
          media: { track: 'inbound', chunk: String(i), timestamp: String(i * 20), payload: payloads[i] },
        }),
      );
      i += 1;
    }, 20);
    setTimeout(() => clearInterval(pump), 18000);
  });

  ws.addEventListener('message', (event) => {
    received.messages += 1;
    const data = event.data;
    if (typeof data === 'string') {
      received.texts.push(String(data).slice(0, 200));
      if (received.texts.length <= 4) console.log('  text: ' + String(data).slice(0, 200));
    } else {
      const size = (data && (data.byteLength || data.length)) || 0;
      received.bytes += size;
      if (received.messages <= 3) console.log('  binary frame: ' + size + ' bytes');
    }
  });
  ws.addEventListener('error', (e) => console.log('  error ' + String(e && (e.message || e.type))));
  ws.addEventListener('close', (e) => {
    console.log('  closed ' + (e && e.code) + ' ' + ((e && e.reason) || ''));
    clearTimeout(hardStop);
    finish();
  });
});

console.log('\n- result');
console.log(JSON.stringify({ messages: received.messages, bytes: received.bytes, elapsedMs: Date.now() - started }, null, 1));
if (received.bytes > 0) {
  console.log('\nVERDICT: the TTS-Flash bridge returned ' + received.bytes + ' bytes of audio. This pipeline speaks, and it is');
  console.log('the one the agent now dials — the silent calls were the Live bridge, not the dialler.');
} else {
  console.log('\nVERDICT: no audio from the TTS-Flash bridge on a synthetic stream either. If the demo page works, the');
  console.log('difference is in what the demo sends (voiceId/gender params, prewarm shape) rather than the endpoint.');
  if (received.texts.length) console.log('  it did say:', received.texts.join(' | ').slice(0, 400));
}
