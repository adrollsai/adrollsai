/**
 * LIVE AGENT TEST.
 *
 * Runs the real agent loop — same model, same system prompt, same 57-tool
 * catalogue, same stop conditions — against a real request, and records exactly
 * which path it chooses. This is the empirical answer to "would it work it out
 * by itself", rather than an opinion.
 *
 *   npm run test:live-agent
 *
 * Costs real DeepSeek tokens and real sandbox time.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { streamText } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { getAgentModel } from '../lib/agent/deepseek';
import { turnStopConditions } from '../lib/agent/turn-limits';

const SOURCE_VIDEO =
  process.env.DEMO_SOURCE_VIDEO ||
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/demo-behind/1794247488701_src.mp4';

const REQUEST = `Put the words "NOBOGENT" with a smaller line underneath reading "BEHIND THE HEAD" behind the person in this video, so her head and hair hide the middle of the text and the rest of it sits on the background. Give me the finished MP4.

[Attached File: presenter.mp4 (video)]
${SOURCE_VIDEO}`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const steps: { n: number; tools: string[]; text: string }[] = [];
const toolCallLog: string[] = [];

(async () => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, business_name')
    .not('facebook_token', 'is', null)
    .limit(1)
    .maybeSingle();
  if (!profile?.id) throw new Error('no profile');

  console.log(`profile: ${profile.business_name} (${profile.id})`);
  const ctx = await createAgentContext(supabase as any, profile.id, { intentText: REQUEST });
  const { systemPrompt, tools } = ctx;
  console.log(`tool groups: ${ctx.toolGroups.join(', ')}`);
  const model = await getAgentModel({});
  console.log(`model: ${JSON.stringify(model?.modelId || model)} · tools: ${Object.keys(tools).length}`);
  console.log(`\nREQUEST:\n${REQUEST.slice(0, 300)}\n${'='.repeat(70)}`);

  const started = Date.now();
  const result = streamText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: REQUEST }],
    stopWhen: turnStopConditions(started, 'Nobo Agent'),
    tools,
    onStepFinish: (step: any) => {
      const calls = (step.toolCalls || []).map((c: any) => {
        const args = JSON.stringify(c.input ?? c.args ?? {}).slice(0, 260);
        toolCallLog.push(`${c.toolName} ${args}`);
        return c.toolName;
      });
      const text = (step.text || '').trim();
      steps.push({ n: steps.length + 1, tools: calls, text: text.slice(0, 200) });
      console.log(`\n--- step ${steps.length}`);
      if (text) console.log(`  say: ${text.slice(0, 300)}`);
      for (const c of step.toolCalls || []) {
        console.log(`  tool: ${c.toolName} ${JSON.stringify(c.input ?? c.args ?? {}).slice(0, 320)}`);
      }
      for (const r of step.toolResults || []) {
        const out = JSON.stringify(r.output ?? r.result ?? {}).slice(0, 320);
        console.log(`  -> ${out}`);
      }
    },
  });

  const finalText = await result.text;
  const usage = await result.usage;

  console.log(`\n${'='.repeat(70)}\n=== FINAL MESSAGE\n${finalText}\n`);
  console.log('=== STATS');
  console.log(`steps: ${steps.length}, wall clock: ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`tool calls: ${toolCallLog.length}`);
  console.log('distinct tools:', [...new Set(toolCallLog.map((t) => t.split(' ')[0]))].join(', '));
  console.log('usage:', JSON.stringify(usage));

  // Did it reach for the right technique on its own?
  const all = toolCallLog.join('\n');
  const usedFfmpeg = /ffmpeg/.test(all);
  const usedMatte = /mediapipe|selfie|matting|segment/i.test(all);
  const triedHtml = /hyperframes|index\.html|gsap/i.test(all);
  const verified = /analyze_video_with_gemini/.test(all);
  console.log('\n=== VERDICT');
  console.log(`used ffmpeg:            ${usedFfmpeg}`);
  console.log(`used a matte/segmenter: ${usedMatte}`);
  console.log(`went down the HTML path:${triedHtml}`);
  console.log(`self-verified output:   ${verified}`);
})().catch((e) => {
  console.error('live agent test failed:', e?.message || e);
  process.exit(1);
});
