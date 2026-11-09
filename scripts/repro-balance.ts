/**
 * Reproduce the runner's exact model call: same model, same system prompt, same
 * ~60-tool catalogue. Answers whether "Insufficient Balance" is about request
 * size rather than an empty account.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { generateText } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { getAgentModel } from '../lib/agent/deepseek';
import { createAgentContext } from '../lib/agent/orchestrator';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

(async () => {
  const { data: profiles } = await admin.from('profiles').select('id').limit(1);
  const userId = profiles![0].id as string;

  const { systemPrompt, tools } = await createAgentContext(admin, userId, userId);
  const toolNames = Object.keys(tools);
  const schemaChars = JSON.stringify(
    toolNames.map((n) => ({ n, d: (tools as any)[n]?.description, s: (tools as any)[n]?.inputSchema }))
  ).length;

  console.log(`tools: ${toolNames.length}`);
  console.log(`system prompt chars: ${systemPrompt.length}`);
  console.log(`tool-catalogue chars (approx prompt cost): ${schemaChars}`);
  console.log(`≈ prompt tokens: ${Math.round((systemPrompt.length + schemaChars) / 4)}\n`);

  const model = await getAgentModel();
  try {
    const res = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      tools,
      toolsChoice: undefined,
      maxOutputTokens: 20,
    } as any);
    console.log('SUCCESS — text:', JSON.stringify(res.text).slice(0, 80));
    console.log('usage:', JSON.stringify(res.usage));
  } catch (err: any) {
    console.log('FAILED:', String(err?.message || err).slice(0, 400));
    console.log('status:', err?.statusCode ?? err?.status ?? '(none)');
    console.log('cause:', JSON.stringify(err?.cause ?? null).slice(0, 400));
  }
})();
