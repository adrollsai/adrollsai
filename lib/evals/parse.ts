/**
 * Small pure helpers for reading model output.
 *
 * Kept separate from judge.ts so the self-test (scripts/verify-evals.ts) can
 * exercise the parsing without importing an AI provider. The gate must stay free
 * and offline; a gate that needs a network is a gate people skip.
 */

/**
 * Pull the first JSON object out of a reply that may still be fenced or padded.
 *
 * Models add ```json fences, a preamble sentence, or a trailing "let me know" far
 * more often than they fail to produce JSON at all — so try the obvious parse,
 * then fall back to the outermost balanced braces rather than giving up.
 */
export function extractJson(text: string): unknown {
  const cleaned = (text ?? '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to brace scanning */
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
