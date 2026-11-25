/**
 * Gate for the video-creation decision core.
 *
 * Every assertion here corresponds to a failure that actually happened while building two rejected
 * films, so this file is the regression suite for that post-mortem rather than a style check:
 *
 *   - a 4-minute film was generated entirely at 1080p because nobody asked;
 *   - "same style as the reference" was never turned into numbers;
 *   - picture was generated for 9 lines and 4 were shown;
 *   - a vendor outage was retried 42 times;
 *   - lines that dropped their opening words passed the old coverage check.
 *
 * Pure: no vendor, no browser, no database, no clock.
 */
import {
  DEFAULT_VIDEO_RESOLUTION,
  GATES,
  VIDEO_RESOLUTIONS,
  assignAttachments,
  checkBriefConsistency,
  decideLane,
  draftThenFinalEconomics,
  gatesBeforeSpend,
  planCost,
  resolutionChoices,
  resolutionQuestion,
  shouldAbortBatch,
  verifySpokenLine,
  videoCreditsFor,
} from '../lib/agent/video-plan';
import { VIDEO_CREDITS_PER_SECOND } from '../lib/agent/media-models';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

// ── resolution ─────────────────────────────────────────────────────────────
console.log('\n=== resolution: asked, priced from the registry, 480p by default ===');

check('the default is 480p', DEFAULT_VIDEO_RESOLUTION === '480p', DEFAULT_VIDEO_RESOLUTION);
check('three resolutions are offered', VIDEO_RESOLUTIONS.length === 3, VIDEO_RESOLUTIONS.join(' '));

const choices = resolutionChoices(60);
check('a choice exists per resolution', choices.length === 3);
check(
  'prices are READ from the registry, not retyped',
  choices.every((c) => c.creditsPerSecond === VIDEO_CREDITS_PER_SECOND[c.resolution]),
  choices.map((c) => `${c.resolution}=${c.creditsPerSecond}`).join(' '),
);
check(
  '60s at 480p is 144 credits (2.4/s)',
  choices.find((c) => c.resolution === '480p')?.credits === 144,
  String(choices.find((c) => c.resolution === '480p')?.credits),
);
check(
  '60s at 1080p is 480 credits (8/s)',
  choices.find((c) => c.resolution === '1080p')?.credits === 480,
  String(choices.find((c) => c.resolution === '1080p')?.credits),
);
check(
  'the 1080p multiple of the default is 3.33x',
  choices.find((c) => c.resolution === '1080p')?.multipleOfDefault === 3.33,
  String(choices.find((c) => c.resolution === '1080p')?.multipleOfDefault),
);
check('the question quotes every price', /480 credits/.test(resolutionQuestion(60)) && /144 credits/.test(resolutionQuestion(60)));
check('the question names the default', /480p is the default/.test(resolutionQuestion(60)));

// ── draft-then-final economics ─────────────────────────────────────────────
console.log('\n=== draft-then-final: the break-even is stated, not guessed ===');

const econ = draftThenFinalEconomics(60, '1080p', '480p');
check(
  'the break-even keep rate for 480p->1080p is 0.70',
  econ.breakEvenKeepRate === 0.7,
  String(econ.breakEvenKeepRate),
);
check('below the break-even, drafting first wins', econ.cheaperAt(0.5) === 'draft-first');
check('above the break-even, going straight to final wins', econ.cheaperAt(0.9) === 'direct-to-final');
check('at the break-even, drafting is not worse', econ.cheaperAt(0.7) === 'draft-first');
check('going direct to 1080p is 480 credits for 60s', econ.directToFinal === 480, String(econ.directToFinal));

// ── lane ───────────────────────────────────────────────────────────────────
console.log('\n=== lane: reference in means measure first ===');

