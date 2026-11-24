/**
 * Proves one call can be given its own words and voice, without breaking the default.
 *
 * WHAT THIS PINS
 * The feature is inheritance, so the tests are about inheritance:
 *
 *   1. THE SCENARIO IS DERIVED FROM THE LEAD, in a fixed order. A booking beats everything, an
 *      untouched lead beats silence, and only elapsed time (14 days) makes a win-back.
 *   2. AN OVERRIDE WINS, AND ONLY WHAT IT SETS. A scenario that sets a voice but no script keeps the
 *      account's script, and the source of each part is reported so the UI and the agent can both say
 *      where the words came from.
 *   3. NOTHING SET MEANS BYTE-IDENTICAL TO TODAY. An account that never opens this feature must get
 *      exactly the script it got before, from exactly the same layer.
 *   4. THE STORED JSON CANNOT PRODUCE A SCRIPTLESS CALL. Unrecognised keys, wrong types and broken
 *      JSON all degrade to "inherit", never to an empty script.
 *   5. THE PLACEHOLDERS ARE FILLED, from the same renderer the default path uses.
 *
 *   npm run verify:voice-scenarios
 */
import fs from 'node:fs';
import {
  CALL_SCENARIOS,
  classifyCallScenario,
  compactVoiceScenarios,
  parseVoiceScenarios,
  resolveCallPlan,
  type VoiceScenarioMap,
} from '../lib/automation/calling-scenarios';
import { DEFAULT_CALLING_SCRIPT } from '../lib/automation/calling-script';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const NOW = new Date('2026-11-24T09:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

head('1. The lead decides which kind of call it is');

check('a lead nobody has spoken to is a new enquiry', classifyCallScenario({ pipeline_stage: 'New Lead', status: 'New' }, NOW) === 'new-lead');
check('a lead worked before is a follow-up', classifyCallScenario({ pipeline_stage: 'Contacted', last_activity_at: daysAgo(2) }, NOW) === 'follow-up');
check(
  'a booking beats the stage it sits in',
  classifyCallScenario({ pipeline_stage: 'Contacted', booked_time: daysAgo(-2) }, NOW) === 'booked',
  'booked_time present',
);
check('a booked stage is a booking even without a time', classifyCallScenario({ pipeline_stage: 'Appointment Booked' }, NOW) === 'booked');
check(
  'two weeks of silence is a win-back',
  classifyCallScenario({ pipeline_stage: 'Contacted', last_activity_at: daysAgo(20) }, NOW) === 're-engage',
);
check(
  'thirteen days is not yet',
  classifyCallScenario({ pipeline_stage: 'Contacted', last_activity_at: daysAgo(13) }, NOW) === 'follow-up',
);
check('a lost lead is not won back', classifyCallScenario({ pipeline_stage: 'Lost', last_activity_at: daysAgo(60) }, NOW) === 'follow-up');
check('no lead at all falls back to a new enquiry', classifyCallScenario(null, NOW) === 'new-lead');
check('every scenario id in the catalogue is classifiable', CALL_SCENARIOS.every((s) => ['new-lead', 'follow-up', 'booked', 're-engage'].includes(s.id)));

head('2. What an override sets is what it changes, and nothing else');

{
  const overrides: VoiceScenarioMap = {
    're-engage': { voice: 'Fenrir', script: 'Hi {{name}}, this is {{business}} checking in.', firstMessage: 'Hello {{name}}!' },
    booked: { voice: 'Charon' },
  };

  const winback = resolveCallPlan({
    lead: { pipeline_stage: 'Contacted', last_activity_at: daysAgo(30) },
    overrides,
    baseVoice: 'Aoede',
    baseLanguage: 'hinglish',
    businessName: 'Procolor Film Academy',
    leadName: 'Gagan',
    now: NOW,
  });
  check('the scenario is picked from the lead', winback.scenario === 're-engage', winback.scenario);
  check('the scenario voice wins over the account voice', winback.voice === 'Fenrir' && winback.voiceSource === 'scenario', `${winback.voice} (${winback.voiceSource})`);
  check('the scenario script wins', winback.script.startsWith('Hi Gagan, this is Procolor Film Academy checking in.'), winback.script.slice(0, 60));
  check('and it is labelled as coming from the scenario', winback.scriptSource === 'scenario', winback.scriptSource);
  check('the opener is used and rendered', winback.firstMessage === 'Hello Gagan!', String(winback.firstMessage));
  check('the language it did not set is inherited', winback.language === 'hinglish' && winback.languageSource === 'account');
  check('and it is not reported as inherited overall', winback.inherited === false);

  const booking = resolveCallPlan({
    lead: { booked_time: daysAgo(-1), pipeline_stage: 'Appointment Booked' },
    overrides,
    baseVoice: 'Aoede',
    baseLanguage: 'english',
    now: NOW,
  });
  check('a scenario that sets only a voice keeps the account script', booking.voice === 'Charon' && booking.scriptSource === 'default', `${booking.voice} / ${booking.scriptSource}`);
  check(
    'and the shipped default script is what it kept',
    booking.script.startsWith('You are a professional, helpful outbound calling assistant') && booking.scriptSource === 'default',
    booking.script.slice(0, 48),
  );

  const untouched = resolveCallPlan({ lead: { pipeline_stage: 'New Lead' }, overrides, baseVoice: 'Kore', now: NOW });
  check('a scenario with no override inherits everything', untouched.inherited === true && untouched.voice === 'Kore' && untouched.scriptSource === 'default');
}

head('3. An account that never touches this gets exactly what it got before');

{
  const before = resolveCallPlan({ lead: { pipeline_stage: 'New Lead' }, baseVoice: 'Aoede', baseLanguage: 'hinglish', now: NOW });
  check('the default script is the shipped one, rendered the same way as before', before.scriptSource === 'default' && before.script.startsWith('You are a professional, helpful outbound calling assistant'), before.script.slice(0, 48));
  check('the default voice is still Aoede', before.voice === 'Aoede');
  check('the default language is still hinglish', before.language === 'hinglish');
  const withEmptyOverrides = resolveCallPlan({ lead: { pipeline_stage: 'New Lead' }, overrides: {}, baseVoice: 'Aoede', now: NOW });
  check('an empty override map changes nothing', withEmptyOverrides.script === before.script && withEmptyOverrides.voice === before.voice);

  // The layers that already existed keep their precedence, with the scenario merely in front.
  const playbook = { call_script: { script: 'PLAYBOOK WORDS for {{business}}' }, industry: 'education' };
  const fromPlaybook = resolveCallPlan({ lead: null, playbook, baseVoice: 'Aoede', businessName: 'Acme', now: NOW });
  check('a playbook script still wins over the shipped default', fromPlaybook.scriptSource === 'playbook' && fromPlaybook.script === 'PLAYBOOK WORDS for Acme', fromPlaybook.script);
  const campaignWins = resolveCallPlan({ lead: null, playbook, campaignScript: 'CAMPAIGN WORDS', now: NOW });
  check('a campaign script still wins over the playbook', campaignWins.scriptSource === 'campaign' && campaignWins.script === 'CAMPAIGN WORDS');
}

head('4. Stored settings can never produce a call with no script');

{
  check('broken JSON inherits instead of throwing', JSON.stringify(parseVoiceScenarios('{not json')) === '{}');
  check('an array is not a map', JSON.stringify(parseVoiceScenarios([1, 2, 3])) === '{}');
  check('null is empty', JSON.stringify(parseVoiceScenarios(null)) === '{}');
  check(
    'an unknown scenario key is dropped',
    JSON.stringify(parseVoiceScenarios({ 'made-up': { script: 'x' } })) === '{}',
    'unknown keys cannot reach the dialer',
  );
  check(
    'wrong types for a known key are dropped, the good part is kept',
    JSON.stringify(parseVoiceScenarios({ 'new-lead': { script: 42, voice: 'Kore' } })) === JSON.stringify({ 'new-lead': { voice: 'Kore' } }),
  );
  check('whitespace-only values are not overrides', JSON.stringify(parseVoiceScenarios({ booked: { script: '   ', voice: ' ' } })) === '{}');

  const withBlank = parseVoiceScenarios({ 'new-lead': { script: '   ' } });
  const plan = resolveCallPlan({ lead: { pipeline_stage: 'New Lead' }, overrides: withBlank, now: NOW });
  check('a blank script still yields a real script', plan.script.length > 100 && plan.scriptSource === 'default', `${plan.script.length} chars`);

  check(
    'compacting a map keeps only real settings',
    JSON.stringify(compactVoiceScenarios({ 'new-lead': { script: '', voice: 'Kore' }, booked: {} })) === JSON.stringify({ 'new-lead': { voice: 'Kore' } }),
  );
}

head('5. The placeholders are filled by the same renderer as the default path');

{
  const plan = resolveCallPlan({
    lead: { pipeline_stage: 'New Lead' },
    overrides: { 'new-lead': { script: 'Calling {{name}} about {{products}} at {{business}}.' } },
    businessName: 'Procolor Film Academy',
    industry: 'education',
    leadName: 'Gagan',
    now: NOW,
  });
  check('name, industry noun and business are rendered', !/\{\{/.test(plan.script) && plan.script.includes('Gagan') && plan.script.includes('Procolor Film Academy'), plan.script);
  check('the industry vocabulary is used, not a generic word', /course|batch|programme|program/i.test(plan.script), plan.script);
  check(
    'a missing name does not produce an empty sentence',
    resolveCallPlan({ overrides: { 'new-lead': { script: 'Hi {{name}}' } }, lead: null, now: NOW }).script === 'Hi the lead',
    resolveCallPlan({ overrides: { 'new-lead': { script: 'Hi {{name}}' } }, lead: null, now: NOW }).script,
  );
}

head('6. The feature is wired, not just available');

{
  const settings = fs.readFileSync('components/VoiceAgentSettings.tsx', 'utf8');
  check('the voice page offers per-scenario editing', /voice_scenarios/.test(settings) && /CALL_SCENARIOS/.test(settings));
  check('and a per-scenario voice picker', /scenario\.voice|voice_scenarios/.test(settings));

  const voiceTools = fs.readFileSync('lib/agent/tools/voice.ts', 'utf8');
  check('the agent can read the scenarios it is expected to honour', /parseVoiceScenarios/.test(voiceTools) && /CALL_SCENARIOS\.map/.test(voiceTools));
  check(
    'and reports each one resolved, with what it inherits',
    /voiceSource: plan\.voiceSource/.test(voiceTools) && /scriptSource: plan\.scriptSource/.test(voiceTools),
  );

  const route = fs.readFileSync('app/api/voice/settings/route.ts', 'utf8');
  check('the settings route sanitises what it stores', /parseVoiceScenarios\(voice_scenarios\)/.test(route));
  check('and an empty map clears the stored overrides', /delete bi\.voice_scenarios/.test(route));
}

console.log(`\n${'='.repeat(64)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nA scenario must change only what it sets, and never leave a call without words.');
  process.exit(1);
}
console.log('Each kind of call can have its own words and voice, and the default is untouched.');
