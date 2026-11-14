/* eslint-disable @typescript-eslint/no-explicit-any --
 * Test harness: playbook rows are untyped (stale generated types).
 */
/**
 * Verification suite for the agent-composed daily routine.
 *
 *   npm run verify:compose
 *
 * Part A (the materialiser's live behaviour) is already covered by
 * `npm run verify:routines`. This suite covers what that one cannot: the brief
 * built from a PLAYBOOK (the thing that replaced the hardcoded pipeline), the
 * fallback policy that decides when the old pipeline may still act, and the fact
 * that the composition tools are actually registered on the agent.
 *
 * All offline. No vendor call, no send, no database write.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  composeRoutineBrief,
  renderDailyRoutine,
  renderRecipe,
  AUDIO_RULE,
  type RoutineBriefInput,
} from '../lib/automation/routine-composer';
import { fallbackDecision, legacyPipelineEnabled } from '../lib/automation/pipeline-flag';
import { DEFAULT_RECIPES } from '../lib/automation/recipes';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
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

const BANNED_REAL_ESTATE = [
  'propert',
  'listing',
  'rera',
  'carpet area',
  'bhk',
  'apartment',
  'realtor',
  'real estate',
  'realty',
  'brokerage',
  'site visit',
];

/**
 * Scan for real-estate VOCABULARY, ignoring the mandatory button ids.
 *
 * `view_properties` is invariant 1: it is a stable contract id consumed by the
 * inbound webhook handlers and may never change, on any industry's messages. It
 * is an identifier, not a noun the tenant is described with, so it is stripped
 * before the scan — otherwise every correctly-neutral brief would fail this test.
 */
function hasRealEstateWords(text: string): string | null {
  const lower = text
    .toLowerCase()
    .replace(/view_properties/g, 'view_offerings')
    .replace(/talk_expert/g, 'talk_expert')
    .replace(/book_appointment/g, 'book_appointment');
  for (const word of BANNED_REAL_ESTATE) {
    if (lower.includes(word)) return word;
  }
  return null;
}

const baseRoutine = {
  name: 'Daily marketing',
  intent: 'Keep the pipeline moving; one strong creative a day.',
  cadence: 'daily',
  approval_policy: 'always',
  daily_credit_cap: 200,
  channels: ['whatsapp'],
  timezone: 'Asia/Kolkata',
};

function brief(overrides: Partial<RoutineBriefInput> = {}) {
  return composeRoutineBrief({
    businessName: 'Procolor Film Academy',
    industry: 'education',
    playbook: {
      industry: 'education',
      positioning: 'We train people who want to work in film and television.',
      website_spec: {},
      call_script: {},
      whatsapp_replies: {},
      buttons: { cta: [] },
      cadence: {},
      daily_routine: {
        summary: 'One post a day, one reel a week.',
        slots: [
          { when: 'morning', do: 'post one course creative', channel: 'whatsapp' },
          { when: 'evening', do: 'follow up with new enquiries' },
        ],
        skip_when: 'the academy is closed for a holiday',
      },
      recipes: { creative: { must_include: ['the course name'] } },
    },
    routine: baseRoutine,
    todaysDate: '2026-11-12',
    creditsLeft: 5000,
    availableCredits: 4800,
    ...overrides,
  });
}

/* ====================================================================== */
/* 1. THE BRIEF IS BUILT FROM THE PLAYBOOK                                */
/* ====================================================================== */
function testBriefFromPlaybook() {
  console.log('\n— the brief comes from the playbook —');

  const compiled = brief();
  const text = compiled.text;

  check('the brief names the business and the day', text.includes('Procolor Film Academy') && text.includes('2026-11-12'));
  check('the brief carries the positioning', text.includes('We train people who want to work in film'));
  check('the brief carries the timezone', text.includes('Asia/Kolkata'));

  check('an authored daily_routine is used', compiled.usedPlaybookRoutine === true);
  check('the routine summary is in the brief', text.includes('One post a day, one reel a week'));
  check('a morning slot is in the brief', /morning\s*—\s*post one course creative\s*—\s*on whatsapp/i.test(text));
  check('the skip rule is in the brief', text.includes('closed for a holiday'));
  check('the standing intent rides along with the schedule', text.includes('Keep the pipeline moving'));

  // No playbook routine: the intent alone has to carry the day.
  const intentOnly = brief({ playbook: null });
  eq('without a playbook routine the flag is false', intentOnly.usedPlaybookRoutine, false);
  check('and the intent still describes the day', intentOnly.text.includes('Keep the pipeline moving'));

  // Credits are stated, and the reserved part is distinguished from the balance.
  check('the wallet balance is stated', text.includes('5000 credits'));
  check('the unreserved amount is stated separately', text.includes('4800 credits'));
}

