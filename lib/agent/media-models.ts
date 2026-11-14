/**
 * Media model registry — the single source of truth for every generated artefact
 * (image, video, voice, music).
 *
 * Why this file exists: the same kie.ai model id was being re-typed inside
 * `app/api/chat/route.ts`, `app/api/onboarding/complete/route.ts`,
 * `app/api/projects/allocate-delivery/route.ts`,
 * `app/api/cron/auto-generate/festival/route.ts` and
 * `app/api/cron/auto-generate/worker/route.ts`. Five copies drift; one does not.
 *
 * The ids below are the ones this account is actually entitled to. The public
 * `GET /api/v1/models` catalogue does NOT list the Flare image models, so do not
 * "correct" these against it.
 */

export type MediaKind = 'image' | 'imageEdit' | 'video' | 'voice' | 'music';

export interface MediaModel {
  /** primary model id, exactly as kie.ai expects it */
  id: string;
  /** tried in order when the primary errors, times out or is rate-limited */
  fallbacks: readonly string[];
  /** after this we give up on the primary and move to the fallback */
  timeoutMs: number;
  /** credits reserved per unit of work (per image / per line / per request) */
  credits: number;
  /** for video: credits are billed per second of output, not per call */
  creditsPerSecond?: number;
  notes: string;
}

export const MEDIA_MODELS = {
  /** Text -> finished image. ONE call, ONE image. Never a background + HTML overlay. */
  image: {
    id: 'gpt-image-2-5-flare-text-to-image',
    fallbacks: ['google/nano-banana-2'] as const,
    timeoutMs: 180_000,
    credits: 8,
    notes:
      'GPT 2.5 Flare t2i. Does not expose 4:5 as an explicit ratio — request 3:4 and crop in ffmpeg.',
  },

  /** Any supplied reference (product, property, logo, screenshot) -> edited image. */
  imageEdit: {
    id: 'gpt-image-2-5-flare-image-to-image',
    fallbacks: ['google/nano-banana-2', 'gpt-image-2-5-flare-text-to-image'] as const,
    timeoutMs: 180_000,
    credits: 8,
    notes: 'Use whenever the user attaches a reference. Keeps the real subject real.',
  },

  /** Motion from a real still. Always image-to-video; never text-to-video for a place. */
  video: {
    id: 'grok-imagine-video-1-5-preview',
    fallbacks: ['grok-imagine/image-to-video'] as const,
    timeoutMs: 600_000,
    credits: 0,
    creditsPerSecond: 8,
    notes: 'Grok Imagine 1.5, 1080p = 8 credits/sec. Keep clips at or under 6 s.',
  },

  /** Voiceover. 3.8 Flash is fast (~5 s) and takes sound-design direction in `scene`. */
  voice: {
    id: 'google/gemini-3-8-flash-tts',
    fallbacks: ['google/gemini-2-5-pro-tts'] as const,
    timeoutMs: 45_000,
    credits: 2,
    notes:
      // VERIFIED LIVE against kie.ai (2026-11-14), not inferred:
      //   createTask -> code 200, task SUCCESS in ~5 s, real .wav URL returned.
      // The comment this replaced claimed "Kie's catalogue lists 3.1 Flash TTS
      // Preview; there is no 3.8 TTS entry". That was wrong — do not restore it.
      // Payload shape that works (utils/external-apis.ts createGeminiTTS):
      //   input.speakers[] (speaker_id, voice_name, audio_profile, style, pace,
      //   accent) + input.dialogue_turns[] + temperature + scene + sample_context.
      // Two traps: speakers is REQUIRED ("speakers is a required parameter"),
      // and a non-empty per-speaker style is rejected with HTTP 422 — keep it
      // '' and put the sound-design direction in scene.
      '3.8 Flash supports voice sound design via the scene/style fields. Pro is the safety net for 524s.',
  },

  /** Score / bed. Suno wrapper; input.model must be set to V6_MINI. */
  music: {
    id: 'ai-music-api/generate',
    fallbacks: [] as const,
    timeoutMs: 600_000,
    credits: 12,
    notes: 'Instrumental only. Returns 4 takes per request; keep the best.',
  },
} as const satisfies Record<MediaKind, MediaModel>;

