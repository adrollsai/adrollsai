/**
 * Gemini 3.8 Flash TTS, straight from Google.
 *
 * WHY NOT KIE
 * The voice route went through Kie.ai's wrapper around this same model. That wrapper is a queued
 * task: it returns an id, we poll for up to 45 seconds, and when the task is slow it dies with
 * "generate task timeout" — a failure that arrives AFTER the owner has already been charged a
 * generation and is sitting in front of a broken video. Google's own endpoint is the same model
 * (gemini-3.8-flash-tts) with no queue at all: one request, the audio in the response, usually a
 * few seconds. Fewer moving parts, nothing to poll, nothing to time out.
 *
 * Kie stays as the fallback, because a Google quota or permission problem is a real possibility and
 * a second route is cheaper than a customer who cannot make a video.
 *
 * WHAT COMES BACK
 * Base64 PCM — 24 kHz, 16-bit, mono — which is not a file any player or Remotion will accept, so it
 * is wrapped in a WAV header here. That is also why the sample clips in public/voices are 24 kHz
 * mono PCM: they came out of this model.
 */

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** The model the owner asked for, by name. An env override exists for testing a new release. */
export const GEMINI_TTS_DEFAULT_MODEL = 'gemini-3.8-flash-tts';

/** Gemini TTS speaks at a fixed 24 kHz. Reading it from the mimeType is preferred; this is the floor. */
export const GEMINI_TTS_SAMPLE_RATE = 24_000;

export function geminiTtsModel(): string {
  return String(process.env.GEMINI_TTS_MODEL || GEMINI_TTS_DEFAULT_MODEL).trim();
}

/** The key Google actually wants; the app has it under two names depending on which SDK wrote it. */
export function geminiTtsApiKey(): string | null {
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    '';
  return key.trim() || null;
}