check('a reference selects the reference lane', decideLane({ hasReference: true }).lane === 'reference');
check('no reference selects the default lane', decideLane({ hasReference: false }).lane === 'default');
check(
  'the reference lane starts at the free measurement',
  /Style Card/.test(decideLane({ hasReference: true }).firstStep),
);
check(
  'the default lane puts attachments ahead of generation',
  /Inventory the attachments/.test(decideLane({ hasReference: false, attachmentCount: 2 }).firstStep),
);

// ── brief consistency ──────────────────────────────────────────────────────
console.log('\n=== brief consistency: the conflict is asked, not silently resolved ===');

const presenterConflict = checkBriefConsistency({ hasPresenter: false }, { wantsSpeakingCharacter: true });
check('a no-presenter reference plus a speaking character is a conflict', presenterConflict.length === 1);
check('the conflict asks a question', /\?/.test(presenterConflict[0]?.question ?? ''));
check(
  'the conflict explains why, not just that',
  /different genre|design and motion/.test(presenterConflict[0]?.because ?? ''),
);

const cutsConflict = checkBriefConsistency({ cutsPerMinute: 0 }, { wantsMultiShot: true });
check('a zero-cut reference plus a multi-shot edit is a conflict', cutsConflict.length === 1);

const voConflict = checkBriefConsistency({ isVoiceoverOnly: true }, { wantsSpeakingCharacter: true });
check('a voiceover reference plus on-camera speech is a conflict', voConflict.length === 1);

check(
  'a coherent brief produces no questions',
  checkBriefConsistency({ hasPresenter: true, cutsPerMinute: 12 }, { wantsSpeakingCharacter: true, wantsMultiShot: true })
    .length === 0,
);

// ── plan cost: the waste is visible before the batch ───────────────────────
console.log('\n=== plan cost: footage nobody will see is counted and named ===');

const beats = [
  { id: 'b1', role: 'picture' as const, generateSeconds: 6 },
  { id: 'b2', role: 'picture' as const, generateSeconds: 6 },
  { id: 'b3', role: 'audio-only' as const, generateSeconds: 8 },
  { id: 'b4', role: 'picture' as const, generateSeconds: 5, coveredByAttachment: true },
];
const cost = planCost(beats, '1080p');

check('picture seconds exclude the audio-only plate', cost.pictureSeconds === 12, String(cost.pictureSeconds));
check('audio-only seconds are counted', cost.audioOnlySeconds === 8, String(cost.audioOnlySeconds));
check('attachment seconds are not billed', cost.attachmentSeconds === 5, String(cost.attachmentSeconds));
check('generated seconds are picture + audio-only', cost.generatedSeconds === 20, String(cost.generatedSeconds));
check('credits are for the generated seconds only', cost.credits === 160, String(cost.credits));
check(
  'the credits that buy unseen picture are named',
  cost.creditsForUnseenPicture === 64,
  String(cost.creditsForUnseenPicture),
);
check(
  'the plan says so in words',
  cost.notes.some((n) => /picture nobody sees/.test(n)),
  cost.notes.find((n) => /picture nobody sees/.test(n))?.slice(0, 70),
);
check(
  'the plan says the attachment was free',
  cost.notes.some((n) => /own footage/.test(n)),
);

const draftCost = planCost(beats, '480p');
check('the same plan at 480p is a third of the price', draftCost.credits === 48, String(draftCost.credits));

// ── line verification: the truncation that shipped by luck ─────────────────
console.log('\n=== line verification: a dropped opening word fails ===');

const truncated = verifySpokenLine(
  'Meet Nobo. The AI that runs your entire real estate business.',
  'The AI that runs your entire real estate business.',
);
check('a clip missing its opening words is NOT ok', truncated.ok === false);
check('the missing opening is named', truncated.firstWordPresent === false);
check('coverage alone would have passed it (0.82)', truncated.coverage > 0.8, String(truncated.coverage));
check(
  'the reason tells the operator what to do',
  /begin speaking in the first frame/.test(truncated.reason ?? ''),
  truncated.reason?.slice(0, 80),
);