/** Primary first, then fallbacks — the order a caller should attempt. */
export function routeOrder(kind: MediaKind): string[] {
  const route = MEDIA_MODELS[kind];
  return [route.id, ...route.fallbacks];
}

/** Image model to use for a request: a reference in means image-to-image. */
export function imageModelFor(referenceUrls: readonly string[] = []): string {
  return referenceUrls.length > 0 ? MEDIA_MODELS.imageEdit.id : MEDIA_MODELS.image.id;
}

/**
 * The short, prefix-free form of a model id — `nano-banana-2` for
 * `google/nano-banana-2`. Old clients put that short form in the `model` field
 * of an /api/chat request, so the routes still accept it; deriving it here keeps
 * the string out of the routes.
 */
export function modelAlias(modelId: string): string {
  const cut = modelId.lastIndexOf('/');
  return cut === -1 ? modelId : modelId.slice(cut + 1);
}

/**
 * Credits to reserve before spending anything.
 *
 * `units` means images / lines / requests for most kinds, and SECONDS for video
 * and music, which are billed per second of output — reading `credits` there
 * would reserve 0 and let an unfunded clip start. Per-second rate wins when set.
 */
export function estimateCredits(kind: MediaKind, units = 1): number {
  const route = MEDIA_MODELS[kind] as MediaModel;
  const perUnit = route.creditsPerSecond ?? route.credits;
  return Math.ceil(perUnit * units);
}

/** Credits a video clip will cost, given its length. */
export function videoCredits(seconds: number): number {
  return estimateCredits('video', seconds);
}

/** Guard: refuse any model id that is not in the registry. */
export function assertKnownModel(modelId: string): string {
  const known: string[] = Object.values(MEDIA_MODELS).flatMap((m) => [m.id, ...m.fallbacks]);
  if (!known.includes(modelId)) {
    throw new Error(
      `Model "${modelId}" is not in MEDIA_MODELS. Add it to lib/agent/media-models.ts instead of inlining it.`,
    );
  }
  return modelId;
}

/**
 * Failure modes that are worth ONE retry on the SAME model before we spend a
 * fallback on them.
 *
 * 524 is Cloudflare giving up on kie's origin mid-generation, and kie reports
 * the same thing as the bare string `generate task timeout` on TTS. Both are
 * transient: the second identical request usually goes through. A 422 or a bad
 * prompt will never succeed, so retrying those only doubles the latency.
 */
const RETRYABLE_MEDIA_FAILURES: RegExp[] = [
  /\b524\b/,
  /generate task timeout/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\bETIMEDOUT\b/i,
  /socket hang up/i,
  /\bECONNRESET\b/i,
  /\b429\b/,
  /\b50[234]\b/,
];

/** True when a failure reason is transient enough to deserve one retry. */
export function isRetryableMediaError(reason: string | null | undefined): boolean {
  const text = String(reason ?? '');
  if (!text.trim()) return false;
  return RETRYABLE_MEDIA_FAILURES.some((pattern) => pattern.test(text));
}

export interface MediaAttemptLog {
  /** the model id this attempt used */
  model: string;
  /** 1 = first go at this model, 2 = the single retry */
  attempt: number;
  ok: boolean;
  /** why it failed, as reported by the caller or the thrown error */
  reason?: string;
}

export interface MediaRouteResult<T> {
  ok: boolean;
  value: T | null;
  /** the model that actually produced the result */
  model: string | null;
  /** true when `model` is not routeOrder(kind)[0] */
  fellBack: boolean;
  /** last failure reason, null on success */
  reason: string | null;
  attempts: MediaAttemptLog[];
  /** every decision, one line each — printed as-is so logs stay greppable */
  log: string[];
}

