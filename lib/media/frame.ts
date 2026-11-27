import sharp from 'sharp';
import { FRAME_BY_RATIO, normaliseImageRatio, type OfferedImageRatio } from '@/lib/agent/media-ratios';

/**
 * MAKE "4:5" MEAN 4:5.
 *
 * THE CASE THIS EXISTS FOR
 * A live account generated a creative for the Creation tab with 4:5 selected and got a LANDSCAPE image. The
 * tab had done what the code told it to: `lib/agent/media-ratios` sends every ratio to the provider as
 * `auto` (the Flare models have no 4:5 enum) and states the ratio in words inside the prompt. Words are not
 * a contract — the model composed to its own default and the operator got a ratio they never chose, on a
 * placement that had been bought for portrait.
 *
 * So the promise is kept with pixels instead of prose: whatever the model returns, the delivered image is
 * cropped to the requested frame. Centre-weighted `cover`, so the subject in the middle of the composition
 * survives and the overflow is trimmed from the edges, then resized to the frame's pixel size.
 *
 * This runs at check-status for the interactive path (the one that was wrong) and in the batch worker, so
 * every image this app delivers has been through it.
 */

export interface FramedImage {
  buffer: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
  /** What the model actually returned, so a crop is explainable rather than mysterious. */
  original: { width: number; height: number; ratio: string };
  /** True when the source already matched the frame and nothing was cropped. */
  unchanged: boolean;
}

const round = (value: number) => Math.max(1, Math.round(value));

/**
 * Crop (and if necessary upscale) an image to exactly the requested frame.
 *
 * Never throws for a valid image: on any failure the caller gets the ORIGINAL buffer back, because a
 * wrongly-shaped creative is still better than a missing one — but `unchanged` and `original` say what
 * happened so the caller can log it.
 */
export async function enforceFrame(input: Buffer, ratio: unknown, quality = 90): Promise<FramedImage> {
  const resolved: OfferedImageRatio = normaliseImageRatio(ratio);
  const frame = FRAME_BY_RATIO[resolved];

  const fallback = async (): Promise<FramedImage> => {
    let width = frame.width;
    let height = frame.height;
    try {
      const meta = await sharp(input).metadata();
      width = meta.width || width;
      height = meta.height || height;
    } catch {
      /* unreadable metadata: report the frame we asked for */
    }
    return {
      buffer: input,
      contentType: 'image/jpeg',
      width,
      height,
      original: { width, height, ratio: width && height ? ratioOf(width, height) : 'unknown' },
      unchanged: true,
    };
  };

  try {
    const meta = await sharp(input).metadata();
    const sourceWidth = meta.width || 0;
    const sourceHeight = meta.height || 0;
    if (!sourceWidth || !sourceHeight) return fallback();

    // Already exact? Nothing to do, and no re-encode to lose quality over.
    const sameRatio = Math.abs(sourceWidth / sourceHeight - frame.width / frame.height) < 0.01;
    if (sameRatio) {
      const buffer =
        sourceWidth === frame.width && sourceHeight === frame.height
          ? input
          : await sharp(input).resize(frame.width, frame.height, { fit: 'cover', position: 'centre' }).jpeg({ quality }).toBuffer();
      return {
        buffer,
        contentType: 'image/jpeg',
        width: frame.width,
        height: frame.height,
        original: { width: sourceWidth, height: sourceHeight, ratio: ratioOf(sourceWidth, sourceHeight) },
        unchanged: true,
      };
    }

    const buffer = await sharp(input)
      // `cover` fills the frame exactly, trimming the overflow; `centre` keeps the subject.
      .resize(frame.width, frame.height, { fit: 'cover', position: 'centre' })
      .jpeg({ quality })
      .toBuffer();

    return {
      buffer,
      contentType: 'image/jpeg',
      width: frame.width,
      height: frame.height,
      original: { width: sourceWidth, height: sourceHeight, ratio: ratioOf(sourceWidth, sourceHeight) },
      unchanged: false,
    };
  } catch {
    return fallback();
  }
}

/** A readable ratio for logs: 1080x1350 -> "4:5". */
export function ratioOf(width: number, height: number): string {
  if (!width || !height) return 'unknown';
  const divisor = gcd(round(width), round(height));
  return `${round(width) / divisor}:${round(height) / divisor}`;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}
