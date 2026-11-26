/**
 * GATE: an avatar speaks its own lines, is the same character in every shot, and is briefed on the line
 * it is saying.
 *
 * WHY THIS GATE EXISTS
 * The owner's report, verbatim: "when an avatar is selected then the tts should not be run, then the
 * avatar is supposed to speak the dialogues from the prompt not tts, the tts works only when the avatar
 * is not selected, and there were mutations in the video, i fed it a robotic mascot, in the end scene it
 * fit the human face in the nobogent helmet, i think need to work on the prompts too, since when it was
 * talking about meta ads, video generations etc, it should've shown something related to that."
 *
 * Three separate defects, and each is asserted here:
 *
 *   1. MODE SELECTION. The generator synthesised a full Gemini voiceover for BOTH presenter modes (its
 *      own comment said so: "...for BOTH Avatar and Non-Avatar videos"), and the callback then muxed that
 *      voiceover over shots where the avatar was already speaking the same words. Avatar mode now
 *      requests no TTS at all and marks the asset `audioUrl: 'none'` / `audioMode: 'avatar_speaks'`,
 *      which the voiceover resolver honours BEFORE its on-the-fly fallback synthesis — otherwise a
 *      narrator would reappear at the last step.
 *   2. IDENTITY DRIFT. Every shot is generated independently from the same reference photo, so "look like
 *      Image 1" was the only thing holding the character together — a soft per-shot hint with nothing
 *      naming the actual subject. A mascot became a human face inside a helmet in the end scene. Each
 *      shot's brief now carries an identity lock, quotes the avatar's own vision description, and forbids
 *      substituting a human.
 *   3. SCENE ↔ SCRIPT BINDING. `scenes[i % scenes.length]` gave every clip the same dialogue and the same
 *      visual direction when the script had no `scenes` array, and repeated a short script by modulo. A
 *      shot is now bound to one beat of the spoken script, and its visual brief carries that line.
 *
 * WHAT THIS GATE DOES NOT CLAIM: it does not watch a rendered video. Prompt-level guarantees are asserted
 * statically and the allocation is proven with fakes; the composite identity verification the brief asks
 * for (`analyze_video_with_gemini` on the finished file) is NOT wired into this legacy route, and the
 * report says so.
 *
 *   npm run verify:avatar-video
 */
import { readFileSync } from 'node:fs';
import { allocateSceneBriefs, splitDialogueBeats, subjectOfLine } from '../lib/agent/video-scene-briefs';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string | number | null = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail !== '' && detail !== null ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail !== '' && detail !== null ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

// ── 1. splitting a script into beats ────────────────────────────────────────
head('1. A script becomes one beat per shot');

{
  const dialogue =
    'Your leads now answer themselves. Meta ads report back every morning. ' +
    'Video generation runs while you sleep. You only approve.';
  const four = splitDialogueBeats(dialogue, 4);
  check('four sentences become four beats', four.length === 4, four.length);
  check('in order, starting at the beginning', /leads now answer/.test(four[0]), four[0]);
  check('and ending at the end', /only approve/.test(four[3]), four[3]);
  check('no beat is empty', four.every((b) => b.trim().length > 0));

  const oneSentence = splitDialogueBeats('One long sentence about property launches with no full stop anywhere in it at all', 3);
  check('a single sentence is still split into the requested beats', oneSentence.length === 3, oneSentence.length);
  check('and no words are invented', oneSentence.join(' ').includes('property launches'));

  const short = splitDialogueBeats('Short one. Two.', 4);
  check(
    'a two-word-sentence script is not padded with invented words',
    short.length === 2 && short.join(' ') === 'Short one. Two.',
    `${short.length}: ${short.join(' | ')}`,
  );

  const many = splitDialogueBeats('A. B. C. D. E. F.', 2);
  check('too many sentences are grouped, keeping all the words', many.length === 2 && many.join(' ').replace(/\s+/g, ' ').includes('F'), many.join(' | '));

  check('an empty script yields no beats rather than an empty shot', splitDialogueBeats('', 3).length === 0);
  check('whitespace-only yields nothing', splitDialogueBeats('   \n  ', 2).length === 0);
}

// ── 2. what a shot's visual brief is anchored on ────────────────────────────
head('2. A shot is briefed on the line it says');

{
  check('the subject of a line is the line', subjectOfLine('Your ads report back to you.') === 'Your ads report back to you.');
  check('stage directions are stripped', subjectOfLine('[CUT TO] the dashboard (wide shot)') === 'the dashboard', subjectOfLine('[CUT TO] the dashboard (wide shot)'));
  check('bullet markers are stripped', subjectOfLine('- leads answered automatically') === 'leads answered automatically');

  const briefs = allocateSceneBriefs({
    scenes: null,
    dialogue: 'Your ads now report back. Video generation runs itself. Leads are answered in seconds.',
    visuals: 'A modern office at golden hour',
    clips: 3,
  });
  check('three clips, three briefs', briefs.length === 3, briefs.length);
  check('every brief carries its own line', briefs.every((b) => b.dialogue.length > 0));
  check(
    'the brief for the ads line is about ads, not generic footage',
    /ads/i.test(briefs[0].visuals) && /ads/i.test(briefs[0].dialogue),
    briefs[0].visuals,
  );
  check(
    'the brief for the video-generation line is about that line',
    /Video generation|video generation/i.test(briefs[1].dialogue),
    briefs[1].dialogue,
  );
  check('the script visual direction is kept as the base', /modern office/i.test(briefs[0].visuals));
  check('and the shots are distinct, not the same brief three times', new Set(briefs.map((b) => b.dialogue)).size === 3);
}

