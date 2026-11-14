/**
 * Which transcription engine will actually answer, and how fast?
 *
 * Calls the same two providers the route uses, in the same order, with a real recording.
 * This is the check that tells us whether Cloud STT is live on the project or whether we
 * are silently running on the Gemini fallback.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import crypto from 'node:crypto';

const q = String.fromCharCode(34);

function sa() {
  let raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith(q) && raw.endsWith(q))) raw = raw.slice(1, -1);
  return JSON.parse(raw);
}

const b64u = (x: string) => Buffer.from(x).toString('base64url');

async function token(account: any) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  )}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${Buffer.from(sig).toString('base64url')}`,
    }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
  return body.access_token as string;
}

(async () => {
  const audio = fs.readFileSync('.work/probe.mp3');
  const b64 = audio.toString('base64');
  console.log(`clip: ${Math.round(audio.length / 1024)} KB\n`);

  // ---- Cloud STT v2 (chirp_2)
  const account = sa();
  try {
    const at = await token(account);
    const t0 = Date.now();
    const res = await fetch(
      `https://speech.googleapis.com/v2/projects/${account.project_id}/locations/global/recognizers/_:recognize`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            autoDecodingConfig: {},
            languageCodes: ['en-IN', 'hi-IN'],
            model: 'chirp_2',
            features: { enableAutomaticPunctuation: true },
          },
          content: b64,
        }),
      }
    );
    const ms = Date.now() - t0;
    if (res.ok) {
      const data: any = await res.json();
      const text = (data.results || []).map((r: any) => r?.alternatives?.[0]?.transcript || '').join(' ');
      console.log(`Cloud STT (chirp_2): OK in ${ms}ms`);
      console.log(`  "${text.slice(0, 160)}"`);
    } else {
      const body = await res.text();
      console.log(`Cloud STT (chirp_2): HTTP ${res.status} in ${ms}ms`);
      console.log(`  ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  } catch (e: any) {
    console.log('Cloud STT: FAILED —', e?.message || e);
  }

  // ---- Gemini fallback
  try {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
    const t0 = Date.now();
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: 'Transcribe this recording verbatim. Return only the transcript.' },
                { inline_data: { mime_type: 'audio/mpeg', data: b64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 400 },
        }),
      }
    );
    const ms = Date.now() - t0;
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`\nGemini Flash fallback: ${res.ok ? 'OK' : 'HTTP ' + res.status} in ${ms}ms`);
    console.log(`  "${String(text).slice(0, 160)}"`);
  } catch (e: any) {
    console.log('Gemini fallback: FAILED —', e?.message || e);
  }
})();