/* ====================================================================== */
/* 2. INDUSTRY NEUTRALITY                                                 */
/* ====================================================================== */
function testIndustryNeutrality() {
  console.log('\n— nothing assumes real estate —');

  const education = brief().text;
  eq('an education tenant is never told about properties', hasRealEstateWords(education), null);
  check('an education tenant gets course vocabulary', /course/i.test(education));

  const realEstate = brief({ industry: 'real_estate', playbook: { industry: 'real_estate' } as any }).text;
  check('a real-estate tenant still gets its own vocabulary', /listing/i.test(realEstate));

  const neutral = brief({ industry: null, playbook: null }).text;
  eq('a NULL industry resolves to neutral, not real estate', hasRealEstateWords(neutral), null);
  check('and it says "offerings" rather than borrowing a vertical', /offering/i.test(neutral));

  const unrecognised = brief({ industry: 'quantum-basket-weaving', playbook: null }).text;
  eq('an unrecognised industry resolves to neutral too', hasRealEstateWords(unrecognised), null);
  eq(
    'an unrecognised industry reads the same as NULL',
    unrecognised.replace(/quantum-basket-weaving/g, 'neutral'),
    neutral
  );
}

/* ====================================================================== */
/* 3. RECIPES ARE GUIDANCE, INCLUDING THE DEGRADED PATH                   */
/* ====================================================================== */
function testRecipes() {
  console.log('\n— recipes are first-draft guidance —');

  const text = brief().text;

  eq('the brief carries the creative recipe sections', ['creative', 'video', 'copy'].every((s) => text.includes(s.toUpperCase())), true);
  check(
    'the degraded path for a missing photo is present, in the recipe\'s own words',
    text.includes(String(DEFAULT_RECIPES.creative.degraded_path))
  );
  check(
    'the degraded path for a failed video is present',
    text.includes(String(DEFAULT_RECIPES.video.degraded_path))
  );
  check(
    'the degraded path for thin copy is present',
    text.includes(String(DEFAULT_RECIPES.copy.degraded_path))
  );
  check('the creative must-include rules survive', /never invent a building|real photo|must include/i.test(text));

  // THE AUDIO RULE — the owner's own note.
  check('the audio rule is in the brief verbatim', text.includes(AUDIO_RULE));
  check(
    'the audio rule forbids a voiceover when a presenter is speaking',
    /do NOT add a separate voiceover/i.test(AUDIO_RULE) && /only when the visuals are silent/i.test(AUDIO_RULE)
  );

  // A tenant can override a recipe through the playbook, and the override wins.
  const overridden = brief({
    playbook: {
      industry: 'education',
      website_spec: {},
      call_script: {},
      whatsapp_replies: {},
      buttons: { cta: [] },
      cadence: {},
      recipes: { creative: { degraded_path: 'Use the academy crest on a plain background.' } },
    } as any,
  }).text;
  check('a tenant recipe override reaches the brief', overridden.includes('Use the academy crest'));
  check(
    'and the other creative rules are not lost when one key is overridden',
    /must include/i.test(overridden)
  );
}

/* ====================================================================== */
/* 4. THE RULES THAT DO NOT BEND                                          */
/* ====================================================================== */
function testInvariants() {
  console.log('\n— invariants —');

  const text = brief().text;

  check('the brief forbids invented facts', /never invent a price/.test(text));
  check('it refuses to fill a gap with something plausible', /do not fill the gap/.test(text));
  check('it says nothing goes to a paid channel without approval', /without approval/.test(text));
  check('it allows a quiet day', /quiet day is a valid outcome/.test(text));

  // Invariant 1: the three reply buttons, with stable ids.
  for (const id of ['view_properties', 'talk_expert', 'book_appointment']) {
    check(`the button id ${id} is stated in the brief`, text.includes(id));
  }
  check('the brief says the ids never change', /ids never change/.test(text));

  // The ad-spend rule: credits are not ad budget.
  check('it forbids spending ad budget', /NEVER spend ad budget/.test(text));
  check('it stops at "launch with Rs X/day" and waits', /launch with Rs X\/day/.test(text));

  // Money rules.
  check('it states the quote threshold', /quote before executing anything above ~200 credits/.test(text));
  check('it stops rather than overdrawing', /STOP and ask/.test(text));
  check('it states the spend ceiling when one is set', text.includes('200 credits'));

  const uncapped = brief({ routine: { ...baseRoutine, daily_credit_cap: 0 } }).text;
  check('with no ceiling it still treats the wallet as finite', /no daily ceiling, but the wallet is finite/.test(uncapped));
  check('and it does not print a ceiling of 0', !/ceiling for today: 0 credits/.test(uncapped));

  // The digest contract.
  for (const key of ['DONE:', 'SPENT:', 'NEEDS YOU:', 'NOT DONE:', 'TOMORROW:']) {
    check(`the digest shape includes ${key}`, text.includes(key));
  }

  // Duplicate approvals are only mentioned when there are some.
  check('no duplicate-approval warning when nothing is pending', !/do not duplicate them/.test(text));
  check(
    'a duplicate-approval warning appears when approvals are pending',
    /do not duplicate them/.test(brief({ pendingApprovals: 3 }).text)
  );
}

