import { createOpenAI } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { DEEPSEEK_MODELS, DEEPSEEK_BASE_URL } from './models';

function getDeepseekApiKey() {
  return (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

export { DEEPSEEK_MODELS, DEEPSEEK_BASE_URL };
export type { DeepseekModelId } from './models';

/**
 * Custom fetch for DeepSeek SSE stream:
 * DeepSeek returns reasoning inside `delta.reasoning_content`.
 * We wrap reasoning into <think>...</think> tags so that AI SDK's
 * `extractReasoningMiddleware` cleanly separates reasoning and text.
 */
const deepseekStreamFetch = async (url: RequestInfo | URL, options?: RequestInit) => {
  let cleanedOptions = options;
  if (options?.body && typeof options.body === 'string') {
    try {
      const parsed = JSON.parse(options.body);
      if (Array.isArray(parsed.messages)) {
        // DeepSeek requires every assistant message to have either non-empty content or non-empty tool_calls
        parsed.messages = parsed.messages
          .filter((m: any) => {
            if (!m) return false;
            if (m.role === 'assistant') {
              const hasContent = typeof m.content === 'string'
                ? m.content.trim().length > 0
                : Boolean(m.content && (!Array.isArray(m.content) || m.content.length > 0));
              const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
              return hasContent || hasToolCalls;
            }
            return true;
          })
          .map((m: any) => {
            if (m.role === 'assistant') {
              const hasContent = typeof m.content === 'string'
                ? m.content.trim().length > 0
                : Boolean(m.content && (!Array.isArray(m.content) || m.content.length > 0));
              const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
              if (!hasContent && !hasToolCalls) {
                return { ...m, content: 'Continuing workflow...' };
              }
              // Thinking mode: an assistant turn that carries tool calls must
              // echo its reasoning back. The AI SDK drops `reasoning` parts when
              // serialising, so any REPLAYED tool-calling history is rejected
              // with "The `reasoning_content` in the thinking mode must be
              // passed back to the API" — which broke every durable resume.
              // Verified against the live API: an empty string is accepted, so
              // preserving the exact text is optional (we keep it when present).
              if (hasToolCalls && m.reasoning_content === undefined) {
                return { ...m, reasoning_content: '' };
              }
            }
            return m;
          });
        cleanedOptions = {
          ...options,
          body: JSON.stringify(parsed),
        };
      }
    } catch (e) {}
  }

  const res = await fetch(url, cleanedOptions);
  if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) {
    return res;
  }

  let isFirstReasoning = true;
  let hasReasoning = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (hasReasoning) {
              controller.enqueue(encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"</think>\\n"}}]}\n\n'));
            }
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
              try {
                const json = JSON.parse(line.slice(6));
                const delta = json.choices?.[0]?.delta;
                if (delta && delta.reasoning_content) {
                  hasReasoning = true;
                  let text = delta.reasoning_content;
                  if (isFirstReasoning) {
                    text = '<think>' + text;
                    isFirstReasoning = false;
                  }
                  delta.content = text;
                  controller.enqueue(encoder.encode('data: ' + JSON.stringify(json) + '\n\n'));
                  continue;
                } else if (hasReasoning && delta && delta.content) {
                  delta.content = '</think>\n' + delta.content;
                  hasReasoning = false;
                  controller.enqueue(encoder.encode('data: ' + JSON.stringify(json) + '\n\n'));
                  continue;
                }
                controller.enqueue(encoder.encode(line + '\n'));
              } catch (e) {
                controller.enqueue(encoder.encode(line + '\n'));
              }
            } else {
              controller.enqueue(encoder.encode(line + '\n'));
            }
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
};

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
      baseURL: DEEPSEEK_BASE_URL,
      apiKey: key,
      fetch: deepseekStreamFetch as any,
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

  if (key === lastCheckedKey && Date.now() - lastCheckTimestamp < 60_000) {
    return isKeyValidCache;
  }

  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });

    isKeyValidCache = res.status === 200;
    if (!isKeyValidCache) {
      console.error(`[Agent Model] DeepSeek key rejected by /models with HTTP ${res.status}. Falling back to Gemini.`);
    }
    lastCheckedKey = key;
    lastCheckTimestamp = Date.now();
    return isKeyValidCache;
  } catch (e) {
    console.error('[Agent Model] DeepSeek /models unreachable:', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Returns the model for the harness agent.
 *
 * Fixed to `deepseek-flash` — it is the multimodal model, so attached images
 * reach it as real image content parts rather than being described in text.
 * `preferReasoning` is still accepted so existing callers keep working, but it
 * no longer selects a different model: the reasoner (`deepseek-v4-pro`) is not
 * used by the agent.
 *
 * Fallback: Google Gemini Flash, only when there is no usable DeepSeek key.
 */
export async function getAgentModel(options: { preferReasoning?: boolean; hasVision?: boolean } = {}) {
  void options;
  const isAuthorized = await isDeepseekAuthorized();

  if (isAuthorized) {
    const provider = getDeepseekProvider();
    if (provider) {
      const baseModel = provider.chat(DEEPSEEK_MODELS.flash);
      return wrapLanguageModel({
        model: baseModel,
        middleware: extractReasoningMiddleware({ tagName: 'think' }),
      });
    }
  }

  console.warn('[Agent Model] DeepSeek key not authorized — falling back to Gemini Flash.');
  return google('gemini-2.5-flash');
}
