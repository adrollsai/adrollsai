/**
 * The creative doctrine the owner asked for, asserted against the prompt the model actually receives.
 *
 * Four rules, each of which changes what the agent DOES rather than what it says:
 *
 *   1. REFERENCES ARE THE DEFAULT. The owner should not have to ask for one — especially for images. If
 *      they pass one, that one wins; otherwise the agent goes and finds one before writing a prompt.
 *   2. VIDEO IS SCRIPT-FIRST. Script -> shot list -> per-shot decision about AI footage vs free stock ->
 *      build. Not "generate a clip and hope".
 *   3. A SUPPLIED VIDEO IS WATCHED FIRST, before any decision is taken.
 *   4. NO SPEAKING PERSON by default — TTS narration (Gemini 3.8 Flash). A generated presenter only when
 *      explicitly asked for, and then via Grok inside the film.
 *
 * Asserted on the RENDERED prompt, because a conditional that quietly drops a sentence is exactly how the
 * agent ends up not knowing a rule.
 *
 *   npx esbuild scripts/verify-creative-doctrine.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-doctrine.mjs && node .tmp-doctrine.mjs
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';

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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const ctx = await createAgentContext(sb as any, ORG, {
  intentText: 'make a 15 second video ad for the course with a voiceover',
});
const prompt = String(ctx.systemPrompt || '');
console.log(`tool groups: ${ctx.toolGroups.join(', ')}\nprompt: ${prompt.length} chars\n`);

// ── 1. References are the default, not a request.
console.log('▸ 1. references are the DEFAULT behaviour');
check(
  'the prompt says every still creative starts with a reference the agent found',
  /EVERY still creative starts with a reference you found/i.test(prompt),
);
check(
  'and that the owner will not ask for one',
  /will not say "find a reference"|nobody should have to ask you to look/i.test(prompt),
);
check('it names the tool that finds them', /find_reference_creatives/.test(prompt));
check(
  'a supplied reference takes priority over finding one',
  /use THAT first|is the fallback, not the first move/i.test(prompt),
);
check(
  'a supplied VIDEO is watched before anything else',
  /WATCHED FIRST/i.test(prompt),
);

// ── 2. Script first, then shots, then the source decision.
console.log('\n▸ 2. video is SCRIPT -> SHOT LIST -> SOURCE DECISION');
const iScript = prompt.indexOf('SCRIPT FIRST');
const iShots = prompt.indexOf('THEN THE SHOT LIST');
const iSource = prompt.indexOf('WHERE THE FOOTAGE COMES FROM');
const iVoice = prompt.indexOf('THE VOICE IS NARRATION');
check('the script step exists', iScript > -1);
check('the shot-list step exists', iShots > -1);
check('the per-shot source decision exists', iSource > -1);
check('they appear in that order', iScript > -1 && iScript < iShots && iShots < iSource, `${iScript} < ${iShots} < ${iSource}`);
check('the voice rule comes after the source decision', iVoice > iSource, `${iSource} < ${iVoice}`);
check('free stock footage is named as an option', /FREE STOCK VIDEO/.test(prompt));
check(
  'and stock is forbidden for the product / the offer',
  /Never use stock for the product itself/i.test(prompt),
  'stock is for the world around the product',
);

// ── 3. No speaking person by default; TTS carries the voice.
console.log('\n▸ 3. NO SPEAKING PERSON unless explicitly asked');
check('the default is narrated, not presented', /NARRATION, NOT A PRESENTER/i.test(prompt));
check('TTS is the stated default', /'generate_voiceover' \(Gemini 3\.8 Flash\)/.test(prompt), 'Gemini 3.8 Flash');
check(
  'a speaking person is explicitly forbidden by default',
  /DO NOT put a speaking person in the video unless the owner explicitly asks/i.test(prompt),
);
check(
  'and when asked, Grok generates them inside the film',
  // Whitespace-tolerant: the prompt is line-wrapped, so a phrase written across two lines must still match.
  /generate that person with Grok/i.test(prompt.replace(/\s+/g, ' ')),
  'the obvious exception, stated',
);

// ── 4. The alpha label on the agent tab.
console.log('\n▸ 4. the agent tab is labelled alpha');
const nav = fs.readFileSync('components/BottomNav.tsx', 'utf8');
check('the navbar renders an Alpha badge', /Alpha/.test(nav) && /uppercase/.test(nav));
check(
  'and it is attached to the Nobogent/agent tab only',
  /item\.name === 'Nobogent'/.test(nav),
  'not on every tab',
);
check('with a title explaining it', /title="Alpha/.test(nav));

// ── Guard the thing I broke once already: no ghost tools in the new prose.
console.log('\n▸ 5. the new prose names no tool this turn does not have');
const quoted = [...new Set((prompt.match(/'([a-z0-9_]{4,})'/g) || []).map((s) => s.replace(/'/g, '')))];
const registered = Object.keys(ctx.tools as any);
const ghosts = quoted.filter((n) => n.includes('_') && !registered.includes(n) && !n.startsWith('sandbox_publish'));
check('no quoted tool name is unregistered', ghosts.length === 0, ghosts.join(', ') || 'none');

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