const lostTail = verifySpokenLine('Jab aap site pe the.', 'Jab aap site pe');
check('a clip missing its final word is NOT ok', lostTail.ok === false);
check('the lost tail is attributed to the trim', /trim/.test(lostTail.reason ?? ''));

const full = verifySpokenLine('Purana nahi. Unsuni hai.', 'Purana nahi. Unsuni hai.');
check('a line that said everything is ok', full.ok === true, `coverage ${full.coverage}`);

const improvised = verifySpokenLine(
  'No agencies. No telecaller shifts. No site visit left unfollowed.',
  'Something entirely different was said here instead.',
);
check('an improvised line is NOT ok', improvised.ok === false);

// ── circuit breaker ────────────────────────────────────────────────────────
console.log('\n=== circuit breaker: an outage stops the batch ===');

const storm = shouldAbortBatch([
  { ok: false, reason: '524 generate task timeout.' },
  { ok: false, reason: '524 generate task timeout.' },
  { ok: false, reason: '524 generate task timeout.' },
]);
check('three identical failures abort the batch', storm.abort === true);
check('the verdict calls it an outage', /outage/.test(storm.reason ?? ''));
check('it says to run one control', /control/.test(storm.reason ?? ''));

check(
  'two failures are not enough to abort',
  shouldAbortBatch([{ ok: false, reason: 'x' }, { ok: false, reason: 'x' }]).abort === false,
);
check(
  'a success in the tail prevents an abort',
  shouldAbortBatch([
    { ok: false, reason: 'x' },
    { ok: false, reason: 'x' },
    { ok: true },
  ]).abort === false,
);
check(
  'mixed reasons still stop the batch for a human look',
  shouldAbortBatch([
    { ok: false, reason: 'a' },
    { ok: false, reason: 'b' },
    { ok: false, reason: 'c' },
  ]).abort === true,
);

// ── attachments ────────────────────────────────────────────────────────────
console.log('\n=== attachments: the operator\'s own footage outranks generation ===');

const assignments = assignAttachments(
  [
    { id: 'b1', role: 'picture' as const, seconds: 5 },
    { id: 'b2', role: 'picture' as const, seconds: 5 },
    { id: 'b3', role: 'audio-only' as const, seconds: 5 },
  ],
  [
    { id: 'clip-long', kind: 'video' as const, seconds: 12, shows: 'the tower at dusk' },
    { id: 'clip-defect', kind: 'video' as const, seconds: 30, hasDefect: true },
  ],
);
check('a covering clip is assigned once, not reused', assignments.length === 1);
check('the assignment cites the real thing', /the tower at dusk/.test(assignments[0]?.because ?? ''));
check(
  'a clip with a defect is skipped',
  assignments.every((a) => a.attachmentId !== 'clip-defect'),
);
check(
  'audio-only beats never take an attachment',
  assignments.every((a) => a.beatId !== 'b3'),
);

// ── gates ──────────────────────────────────────────────────────────────────
console.log('\n=== gates: nothing expensive before an approval ===');

check('there are seven gates', GATES.length === 7, `${GATES.length}`);
check(
  'the free gates come before the first paid one',
  GATES.findIndex((g) => g.mediaCredits > 0) >
    GATES.findIndex((g) => g.id === 'storyboard'),
);
check('measurement is free', GATES.find((g) => g.id === 'measure')?.mediaCredits === 0);
check('the storyboard is free', GATES.find((g) => g.id === 'storyboard')?.mediaCredits === 0);
check(
  'the resolution question is asked before any generation',
  GATES.findIndex((g) => g.id === 'resolution') < GATES.findIndex((g) => g.id === 'hero-frame'),
);
const beforeSpend = gatesBeforeSpend();
check('four gates must pass before a credit is spent', beforeSpend.length === 4, beforeSpend.map((g) => g.id).join(' '));
check('none of them cost media credits', beforeSpend.every((g) => g.mediaCredits === 0));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
