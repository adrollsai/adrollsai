import { createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

function getDeepseekApiKey() {
  return (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

let cachedProvider: ReturnType<typeof createOpenAI> | null = null;

export function getDeepseekProvider() {
  const key = getDeepseekApiKey();
  if (!key) return null;
  if (!cachedProvider) {
    cachedProvider = createOpenAI({
      name: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      apiKey: key,
      compatibility: 'compatible',
    });
  }
  return cachedProvider;
}

/**
 * Returns the best model for the current task:
 * - DeepSeek v4.1-Flash / chat for blazing-fast agentic reasoning & execution
 * - DeepSeek-Reasoner for deep Chain-of-Thought
 * - Gemini 2.5/3-Flash for native high-resolution vision (brochures, flyers, site photos)
 */
export function getAgentModel(options: { preferReasoning?: boolean; hasVision?: boolean } = {}) {
  const { preferReasoning = false, hasVision = false } = options;

  if (hasVision) {
    // Gemini 2.5 Flash has the highest fidelity for vision
    return google('gemini-2.5-flash');
  }

  const provider = getDeepseekProvider();
  if (provider) {
    const modelName = preferReasoning ? 'deepseek-reasoner' : 'deepseek-chat';
    return provider.chat(modelName);
  }

  // Fallback to Google Gemini
  return google('gemini-2.5-flash');
}
