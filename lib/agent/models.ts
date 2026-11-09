/**
 * Single source of truth for DeepSeek model IDs.
 *
 * Verified against `GET https://api.deepseek.com/models` — this account is
 * entitled to exactly these two. Anything else ('deepseek-chat',
 * 'deepseek-v4.1-flash', 'deepseek-v4-flash', …) is rejected by the API, and
 * because the callers fall back to Gemini on error the failure was silent:
 * the harness kept "working" while actually running on a different model with
 * different tool-call formatting.
 *
 * Keep this module import-free so tool files can use it without pulling in
 * the AI SDK providers.
 */
export const DEEPSEEK_MODELS = {
  /** Primary agent model — multimodal (text + vision). This is THE agent model. */
  flash: 'deepseek-flash',
  /** Deep-reasoning variant. Kept for reference; not wired into the agent. */
  pro: 'deepseek-v4-pro',
} as const;

/**
 * The model the harness agent runs on. Fixed to flash on purpose: it is the
 * multimodal one, so images sent with a message are understood directly.
 * (`deepseek-v4-pro` is not used by the agent — see getAgentModel.)
 */
export const AGENT_MODEL = DEEPSEEK_MODELS.flash;

/** Model used to analyse videos, which DeepSeek cannot accept. */
export const VIDEO_ANALYSIS_MODEL = 'gemini-3.8-flash';
export const VIDEO_ANALYSIS_FALLBACK_MODEL = 'gemini-2.5-flash';

export type DeepseekModelId = (typeof DEEPSEEK_MODELS)[keyof typeof DEEPSEEK_MODELS];

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * White-label display names. The UI never shows the underlying provider — this
 * is the only place a model is named for humans, so branding lives in one map.
 */
export const MODEL_DISPLAY_NAMES: Record<DeepseekModelId, string> = {
  [DEEPSEEK_MODELS.flash]: 'Nobogent Flash',
  [DEEPSEEK_MODELS.pro]: 'Nobogent Reasoner',
};

export function displayNameFor(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId as DeepseekModelId] || 'Nobogent Flash';
}
