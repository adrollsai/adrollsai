/**
 * WCAG contrast maths, in one place.
 *
 * It started life inside the ad-prompt compiler, where it stopped a brand colour being used as body text on a
 * background it could not be read on. The page generator needs exactly the same measurement, and two copies of
 * this would eventually disagree — so it lives here and both import it.
 *
 * `relativeLuminance` returns null for anything that is not a hex colour, which is deliberate: an unparseable
 * colour must be reported as unmeasurable, never as passing.
 */

/** WCAG relative luminance for a hex colour (#abc or #aabbcc). Null when it cannot be parsed. */
export function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  let value = match[1];
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  const channel = (offset: number) => {
    const srgb = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio between two hex colours, 1–21. Null when either cannot be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}
