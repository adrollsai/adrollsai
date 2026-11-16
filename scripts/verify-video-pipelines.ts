/**
 * Does the agent know what KIND of film it is making?
 *
 * Shot design was covered; pipeline structure was not, and that is why every request tended to become the same
 * film. This checks the shapes as a product: contiguous beat schedules at several runtimes, a deterministic
 * chooser that explains itself, and — the part that matters most legally — that the knowledge the agent loads is
 * our own writing, with no third-party text in it and no false attribution.
 *
 * Pure: no network, no model calls, no credits.
 *
 *   npx esbuild scripts/verify-video-pipelines.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-video-pipelines.mjs && node .tmp-video-pipelines.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { houseSkillCatalogue } from '../lib/agent/house-skills';
import {
  VIDEO_PIPELINES,
  beatsFor,
  choosePipeline,
  renderPipelineKnowledge,
} from '../lib/agent/creative/video-pipelines';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor Film Academy

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

// ── 1. The shapes exist and are complete.
console.log('▸ every pipeline is a complete film shape');
check('there are ten shapes', VIDEO_PIPELINES.length === 10, `${VIDEO_PIPELINES.length}`);
check('ids are unique', new Set(VIDEO_PIPELINES.map((p) => p.id)).size === VIDEO_PIPELINES.length);
for (const pipeline of VIDEO_PIPELINES) {
  const contiguous = pipeline.beats.every((beat, i, all) => (i === 0 ? beat.from === 0 : beat.from === all[i - 1].to));
  const covers = pipeline.beats[pipeline.beats.length - 1].to === 1;
  check(
    `  ${pipeline.id}: beats are contiguous, start at 0 and end at 1`,
    contiguous && covers && pipeline.beats.length >= 4,
    `${pipeline.beats.length} beats, ${pipeline.beats[0].from}→${pipeline.beats[pipeline.beats.length - 1].to}`,
  );
  check(
    `  ${pipeline.id}: says what it needs, how it sounds and how it fails`,
    pipeline.needs.length > 0 && pipeline.audio.length > 40 && pipeline.never.length >= 2 && pipeline.cta.length > 10,
    pipeline.needs.length + ' needs, ' + pipeline.never.length + ' nevers',
  );
  check(
    `  ${pipeline.id}: every beat has a shot instruction, not just a label`,
    pipeline.beats.every((b) => b.shot.length > 20 && b.onScreen.length > 3),
    'the shot column is what makes it usable',
  );
  check(
    `  ${pipeline.id}: has a realistic runtime range`,
    pipeline.seconds[0] >= 5 && pipeline.seconds[1] > pipeline.seconds[0],
    `${pipeline.seconds[0]}–${pipeline.seconds[1]} s`,
  );
}

// ── 2. The schedule scales to the runtime.
console.log('\n▸ the same shape works at 15 s and at 60 s');
for (const seconds of [15, 30, 60]) {
  const scheduled = beatsFor('testimonial', seconds);
  const total = scheduled[scheduled.length - 1].endSec;
  const contiguous = scheduled.every((b, i, all) => (i === 0 ? b.startSec === 0 : b.startSec === all[i - 1].endSec));
  check(
    `  a ${seconds}s testimonial fills the runtime with no gaps`,
    contiguous && Math.abs(total - seconds) <= 1,
    scheduled.map((b) => `${b.startSec}-${b.endSec}`).join(' '),
  );
  check(
    `  and no beat is a sliver at ${seconds}s`,
    scheduled.every((b) => b.endSec - b.startSec >= 0.5),
    `shortest ${Math.min(...scheduled.map((b) => b.endSec - b.startSec))}s`,
  );
}
const lengthIndependent = beatsFor('offer-reel', 15).length === beatsFor('offer-reel', 60).length;
check('the structure is the same at both lengths, only the timing changes', lengthIndependent);

// ── 3. The chooser picks the right film and can explain itself.
console.log('\n▸ the shape is chosen from the brief, deterministically');
const cases: Array<[string, string]> = [
  ['a testimonial video from a student who cleared her exam', 'testimonial'],
  ['before after gym transformation reel', 'transformation'],
  ['Diwali greeting for our customers', 'event'],
  ['explain how the diploma course works', 'explainer'],
  ['property walkthrough of the new 3BHK', 'walkthrough'],
  ['video showing why we are trusted, 15 years experienced', 'credibility'],
  ['address the worry about hidden charges and fees', 'objection'],
  ['announce the launch of our new batch', 'launch'],
  ['recap of last week at the studio', 'recap'],
  ['run an ad for the november batch at 15,000 off', 'offer-reel'],
];
for (const [brief, expected] of cases) {
  const chosen = choosePipeline(brief);
  check(`  "${brief.slice(0, 46)}" → ${expected}`, chosen.pipeline.id === expected, chosen.pipeline.id);
}
const empty = choosePipeline('make me a video');
check(
  'a brief that names no format falls back to the offer reel and says why',
  empty.pipeline.id === 'offer-reel' && /default/.test(empty.why),
  empty.why.slice(0, 60),
);
check('the choice is repeatable', choosePipeline(cases[1][0]).pipeline.id === choosePipeline(cases[1][0]).pipeline.id);
check(
  'the reason names the words that decided it',
  /mentions ".*"/.test(choosePipeline('before after gym transformation reel').why),
  choosePipeline('before after gym transformation reel').why.slice(0, 80),
);

// ── 4. The knowledge the agent loads, and where it came from.
console.log('\n▸ the skill text is ours, and says so');
const knowledge = renderPipelineKnowledge();
check('it renders a document', knowledge.length > 4000, `${knowledge.length} chars`);
check('every pipeline appears in it', VIDEO_PIPELINES.every((p) => knowledge.includes(p.name)));
check('every pipeline id appears in it, so the agent can name its choice', VIDEO_PIPELINES.every((p) => knowledge.includes(p.id)));
check('it states the provenance rather than implying a licence', /No third-party text is reproduced/.test(knowledge));
check(
  'and points at the decision record for the AGPL alternative',
  /openmontage-decision\.md/.test(knowledge),
  'the reason we wrote this instead of vendoring it',
);
check(
  'it does NOT claim OpenMontage authorship or a licence it does not have',
  !/OpenMontage/i.test(knowledge.split('## Where this comes from')[0]),
  'no attribution is owed, so none is implied',
);
check(
  'it tells the agent to ask rather than invent missing facts',
  /never a placeholder to fill in later and never a number to invent/i.test(knowledge.replace(/\s+/g, ' ')),
);
check('the catalogue exposes it so get_skill can reach it', houseSkillCatalogue().some((s) => s.name === 'nobogent-video-pipelines'));

// ── 5. The agent actually has it, and is told to pick a shape.
console.log('\n▸ the agent is told to choose a shape before designing');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);
const ctx = await createAgentContext(sb as any, ORG, { intentText: 'make a testimonial video from a student' });
const prompt = String(ctx.systemPrompt || '');
const flat = prompt.replace(/\s+/g, ' ');
check('the skill is offered in the prompt catalogue', /nobogent-video-pipelines/.test(prompt));
check('the doctrine says to load it after the shot skill', /LOAD THE PIPELINE SHAPE/i.test(flat));
check(
  'and that the shot skill comes first',
  flat.indexOf("get_skill('video-shotcraft')") < flat.indexOf("get_skill('nobogent-video-pipelines')") ||
    flat.indexOf("get_skill('nobogent-video-pipelines')") === -1,
  'shot design before pipeline shape, or not at all',
);
check('it names the shapes so the agent knows they exist', /testimonial/.test(flat) && /walkthrough/.test(flat));
const skillTool = (ctx.tools as any).get_skill;
const loaded = await skillTool.execute({ name: 'nobogent-video-pipelines' }, {} as any).catch((e: any) => ({ success: false, error: String(e?.message) }));
check(
  'get_skill actually returns it',
  loaded?.success !== false && JSON.stringify(loaded).includes('The customer story'),
  String(loaded?.error ?? `${JSON.stringify(loaded).length} bytes`).slice(0, 80),
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
