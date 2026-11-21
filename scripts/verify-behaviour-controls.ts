/**
 * Can the owner change how their agent behaves, by saying so?
 *
 * THE BUG THIS COVERS
 * The agent could already patch its playbook, but three other pieces of "how this business behaves"
 * had no path at all:
 *   1. the routine row (cadence, hour, ceiling, approval policy, on/off) - the agent could start a
 *      routine and change nothing about it;
 *   2. the default calling voice / language / auto-call - `createVoiceTools` was written and then
 *      NEVER imported by the orchestrator, so the tool did not exist for the model at all;
 *   3. the calling script - the dead tool pointed it at `profiles.custom_prompt`, which is the
 *      brand's VISUAL STYLE prompt for creatives, so wiring it as written would have silently
 *      rewritten the art direction of every future image.
 *
 * So this asserts the wiring (not just that the functions exist), what each write targets, which
 * phrasing reaches the tools, and which of the writes must come back for approval.
 *
 * Reads source with comments stripped, because a comment describing a fix must never satisfy the
 * test for that fix.
 *
 *   npm run verify:behaviour
 *
 * Read-only: pure functions plus source inspection. It never writes to the database.
 */
import fs from 'node:fs';

import {
  CALLING_LANGUAGES,
  CALLING_VOICES,
  REGISTERED_VOICE_TOOLS,
  normaliseLanguage,
  normaliseVoice,
  validateCallingScript,
} from '../lib/agent/tools/voice';
import {
  ROUTINE_APPROVAL_POLICIES,
  ROUTINE_CADENCES,
  ROUTINE_CHANNELS,
  describeRoutine,
  validateRoutinePatch,
} from '../lib/agent/tools/routine';
import { REVIEW_POLICY } from '../lib/agent/review-gate';
import { selectToolGroups } from '../lib/agent/tool-groups';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

/** Source with comments removed, so an explanation cannot satisfy its own assertion. */
const codeOf = (path: string) =>
  fs
    .readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');

const rawOf = (path: string) => fs.readFileSync(path, 'utf8');

// ── 1. the validators: refuse the values that quietly break a call
console.log('\n▸ what the agent may set, and what it may not');
check(
  'a voice the product offers is accepted whatever its casing',
  normaliseVoice('kore').voice === 'Kore' && normaliseVoice('CHARON').voice === 'Charon',
  `${CALLING_VOICES.join(', ')}`,
);
check(
  'a voice it does not offer is refused, with the real list',
  !!normaliseVoice('Barry White').error && /Aoede/.test(normaliseVoice('Barry White').error || ''),
);
check(
  '"hindi+english" means hinglish, not two languages',
  normaliseLanguage('Hindi+English').language === 'hinglish' &&
    normaliseLanguage('Indian English').language === 'english',
  `real values: ${CALLING_LANGUAGES.slice(0, 4).join(', ')}...`,
);
check('an unknown language is refused', !!normaliseLanguage('Klingon').error);

check(
  'a one-line "script" is refused as too short',
  validateCallingScript('be nice').ok === false,
  validateCallingScript('be nice').error?.slice(0, 60),
);
check(
  'a script that claims to be human is refused',
  validateCallingScript(
    'You are a professional calling on behalf of Acme Realty. If asked, say I am a human being and never a bot. Keep it brief.',
  ).ok === false,
);
check(
  'a real script is accepted',
  validateCallingScript(
    'You are a property advisor calling on behalf of {{business}}. Your goal is to understand what {{name}} asked about and offer one clear next step. Never invent prices.',
  ).ok === true,
);