/* ====================================================================== */
/* 5. THE APPROVAL GATE                                                   */
/* ====================================================================== */
function testApprovalGate() {
  console.log('\n— the approval gate —');

  const always = brief().text;
  check('policy "always" stops at request_human_approval', /stop ONCE at request_human_approval/.test(always));
  check('and says not to ask twice', /Do not ask twice/.test(always));
  check('the cheap preparation comes before the gate', /cheap preparation first/.test(always));

  const autoImages = brief({ routine: { ...baseRoutine, approval_policy: 'auto_images' } }).text;
  check('policy "auto_images" lets images through', /images may be generated without asking/.test(autoImages));
  check('but gates the video', /before the first video/.test(autoImages));

  const never = brief({ routine: { ...baseRoutine, approval_policy: 'never' } }).text;
  check('policy "never" does not demand an approval stop', !/stop ONCE at request_human_approval/.test(never));
  check('but still forbids ad spend and broadcasts', /Still stop before ad spend/.test(never));
}

/* ====================================================================== */
/* 6. THE FALLBACK POLICY                                                 */
/* ====================================================================== */
function testFallbackPolicy() {
  console.log('\n— legacy pipeline fallback —');

  const base = {
    enabled: true,
    agentProducedToday: false,
    agentRunInFlight: false,
  };

  eq('the pipeline fills the gap when the agent produced nothing', fallbackDecision(base), {
    run: true,
    reason: 'agent_produced_nothing',
  });
  eq('it stays quiet when the agent already produced today', fallbackDecision({ ...base, agentProducedToday: true }), {
    run: false,
    reason: 'already_produced_today',
  });
  eq('it stays quiet while an agent run is in flight', fallbackDecision({ ...base, agentRunInFlight: true }), {
    run: false,
    reason: 'agent_run_in_flight',
  });
  eq('the env switch turns it off entirely', fallbackDecision({ ...base, enabled: false }), {
    run: false,
    reason: 'fallback_disabled',
  });
  eq('a tenant opt-out wins over everything', fallbackDecision({ ...base, tenantDisabled: true, forced: true }), {
    run: false,
    reason: 'tenant_disabled',
  });
  eq('a manual force overrides the quiet rules', fallbackDecision({ ...base, forced: true }), {
    run: true,
    reason: 'forced',
  });
  eq(
    'a forced run still respects the env switch? no — force is explicit',
    fallbackDecision({ ...base, forced: true, enabled: false }).run,
    true
  );

  // Env parsing.
  const original = process.env.AUTOMATION_PIPELINE_FALLBACK;
  delete process.env.AUTOMATION_PIPELINE_FALLBACK;
  eq('the fallback is ON by default', legacyPipelineEnabled(), true);
  process.env.AUTOMATION_PIPELINE_FALLBACK = '0';
  eq('=0 turns it off', legacyPipelineEnabled(), false);
  process.env.AUTOMATION_PIPELINE_FALLBACK = 'false';
  eq('=false turns it off', legacyPipelineEnabled(), false);
  process.env.AUTOMATION_PIPELINE_FALLBACK = 'true';
  eq('=true leaves it on', legacyPipelineEnabled(), true);
  if (original === undefined) delete process.env.AUTOMATION_PIPELINE_FALLBACK;
  else process.env.AUTOMATION_PIPELINE_FALLBACK = original;
}

