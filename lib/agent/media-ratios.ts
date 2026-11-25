/**
 * The single owner of image aspect ratios, and of the one provider rule that goes with them.
 *
 * WHY THIS FILE EXISTS
 * The ratio an operator picks is a SOCIAL requirement: 4:5 is what Instagram and Facebook
 * actually fill the feed with, so that is what the app offers by default. The ratio the image
 * provider accepts is a different thing: the Flare image models do not carry a 4:5 enum at all.
 *
 * The old code resolved that mismatch in three separate places (this repo's `chat` route,
 * `createKieImageTask`, and the image skill's prompt builder) by quietly asking for 3:4 and
 * hoping someone cropped later. Nothing cropped, so every "4:5" creative shipped narrower than
 * the placement it was bought for.
 *
 * THE DECISION THIS FILE ENCODES
 *   - every ratio the operator can pick is sent to the provider as `auto`;
 *   - the ratio itself is stated in WORDS inside the prompt, with its pixel frame, so the model
 *     composes to it instead of to whatever its default happens to be;
 *   - one function does both, so a new call site cannot implement it differently.
 *
 * PURE: no I/O, no env, no clock, no random — so a gate can pin it without a vendor call.
 */

/** Every ratio this app offers for an image, best-first. 4:5 leads because it is the feed unit. */
export const OFFERED_IMAGE_RATIOS = ['4:5', '1:1', '9:16', '16:9'] as const;

export type OfferedImageRatio = (typeof OFFERED_IMAGE_RATIOS)[number];

/** What every image request sends instead of a ratio the provider may not have. */
export const PROVIDER_ASPECT_RATIO = 'auto' as const;

export interface FrameSpec {
  /** The ratio itself, as the operator and the social platform name it. */
  ratio: OfferedImageRatio;
  /** Human label for a picker. */
  label: string;
  /** Where it is used, in the operator's language. */
  where: string;
  /** The pixel frame the model should compose for. */
  width: number;
  height: number;
  /** The sentence injected into the prompt. Never empty, always names the ratio in words. */
  sentence: string;
}

/**
 * Pixels are the frame the composition should be built in. They are guidance to the model, not
 * a crop instruction — the provider returns whatever it returns and the prompt is what steers it.
 */
export const FRAME_BY_RATIO: Readonly<Record<OfferedImageRatio, FrameSpec>> = {
  '4:5': {
    ratio: '4:5',
    label: '4:5 Portrait',
    where: 'Instagram + Facebook feed',
    width: 1080,
    height: 1350,
    sentence:
      'Compose the whole design for a 4:5 portrait frame, 1080 by 1350 pixels — taller than a ' +
      'square, shorter than a story. Leave nothing outside this frame and crop nothing at the edges.',
  },
  '1:1': {
    ratio: '1:1',
    label: '1:1 Square',
    where: 'grid tile, carousel',
    width: 1080,
    height: 1080,
    sentence:
      'Compose the whole design for a 1:1 square frame, 1080 by 1080 pixels. Leave nothing outside ' +
      'this frame and crop nothing at the edges.',
  },
  '9:16': {
    ratio: '9:16',
    label: '9:16 Vertical',
    where: 'Stories, Reels, Shorts',
    width: 1080,
    height: 1920,
    sentence:
      'Compose the whole design for a 9:16 vertical frame, 1080 by 1920 pixels — a full-screen ' +
      'phone frame. Leave nothing outside this frame and crop nothing at the edges.',
  },
  '16:9': {
    ratio: '16:9',
    label: '16:9 Landscape',
    where: 'link ads, YouTube, website',
    width: 1920,
    height: 1080,
    sentence:
      'Compose the whole design for a 16:9 landscape frame, 1920 by 1080 pixels. Leave nothing ' +
      'outside this frame and crop nothing at the edges.',
  },
};

/** The ratio used when nobody chose one. 4:5 is the feed unit, so it is the safe default. */
export const DEFAULT_IMAGE_RATIO: OfferedImageRatio = '4:5';

/**
 * Ratios that used to be offered and may still be sitting in a saved setting or a stored row.
 * `3:4` was the old portrait; its INTENT was a feed portrait, so it becomes 4:5 rather than
 * being rejected. A row written last month must not start failing today.
 */
const LEGACY_RATIO_ALIASES: Readonly<Record<string, OfferedImageRatio>> = {
  '3:4': '4:5',
  '4x5': '4:5',
  '1x1': '1:1',
  '9x16': '9:16',
  '16x9': '16:9',
  '3x4': '4:5',
  portrait: '4:5',
  square: '1:1',
  vertical: '9:16',
  landscape: '16:9',
};

export function isOfferedImageRatio(value: unknown): value is OfferedImageRatio {
  return typeof value === 'string' && (OFFERED_IMAGE_RATIOS as readonly string[]).includes(value);
}

/**
 * Coerce anything a caller may hand us into an offered ratio.
 *
 * Never throws. A stored `3:4`, a `4x5`, a null from an old row and a typo all resolve to a
 * usable ratio, because the failure mode of throwing here is a creative that never renders.
 */
export function normaliseImageRatio(value: unknown): OfferedImageRatio {
  if (isOfferedImageRatio(value)) return value;
  const key = String(value ?? '').trim().toLowerCase();
  if (key in LEGACY_RATIO_ALIASES) return LEGACY_RATIO_ALIASES[key];
  return DEFAULT_IMAGE_RATIO;
}

/** The frame sentence for a ratio. Never throws — see `normaliseImageRatio`. */
export function frameSentenceFor(ratio: unknown): string {
  return FRAME_BY_RATIO[normaliseImageRatio(ratio)].sentence;
}

/**
 * Put the ratio into the prompt.
 *
 * Idempotent: a prompt that already carries this ratio's sentence is returned unchanged, so a
 * retry or a second wrap cannot stack the instruction twice. If the prompt already carries a
 * DIFFERENT ratio's sentence, that sentence is replaced rather than both being sent — two
 * contradictory frames is worse than none.
 */
export function withFrameSentence(prompt: string, ratio: unknown): string {
  const target = FRAME_BY_RATIO[normaliseImageRatio(ratio)];
  let text = String(prompt ?? '');

  for (const spec of Object.values(FRAME_BY_RATIO)) {
    if (spec.ratio === target.ratio) continue;
    if (text.includes(spec.sentence)) text = text.split(spec.sentence).join('').trim();
  }
  if (text.includes(target.sentence)) return text;
  return `${text.trim()} ${target.sentence}`.trim();
}

/**
 * The one function a payload builder calls.
 *
 * Returns both halves of the decision together, because sending `auto` without the sentence is
 * exactly the bug this file exists to prevent: the model then composes to its own default and
 * the operator silently gets a ratio they did not choose.
 */
export function providerImageRequest(prompt: string, ratio: unknown): {
  aspectRatio: typeof PROVIDER_ASPECT_RATIO;
  prompt: string;
  ratio: OfferedImageRatio;
  frame: FrameSpec;
} {
  const resolved = normaliseImageRatio(ratio);
  return {
    aspectRatio: PROVIDER_ASPECT_RATIO,
    prompt: withFrameSentence(prompt, resolved),
    ratio: resolved,
    frame: FRAME_BY_RATIO[resolved],
  };
}

/** For a picker: every offered ratio with its label, placement and pixels. */
export function ratioChoices(): readonly FrameSpec[] {
  return OFFERED_IMAGE_RATIOS.map((r) => FRAME_BY_RATIO[r]);
}