check(
  'a cadence the executor does not understand is refused',
  validateRoutinePatch({ cadence: 'fortnightly' }).ok === false,
  `real cadences: ${ROUTINE_CADENCES.join(', ')}`,
);
check(
  '19:00 is accepted and 19 is not confused with 7pm in the wrong direction',
  validateRoutinePatch({ runAtHour: 19 }).patch?.run_at_hour === 19 &&
    validateRoutinePatch({ runAtHour: 25 }).ok === false,
);
check(
  'a timezone that does not exist is refused',
  validateRoutinePatch({ timezone: 'Mars/Olympus' }).ok === false &&
    validateRoutinePatch({ timezone: 'Asia/Kolkata' }).ok === true,
);
check(
  'an unknown channel is refused rather than stored',
  validateRoutinePatch({ channels: ['whatsapp', 'telepathy'] }).ok === false,
  `real channels: ${ROUTINE_CHANNELS.join(', ')}`,
);
check(
  'an approval policy outside the executor\'s vocabulary is refused',
  validateRoutinePatch({ approvalPolicy: 'sometimes' }).ok === false,
  `real policies: ${ROUTINE_APPROVAL_POLICIES.join(', ')}`,
);
check('a negative daily ceiling is refused', validateRoutinePatch({ dailyCreditCap: -5 }).ok === false);
check(
  'an empty change is refused instead of writing nothing',
  validateRoutinePatch({}).ok === false,
);
check(
  'a real change compiles to the row\'s own column names',
  validateRoutinePatch({ cadence: 'weekly', runAtHour: 18, channels: ['whatsapp'] }).patch?.run_at_hour === 18 &&
    validateRoutinePatch({ cadence: 'weekly', runAtHour: 18, channels: ['whatsapp'] }).patch?.cadence === 'weekly',
);
check(
  'and the summary it shows the owner names the cadence, the hour and the switch',
  (() => {
    const lines = describeRoutine({
      name: 'Daily marketing',
      cadence: 'weekly' as any,
      run_at_hour: 18,
      timezone: 'Asia/Kolkata',
      enabled: false,
      daily_credit_cap: 200,
      approval_policy: 'always' as any,
      channels: ['whatsapp'],
      intent: 'make one post each week',
    } as any);
    const text = lines.join(' | ');
    return /weekly/.test(text) && /18:00/.test(text) && /on: no/.test(text);
  })(),
);

// ── 2. the wiring: a tool that is not handed to the model does not exist
console.log('\n▸ the tools are actually handed to the agent');
const orchestrator = codeOf('lib/agent/orchestrator.ts');
const voice = codeOf('lib/agent/tools/voice.ts');
const routine = codeOf('lib/agent/tools/routine.ts');

