/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test harness: tool objects and playbook rows are untyped.
 */
/**
 * Verification suite for the PRE-FLIGHT CONTRACT.
 *
 *   npm run verify:preflight
 *
 * The agent must gather the inputs it cannot guess BEFORE it starts a big
 * action. Two halves are covered here:
 *
 *   A. the rule — the assembled system prompt carries the contract and names all
 *      four categories of action that must not start on assumptions;
 *   B. the guard — the campaign-launch and bulk-action tools refuse instead of
 *      acting, and the refusal names exactly what to ask.
 *
 * All offline. No vendor call, no send, no database write: the Supabase client is
 * a stub, and the tools are invoked in the one state where they must stop before
 * the first network call.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { createAgentContext } from '../lib/agent/orchestrator';
import { createMetaAdsMcpTools } from '../lib/agent/mcp/meta-ads-mcp';
import { createMetaGraphTools } from '../lib/agent/mcp/meta-graph';
import { createWhatsAppTools } from '../lib/agent/tools/whatsapp';
import { createVoiceTools } from '../lib/agent/tools/voice';
import { createHumanApprovalTool } from '../lib/agent/tools/human_approval';
import { preflightPromptSection, checkCampaignLaunch, checkBulkAction } from '../lib/agent/preflight';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`ok    ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`
  );
}

/**
 * A Supabase stub. `tables` maps a table name to the row `.maybeSingle()` /
 * `.single()` should return; anything unlisted resolves to null (no active
 * playbook, no skills), which is the strict path the guard must handle.
 */
function fakeSupabase(tables: Record<string, any> = {}) {
  const make = (row: any) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: () => chain,
      update: () => chain,
      maybeSingle: async () => ({ data: row ?? null, error: null }),
      single: async () => ({ data: row ?? null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve),
    };
    return chain;
  };
  return {
    from: (table: string) => make(tables[table] ?? null),
    rpc: async () => ({ data: null, error: null }),
  } as any;
}

const PROFILE = {
  business_name: 'Procolor Film Academy',
  industry: 'education',
  currency: 'INR',
  role: 'owner',
  email: 'owner@procolor.test',
  logo_url: 'https://cdn.example.test/logo.png',
  brand_color: '#0F172A',
  contact_number: '+910000000000',
  mission_statement: 'We train people who want to work in film and television.',
  business_landing_hero_title: 'Learn the craft',
};

/** The assembled system prompt for a tenant, offline. */
async function assemble(profile: Record<string, any> = PROFILE, forceGroups?: any[]) {
  const sb = fakeSupabase({
    profiles: profile,
    business_playbooks: null,
    agent_skills: null,
    assets: null,
    leads: null,
  });
  const ctx = await createAgentContext(sb, 'user-1', forceGroups ? { forceGroups } : { intentText: 'hello' });
  return ctx.systemPrompt;
}