export interface GeminiTtsRequest {
  /** The words to speak. Style direction belongs in the text (see `spokenScript`). */
  text: string;
  /** A Gemini prebuilt voice: Aoede, Puck, Kore, Fenrir, Charon… */
  voiceName?: string;
  model?: string;
  /** e.g. "en-IN". Helps an Indian-English read; omitted when unknown. */
  languageCode?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface GeminiTtsSuccess {
  ok: true;
  /** A complete WAV file, ready to store or transcode to MP3. */
  wav: Buffer;
  model: string;
  mimeType: string;
  sampleRate: number;
  /** True when the bytes arrived as raw PCM and needed a header; false when they were already WAV. */
  wrapped: boolean;
}

export interface GeminiTtsFailure {
  ok: false;
  error: string;
  status?: number;
  /** True when trying again (or trying the other engine) could plausibly work. */
  retryable: boolean;
}

export type GeminiTtsResult = GeminiTtsSuccess | GeminiTtsFailure;

/** 16-bit PCM in, a playable WAV out. Pure, so the header is testable without a network call. */
export function pcmToWav(pcm: Buffer, sampleRate = GEMINI_TTS_SAMPLE_RATE, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** `audio/L16;codec=pcm;rate=24000` → 24000. Falls back to the model's fixed rate. */
export function sampleRateFromMime(mimeType: string | undefined): number {
  const match = String(mimeType || '').match(/rate=(\d+)/i);
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate >= 8000 && rate <= 192_000 ? rate : GEMINI_TTS_SAMPLE_RATE;
}

/** The real sample rate out of a WAV header, so a file that arrives as WAV is described honestly. */
export function sampleRateFromWav(wav: Buffer): number {
  if (wav.length < 44) return GEMINI_TTS_SAMPLE_RATE;
  const rate = wav.readUInt32LE(24);
  return Number.isFinite(rate) && rate >= 8000 && rate <= 192_000 ? rate : GEMINI_TTS_SAMPLE_RATE;
}

/**
 * The text we send. ONLY the words to be spoken.
 *
 * This function used to prepend the style and scene description — the usual way of asking Gemini TTS
 * for a tone ("Say warmly: …"). It was measured, and the model reads that direction OUT LOUD. The
 * same line took:
 *
 *   line alone                                      4.8 s
 *   "Say warmly and confidently:" + line            7.3 s   (the cue is spoken)
 *   the studio/style description the route sent    26.9 s   (all of it is spoken)
 *
 * and transcription confirmed the words: "Warm, confident Indian English commercial voiceover. A
 * confident, polished Indian voiceover artist speaking fluent Indian English… Say, Nobogent brings
 * you the finest homes…". Every voiceover would have opened with twenty seconds of its own art
 * direction.
 *
 * So style is carried by the VOICE CHOICE and the language code, and the prompt carries the script.
 * A leaked cue is not a nuance: it is the wrong audio, and it is silent — the file exists, it is
 * speech, and nobody notices until they listen.
 */
export function spokenScript(input: { dialogueText: string }): string {
  return String(input.dialogueText || '').trim();
}

/**
 * The visual/tone brief, for engines that take direction as a FIELD rather than as prompt text.
 *
 * Kie's API has `scene` and `sampleContext`, which are not spoken. Google's endpoint has no such
 * channel we can trust, so this is deliberately not part of the script above.
 */
export function styleDirection(input: { style?: string; scene?: string; context?: string }): string {
  return [input.style, input.scene, input.context].map((part) => String(part || '').trim()).filter(Boolean).join('. ');
}

/** Whether a failed call is worth another attempt somewhere else. */
function classify(status: number | undefined, message: string): boolean {
  if (status === 429) return true; // quota / rate limit: another engine may still work
  if (status && status >= 500) return true;
  if (status === 408) return true;
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(message)) return true;
  // 400 for a real reason (bad voice name, text too long) or 401/403 (key) will fail again.
  return false;
}

export async function synthesizeSpeech(request: GeminiTtsRequest): Promise<GeminiTtsResult> {
  const apiKey = request.apiKey ?? geminiTtsApiKey();
  const model = String(request.model || geminiTtsModel()).trim();
  const text = String(request.text || '').trim();

  if (!text) return { ok: false, error: 'there is nothing to say — the script is empty', retryable: false };
  if (!apiKey) {
    return {
      ok: false,
      error: 'GEMINI_API_KEY is not set, so Gemini TTS cannot be called directly',
      retryable: true,
    };
  }

  const voiceName = String(request.voiceName || 'Aoede').trim();
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeoutMs = Number(request.timeoutMs ?? 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${GOOGLE_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            ...(request.languageCode ? { languageCode: request.languageCode } : {}),
          },
        },
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      // Google's error body names the real problem (bad voice, unsupported key, quota). Passing the
      // first line of it through beats "TTS failed".
      let detail = raw.slice(0, 400);
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message || detail;
      } catch {
        // keep the raw slice
      }
      return {
        ok: false,
        error: `Gemini TTS refused the request (${response.status}): ${detail}`,
        status: response.status,
        retryable: classify(response.status, detail),
      };
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Gemini TTS returned something that is not JSON', retryable: true };
    }

    const parts: any[] = payload?.candidates?.[0]?.content?.parts ?? [];
    const audioPart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data);
    const inline = audioPart?.inlineData ?? audioPart?.inline_data;
    if (!inline?.data) {
      const blocked = payload?.promptFeedback?.blockReason;
      return {
        ok: false,
        error: blocked
          ? `Gemini refused to speak this text (${blocked})`
          : 'Gemini TTS returned no audio',
        retryable: !blocked,
      };
    }

    const audio = Buffer.from(String(inline.data), 'base64');
    if (!audio.length) return { ok: false, error: 'Gemini TTS returned an empty audio track', retryable: true };

    const mimeType = String(inline.mimeType || inline.mime_type || 'audio/L16;codec=pcm;rate=24000');
    /**
     * Sometimes it is raw PCM, sometimes it is already a WAV file — the mimeType says which
     * (`audio/L16;codec=pcm;rate=24000` versus `audio/wav`), and the bytes say the same thing.
     * Wrapping a WAV in a second WAV header produces a file that still plays in a forgiving
     * player and fails in a strict one, so trust the bytes rather than the header we assumed.
     */
    const alreadyWav = audio.length > 12 && audio.toString('ascii', 0, 4) === 'RIFF';
    const sampleRate = alreadyWav ? sampleRateFromWav(audio) : sampleRateFromMime(mimeType);
    return {
      ok: true,
      wav: alreadyWav ? audio : pcmToWav(audio, sampleRate),
      model,
      mimeType,
      sampleRate,
      wrapped: !alreadyWav,
    };
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? `Gemini TTS timed out after ${timeoutMs}ms` : String(error?.message || error);
    return { ok: false, error: message, retryable: classify(undefined, message) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The language code for the accents this product offers.
 *
 * Sending nothing lets the model guess, and a guess is how an Indian-English read comes back
 * American. Only mapped when we actually know.
 */
export function languageCodeFor(input: { language?: string; accent?: string }): string | undefined {
  const language = String(input.language || '').toLowerCase();
  const accent = String(input.accent || '').toLowerCase();
  const indian = ['hinglish', 'hindi', 'indian_english', 'english_in', 'punjabi', 'tamil', 'telugu', 'kannada', 'marathi', 'bengali', 'gujarati'];
  if (indian.includes(language) || accent === 'indian') {
    if (language === 'hindi') return 'hi-IN';
    if (language === 'punjabi') return 'pa-IN';
    if (language === 'tamil') return 'ta-IN';
    if (language === 'telugu') return 'te-IN';
    if (language === 'kannada') return 'kn-IN';
    if (language === 'marathi') return 'mr-IN';
    if (language === 'bengali') return 'bn-IN';
    if (language === 'gujarati') return 'gu-IN';
    return 'en-IN';
  }
  return undefined;
}