check(
  'the orchestrator registers the calling tools',
  /createRegisteredVoiceTools\(supabase,\s*userId\)/.test(orchestrator),
  'this line was missing entirely, so the model never saw them',
);
check(
  'and the routine tools',
  /createRoutineTools\(supabase,\s*userId\)/.test(orchestrator),
);
check(
  'the registered calling set is explicit',
  REGISTERED_VOICE_TOOLS.includes('get_calling_defaults' as any) &&
    REGISTERED_VOICE_TOOLS.includes('update_default_voice_settings' as any) &&
    REGISTERED_VOICE_TOOLS.includes('get_call_history' as any),
  REGISTERED_VOICE_TOOLS.join(', '),
);
check(
  'the tool with no executor behind it stays unregistered',
  !REGISTERED_VOICE_TOOLS.includes('launch_bulk_calling_campaign' as any),
  'nothing in the app executes an approved bulk_call, so a card for it would approve into nothing',
);
const PHRASINGS = [
  'make my daily routine weekly at 6pm',
  'stop calling new leads automatically',
  'change the calling script',
  'switch the calling voice to Kore',
  'what does the agent do every day',
];
const unrouted = PHRASINGS.filter((text) => !selectToolGroups(text).groups.includes('automation'));
check(
  'the routing actually reaches those tools for the owner\'s phrasing',
  unrouted.length === 0,
  unrouted.length ? `no automation tools for: ${unrouted.join(' | ')}` : `${PHRASINGS.length} phrasings`,
);
check(
  'and the prompt names them only where the group is loaded',
  /if \(has\('automation'\)\) parts\.push\(`[\s\S]{0,1200}get_routine[\s\S]{0,600}update_default_voice_settings/.test(
    rawOf('lib/agent/orchestrator.ts'),
  ),
);

// ── 3. what each write targets: the exact columns and rows the readers use
console.log('\n▸ each setting is written where the code that reads it looks');
check(
  'the voice is written to profiles.voice_name',
  /updatePayload\.voice_name\s*=\s*norm\.voice/.test(voice),
  'the answer webhook reads profiles.voice_name',
);
check(
  'the starting language goes into business_info, not a column that does not exist',
  /default_calling_language:\s*nextLanguage/.test(voice) && /business_info\s*=\s*JSON\.stringify\(merged\)/.test(voice),
  'profiles.default_calling_language was never a column - that write would have failed every time',
);
check(
  'auto-calling is written to profiles.auto_call_new_leads',
  /updatePayload\.auto_call_new_leads\s*=\s*wanted/.test(voice),
);
check(
  'the calling script goes to the playbook, through the versioned patch',
  /callingScriptPatch\(/.test(voice) && /applyPlaybookPatch\(/.test(voice),
  'the panel resolves campaign > playbook > dynamic > shipped default',
);
check(
  'and it never touches profiles.custom_prompt',
  !/custom_prompt/.test(voice),
  'custom_prompt is the brand VISUAL STYLE for creatives; writing the script there would repaint every future image',
);
check(
  'the routine write recomputes next_run_at from the routine itself',
  /nextRunAfter\(/.test(routine) && /next_run_at\s*=/.test(routine),
  'otherwise a cadence change keeps the old slot',
);
check(
  'a new routine is not fired at the moment it is created',
  /next_run_at = nextRunAfter\(now,/.test(routine),
);

// ── 4. the two writes that act afterwards still need a human
console.log('\n▸ the edits that reach the outside world are gated');
const routinePolicy = (REVIEW_POLICY as any).update_routine;
const voicePolicy = (REVIEW_POLICY as any).update_default_voice_settings;

check('changing the routine has a review policy', !!routinePolicy);
check(
  'switching the routine ON needs approval',
  routinePolicy?.when?.({ enabled: true }) === true,
);
check(
  'and so does relaxing approval away from "always"',
  routinePolicy?.when?.({ approvalPolicy: 'never' }) === true && routinePolicy?.when?.({ approvalPolicy: 'auto_images' }) === true,
);
check(
  'but rewording it, or changing the hour, does not',
  routinePolicy?.when?.({ intent: 'post twice a week' }) === false &&
    routinePolicy?.when?.({ runAtHour: 18 }) === false &&
    routinePolicy?.when?.({ enabled: false }) === false,
);
check('changing the calling defaults has a review policy', !!voicePolicy);
check(
  'rewriting the script a stranger will hear needs approval',
  voicePolicy?.when?.({ systemPromptScript: 'a new script' }) === true,
);
check(
  'and so does switching auto-calling on',
  voicePolicy?.when?.({ autoCallNewLeads: true }) === true,
);
check(
  'but picking a different voice does not',
  voicePolicy?.when?.({ voiceName: 'Kore' }) === false &&
    voicePolicy?.when?.({ defaultCallingLanguage: 'english' }) === false,
);
// The script and the journey also live on the playbook, so the SAME change has a second door.
// Measured: "rewrite my calling script" went through update_playbook and wrote a new version with
// no card at all, because only the voice tool was gated.
const playbookPolicy = (REVIEW_POLICY as any).update_playbook;
check(
  'the playbook cannot be used as a side door to the same words',
  !!playbookPolicy &&
    playbookPolicy.when?.({ section: 'call_script', value: { script: 'x'.repeat(60) } }) === true &&
    playbookPolicy.when?.({ section: 'cadence', value: { journey: { followups: [] } } }) === true,
  'call_script and cadence both reach a real customer',
);
check(
  'while positioning, replies, the daily plan and recipes stay free',
  playbookPolicy?.when?.({ section: 'positioning' }) === false &&
    playbookPolicy?.when?.({ section: 'whatsapp_replies' }) === false &&
    playbookPolicy?.when?.({ section: 'daily_routine' }) === false &&
    playbookPolicy?.when?.({ section: 'recipes' }) === false,
  'a copy edit that no send has agreed to yet is not a customer-facing act',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
