/**
 * Can the bridge speak when driven the way a media stream actually drives it?
 *
 * A first probe sent raw binary and the bridge logged "Error processing stream packet ... is not valid JSON", so
 * that probe proved nothing except that the protocol is JSON events, not frames. This one sends what a
 * Twilio-style media stream sends - `connected`, then `start` with the media format, then `media` packets carrying
 * base64 audio - and counts the audio that comes back.
 *
 * The distinction decides where the fix goes:
 *   audio back   -> the bridge works; the silent calls are the telephony leg (codec or XML dialect)
 *   still silent -> the defect is inside the bridge session and no dialler tuning will help
 *
 *   node scripts/probe-voice-bridge-2.mjs
 */
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const LEAD = '8fa9376d-e44f-4467-b590-1e8d4e490058';
const PROFILE = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const AUTH_ID = 'MA_HOSGFZ86';
const AUTH_TOKEN = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
const BRIDGE = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';

const mulawSilence = (frames) => Array.from({ length: frames }, () => Buffer.alloc(160, 0xff).toString('base64'));
const l16Silence = (frames) => Array.from({ length: frames }, () => Buffer.alloc(320, 0x00).toString('base64'));

async function drive(label, spec) {
  const url =
    'wss://gemini-voice-bridge-805895515412.us-central1.run.app/gemini-live-stream' +
    '?leadId=' + LEAD + '&profileId=' + PROFILE + '&telephony=vobiz&voiceName=Aoede' +
    '&vobizAuthId=' + AUTH_ID + '&vobizAuthToken=' + AUTH_TOKEN;

  const received = { messages: 0, bytes: 0, texts: [] };
  const ws = new WebSocket(url);
  const started = Date.now();

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch (e) { /* already closing */ }
      resolve(undefined);
    };
    const hardStop = setTimeout(finish, 26000);

    ws.addEventListener('open', () => {
      console.log('  [' + label + '] socket open');
      ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
      ws.send(
        JSON.stringify({
          event: 'start',
          sequenceNumber: '1',
          start: {
            streamSid: 'MZprobe',
            callSid: 'CAprobe',
            accountSid: AUTH_ID,
            tracks: ['inbound'],
            mediaFormat: { encoding: spec.encoding, sampleRate: spec.sampleRate, channels: 1 },
          },
        }),
      );

      let i = 0;
      const pump = setInterval(() => {
        if (ws.readyState !== 1 || i >= spec.payloads.length) return clearInterval(pump);
        ws.send(
          JSON.stringify({
            event: 'media',
            sequenceNumber: String(i + 2),
            media: { track: 'inbound', chunk: String(i), timestamp: String(i * 20), payload: spec.payloads[i] },
          }),
        );
        i += 1;
      }, 20);
      setTimeout(() => clearInterval(pump), 14000);
    });

    ws.addEventListener('message', (event) => {
      received.messages += 1;
      const data = event.data;
      if (typeof data === 'string') {
        received.texts.push(String(data).slice(0, 200));
        if (received.texts.length <= 3) console.log('  [' + label + '] text: ' + String(data).slice(0, 200));
      } else {
        const size = (data && (data.byteLength || data.length)) || 0;
        received.bytes += size;
        if (received.messages <= 2) console.log('  [' + label + '] binary frame: ' + size + ' bytes');
      }
    });
    ws.addEventListener('error', (e) => console.log('  [' + label + '] error ' + String(e && (e.message || e.type))));
    ws.addEventListener('close', (e) => {
      console.log('  [' + label + '] closed ' + (e && e.code) + ' ' + ((e && e.reason) || ''));
      clearTimeout(hardStop);
      finish();
    });
  });

  return { ...received, elapsedMs: Date.now() - started };
}

console.log('- health');
const health = await fetch(BRIDGE + '/health', { signal: AbortSignal.timeout(30000) });
console.log('  ' + health.status + ' ' + (await health.text()).slice(0, 200));

console.log('\n- prewarm');
try {
  const res = await fetch(BRIDGE + '/prewarm?leadId=' + LEAD + '&profileId=' + PROFILE + '&telephony=vobiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: LEAD, profileId: PROFILE, telephony: 'vobiz' }),
    signal: AbortSignal.timeout(60000),
  });
  console.log('  ' + res.status + ' ' + (await res.text()).slice(0, 300));
} catch (err) {
  console.log('  prewarm failed: ' + err.message);
}

console.log('\n- driven as L16 / 16 kHz, which is what our answer XML declares');
const l16 = await drive('l16', { encoding: 'audio/x-l16', sampleRate: 16000, payloads: l16Silence(600) });
console.log('  ->', JSON.stringify(l16));

console.log('\n- driven as PCMU / 8 kHz, which is the codec Vobiz reported on both calls');
const mulaw = await drive('mulaw', { encoding: 'audio/x-mulaw', sampleRate: 8000, payloads: mulawSilence(600) });
console.log('  ->', JSON.stringify(mulaw));

console.log('\n- verdict');
if (l16.bytes > 0 || mulaw.bytes > 0) {
  console.log('  The bridge DOES return audio, so the silent calls are on the telephony leg: Vobiz reports PCMU');
  console.log('  8 kHz while our answer XML declares L16 16 kHz, so the two ends disagree about the format.');
} else {
  console.log('  The bridge returned no audio in either format. It accepted the socket, completed setup and stayed');
  console.log('  silent, so the defect is inside the bridge session, not the dialler and not the codec alone.');
}
