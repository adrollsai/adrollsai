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
 * The model the agent falls back to when the DeepSeek key is unusable.
 *
 * `gemini-2.5-flash` was the fallback and it is two generations behind. Verified against
 * `GET /v1beta/models` on this account (50 models visible) and the published docs
 * (https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash): the newest Flash is
 * `gemini-3.8-flash` — the list also carries 3.6 and 3.7 Flash, plus `gemini-flash-latest` as an
 * alias that silently tracks whatever is newest. A pinned id is used on purpose: an alias can move
 * under us mid-conversation and change tool-call formatting, which is the exact failure the
 * models.ts comment at the top of this file was written for.
 *
 * The id is duplicated here rather than added to `lib/agent/models.ts`, because that file is the
 * frozen, verified-against-the-API registry and is not to be edited. `verify:parity` asserts this
 * constant equals `VIDEO_ANALYSIS_MODEL` there, so the two can never drift apart unnoticed.
 */
const AGENT_FALLBACK_MODEL = 'gemini-3.8-flash';

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
              // Thinking mode: an assistant turn must echo its reasoning back, or DeepSeek
              // refuses the request with "The `reasoning_content` in the thinking mode must be
              // passed back to the API".
              //
              // HONEST STATUS: this backfills for EVERY assistant turn now, not only turns that
              // carry tool calls. That is a defensive widening, not a proven fix — the exact
              // shape that failed in production could not be reproduced against the live API
              // (plain prose, tool-call turns, content-part arrays and a null field are all
              // accepted), so this may or may not be the trigger. It is safe either way:
              // verified that the empty string is accepted with and without tool calls, and the
              // real text is kept when the SDK preserved it.
              //
              // What was NOT safe was the retry policy around it: see settleFailure in
              // lib/agent/harness/runner.ts, which now stops after one attempt instead of
              // spending five model calls on identical history.
              if (m.reasoning_content === undefined) {
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
 *
 * This is a network round trip, and it sits in front of the first token, so it is
 * cached far longer than a single turn: a healthy key does not need re-proving
 * every minute, and a busy serverless instance serves many turns per minute.
 *
 * A probe that FAILS (as opposed to being rejected) must not downgrade the model:
 * a blip reaching DeepSeek would otherwise silently switch the agent to Gemini
 * mid-conversation. Only an explicit non-200 answer marks the key bad.
 */
const KEY_CHECK_TTL_MS = 5 * 60_000;

/**
 * AN EMPTY ACCOUNT IS NOT AN UNAUTHORISED KEY, AND THE FALLBACK MISSED IT.
 *
 * `getAgentModel()` already degrades to Gemini when the DeepSeek key is REJECTED. But an account with no
 * balance still answers `/models` with 200 — authorization is fine, the wallet is not — so the probe said
 * "authorised", every turn was attempted on DeepSeek, and every turn died with "Insufficient Balance". Eight
 * runs in a day across two tenants, five retries each, and the customers saw a spinner.
 *
 * A runtime balance failure is therefore recorded here, and for a while every turn goes straight to the
 * documented fallback. The window is short on purpose: a top-up should restore the primary model without a
 * deploy, and a transient billing hiccup should not pin the platform to the fallback model forever.
 */
const OUT_OF_CREDIT_TTL_MS = 15 * 60_000;
let outOfCreditUntil = 0;
/** How often the durable (database) check may run, per instance. */
const OUT_OF_CREDIT_DB_CHECK_MS = 5 * 60_000;
let lastDbCheck = 0;
let dbSaidOutOfCredit = false;

/** True when a real call reported the provider account is dry. Exported for the UI and the watchdog. */
export function isProviderOutOfCredit(): boolean {
  return Date.now() < outOfCreditUntil || dbSaidOutOfCredit;
}

/**
 * Ask the database whether the platform has recently failed for want of provider credit.
 *
 * The in-memory flag alone was not enough, and production proved it within minutes: the re-queued runs failed
 * again, because each serverless invocation can be a COLD instance that never saw the failure and therefore
 * had no reason to stop trusting the primary model. A durable signal is the only thing that survives that.
 *
 * Reads the dead run the runner already recorded — no new table, no new column — and treats a balance failure
 * in the last hour as "the wallet is dry". Cheap, cached per instance, and it heals itself: one successful
 * top-up and a fresh run with real credit makes the query stop matching.
 */
async function refreshOutOfCreditFromDb(): Promise<void> {
  if (Date.now() - lastDbCheck < OUT_OF_CREDIT_DB_CHECK_MS) return;
  lastDbCheck = Date.now();
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(url, key, { auth: { persistSession: false } });
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data } = await db
      .from('harness_runs')
      .select('id')
      .gte('created_at', since)
      .ilike('error', '%insufficient balance%')
      .limit(1);
    const found = Array.isArray(data) && data.length > 0;
    if (found && !dbSaidOutOfCredit) {
      console.error(
        `[Agent Model] Recent runs failed for want of provider credit — routing new work to ${AGENT_FALLBACK_MODEL}.`,
      );
    }
    dbSaidOutOfCredit = found;
  } catch {
    // A failed probe must not change the decision: keep using whatever we already knew.
  }
}

