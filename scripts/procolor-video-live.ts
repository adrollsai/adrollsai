/**
 * THE VIDEO PROOF: a real ad film, with reference research, real footage, real voice, real type.
 *
 * The doctrine this tests was set by the owner: reference first, then build the film with every model
 * the app actually has; narration rather than a talking head; no avatar unless clips are supplied or
 * it is explicitly asked for. So this script checks all four, not just "did a file come out":
 *
 *   reference     - did it search for a reference before designing?
 *   footage       - did it generate or animate real footage (Grok Imagine / the product's own plates)?
 *   voice         - did it narrate with TTS?
 *   no avatar     - did it avoid generating a synthetic presenter?
 *   composition   - did the typography/offers/CTA come from a real composition rather than hoping an
 *                   image model spelled them?
 *
 * It runs the REAL agent loop against the real sandbox, and walks the real review gate: every billable
 * step stages a card, this script approves it exactly as the owner's tap does, and the conversation
 * continues with the deterministic buildResumePrompt.
 *
 *   npx esbuild scripts/procolor-video-live.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-video-live.mjs && node .tmp-video-live.mjs
 *
 * Costs: real tokens, real credits, real sandbox render time. No ad spend, no money moves.
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
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';
process.env.AGENT_TURN_BUDGET_MS = process.env.AGENT_TURN_BUDGET_MS || '1500000';

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor Film Academy
const PRODUCT = 'cd40f892-81bc-4712-a40d-ac3163588628'; // Diploma in Cinematography

const REQUEST = `Make me a 15-second vertical video ad for our Diploma in Cinematography that I can post on Instagram this week.

It's the 8-week hands-on course - real shoots on professional cinema cameras, gimbals and LED lighting, taught by working industry mentors.

The offer: ₹15,000 off the November batch, and applications close 30 November.

Our number for people to call is 9569919985.

Use the course photo we already have on the catalogue if it helps. I don't have any footage of myself, so no need to put anyone on camera talking.`;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const runStarted = new Date().toISOString();
const transcript: string[] = [];
const toolsUsed = new Map<string, number>();
const artefactUrls = new Set<string>();
const videoUrls = new Set<string>();
let messages: any[] = [{ role: 'user', content: REQUEST }];
const turnTimes: { label: string; seconds: number }[] = [];

const say = (line: string) => {
  console.log(line);
  transcript.push(line);
};

async function runTurn(label: string): Promise<string> {
  const ctx = await createAgentContext(sb as any, ORG, { intentText: REQUEST });
  if (label === 'turn 1') {
    say(`tool groups: ${ctx.toolGroups.join(', ')}`);
    say(`tools: ${Object.keys(ctx.tools).length}`);
    for (const t of ['deepseek_web_search', 'generate_voiceover', 'generate_grok_video', 'generate_ai_image', 'sandbox_render_hyperframes']) {
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
    stopWhen: turnStopConditions(started, 'video-proof'),
    tools: ctx.tools as any,
    onStepFinish: (step: any) => {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      const text = (step.text || '').trim();
      if (text) say(`\n[${elapsed}s] say: ${text.slice(0, 600)}`);
      for (const call of step.toolCalls || []) {
        const name = String(call.toolName);
        toolsUsed.set(name, (toolsUsed.get(name) ?? 0) + 1);
        const args = JSON.stringify(call.input ?? call.args ?? {});
        say(`[${elapsed}s] -> ${name} ${args.slice(0, 340)}`);
      }
      for (const r of step.toolResults || []) {
        const name = String((r as any).toolName ?? '?');
        const out = JSON.stringify(r.output ?? r.result ?? {});
        say(`        <- ${out.slice(0, 460)}`);
        for (const m of out.matchAll(/https:\/\/[^"\\\s]+\.(?:mp4|mov|png|jpg|jpeg|webp|mp3)/g)) {
          artefactUrls.add(m[0]);
          if (/\.(mp4|mov)$/i.test(m[0])) videoUrls.add(m[0]);
        }
      }
    },
  });

  const finalText = await result.text;
  const response = await result.response;
  messages = [...messages, ...(response.messages as any[])];
  clearTurnDeadline();
  const seconds = Math.round((Date.now() - started) / 1000);
  turnTimes.push({ label, seconds });
  say(`\n=== ${label} finished in ${seconds}s`);
  return finalText ?? '';
}

/** Approve everything this run staged, newest first, the way the owner's tap does. */
async function approvePendingStaged(): Promise<number> {
  const pending = await sb
    .from('agent_events')
    .select('id, payload, created_at')
    .eq('user_id', ORG)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .eq('status', 'pending')
    .gte('created_at', runStarted)
    .order('created_at', { ascending: true });

  const rows = pending.data ?? [];
  if (!rows.length) return 0;

  let approved = 0;
  const resumeBits: string[] = [];
  for (const row of rows as any[]) {
    const actionId = String(row.payload?.actionId ?? '');
    if (!actionId) continue;
    const { error } = await sb
      .from('agent_events')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) {
      say(`could not approve ${actionId}: ${error.message}`);
      continue;
    }
    approved++;
    say(`\n=== APPROVED ${actionId} (${row.payload?.actionType}) — ${row.payload?.title ?? ''}`);
    resumeBits.push(
      buildResumePrompt({
        actionId,
        actionType: String(row.payload?.actionType ?? 'custom'),
        title: String(row.payload?.title ?? ''),
        resumePrompt: String(row.payload?.resumePrompt ?? ''),
      }),
    );
  }
  if (resumeBits.length) messages = [...messages, { role: 'user', content: resumeBits.join('\n\n') }];
  return approved;
}