// ── 3. a script with scenes is not repeated by modulo ──────────────────────
head('3. Two scenes and four clips is not the same two shots twice');

{
  const briefs = allocateSceneBriefs({
    scenes: [
      { dialogue: 'First line about the launch.', visuals: 'Tower exterior at dawn' },
      { dialogue: 'Second line about the price.', visuals: 'Interior walkthrough' },
    ],
    dialogue: 'First line about the launch. Second line about the price. Third line about the offer. Fourth line about booking a visit.',
    visuals: 'Luxury real estate',
    clips: 4,
  });
  check('four briefs are produced', briefs.length === 4, briefs.length);
  check('the script scenes are used first, in order', /Tower exterior/.test(briefs[0].visuals) && /Interior walkthrough/.test(briefs[1].visuals));
  check(
    'clips three and four are NOT copies of one and two',
    briefs[2].dialogue !== briefs[0].dialogue && briefs[3].dialogue !== briefs[1].dialogue,
    `${briefs[2].dialogue} | ${briefs[3].dialogue}`,
  );
  check('and they are sourced from the dialogue, not invented', briefs.slice(2).every((b) => b.source !== 'script-scene'));
  check(
    'more scenes than clips takes the first clips only',
    allocateSceneBriefs({ scenes: [{ dialogue: 'a' }, { dialogue: 'b' }, { dialogue: 'c' }], clips: 2 }).length === 2,
  );
  check('one clip is always one brief', allocateSceneBriefs({ dialogue: 'Only line.', clips: 1 }).length === 1);
  check('no dialogue at all still yields briefs rather than throwing', allocateSceneBriefs({ clips: 2 }).length === 2);
}

// ── 4. mode selection: an avatar gets no TTS ───────────────────────────────
head('4. Avatar selected means no TTS is requested, and none is muxed');

{
  const generate = readFileSync('app/api/video/generate/route.ts', 'utf8');
  const avatarBranch = generate.search(/if \(isAvatarPresenter\) \{\r?\n\s+grokAudioUrl = null;/);
  const ttsBranch = generate.indexOf('} else if (!grokAudioUrl && script.dialogue');
  check('the avatar branch exists', avatarBranch > 0, avatarBranch);
  check('it comes before the TTS synthesis branch', avatarBranch > 0 && ttsBranch > avatarBranch, `${avatarBranch} < ${ttsBranch}`);
  check(
    'and it marks the asset so nothing is muxed',
    /audioUrl: 'none', isAvatar: true, audioMode: 'avatar_speaks'/.test(generate),
  );
  check(
    'the avatar branch never calls the TTS creator itself',
    (() => {
      if (avatarBranch < 0 || ttsBranch < 0) return false;
      return !/createGeminiTTS/.test(generate.slice(avatarBranch, ttsBranch));
    })(),
  );
  check(
    'the non-avatar branch still does (voiceover is not removed for everyone)',
    /Launching asynchronous Gemini TTS voiceover for the NO-AVATAR video/.test(generate) &&
      /createGeminiTTS\(\{/.test(generate.slice(ttsBranch)),
  );
  check(
    'the metadata write merges instead of wiping videoModel/presenterType',
    /update\(\{ metadata: \{ \.\.\.existing, \.\.\.patch \} \}\)/.test(generate) && !/metadata: \{ audioUrl: 'tts:/.test(generate),
  );

  const helper = readFileSync('utils/video-voiceover-helper.ts', 'utf8');
  const guard = helper.indexOf("assetMetadata?.audioMode === 'avatar_speaks'");
  const fallback = helper.indexOf('Synthesizing on-the-fly Gemini TTS voiceover');
  check('the resolver refuses avatar-speaks assets', guard > 0, guard);
  check(
    'before its on-the-fly fallback synthesis can put a narrator back',
    guard > 0 && fallback > guard,
    `${guard} < ${fallback}`,
  );

  const stitcher = readFileSync('utils/video-stitcher.ts', 'utf8');
  check(
    "the stitcher keeps the clips' own audio, so the avatar's speech survives the join",
    /-map 0:a\?/.test(stitcher) && /native audio/.test(stitcher),
  );
}

// ── 5. identity lock, in every shot ────────────────────────────────────────
head('5. The identity is locked in every shot, and drift is named');

{
  const generate = readFileSync('app/api/video/generate/route.ts', 'utf8');
  check('an identity lock block exists', /IDENTITY LOCK — ONE CHARACTER, IN EVERY SHOT OF THIS VIDEO/.test(generate));
  check(
    'the avatar description is quoted into it',
    /avatar_description \|\| \(script as any\)\?\.avatar_description/.test(generate) && /Immutable appearance, reproduced exactly/.test(generate),
  );
  check(
    'it forbids substituting a human for a mascot, by name',
    /Never replace it with a human being, and never push a human face into a helmet/.test(generate),
  );
  check(
    'it names the one-character rule for the whole video',
    /the SAME character must appear here as in every other scene/.test(generate),
  );
  check('and it is interpolated into the avatar prompt itself', /\$\{identityLock\}/.test(generate));
  check(
    'the prompt still tells the model to SAY the line (speech comes from the model, not a track)',
    /flawless lip synchronization saying: "\$\{sceneDialogue\}"/.test(generate),
  );
  check(
    'the modulo repeat of scene briefs is gone (the code, not the comment explaining it)',
    !/const currentSceneObj = scenes\[i % scenes\.length\]/.test(generate),
  );
  check('and the briefs are allocated per clip', /allocateSceneBriefs\(\{/.test(generate));
}

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nAn avatar must speak its own lines, stay itself, and be told what the line is about.');
  process.exit(1);
}
console.log('Avatar mode: no TTS, one identity, one shot per line.');
