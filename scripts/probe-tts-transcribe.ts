/**
 * What is actually said in the generated audio?
 *
 * Durations hinted that the style direction is read out loud. This asks Gemini to transcribe the
 * clip, so the answer is words rather than an inference from length.
 */
import fs from 'node:fs';
import { geminiTtsApiKey } from '../lib/media/gemini-tts-direct';

const files = process.argv.slice(2);

(async () => {
  const key = geminiTtsApiKey();
  if (!key) throw new Error('no key');

  for (const file of files) {
    const audio = fs.readFileSync(file);
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: 'Transcribe exactly what is spoken in this audio. Output only the words.' },
                { inlineData: { mimeType: 'audio/wav', data: audio.toString('base64') } },
              ],
            },
          ],
        }),
      }
    );
    const json: any = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(' ').trim();
    console.log(`\n--- ${file} (${(audio.length / 1024).toFixed(0)} KB) ---`);
    console.log(text || JSON.stringify(json).slice(0, 300));
  }
})();
