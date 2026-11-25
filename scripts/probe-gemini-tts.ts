import fs from 'node:fs';
import {
  geminiTtsApiKey,
  geminiTtsModel,
  languageCodeFor,
  spokenScript,
  synthesizeSpeech,
} from '../lib/media/gemini-tts-direct';

(async () => {
  console.log('model:', geminiTtsModel());
  console.log('key present:', Boolean(geminiTtsApiKey()));
  const started = Date.now();
  const result = await synthesizeSpeech({
    // Only the line: Gemini reads any style direction out loud (see lib/media/gemini-tts-direct.ts).
    text: spokenScript({
      dialogueText: 'Nobogent brings you the finest homes in Dholera. Book your site visit today.',
    }),
    voiceName: 'Aoede',
    languageCode: languageCodeFor({ accent: 'indian', language: 'hinglish' }),
  });
  const ms = Date.now() - started;
  if (!result.ok) {
    console.log(`FAILED in ${ms}ms | status ${result.status ?? '-'} | retryable=${result.retryable}`);
    console.log('error:', result.error);
    return;
  }
  fs.writeFileSync('probe-gemini-tts.wav', result.wav);
  console.log(
    `OK in ${ms}ms | model=${result.model} | mime=${result.mimeType} | rate=${result.sampleRate} | ` +
      `bytes=${result.wav.length} | header=${result.wrapped ? 'added by us' : 'already WAV'}`
  );
})();
