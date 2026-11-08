import { createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

function getDeepseekApiKey() {
  return (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

let cachedProvider: ReturnType<typeof createOpenAI> | null = null;
let lastCheckedKey = '';
let isKeyValidCache = false;
let lastCheckTimestamp = 0;

export function getDeepseekProvider() {
  const key = getDeepseekApiKey();
  if (!key) return null;
  if (!cachedProvider || key !== lastCheckedKey) {
    cachedProvider = createOpenAI({
      name: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      apiKey: key,
    });
  }
  return cachedProvider;
}

/**
 * Checks if the configured DEEPSEEK_API_KEY is active and authorized.
 */
export async function isDeepseekAuthorized(): Promise<boolean> {
  const key = getDeepseekApiKey();
  if (!key) return false;

  // Use cached result if recent (60s)
  if (key === lastCheckedKey && Date.now() - lastCheckTimestamp < 60_000) {
    return isKeyValidCache;
  }

  try {
    const res = await fetch('https://api.deepseek.com/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });

    isKeyValidCache = res.status === 200;
    lastCheckedKey = key;
    lastCheckTimestamp = Date.now();
    return isKeyValidCache;
  } catch (e) {
    return false;
  }
}

/**
 * Returns the model for the task:
 * Official DeepSeek API models:
 * - 'deepseek-flash': DeepSeek-V4.1-Flash (natively supports input_modalities: ["text", "image"])
 * - 'deepseek-v4-pro': DeepSeek-V4-Pro for pro reasoning
 * - Seamless fallback to Google Gemini Flash if DeepSeek is unreachable
 */
export async function getAgentModel(options: { preferReasoning?: boolean; hasVision?: boolean } = {}) {
  const { preferReasoning = false, hasVision = false } = options;
  const isAuthorized = await isDeepseekAuthorized();

  if (isAuthorized) {
    const provider = getDeepseekProvider();
    if (provider) {
      // deepseek-flash natively handles both text and images
      const modelName = preferReasoning ? 'deepseek-v4-pro' : 'deepseek-flash';
      return provider.chat(modelName);
    }
  }

  console.warn('[Agent Model] DeepSeek key not authorized, falling back to Gemini Flash.');
  return google('gemini-2.5-flash');
}