/**
 * Record that the provider account has no balance.
 *
 * Called from the places that actually see the failure — the harness runner and the chat route — so the NEXT
 * turn stops trying a wallet that cannot pay. Safe to call redundantly.
 */
export function markProviderOutOfCredit(reason?: string): void {
  const wasOut = isProviderOutOfCredit();
  outOfCreditUntil = Date.now() + OUT_OF_CREDIT_TTL_MS;
  if (!wasOut) {
    console.error(
      `[Agent Model] DeepSeek account is out of credit${reason ? ` (${reason.slice(0, 120)})` : ''} — ` +
        `running on ${AGENT_FALLBACK_MODEL} for the next ${OUT_OF_CREDIT_TTL_MS / 60_000} minutes.`,
    );
  }
}

/** Recognise the provider's own words for "no money". Used by the runner, the chat route and this module. */
export function isProviderOutOfCreditError(message: unknown): boolean {
  const text = String(message ?? '');
  return /insufficient balance|insufficient_quota|exceeded your current quota|payment required|\b402\b/i.test(text);
}

/**
 * Ask the provider's own wallet whether it can actually pay, right now.
 *
 * WHY THIS EXISTS
 * Everything above infers "out of credit" from our own history: an in-memory mark that lapses after 15
 * minutes, plus a database query for balance-failed runs in the last hour. Both are guesses about the
 * PRESENT made from the PAST, and the owner corrected one of those guesses in person — the account was
 * funded while the code still believed it was dry. A top-up should not have to wait for an old row to age
 * out of a window before the platform trusts the primary model again.
 *
 * `is_available` and `total_balance` are the authoritative answer, so a funded wallet clears the flag
 * immediately. A probe that FAILS changes nothing: this may only ever restore the primary model, never
 * take it away, so a network blip cannot silently switch the agent to the fallback.
 *
 * Returns null when it could not tell.
 */
async function providerWalletIsFunded(key: string): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 2_500);
    const res = await fetch(`${DEEPSEEK_BASE_URL}/user/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    if (body?.is_available === false) return false;
    const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
    const total = infos.reduce(
      (sum: number, info: any) => sum + Number(info?.total_balance ?? 0),
      0,
    );
    if (!Number.isFinite(total)) return null;
    return total > 0;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function isDeepseekAuthorized(): Promise<boolean> {
  // A dry account is not an authorised one for our purposes: the caller wants a model that will answer.
  // Asked of the database too, because a cold instance has no memory of the last failure.
  await refreshOutOfCreditFromDb();

  if (isProviderOutOfCredit()) {
    const keyNow = getDeepseekApiKey();
    if (!keyNow) return false;
    // Believe the wallet over our own history: if it can pay, stop hedging.
    const funded = await providerWalletIsFunded(keyNow);
    if (funded !== true) return false;
    outOfCreditUntil = 0;
    dbSaidOutOfCredit = false;
    console.error(
      '[Agent Model] The provider wallet is funded again — returning to the primary model.',
    );
  }

  const key = getDeepseekApiKey();
  if (!key) return false;

  if (key === lastCheckedKey && Date.now() - lastCheckTimestamp < KEY_CHECK_TTL_MS) {
    return isKeyValidCache;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A slow probe is worse than no probe: cap it and let the request decide.
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 2_500);
    const res = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });

    isKeyValidCache = res.status === 200;
    if (!isKeyValidCache) {
      console.error(`[Agent Model] DeepSeek key rejected by /models with HTTP ${res.status}. Falling back to Gemini.`);
    }
    lastCheckedKey = key;
    lastCheckTimestamp = Date.now();
    return isKeyValidCache;
  } catch (e) {
    // Unreachable / timed out. Keep whatever we knew; with no history at all,
    // assume the key works and let the real call be the judge.
    console.error('[Agent Model] DeepSeek /models unreachable:', e instanceof Error ? e.message : e);
    if (lastCheckedKey === key) return isKeyValidCache;
    return true;
  } finally {
    if (timer) clearTimeout(timer);
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
 * Fallback: Google Gemini Flash (the current generation — see AGENT_FALLBACK_MODEL above), only
 * when there is no usable DeepSeek key.
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

  console.warn(
    `[Agent Model] ${isProviderOutOfCredit() ? 'DeepSeek account is out of credit' : 'DeepSeek key not authorized'} — ` +
      `falling back to ${AGENT_FALLBACK_MODEL}. The owner should be told the agent is running on the fallback model, ` +
      'not the primary one.'
  );
  return google(AGENT_FALLBACK_MODEL);
}
