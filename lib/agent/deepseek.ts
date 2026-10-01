import { createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

const deepseekApiKey = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();

export const deepseekProvider = createOpenAI({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: deepseekApiKey,
  compatibility: 'compatible',
});

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

  if (deepseekApiKey) {
    const modelName = preferReasoning ? 'deepseek-reasoner' : 'deepseek-chat';
    return deepseekProvider.chat(modelName);
  }

  // Fallback to Google Gemini
  return google('gemini-2.5-flash');
}
