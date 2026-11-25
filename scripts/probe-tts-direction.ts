/**
 * Is the style direction being spoken?
 *
 * Gemini TTS accepts direction in the prompt text ("Say warmly: …"). The risk is that a long
 * direction gets READ OUT instead of followed, which would put "professional recording studio,
 * high-converting ad read" at the start of every voiceover. Durations are the cheap test: the same
 * line, with and without direction, should take about the same time to say.
 */
import fs from 'node:fs';
import { synthesizeSpeech } from '../lib/media/gemini-tts-direct';

const LINE = 'Nobogent brings you the finest homes in Dholera. Book your site visit today.';

const cases = [
  { label: 'no direction', text: LINE },
  { label: 'short direction', text: `Say warmly and confidently:\n\n${LINE}` },
  {
    label: 'long direction (what the route sends)',
    text:
      'Warm, confident Indian English commercial voiceover. A confident, polished Indian voiceover artist ' +
      'speaking fluent Indian English in a professional recording studio. Warm, clear, enthusiastic, natural ' +
      `Indian vocal cadence, and convincing tone for a high-converting commercial. High converting luxury ` +
      `marketing video commercial with natural Indian English delivery.\n\nSay: ${LINE}`,
  },
];

(async () => {
  for (const testCase of cases) {
    const result = await synthesizeSpeech({ text: testCase.text, voiceName: 'Aoede', languageCode: 'en-IN' });
    if (!result.ok) {
      console.log(`${testCase.label.padEnd(38)} FAILED: ${result.error}`);
      continue;
    }
    fs.writeFileSync(`probe-dir-${testCase.label.replace(/\W+/g, '_')}.wav`, result.wav);
    console.log(
      `${testCase.label.padEnd(38)} ${String(result.wav.length).padStart(8)} bytes  → measure with ffprobe`
    );
  }
})();
