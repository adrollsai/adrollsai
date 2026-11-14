/**
 * Live voice — shared constants and pure helpers.
 *
 * Nothing here talks to a vendor directly; the white-label rule is that no vendor name
 * appears in anything a user can see or hear, so the UI strings live here and are used
 * by both the panel and its tests.
 *
 * Audio is 16-bit PCM mono: 16 kHz going up, 24 kHz coming back. Those two rates are
 * fixed by the protocol, not by us.
 */

export const LIVE_INPUT_RATE = 16000;
export const LIVE_OUTPUT_RATE = 24000;
export const LIVE_CHUNK_MS = 100; // 100 ms per uplink frame — small enough for barge-in

/**
 * The live model.
 *
 * `gemini-3.8-live` is the provider's current default for low-latency audio-to-audio
 * voice agents: audio in/out, synchronous and asynchronous function calling, and
 * proactive audio. Kept in one place so the app and the phone bridge can be pointed at
 * the same thing from one env var.
 *
 * Resolution order matters: an explicit app override, then the variable the calling
 * bridge already reads (`GEMINI_LIVE_MODEL`), then the current default.
 */
export const LIVE_MODEL =
  process.env.LIVE_VOICE_MODEL ||
  process.env.NEXT_PUBLIC_LIVE_VOICE_MODEL ||
  process.env.GEMINI_LIVE_MODEL ||
  'models/gemini-3.8-live';

/** The model the phone agent used before the upgrade; kept for comparison in tests. */
export const LIVE_MODEL_LEGACY = 'models/gemini-3.1-flash-live-preview';

/**
 * A live session is a persistent socket with hard limits: ~10 minutes per connection
 * and 15 minutes per audio-only session unless context compression is on. Both are
 * configured in the setup payload below, because discovering them at minute ten is how
 * voice assistants drop calls at the worst moment.
 */
export const LIVE_CONNECTION_MINUTES = 10;
export const LIVE_SESSION_COMPRESSION_TRIGGER = 8000;

/**
 * Which RPC to connect to, given how we are authenticating.
 *
 * Verified against the live service: an ephemeral token is refused by
 * `BidiGenerateContent` with 1008 "unregistered callers", and accepted by
 * `BidiGenerateContentConstrained`, which is the RPC the official SDKs use when a client
 * holds a short-lived token. A raw API key is the other way round. Getting this backwards
 * is an auth failure that looks exactly like a broken microphone, so it lives in one
 * tested function.
 */
export function liveSocketUrl(opts: { credential: string; mode: 'ephemeral' | 'apiKey' }): string {
  const host =
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService';
  const rpc = opts.mode === 'ephemeral' ? 'BidiGenerateContentConstrained' : 'BidiGenerateContent';
  const param = opts.mode === 'ephemeral' ? 'access_token' : 'key';
  return `${host}.${rpc}?${param}=${encodeURIComponent(opts.credential)}`;
}

/** Voices the calling product ships with. */
export const LIVE_VOICE_NAMES = ['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'] as const;

export function pickVoice(requested?: string | null, female = true): string {
  if (requested && (LIVE_VOICE_NAMES as readonly string[]).includes(requested)) return requested;
  return female ? 'Aoede' : 'Charon';
}

/**
 * The one function the live model may call.
 *
 * The realtime model is the *front end*: it listens, answers instantly, and hands real
 * work to the agent. Declaring the agent behind a single tool — rather than exposing
 * every tool to the speech model — keeps the spoken surface small and keeps all the
 * spending rules in one place, because the work runs through the normal agent loop
 * (which already stops at the approval gate before it buys anything).
 */
export const LIVE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'delegate_to_agent',
        description:
          'Hand work to the agent. Use it for anything that needs real data or a real action: ' +
          'a question about the business (leads, calls, spend, pipeline, what is selling) or an action ' +
          '(write a script, make or change a creative, generate a video, set up a follow-up). ' +
          'Say one short sentence to the owner before you call it, so they know you are on it.',
        parameters: {
          type: 'OBJECT',
          properties: {
            instructions: {
              type: 'STRING',
              description:
                'What to do, in the owner\'s own words plus anything you clarified, e.g. "how many leads did we ' +
                'get this week" or "make a Diwali image for Palm Greens, 9:16, Hinglish".',
            },
            kind: {
              type: 'STRING',
              enum: ['question', 'action'],
              description:
                'question = the owner wants an answer or numbers and nothing needs to be created. ' +
                'action = something must be produced or changed. Choosing wrong makes the owner wait ' +
                'much longer than they need to.',
            },
          },
          required: ['instructions'],
        },
      },
    ],
  },
];

/**
 * The socket setup, kept in step with the calling bridge.
 *
 * That payload is proven in production: same response modality, same voice list, same
 * voice-activity tuning. The additions here are the ones the docs require for a session
 * longer than a few minutes: session resumption (so a dropped connection continues the
 * same conversation) and context window compression (so an audio session is not capped
 * at 15 minutes).
 */
export type VadMode = 'auto' | 'manual';

