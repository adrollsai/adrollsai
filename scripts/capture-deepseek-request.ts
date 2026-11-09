/**
 * Capture the exact HTTP body the AI SDK sends to DeepSeek for the failing run,
 * then inspect the assistant messages for the shape DeepSeek rejects.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'node:fs';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { extractReasoningMiddleware, wrapLanguageModel } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

const key = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let captured: any = null;

const loggingFetch = async (url: any, options?: any) => {
  try {
    if (typeof options?.body === 'string') captured = JSON.parse(options.body);
  } catch {
    /* ignore */
  }
  return fetch(url, options);
};

(async () => {
  const { data: run } = await admin
    .from('harness_runs')
    .select('id, checkpoint, user_id, session_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const messages = run?.checkpoint?.messages || [];
  console.log('checkpoint messages:', messages.length);

  const { systemPrompt, tools } = await createAgentContext(admin, run!.user_id, run!.user_id);
  const provider = createOpenAI({ baseURL: 'https://api.deepseek.com', apiKey: key, fetch: loggingFetch as any });
  const model = wrapLanguageModel({
    model: provider.chat('deepseek-flash'),
    middleware: extractReasoningMiddleware({ tagName: 'think' }),
  });

  try {
    const res = await generateText({ model, system: systemPrompt, messages, tools, maxOutputTokens: 16 } as any);
    console.log('SUCCESS:', JSON.stringify(res.text).slice(0, 60));
  } catch (err: any) {
    console.log('FAILED:', String(err?.message || err).slice(0, 200));
  }

  if (!captured) {
    console.log('no request captured');
    return;
  }

  fs.writeFileSync('.tmp-deepseek-request.json', JSON.stringify(captured, null, 2));
  console.log('\nrequest captured → .tmp-deepseek-request.json');
  console.log('assistant messages as the SDK serialised them:');
  for (const [i, m] of captured.messages.entries()) {
    if (m.role !== 'assistant' && m.role !== 'tool') continue;
    const keys = Object.keys(m).join(',');
    const tc = Array.isArray(m.tool_calls) ? ` tool_calls=${m.tool_calls.length}` : '';
    const rc =
      m.reasoning_content === undefined
        ? ' reasoning_content=ABSENT'
        : ` reasoning_content=${JSON.stringify(String(m.reasoning_content)).slice(0, 40)}`;
    const content = m.content === null ? 'null' : typeof m.content === 'string' ? `"${m.content.slice(0, 30)}"` : typeof m.content;
    console.log(`  [${i}] ${m.role} keys={${keys}} content=${content}${tc}${rc}`);
  }
})();
