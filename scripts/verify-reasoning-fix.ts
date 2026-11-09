/**
 * Verify the reasoning_content fix through the REAL model path (getAgentModel),
 * replaying the exact 29-message checkpoint that was failing.
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
  const { data: run } = await admin
    .from('harness_runs')
    .select('id, checkpoint, user_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const messages = run?.checkpoint?.messages || [];
  console.log(`replaying ${messages.length} messages from run ${run?.id?.slice(0, 8)}`);

  const { systemPrompt, tools } = await createAgentContext(admin, run!.user_id, run!.user_id);
  const model = await getAgentModel();

  try {
    const res = await generateText({ model, system: systemPrompt, messages, tools, maxOutputTokens: 64 } as any);
    console.log('SUCCESS — model replied:', JSON.stringify((res.text || '').slice(0, 120)));
    console.log('usage:', JSON.stringify(res.usage));
  } catch (err: any) {
    console.log('STILL FAILING:', String(err?.message || err).slice(0, 240));
  }
})();