/* ====================================================================== */
/* 7. RENDERING HELPERS                                                   */
/* ====================================================================== */
function testRenderers() {
  console.log('\n— rendering helpers —');

  eq('no routine renders no lines', renderDailyRoutine(null), []);
  eq('an empty routine renders no lines', renderDailyRoutine({}), []);

  const lines = renderDailyRoutine({
    summary: 'Daily post',
    slots: [{ when: 'morning', do: 'post', channel: 'whatsapp' }],
    unknown_key: 'kept',
  });
  check('a scalar renders as key: value', lines.includes('- summary: Daily post'));
  check('a slot renders readably', lines.some((l) => /morning — post — on whatsapp/.test(l)));
  check('an unrecognised key is kept rather than dropped', lines.includes('- unknown key: kept'));

  const recipeLines = renderRecipe('creative', {
    goal: 'a poster',
    must_include: ['the name'],
    avoid: ['invented buildings'],
    degraded_path: 'go typographic',
  }).join('\n');
  check('the recipe goal is rendered', recipeLines.includes('a poster'));
  check('must-include rules are rendered', recipeLines.includes('the name'));
  check('avoid rules are rendered', recipeLines.includes('invented buildings'));
  check('the degraded path is labelled clearly', recipeLines.includes('IF THE IDEAL IS NOT ACHIEVABLE: go typographic'));

  const noDegraded = renderRecipe('copy', { goal: 'a message' }).join('\n');
  check(
    'a recipe without a degraded path still gets an honest fallback instruction',
    noDegraded.includes('produce the simplest honest version')
  );
}

/* ====================================================================== */
/* 8. THE TOOLS ARE ACTUALLY REGISTERED                                   */
/* ====================================================================== */
function testWiring() {
  console.log('\n— wiring —');

  const root = process.cwd();
  const orchestrator = fs.readFileSync(path.join(root, 'lib/agent/orchestrator.ts'), 'utf8');

  check('the composition tools are imported', /createCompositionTools/.test(orchestrator));
  check('the composition tools are registered', /\.\.\.\(has\('media'\) \? createCompositionTools/.test(orchestrator));
  check('the routine trigger is imported', /createRoutineTools/.test(orchestrator));
  check('the routine trigger is registered', /createRoutineTools\(supabase, userId\)/.test(orchestrator));

  const composition = fs.readFileSync(path.join(root, 'lib/agent/tools/composition.ts'), 'utf8');
  for (const name of ['composeCreative', 'composeVideo', 'deliverArtefact']) {
    check(`${name} is defined as a tool`, new RegExp(`${name}: tool\\(`).test(composition));
  }
  check(
    'composeVideo encodes the no-double-voiceover rule',
    /presenterSpeaks/.test(composition) && /NO separate voiceover|no separate voiceover|generate_audio: audioMode === 'presenter'/.test(composition)
  );
  check('composeVideo honours the degraded path', /degradedSuggestion/.test(composition));

  const routineTool = fs.readFileSync(path.join(root, 'lib/agent/tools/routine.ts'), 'utf8');
  check('run_routine is defined as a tool', /run_routine: tool\(/.test(routineTool));
  check('run_routine goes through the shared queueRoutineRun', /queueRoutineRun/.test(routineTool));

  const materialiser = fs.readFileSync(path.join(root, 'lib/agent/routines.ts'), 'utf8');
  check('the materialiser composes its brief from the playbook', /composeRoutineBrief/.test(materialiser));
  check('the materialiser reads the active playbook', /getActivePlaybook/.test(materialiser));
  check(
    'the materialiser no longer builds the goal from the routine intent alone',
    !/const goal = dailyBrief\(/.test(materialiser)
  );

  const creativeCron = fs.readFileSync(path.join(root, 'app/api/cron/auto-generate/route.ts'), 'utf8');
  check('the legacy creative pipeline consults the fallback policy', /fallbackDecision/.test(creativeCron));
  const videoCron = fs.readFileSync(path.join(root, 'app/api/cron/auto-generate-video/route.ts'), 'utf8');
  check('the legacy video pipeline consults the fallback policy', /agentRunInFlight/.test(videoCron));
}

/* ====================================================================== */

function main() {
  testBriefFromPlaybook();
  testIndustryNeutrality();
  testRecipes();
  testInvariants();
  testApprovalGate();
  testFallbackPolicy();
  testRenderers();
  testWiring();

  console.log('\n' + '='.repeat(60));
  console.log(`passed ${passed}   failed ${failed}`);
  if (failed > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  • ' + f);
    process.exit(1);
  }
  console.log('ALL ROUTINE-COMPOSER CHECKS PASSED');
}

main();