/* ====================================================================== */
/* A. THE RULE IS IN THE SYSTEM PROMPT AND NAMES ALL FOUR CATEGORIES      */
/* ====================================================================== */
async function testRuleInPrompt() {
  console.log('\n— A. the pre-flight rule is in the system prompt —');

  const prompt = await assemble();
  const rule = preflightPromptSection(undefined);

  check('the assembled prompt carries the pre-flight contract', prompt.includes('PRE-FLIGHT CONTRACT'));
  check('the rule survives a minimal tool selection too', (await assemble(PROFILE, ['core'])).includes('PRE-FLIGHT CONTRACT'));
  check(
    'the rule survives an unrelated ask (no group is allowed to drop it)',
    (await assemble(PROFILE, ['meta'])).includes('PRE-FLIGHT CONTRACT')
  );

  // The named categories — the four kinds of action that must not start blind.
  check(
    'category 1: launching / pausing / adjusting an ad campaign',
    /LAUNCHING, PAUSING OR ADJUSTING AN AD CAMPAIGN/i.test(prompt)
  );
  check(
    'category 2: producing more than a couple of creatives in one go',
    /PRODUCING MORE THAN A COUPLE OF CREATIVES IN ONE GO/i.test(prompt)
  );
  check(
    'category 3: bulk messaging or calling leads',
    /BULK MESSAGING OR CALLING LEADS/i.test(prompt)
  );
  check(
    'category 4: anything that spends credits above ~200',
    /ANYTHING THAT SPENDS CREDITS ABOVE ~200/i.test(prompt)
  );

  // The required inputs of category 1, stated explicitly.
  for (const item of ['objective', 'budget', 'currency', 'locations', 'asset', 'qualifying questions', 'start date']) {
    check(`category 1 requires the ${item}`, new RegExp(item, 'i').test(prompt));
  }
  // …and of categories 2 and 3.
  check('category 2 requires the offer or price', /offer or price/i.test(prompt));
  check('category 2 requires the brand assets', /brand assets/i.test(prompt));
  check('category 2 requires the aspect ratio/channel', /aspect ratio/i.test(prompt));
  check('category 3 requires the segment', /which segment/i.test(prompt));
  check('category 3 requires the message intent', /message intent/i.test(prompt));
  check('category 3 requires the timing', /the timing/i.test(prompt));

  // The mechanics: one batched call, a cap of four, and a wait.
  check('the rule says to ask ONCE, batched', /request_user_input/i.test(prompt) && /SINGLE time/i.test(prompt));
  check('the rule names the `questions` array explicitly', /questions:\s*\[\{ question, context, options/i.test(prompt));
  check('the rule caps the batch at four questions', /Four questions at most/i.test(prompt));
  check('the rule says to wait / not to guess', /Do not guess a budget, a location, an asset or a segment/i.test(prompt));
  check('the rule says to stop and proceed on "you decide"', /you decide/i.test(prompt));
  check(
    'the rule forbids asking what the playbook or catalogue already answers',
    /NEVER ASK what the playbook/i.test(prompt) && /nobogent_inventory_search/i.test(prompt)
  );
  check('the rule explains the missing_inputs refusal', /missing_inputs/i.test(prompt));

  // It is a checklist the model can follow, not a paragraph of advice.
  for (const step of ['CHECK', 'SEPARATE', 'ASK ONCE', 'WAIT']) {
    check(`the checklist has the "${step}" step`, new RegExp(`\\b${step}\\b`).test(rule));
  }

  // The prompt points request_user_input at the contract.
  check(
    'the request_user_input line in the prompt mentions the one-batch rule',
    /Ask for every missing item in ONE 'questions' batch/i.test(prompt)
  );
}

/* ====================================================================== */
/* B. A CAMPAIGN LAUNCH WITH A MISSING BUDGET IS REFUSED                  */
/* ====================================================================== */
function launchCall(overrides: Record<string, any> = {}) {
  const tools: any = createMetaAdsMcpTools(
    fakeSupabase({ profiles: { ...PROFILE, facebook_token: null, ad_account_id: null } }),
    'user-1'
  );
  return tools.meta_mcp_launch_leadgen_campaign.execute({
    campaignName: 'Admissions — March intake',
    adCopy: { headline: 'Learn film production', primaryText: 'Hands-on training with working mentors.' },
    whatsappRedirectUrl: 'https://wa.me/910000000000',
    targetLocations: { cities: [{ key: '1200000', name: 'Pune', radius: 25, distance_unit: 'kilometer' }] },
    imageUrl: 'https://cdn.example.test/creative.png',
    formQuestions: [{ label: 'Which course?', options: ['Acting', 'Editing'] }],
    ...overrides,
  });
}

const ALL_FIELDS = {
  campaignName: 'Admissions — March intake',
  adCopy: { headline: 'Learn film production', primaryText: 'Hands-on training with working mentors.' },
  whatsappRedirectUrl: 'https://wa.me/910000000000',
  targetLocations: { cities: [{ key: '1200000', name: 'Pune', radius: 25, distance_unit: 'kilometer' }] },
  imageUrl: 'https://cdn.example.test/creative.png',
  formQuestions: [{ label: 'Which course?', options: ['Acting', 'Editing'] }],
  dailyBudgetInr: 500,
};

async function testCampaignRefusal() {
  console.log('\n— B. a launch missing its budget is refused, and says which field —');

  const res: any = await launchCall({ dailyBudgetInr: undefined });

  eq('the launch did not run', res.success, false);
  eq('it is reported as missing inputs, not as an error', res.status, 'missing_inputs');
  eq('nothing was created', res.executed, false);
  check('the missing field is the budget', Array.isArray(res.missingFields) && res.missingFields.includes('budget'), JSON.stringify(res.missingFields));
  check(
    'the refusal carries a question the owner can answer',
    typeof res.missingInputs?.[0]?.question === 'string' && /per day/i.test(res.missingInputs[0].question)
  );
  check(
    'the refusal says why a guessed budget is unacceptable',
    /real money/i.test(String(res.missingInputs?.[0]?.why || ''))
  );
  check(
    'every missing input arrives with options, the recommended one first',
    (res.suggestedQuestions?.[0]?.options || []).length > 0 && res.suggestedQuestions[0].options[0].recommended === true
  );
  check('the refusal tells the model to ask with request_user_input', res.askWith === 'request_user_input');
  check(
    'the next step is one batched request_user_input call, then a retry',
    /request_user_input/.test(String(res.next)) && /ONCE/.test(String(res.next)) &&
      /meta_mcp_launch_leadgen_campaign/.test(String(res.next))
  );
  check('the refusal never reached the Meta credentials step', res.error === undefined);

  // The other required inputs are caught in the same breath, not one per round trip.
  const empty: any = await launchCall({
    dailyBudgetInr: undefined,
    imageUrl: undefined,
    formQuestions: undefined,
    targetLocations: undefined,
  });
  const fields = new Set<string>(empty.missingFields || []);
  for (const f of ['budget', 'locations', 'creative', 'qualifying_questions']) {
    check(`a launch with nothing filled reports "${f}"`, fields.has(f));
  }
  check('the whole batch is one refusal, not one refusal per field', empty.status === 'missing_inputs');
  check(
    'the batch is capped at a walkthrough the owner can finish',
    (empty.missingInputs || []).length <= 4,
    `${(empty.missingInputs || []).length} questions`
  );

  // The guard is structural, not advisory: the same call with the budget in place goes on.
  console.log('\n— C. the same call with all fields present proceeds —');
  const complete: any = await launchCall(ALL_FIELDS);
  check('a complete launch is not refused for missing inputs', complete.status !== 'missing_inputs', JSON.stringify(complete.missingFields));
  check('it carries no missingInputs payload', complete.missingInputs === undefined);
  check(
    'it proceeded past the guard into the real launcher (which then stops, offline, at the Meta connection)',
    /not connected/i.test(String(complete.error)),
    String(complete.error)
  );

  // An objective is fixed for this launcher, but a budget of zero is not a budget.
  const zeroBudget: any = await launchCall({ ...ALL_FIELDS, dailyBudgetInr: 0 });
  check('a budget of zero counts as no budget', zeroBudget.status === 'missing_inputs' && zeroBudget.missingFields.includes('budget'));

  // The same contract must hold on the tool the agent actually prefers.
  console.log('\n— meta_graph_create is guarded the same way —');
  const graph: any = createMetaGraphTools(
    fakeSupabase({ profiles: { ...PROFILE, facebook_token: null, ad_account_id: null }, business_playbooks: null }),
    'user-1'
  );
  const bareCampaign: any = await graph.meta_graph_create.execute({
    entity: 'campaign',
    fields: { name: 'Admissions — March intake' },
  });
  eq('a campaign with no objective and no budget is refused', bareCampaign.status, 'missing_inputs');
  check(
    'both fields are named in one refusal',
    ['objective', 'budget'].every((f) => (bareCampaign.missingFields || []).includes(f)),
    JSON.stringify(bareCampaign.missingFields)
  );
  const noTargeting: any = await graph.meta_graph_create.execute({
    entity: 'adset',
    fields: { campaign_id: '120000000000', optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS' },
  });
  eq('an ad set with no targeting is refused', noTargeting.status, 'missing_inputs');
  check('the missing field is the audience', (noTargeting.missingFields || []).includes('locations'));

  const fullCampaign: any = await graph.meta_graph_create.execute({
    entity: 'campaign',
    fields: { name: 'Admissions — March intake', objective: 'OUTCOME_LEADS', daily_budget: 50000 },
  });
  check('a campaign with objective and budget is not refused', fullCampaign.status !== 'missing_inputs');
  check(
    'and it reached the Graph call (which stops, offline, at the Meta connection)',
    /not connected/i.test(String(fullCampaign.error)),
    String(fullCampaign.error)
  );
}

/* ====================================================================== */
/* C2. THE PLAYBOOK MAKES THE GUARD PERMISSIVE                            */
/* ====================================================================== */
async function testPlaybookPermissive() {
  console.log('\n— the guard yields to the playbook —');

  const playbook = {
    industry: 'education',
    positioning: 'Film and television training.',
    website_spec: {},
    call_script: {},
    whatsapp_replies: {},
    buttons: { cta: [] },
    cadence: {},
    ads: {
      daily_budget: 750,
      objective: 'OUTCOME_LEADS',
      locations: { countries: ['IN'] },
      creative_asset: 'https://cdn.example.test/approved.png',
      qualifying_questions: [{ label: 'Which course?', options: ['Acting'] }],
    },
  };

  const sb = fakeSupabase({ profiles: { ...PROFILE, facebook_token: null, ad_account_id: null }, business_playbooks: playbook });
  const tools: any = createMetaAdsMcpTools(sb, 'user-1');
  const res: any = await tools.meta_mcp_launch_leadgen_campaign.execute({
    campaignName: 'Admissions — March intake',
    adCopy: { headline: 'Learn film production', primaryText: 'Hands-on training with working mentors.' },
    whatsappRedirectUrl: 'https://wa.me/910000000000',
  });

  check(
    'a playbook that already answers budget, locations, creative and questions is not interrogated again',
    res.status !== 'missing_inputs',
    JSON.stringify(res.missingFields)
  );
  check(
    'and the call proceeded to the launcher',
    /not connected/i.test(String(res.error)),
    String(res.error)
  );

  // …but a playbook that answers nothing changes nothing.
  const bare = checkCampaignLaunch({}, { playbook: { industry: 'education', call_script: {}, whatsapp_replies: {} } });
  check('a playbook without ads settings still leaves the guard strict', bare.ok === false && bare.missingInputs.length >= 4);
}

/* ====================================================================== */
/* D. THE RULE IS INDUSTRY-NEUTRAL                                        */
/* ====================================================================== */
const BANNED = ['propert', 'listing', 'rera', 'realtor'];

function bannedIn(text: string): string | null {
  const lower = text.toLowerCase();
  for (const word of BANNED) if (lower.includes(word)) return word;
  return null;
}

async function testNeutrality() {
  console.log('\n— D. nothing in the rule assumes a vertical —');

  const neutralRule = preflightPromptSection(undefined);
  eq('the neutral rule names no banned vertical word', bannedIn(neutralRule), null);

  const nullRule = preflightPromptSection(null);
  eq('a NULL industry renders the same neutral rule', nullRule, neutralRule);

  const unknownRule = preflightPromptSection('quantum-basket-weaving');
  eq('an unrecognised industry renders the same neutral rule', unknownRule, neutralRule);
  eq('an unrecognised industry names no banned vertical word', bannedIn(unknownRule), null);

  // The whole assembled prompt for an untagged tenant must be clean too.
  const neutralPrompt = await assemble({ ...PROFILE, industry: null });
  eq('the assembled prompt for an untagged tenant names no banned vertical word', bannedIn(neutralPrompt), null);
  check('the neutral prompt uses neutral nouns', /offerings|offering/i.test(neutralPrompt));

  // Industry vocabulary is used where a noun is needed — an academy is not told
  // about listings, and a brokerage keeps its own word.
  const education = preflightPromptSection('education');
  check('an academy is asked about courses', /course/i.test(education));
  eq('an academy is never asked about listings', bannedIn(education), null);

  const realEstate = preflightPromptSection('real_estate');
  check('a real-estate tenant keeps its own vocabulary', /listing/i.test(realEstate));

  // The guard asks in the tenant's words too.
  const q = checkCampaignLaunch({ leadGen: true }, { industry: 'education' });
  const creative = q.missingInputs.find((m) => m.field === 'creative');
  check('the creative question is phrased with the tenant\'s noun', /course/i.test(String(creative?.question)));
  const neutralQ = checkCampaignLaunch({ leadGen: true }, {});
  eq('a neutral tenant gets neutral nouns in the same question', bannedIn(String(neutralQ.missingInputs.find((m) => m.field === 'creative')?.question)), null);
}

/* ====================================================================== */
/* E. THE BULK GUARD, AND THE request_user_input TOOL ITSELF              */
/* ====================================================================== */
async function testBulkAndToolDescription() {
  console.log('\n— E. bulk actions are guarded; request_user_input takes a batch —');

  const sb = fakeSupabase({ profiles: { ...PROFILE, facebook_token: null, ad_account_id: null }, leads: null });

  const whatsapp: any = createWhatsAppTools(sb, 'user-1');
  // Removed, and must stay removed: these two reported success without doing anything.
  //   create_whatsapp_template     claimed a Meta submission that never happened
  //   send_single_whatsapp_message claimed status: 'sent' and messaged nobody
  // The real ones are whatsapp_create_template (lib/whatsapp/templates.ts) and
  // nobogent_whatsapp_send_template (lib/agent/tools/outbound.ts).
  check(
    'the fake template and send tools are gone',
    !('create_whatsapp_template' in whatsapp) && !('send_single_whatsapp_message' in whatsapp),
    Object.keys(whatsapp).join(', ')
  );
  const noTiming: any = await whatsapp.prepare_whatsapp_broadcast.execute({
    leadIds: ['lead-1', 'lead-2'],
    messageText: 'The March intake is open.',
    campaignName: 'March intake',
  });
  eq('a broadcast with no send time is refused', noTiming.status, 'missing_inputs');
  check('the missing field is the timing', (noTiming.missingFields || []).includes('timing'));
  const timed: any = await whatsapp.prepare_whatsapp_broadcast.execute({
    leadIds: ['lead-1', 'lead-2'],
    messageText: 'The March intake is open.',
    campaignName: 'March intake',
    when: 'now',
  });
  check('an explicit send time lets the broadcast be prepared', timed.status !== 'missing_inputs');

  const voice: any = createVoiceTools(sb, 'user-1');
  const noScript: any = await voice.launch_bulk_calling_campaign.execute({
    leadIds: ['lead-1'],
    campaignName: 'March intake',
    customCampaignScript: '',
  });
  eq('a call blast with no script intent is refused', noScript.status, 'missing_inputs');
  check('the missing field is the message intent', (noScript.missingFields || []).includes('message_intent'));
  const noSegment = checkBulkAction({ channel: 'whatsapp', when: 'now', messageIntent: 'Hello' });
  check('a bulk action with no segment is refused', noSegment.ok === false && noSegment.missingInputs[0].field === 'segment');

  // The tool the rule leans on must accept a batch of questions.
  const approval: any = createHumanApprovalTool(sb, 'user-1');
  const desc = String(approval.request_user_input.description || '');
  check('request_user_input\'s description mentions batched questions', /batch/i.test(desc) && /questions/i.test(desc));
  check(
    'it says the batch is one walkthrough, not one round trip per question',
    /one round trip per question|one at a time|walkthrough/i.test(desc)
  );
  check('it names the pre-flight use', /pre-flight/i.test(desc));
  const shape = (approval.request_user_input.inputSchema as any)?.shape;
  check('the schema still accepts a `questions` array', Boolean(shape?.questions));
}

/* ====================================================================== */
/* F. THE GUARDS ARE ACTUALLY WIRED INTO THE TOOLS                        */
/* ====================================================================== */
function testWiring() {
  console.log('\n— F. wiring —');

  const root = process.cwd();
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

  const orchestrator = read('lib/agent/orchestrator.ts');
  check('the orchestrator imports the rule', /preflightPromptSection/.test(orchestrator));
  check('the orchestrator renders the rule into the prompt', /parts\.push\(preflightPromptSection\(/.test(orchestrator));
  // The call gained an options argument ({ adTools }), so this asserts the industry is passed rather\n  // than pinning the exact call shape — the old pattern failed on a correct refactor.\n  check('the rule is rendered with the tenant\'s industry', /preflightPromptSection\(\s*profile\?\.industry\b/.test(orchestrator));

  const launcher = read('lib/agent/mcp/meta-ads-mcp.ts');
  check('the lead-gen launcher runs the campaign guard', /campaignLaunchRefusal\(/.test(launcher));
  check('the launcher no longer defaults the budget to 500', !/dailyBudgetInr: z\.number\(\)\.default\(500\)/.test(launcher));

  const graph = read('lib/agent/mcp/meta-graph.ts');
  check('meta_graph_create runs the campaign guard', /campaignLaunchRefusal\(/.test(graph));
  check('the ad-set branch requires targeting', /locations: f\.targeting/.test(graph));

  for (const [file, tool, guard] of [
    ['lib/agent/tools/whatsapp.ts', 'prepare_whatsapp_broadcast', 'bulkActionRefusal'],
    ['lib/agent/tools/voice.ts', 'launch_bulk_calling_campaign', 'bulkActionRefusal'],
  ] as const) {
    const src = read(file);
    check(`${tool} runs the bulk guard`, new RegExp(`${guard}\\(`).test(src));
    check(`${tool} takes an explicit send time`, /when: z\.string\(\)\.optional\(\)/.test(src));
  }

  // The artifact handed to the docked panel is untouched: the batch shape is the
  // one QuestionPanel already renders.
  const approval = read('lib/agent/tools/human_approval.ts');
  check('request_user_input still declares a questions array', /questions: z\s*\n?\s*\.array\(/.test(approval));
  check('each batched question still carries label/description/recommended options', /recommended: z\.boolean\(\)/.test(approval));
  check('the user_input_prompt artifact is unchanged', /type: 'user_input_prompt'/.test(approval));
}

/* ====================================================================== */

async function main() {
  await testRuleInPrompt();
  await testCampaignRefusal();
  await testPlaybookPermissive();
  await testNeutrality();
  await testBulkAndToolDescription();
  testWiring();

  console.log('\n' + '='.repeat(60));
  console.log(`passed ${passed}   failed ${failed}`);
  if (failed > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  • ' + f);
    process.exit(1);
  }
  console.log('ALL PRE-FLIGHT CHECKS PASSED');
}

main().catch((err) => {
  console.error('suite crashed:', err?.stack || err?.message || err);
  process.exit(1);
});
