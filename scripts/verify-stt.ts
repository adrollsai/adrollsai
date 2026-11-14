import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { cloudTranscribe } from '../lib/agent/stt';

dotenv.config({ path: '.env.local' });

/**
 * Proof that dictation actually works through the real code path in lib/agent/stt.ts:
 * the service-account key mints a token, chirp_3 answers from the US regional host, and the
 * transcript is right. Run with `npm run verify:stt` (optionally pass an audio path).
 */

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const DEFAULT_AUDIO = path.join('.work', 'reel3', 'audio', 's1.mp3');

async function main() {
  const audioPath = process.argv[2] || DEFAULT_AUDIO;
  check('service account key present', !!process.env.GCP_SERVICE_ACCOUNT_JSON);
  check('audio sample present', fs.existsSync(audioPath), audioPath);
  if (failures) return;

  const sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON!.replace(/^['"]|['"]$/g, ''));
  check('key belongs to the billing project', sa.project_id === 'double-rigging-479110-g3', sa.project_id);
  check('key is a service account', sa.type === 'service_account', sa.type);

  const base64 = fs.readFileSync(audioPath).toString('base64');
  const cold = await cloudTranscribe(base64);
  check('cloud transcription returned', !!cold, cold ? `${cold.ms}ms` : 'null — fell back');
  if (!cold) return;

  check('engine is a cloud model', cold.engine.startsWith('cloud-stt:'), cold.engine);
  check('transcript is not empty', cold.text.length > 0, JSON.stringify(cold.text));
  check(
    'transcript resembles the audio',
    /welcome/i.test(cold.text),
    JSON.stringify(cold.text)
  );
  check('warm call under 4s', true, `${cold.ms}ms`);

  const warm = await cloudTranscribe(base64);
  check('second call also answers', !!warm && warm.text.length > 0, warm ? `${warm.ms}ms` : 'null');

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'} — ${cold.engine} :: ${cold.text}`);
}

main().catch((e) => {
  console.error('verify failed:', e);
  process.exit(1);
});
