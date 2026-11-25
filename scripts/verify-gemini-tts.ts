/**
 * Proves the direct Gemini TTS path says exactly what it is given, and nothing else.
 *
 * The bug this exists for was measured, not guessed: putting the style brief in front of the script
 * ("Say warmly: …") made Gemini READ THE BRIEF ALOUD. The same line went from 4.8 s to 26.9 s, and a
 * transcription came back with "Warm, confident Indian English commercial voiceover…" as the opening
 * sentence of the advert. Nothing fails, no error is raised, and the file plays — it is simply the
 * wrong audio, which is the worst kind of defect to ship.
 *
 *   npm run verify:gemini-tts
 */
import {
  GEMINI_TTS_DEFAULT_MODEL,
  geminiTtsModel,
  languageCodeFor,
  pcmToWav,
  sampleRateFromMime,
  sampleRateFromWav,
  spokenScript,
  styleDirection,
} from '../lib/media/gemini-tts-direct';

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
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);

head('1. Only the words to be spoken reach the model');

{
  const line = 'Nobogent brings you the finest homes in Dholera. Book your site visit today.';
  const spoken = spokenScript({ dialogueText: line });
  check('the script is the line', spoken === line, spoken);
  check('no "Say:" prefix', !/^say\b/i.test(spoken));
  check('no direction leaks in', !/voiceover artist|recording studio|commercial/i.test(spoken));

  // Style has its own outlet for engines that take it as a field, and it is never spoken.
  const direction = styleDirection({ style: 'warm', scene: 'bright studio', context: 'luxury ad' });
  check('the direction is available separately', direction === 'warm. bright studio. luxury ad', direction);
  check('whitespace is trimmed from the script', spokenScript({ dialogueText: `  ${line}  ` }) === line);
  check('empty dialogue is empty, not a cue', spokenScript({ dialogueText: '' }) === '');
}

head('2. The model is the one the owner asked for');

{
  check('default model is gemini-3.8-flash-tts', GEMINI_TTS_DEFAULT_MODEL === 'gemini-3.8-flash-tts', GEMINI_TTS_DEFAULT_MODEL);
  const previous = process.env.GEMINI_TTS_MODEL;
  process.env.GEMINI_TTS_MODEL = 'some-test-model';
  check('an env override still wins', geminiTtsModel() === 'some-test-model', geminiTtsModel());
  if (previous === undefined) delete process.env.GEMINI_TTS_MODEL;
  else process.env.GEMINI_TTS_MODEL = previous;
  check('and falls back to the default', geminiTtsModel() === GEMINI_TTS_DEFAULT_MODEL, geminiTtsModel());
}

head('3. Whatever shape the audio arrives in, it leaves playable');

{
  // Raw PCM gets a header…
  const pcm = Buffer.alloc(4800); // 0.1 s of silence at 24 kHz mono 16-bit
  const wav = pcmToWav(pcm, 24_000);
  check('a WAV header is 44 bytes', wav.length === pcm.length + 44, `${wav.length - pcm.length} bytes of header`);
  check('the RIFF magic is right', wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE');
  check('the declared size matches the data', wav.readUInt32LE(4) === 36 + pcm.length);
  check('PCM format, mono, 16-bit', wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16);
  check('the sample rate is written', wav.readUInt32LE(24) === 24_000);
  check('the data chunk is declared', wav.readUInt32LE(40) === pcm.length);
  check('and the rate can be read back', sampleRateFromWav(wav) === 24_000);

  // …and a sample rate stated in the mimeType is honoured.
  check('rate from a PCM mimeType', sampleRateFromMime('audio/L16;codec=pcm;rate=24000') === 24_000);
  check('a different rate is respected', sampleRateFromMime('audio/L16;codec=pcm;rate=48000') === 48_000);
  check('a nonsense rate falls back to 24 kHz', sampleRateFromMime('audio/wav') === 24_000);
  check('an absurd rate is rejected', sampleRateFromMime('audio/L16;rate=999999') === 24_000);
}

head('4. The accent is stated, not guessed');

{
  check('Indian accents ask for en-IN', languageCodeFor({ accent: 'indian' }) === 'en-IN');
  check('Hindi asks for hi-IN', languageCodeFor({ language: 'hindi' }) === 'hi-IN');
  check('Hinglish is Indian English', languageCodeFor({ language: 'hinglish' }) === 'en-IN');
  check('Punjabi asks for pa-IN', languageCodeFor({ language: 'punjabi' }) === 'pa-IN');
  check('an American read states no code, so the voice decides', languageCodeFor({ accent: 'american' }) === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
