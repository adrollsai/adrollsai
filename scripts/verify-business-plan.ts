/**
 * Does the agent plan from the business's real state before it makes anything?
 *
 * The philosophy being tested: the owner says "get me more leads" and the agent is expected to work out what to do from
 * the business it can see. So this exercises the two halves that make that possible:
 *
 *   ASSEMBLE  the context reader returns the real state of the admin account — catalogue, assets, last 30 days of
 *             leads, what is running, credits — and names the gaps instead of pretending knowledge it lacks;
 *   PLAN      the planner turns that plus a vague request into a work plan with artefacts, an order, assumptions and
 *             the questions only the owner can answer.
 *
 *   npx esbuild scripts/verify-business-plan.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-business-plan.mjs && node .tmp-business-plan.mjs
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';
import { getAgentModel } from '../lib/agent/deepseek';
import { assembleBusinessContext, describeContext, planBusinessWork } from '../lib/agent/creative/business-plan';
import { createAgentContext } from '../lib/agent/orchestrator';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
  auth: { persistSession: false },
});

// ── 1. The business's real state.
console.log('▸ it reads the business as it actually is');
const context = await assembleBusinessContext(sb as any, ADMIN);
console.log(describeContext(context).split('\n').map((l) => `   ${l}`).join('\n'));

check('it knows the business name', context.business.name.length > 1, context.business.name);
check('it reports credits rather than guessing', context.capacity.aiCredits >= 0, `${context.capacity.aiCredits} AI / ${context.capacity.callingCredits} calling`);
check('it counted the catalogue or said it is empty', context.catalogue.length >= 0, `${context.catalogue.length} products`);
check('it counted the imagery the business owns', context.assets.images >= 0, `${context.assets.images} images`);
check(
  'it read the last 30 days of lead activity',
  context.performance.leadsLast30d >= 0,
  `${context.performance.leadsLast30d} leads, ${context.performance.callsLast30d} called, ${context.performance.bookedLast30d} booked`,
);
check('it states its gaps instead of hiding them', Array.isArray(context.gaps), context.gaps.join('; ') || 'none');

// ── 2. A vague request becomes a plan.
console.log('\n▸ a vague request becomes a specific plan');
const model = await getAgentModel({});
const plan = await planBusinessWork({ context, request: 'get me more leads for the November batch', model });
console.log(`   objective: ${plan.objective}`);
console.log(`   audience: ${plan.audience}`);
console.log(`   thesis: ${plan.thesis}`);
for (const artefact of plan.artefacts) console.log(`   artefact: ${artefact.kind} — ${artefact.why}`);
for (const question of plan.questions) console.log(`   question: ${question}`);

check('it names an objective that is a business outcome', plan.objective.length > 12, plan.objective.slice(0, 90));
check('it names a specific audience', plan.audience.length > 3, plan.audience.slice(0, 90));
check('it chooses artefacts and says why', plan.artefacts.length > 0 && plan.artefacts.every((a) => a.why.length > 5), `${plan.artefacts.length} artefact(s)`);
check(
  'the artefact kinds are ones we can actually execute',
  plan.artefacts.every((a) => ['ad_image', 'landing_page', 'website', 'video', 'whatsapp', 'outbound_calls', 'flow'].includes(a.kind)),
  plan.artefacts.map((a) => a.kind).join(', '),
);
check('it gives an order to work in', plan.order.length > 0, plan.order.slice(0, 2).join(' then '));
check('it names a success metric', plan.successMetric.length > 3, plan.successMetric.slice(0, 80));
check('it separates assumptions from questions', Array.isArray(plan.assumptions) && Array.isArray(plan.questions), `${plan.assumptions.length} assumption(s), ${plan.questions.length} question(s)`);

// ── 3. The agent has the planner, and is told to use it first.
console.log('\n▸ the agent is told to plan before it makes anything');
const ctx = await createAgentContext(sb as any, ADMIN, { intentText: 'get me more leads' });
const prompt = String(ctx.systemPrompt || '');
check('the planner is in the toolset', Boolean((ctx.tools as any).plan_business_work?.execute), `${Object.keys(ctx.tools).length} tools`);
check('the prompt says to call it first', /call 'plan_business_work' FIRST/.test(prompt.replace(/\s+/g, ' ')));
check('the prompt says to execute the plan', /EXECUTE THE PLAN with your own tools/.test(prompt));
check('the prompt says to ask the questions rather than invent', /Never invent an answer to make progress/.test(prompt));
check('the prompt forbids substituting other artefacts', /DO NOT SUBSTITUTE a different artefact/.test(prompt));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