/**
 * Which side decides that a turn has ended.
 *
 * Google's own Live API guidance lists three modes — automatic server VAD, a client-side
 * "hybrid" VAD, and manual push-to-talk — with automatic as the default for voice agents.
 * Manual mode (`automaticActivityDetection: { disabled: true }`) is documented on the
 * developer forum as a known trap: the model can stop responding after activityEnd and the
 * session then dies on a keepalive timeout. So automatic it is, tuned for a desk mic.
 */
export const LIVE_VAD_MODE: VadMode = (process.env.NEXT_PUBLIC_LIVE_VAD as VadMode) || 'auto';

/** Level and timing for the optional client-side turn-taking path. */
export const VAD = {
  startRms: 0.012,
  startTicks: 2,
  endRms: 0.009,
  endSilenceMs: 800,
};

/**
 * The realtime input frame shape.
 *
 * On current models the payload key is `audio`; the older `media`/`mediaChunks` shape is
 * explicitly called out as wrong in Google's guidance. Sending the legacy key is accepted
 * by the socket and silently ignored by the model — which is exactly why it looked like a
 * dead microphone while the meter was moving.
 */
export function audioFrame(base64Pcm: string): object {
  return { realtimeInput: { audio: { data: base64Pcm, mimeType: `audio/pcm;rate=${LIVE_INPUT_RATE}` } } };
}

/** Text typed into a live session goes through realtime input too, not a content turn. */
export function textFrame(text: string): object {
  return { realtimeInput: { text } };
}

export function buildSetupPayload(opts: {
  model?: string;
  voiceName?: string;
  systemInstruction: string;
  resumeHandle?: string | null;
  tools?: boolean;
  /** 'desk' = a person at a laptop, 'phone' = the narrowband calling bridge. */
  mic?: 'desk' | 'phone';
  vad?: VadMode;
}): object {
  const desk = (opts.mic || 'desk') === 'desk';
  const vadMode: VadMode = opts.vad || (desk ? LIVE_VAD_MODE : 'auto');
  const setup: any = {
    model: opts.model || LIVE_MODEL,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: pickVoice(opts.voiceName) } },
      },
    },
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    realtimeInputConfig: {
      automaticActivityDetection:
        vadMode === 'manual'
          ? // The client owns turn boundaries; the provider must not guess them.
            { disabled: true }
          : desk
          ? {
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
              silenceDurationMs: 650,
            }
          : {
              startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              silenceDurationMs: 300,
            },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // A dropped socket should continue the conversation, not restart it.
    sessionResumption: opts.resumeHandle ? { handle: opts.resumeHandle } : {},
    // Without this an audio-only session is capped at 15 minutes.
    contextWindowCompression: {
      slidingWindow: {},
      triggerTokens: String(LIVE_SESSION_COMPRESSION_TRIGGER),
    },
  };
  if (opts.tools !== false) setup.tools = LIVE_TOOLS;
  return { setup };
}

export type LiveState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'speaking'
  | 'error';

/** What the user sees. No vendor names, ever. */
export const STATE_COPY: Record<LiveState, string> = {
  idle: 'Tap to talk',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  working: 'Working on it',
  speaking: 'Speaking',
  error: 'Connection lost',
};

/** Colour per state, used by the orb so state is obvious at a glance. */
export const STATE_HUE: Record<LiveState, number> = {
  idle: 220,
  connecting: 220,
  listening: 150,
  thinking: 265,
  working: 32,
  speaking: 200,
  error: 0,
};

export interface PcmChunk {
  mimeType: string;
  data: string;
}

/** Float32 [-1,1] samples → base64 16-bit PCM, which is what the socket wants. */
export function floatToPcm16Base64(samples: Float32Array): string {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  return btoa(binary);
}

/** base64 16-bit PCM → Float32, for playback. */
export function pcm16Base64ToFloat(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer as ArrayBuffer);
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Root-mean-square level, 0..1, for the visualiser. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/**
 * Which state the orb should show, given what is happening.
 *
 * Kept pure so it can be tested: the interesting cases are "the model is talking while
 * a job runs" and "the job finished but its speech is still playing".
 */
export function resolveState(input: {
  connected: boolean;
  errored: boolean;
  playing: boolean;
  awaitingModel: boolean;
  jobRunning: boolean;
}): LiveState {
  if (input.errored) return 'error';
  if (!input.connected) return 'connecting';
  if (input.jobRunning && !input.playing) return 'working';
  if (input.playing) return 'speaking';
  if (input.awaitingModel) return 'thinking';
  return 'listening';
}

/**
 * What to say when a job starts taking noticeable time.
 *
 * Dead air is the thing that makes a voice assistant feel broken, so the panel makes
 * the model *speak* the progress line rather than showing a silent spinner. These are
 * written to be said out loud, in one breath.
 */
export function workingNarration(label: string, secondsSoFar = 0): string {
  if (secondsSoFar <= 0) {
    return `Say exactly this, briefly and naturally, then stop: "Working on ${label} now — I'll stay with you."`;
  }
  return `Say exactly this, briefly: "${label} is still running, about ${Math.round(
    secondsSoFar
  )} seconds in. I'll tell you when it's done."`;
}