export interface MediaFallbackOptions<T> {
  /** prefix for the emitted log lines, e.g. 'tts' */
  label?: string;
  /** override the route (defaults to routeOrder(kind)) */
  models?: readonly string[];
  /** what counts as a usable result; defaults to "no error and a taskId" */
  isSuccess?: (value: T) => boolean;
  /** how to describe a failure that came back as a value instead of a throw */
  failureReason?: (value: T) => string | null;
  /** set false to fall back without retrying the same model first */
  retryOnce?: boolean;
  /** sink for the log lines; defaults to console.warn */
  log?: (line: string) => void;
}

function defaultIsSuccess(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('error' in v && v.error) return false;
    if ('taskId' in v) return v.taskId !== null && v.taskId !== undefined;
  }
  return true;
}

function defaultFailureReason(value: unknown): string | null {
  if (value === null || value === undefined) return 'no result returned';
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v.error) return String(v.error);
    if ('taskId' in v && (v.taskId === null || v.taskId === undefined)) return 'no taskId returned';
  }
  return null;
}

/**
 * Walk routeOrder(kind): primary first, then each fallback.
 *
 * Rules — deliberately dumb so they are easy to reason about at 3am:
 *  - a model gets ONE retry, and only for the transient failures listed above;
 *  - after that we move to the next model in the route, once each, in order;
 *  - every decision is logged with the model id and the reason, because the one
 *    thing that must never happen is "we used a fallback and nobody knew".
 *
 * The callback owns the request shape: this helper never rewrites the payload,
 * so callers keep their existing request/response contracts.
 */
export async function withMediaFallback<T>(
  kind: MediaKind,
  call: (
    model: string,
    attempt: { model: string; attempt: number; isFallback: boolean },
  ) => Promise<T>,
  options: MediaFallbackOptions<T> = {},
): Promise<MediaRouteResult<T>> {
  const label = options.label || kind;
  const models =
    options.models && options.models.length > 0 ? [...options.models] : routeOrder(kind);
  const isSuccess = options.isSuccess ?? defaultIsSuccess;
  const failureReason = options.failureReason ?? defaultFailureReason;
  const retryOnce = options.retryOnce !== false;
  const sink = options.log ?? ((line: string) => console.warn(line));

  const attempts: MediaAttemptLog[] = [];
  const log: string[] = [];
  const record = (line: string) => {
    log.push(line);
    try {
      sink(line);
    } catch {
      /* logging must never break generation */
    }
  };

  let lastReason: string | null = null;
  const maxAttempts = retryOnce ? 2 : 1;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const isFallback = i > 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let value: T | null = null;
      let failure: string | null = null;

      try {
        value = await call(model, { model, attempt, isFallback });
        if (isSuccess(value as T)) {
          attempts.push({ model, attempt, ok: true });
          const retried = attempt > 1 ? ` after one retry` : '';
          record(
            `[media:${label}] used ${model}${retried}${isFallback ? ` — FALLBACK (primary failed: ${lastReason})` : ''}`,
          );
          return {
            ok: true,
            value,
            model,
            fellBack: isFallback,
            reason: null,
            attempts,
            log,
          };
        }
        failure = failureReason(value as T) || 'no usable result';
      } catch (err: any) {
        failure = err?.message ? String(err.message) : String(err);
      }

      lastReason = failure || 'unknown failure';
      attempts.push({ model, attempt, ok: false, reason: lastReason });
      const retryable = isRetryableMediaError(lastReason);

      if (retryOnce && attempt < maxAttempts && retryable) {
        record(`[media:${label}] ${model} failed — ${lastReason} (retryable); retrying ${model} once`);
        continue;
      }

      record(
        `[media:${label}] ${model} failed — ${lastReason}${retryable ? '' : ' (not retryable)'}`,
      );
      break;
    }

    const hasNext = i + 1 < models.length;
    if (hasNext) {
      record(`[media:${label}] falling back to ${models[i + 1]} because ${model} failed`);
    } else {
      record(`[media:${label}] no model left to try after ${model}`);
    }
  }

  return {
    ok: false,
    value: null,
    model: null,
    fellBack: false,
    reason: lastReason,
    attempts,
    log,
  };
}
