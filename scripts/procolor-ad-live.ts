/**
 * THE AD PROOF: does asking for an ad actually produce an ad?
 *
 * The complaint this answers is "the creatives you made were just images, nothing like ads."
 * b59adfc1 answered it in two places - an ad intent now loads the ad tools, and BRIEF DISCIPLINE
 * step 0 says a still creative must be a COMPOSITION with a headline, an offer and a call to
 * action - but neither was proven live. This script proves it against the real thing.
 *
 * It runs the REAL agent loop: the real orchestrator, the real system prompt for this request,
 * the real tool catalogue, the real DeepSeek model, the real E2B sandbox, the real review gate.
 * Nothing here writes the ad; the agent does.
 *
 * THE APPROVAL CYCLE IS PART OF THE TEST. If the agent reaches for a billable generation tool the
 * review gate refuses it and records a card, exactly as in production. This script then does what
 * the owner's Approve button does (mark the event approved) and resumes with the deterministic
 * buildResumePrompt, carrying the whole conversation forward the way the chat route does. So a
 * pass here means the loop really closes.
 *
 *   npx esbuild scripts/procolor-ad-live.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-ad-live.mjs && node .tmp-ad-live.mjs
 *
 * Costs: real tokens, real credits, one or more sandbox renders. No ad spend, no money moves.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { streamText } from 'ai';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { getAgentModel } from '../lib/agent/deepseek';
import { turnStopConditions, setTurnDeadline, clearTurnDeadline } from '../lib/agent/turn-limits';
import { buildResumePrompt } from '../lib/agent/resume-prompt';

dotenv.config({ path: '.env.local', quiet: true });

// The published media template is what Vercel runs; use the same one locally, or the render runs
// on a template without the HyperFrames toolchain and the proof measures the wrong thing.
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';
process.env.AGENT_TURN_BUDGET_MS = process.env.AGENT_TURN_BUDGET_MS || '900000';

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor Film Academy
const PRODUCT = 'cd40f892-81bc-4712-a40d-ac3163588628'; // Diploma in Cinematography

const REQUEST = `Make me an ad for our Diploma in Cinematography.

It's the 8-week hands-on course - real shoots on professional cinema cameras, gimbals and LED lighting, taught by working industry mentors.

The offer: ₹15,000 off the November batch, and applications close 30 November.

Our number for people to call is 9569919985.

I want a vertical Instagram ad - a still, 1080x1920. Something I can post today.`;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const runStarted = new Date().toISOString();
const transcript: string[] = [];
const toolCalls: { tool: string; args: string; out: string; ms: number }[] = [];
const artefactUrls = new Set<string>();
let messages: any[] = [{ role: 'user', content: REQUEST }];

const say = (line: string) => {
  console.log(line);
  transcript.push(line);
};

async function runTurn(label: string): Promise<string> {
  const ctx = await createAgentContext(sb as any, ORG, { intentText: REQUEST });
  if (label === 'turn 1') {
    say(`tool groups: ${ctx.toolGroups.join(', ')}`);
    say(`why: ${ctx.groupReasons.join('; ')}`);
    say(`tools available: ${Object.keys(ctx.tools).length}`);
    for (const t of ['generate_ai_image', 'generate_grok_video', 'generate_voiceover', 'sandbox_render_hyperframes', 'get_recipe']) {
      say(`  has ${t}: ${Object.keys(ctx.tools).includes(t)}`);
    }
  }

  const model = await getAgentModel({});
  const started = Date.now();
  setTurnDeadline(started);

  const result = streamText({
    model,
    system: ctx.systemPrompt,
    messages,
    stopWhen: turnStopConditions(started, 'ad-proof'),
    tools: ctx.tools as any,
    onStepFinish: (step: any) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      const text = (step.text || '').trim();
      if (text) say(`\n[${elapsed}s] say: ${text.slice(0, 700)}`);
      for (const call of step.toolCalls || []) {
        const args = JSON.stringify(call.input ?? call.args ?? {});
        say(`[${elapsed}s] -> ${call.toolName} ${args.slice(0, 400)}`);
      }
      for (const r of step.toolResults || []) {
        const out = JSON.stringify(r.output ?? r.result ?? {});
        say(`        <- ${out.slice(0, 500)}`);
        for (const m of out.matchAll(/https:\/\/[^"\\\s]+\.(?:mp4|png|jpg|jpeg|webp|mp3)/g)) {
          artefactUrls.add(m[0]);
        }
        toolCalls.push({ tool: String((r as any).toolName ?? '?'), args: '', out: out.slice(0, 4000), ms: 0 });
      }
    },
  });

  const finalText = await result.text;
  const response = await result.response;
  messages = [...messages, ...(response.messages as any[])];
  clearTurnDeadline();
  say(`\n=== ${label} finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  return finalText ?? '';
}

function report() {
  say(`\n${'='.repeat(72)}`);
  say('=== ARTEFACT URLS SEEN IN TOOL RESULTS');
  if (!artefactUrls.size) say('  NONE');
  for (const url of artefactUrls) say(`  ${url}`);
  fs.writeFileSync('.tmp-ad-transcript.txt', transcript.join('\n'), 'utf8');
  fs.writeFileSync('.tmp-ad-urls.json', JSON.stringify([...artefactUrls], null, 2), 'utf8');
}

try {
  let finalText = await runTurn('turn 1');

  // The approval cycle: anything still pending that this run staged gets approved, then the
  // conversation continues with the same history - the same thing the chat surface does.
  for (let round = 1; round <= 4; round++) {
    const pending = await sb
      .from('agent_events')
      .select('id, payload, created_at')
      .eq('user_id', ORG)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending')
      .gte('created_at', runStarted)
      .order('created_at', { ascending: false });

    const rows = pending.data ?? [];
    if (!rows.length) {
      say(`\nno pending approvals from this run — no approval round trip needed`);
      break;
    }

    const row: any = rows[0];
    const actionId = String(row.payload?.actionId ?? '');
    const actionType = String(row.payload?.actionType ?? 'custom');
    say(`\n=== APPROVING ${actionId} (${actionType}) — ${row.payload?.title ?? ''}`);

    const { error } = await sb
      .from('agent_events')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      say(`could not approve: ${error.message}`);
      break;
    }

    const resume = buildResumePrompt({
      actionId,
      actionType,
      title: String(row.payload?.title ?? ''),
      resumePrompt: String(row.payload?.resumePrompt ?? ''),
    });
    say(`resume prompt:\n${resume}`);
    messages = [...messages, { role: 'user', content: resume }];
    finalText = await runTurn(`turn ${round + 1} (post-approval)`);
  }

  say(`\n${'='.repeat(72)}\n=== FINAL MESSAGE TO THE OWNER\n${finalText}`);
} catch (error: any) {
  say(`\nRUN FAILED: ${error?.message || error}`);
  if (error?.stack) say(String(error.stack).slice(0, 2000));
  report();
  process.exit(1);
}

report();