function report(finalText: string) {
  const used = [...toolsUsed.keys()];
  const searched = used.some((t) => /deepseek_web_search|deepseek_web_fetch|scrape_run/i.test(t));
  const voiced = used.some((t) => /generate_voiceover/i.test(t));
  const footage = used.some((t) => /generate_grok_video|generate_ai_image/i.test(t));
  const composed = used.some((t) => /sandbox_render_hyperframes|sandbox_write_file|sandbox_bash_run/i.test(t));
  const avatarTool = used.filter((t) => /avatar|heygen|talking|faceswap/i.test(t));

  say(`\n${'='.repeat(72)}`);
  say('=== DOCTRINE CHECK');
  say(`  searched for a reference first : ${searched ? 'YES' : 'NO'}`);
  say(`  narrated with TTS              : ${voiced ? 'YES' : 'NO'}`);
  say(`  generated/animated footage     : ${footage ? 'YES' : 'NO'}`);
  say(`  composed (type/motion/cut)     : ${composed ? 'YES' : 'NO'}`);
  say(`  avatar / talking head tools    : ${avatarTool.length ? avatarTool.join(', ') : 'none used'}`);
  say(`  tools used (${used.length}): ${used.join(', ')}`);
  say(`\n=== TURN TIMES`);
  let total = 0;
  for (const t of turnTimes) {
    total += t.seconds;
    say(`  ${t.label}: ${t.seconds}s`);
  }
  say(`  TOTAL AGENT WALL CLOCK: ${total}s (${(total / 60).toFixed(1)} min)`);
  say(`\n=== VIDEOS PRODUCED (${videoUrls.size})`);
  for (const u of videoUrls) say(`  ${u}`);
  say(`\n=== FINAL MESSAGE\n${finalText}`);

  fs.writeFileSync('.tmp-video-transcript.txt', transcript.join('\n'), 'utf8');
  fs.writeFileSync('.tmp-video-urls.json', JSON.stringify([...videoUrls], null, 2), 'utf8');
}

try {
  let finalText = await runTurn('turn 1');
  for (let round = 1; round <= 8; round++) {
    const approved = await approvePendingStaged();
    if (!approved) {
      say('\nno staged approvals left — work is finished or blocked');
      break;
    }
    finalText = await runTurn(`turn ${round + 1} (post-approval)`);
  }
  report(finalText);
} catch (error: any) {
  say(`\nRUN FAILED: ${error?.message || error}`);
  if (error?.stack) say(String(error.stack).slice(0, 1500));
  report('');
  process.exit(1);
}
