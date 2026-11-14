/**
 * Does the Create flow behave the way the panel promises?
 *
 * The panel tells the user "plan first, generate after my OK". That is only true if the
 * agent, given that message, actually does the cheap work first and stops at one review
 * instead of spending on the expensive model. So this watches the real turn and checks
 * the ORDER of tool calls, not just which tools appeared.
 *
 *   npm run verify:create-live
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { generateText, stepCountIs } from 'ai';
import { createAgentContext } from '../lib/agent/orchestrator';
import { getAgentModel } from '../lib/agent/deepseek';
import { buildCreateIntent } from '../lib/agent/create-intent';

const PAID = ['generate_grok_video', 'generate_ai_image'];
const CHEAP_PREVIEW = ['generate_voiceover'];

interface Case {
  name: string;
  prompt: string;
  /** Must appear in this order somewhere in the turn. */
  order: Array<[string, string]>;
  mustCall: string[];
  /** The card must carry a spec sheet of at least this many rows. */
  minSpec?: number;
}

const CASES: Case[] = [
  {
    name: 'a video create stops at one review, before any paid generation',
    prompt: buildCreateIntent({
      kind: 'video',
      ratio: '9:16',
      resolution: '720p',
      seconds: 15,
      refMode: 'random',
      brief: 'Diwali offer for a 3BHK in Mohali',
    }),
    mustCall: ['request_human_approval'],
    order: [['request_human_approval', 'PAID_ANY']],
    minSpec: 3,
  },
  {
    name: 'an image create with a chosen template reviews before generating',
    prompt: buildCreateIntent({
      kind: 'image',
      ratio: '1:1',
      refMode: 'pick',
      reference: { id: 'pinterest_pin_4', name: 'Marina Skyline Gold', category: 'waterfront' },
      brief: 'weekend open house, Palm Greens',
    }),
    mustCall: ['request_human_approval'],
    order: [['request_human_approval', 'PAID_ANY']],
    minSpec: 2,
  },
];

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: profile } = await sb.from('profiles').select('id, business_name').limit(1).maybeSingle();
  if (!profile?.id) {
    console.error('no profile');
    process.exit(1);
  }
  console.log(`agent under test: ${profile.business_name}\n`);

  let pass = 0;
  let fail = 0;

  for (const c of CASES) {
    const ctx = await createAgentContext(sb, profile.id, { intentText: c.prompt });
    const called: string[] = [];
    let reply = '';
    let approvalArtifact: any = null;

    try {
      const res = await generateText({
        model: await getAgentModel(),
        system: ctx.systemPrompt,
        tools: ctx.tools as any,
        stopWhen: stepCountIs(14),
        prompt: c.prompt,
        onStepFinish: (step: any) => {
          for (const tc of step.toolCalls || []) if (tc?.toolName) called.push(tc.toolName);
          for (const tr of step.toolResults || []) {
            const out: any = (tr as any)?.result ?? (tr as any)?.output;
            if (out?.artifact?.type === 'action_confirmation') approvalArtifact = out.artifact;
          }
          if (step.text) reply += `\n${step.text}`;
        },
      });
      reply = (res.text || reply).trim();
    } catch (e: any) {
      console.log(`FAIL  ${c.name} — the turn errored: ${String(e?.message || e).slice(0, 200)}`);
      fail++;
      continue;
    }

    const problems: string[] = [];
    for (const t of c.mustCall) if (!called.includes(t)) problems.push(`never called ${t}`);

    // Order: the review must come before any paid generation; if nothing paid ran, that
    // is fine too (it stopped correctly at the gate).
    for (const [first, second] of c.order) {
      const iFirst = called.indexOf(first);
      const secondIdx =
        second === 'PAID_ANY'
          ? called.findIndex((t) => PAID.includes(t))
          : called.indexOf(second);
      if (iFirst < 0) problems.push(`missing ${first}`);
      else if (secondIdx >= 0 && secondIdx < iFirst) {
        problems.push(`${second} ran BEFORE ${first} (${called.join(' → ')})`);
      }
    }

    if (c.minSpec) {
      const rows = approvalArtifact?.spec?.length || 0;
      if (!approvalArtifact) problems.push('no approval card was produced');
      else if (rows < c.minSpec) problems.push(`card spec had ${rows} rows, wanted >= ${c.minSpec}`);
      if (approvalArtifact && !approvalArtifact.resumePrompt) problems.push('card had no resumePrompt, so approving would dead-end');
    }

    if (problems.length) {
      fail++;
      console.log(`FAIL  ${c.name}`);
      for (const p of problems) console.log(`        - ${p}`);
    } else {
      pass++;
      const cheap = called.filter((t) => CHEAP_PREVIEW.includes(t));
      console.log(
        `PASS  ${c.name}  (tools: ${called.join(' → ')})${cheap.length ? '  [preview generated first]' : ''}`
      );
      if (approvalArtifact?.spec) {
        for (const row of approvalArtifact.spec) {
          console.log(`        ${row.label}: ${String(row.value).replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    console.log(`        reply: ${reply.replace(/\s+/g, ' ').slice(0, 240)}\n`);
  }

  console.log(`=== ${pass}/${pass + fail} live create checks passed ===`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
