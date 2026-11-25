/**
 * The video-creation decision core: resolution, lane, cost, and the checks that stop a bad batch.
 *
 * WHY THIS FILE EXISTS
 * Two full films were built in this repo and both were rejected, having spent 1,784 vendor
 * credits. The post-mortem found that none of the failures were model quality — every one was a
 * decision made too late or never asked:
 *
 *   - nobody asked what resolution the operator wanted, so every shot was generated at 1080p
 *     (8 credits/sec) when half the work was drafts (2.4);
 *   - "make it like this reference" was never turned into numbers, so "same style" meant
 *     "same palette" and the motion/density that actually constitute the style was missed;
 *   - picture was generated for 9 speaking lines and only 4 were ever shown on screen;
 *   - 7 of 9 spoken lines came back truncated — including the product's name — and that was
 *     caught by luck, because `DIALOGUE_MIN_COVERAGE` (0.4) passes a line that dropped its
 *     opening words;
 *   - a vendor outage was retried 42 times across 7 lines before anyone ran a control.
 *
 * Every one of those is a decision that can be made BEFORE a credit is spent, which is what this
 * module is for. It is PURE — no I/O, no env, no clock, no random — so a gate can pin the whole
 * policy without touching a vendor.
 *
 * The one rule that ties it together: nothing expensive happens until a cheap artefact has been
 * approved. See `gateFor()` for the ordered gates.
 */

import { VIDEO_CREDITS_PER_SECOND, type VideoResolution } from './media-models';

// Re-exported so a caller importing a video type does not have to know it originates in the
// model registry. `intake.ts` needs `VideoResolution` for the answer it now collects.
export type { VideoResolution };

// ────────────────────────────────────────────────────────────────────────────
// 1. Resolution — asked every time, 480p by default
// ────────────────────────────────────────────────────────────────────────────

/** The three resolutions the app offers, cheapest first. */
export const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

/**
 * The default. A draft at 480p costs a third of the same seconds at 1080p, which is why the
 * registry already defaults `dialogue` plates here — and why an operator who has not been asked
 * should get the cheap one.
 */
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = '480p';

export interface ResolutionChoice {
  resolution: VideoResolution;
  creditsPerSecond: number;
  /** What this resolution costs for the seconds actually needed. */
  credits: number;
  /** Against the default, so "4x more" is answerable without arithmetic. */
  multipleOfDefault: number;
  label: string;
  useWhen: string;
}

/**
 * Every resolution with its price for a given number of seconds.
 *
 * The numbers are READ from the registry, never retyped: `VIDEO_CREDITS_PER_SECOND` is the same
 * table the credit estimate and the plan table derive from, so a price change cannot leave this
 * function quoting a stale figure.
 */
export function resolutionChoices(seconds: number): readonly ResolutionChoice[] {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const base = VIDEO_CREDITS_PER_SECOND[DEFAULT_VIDEO_RESOLUTION];
  const meta: Record<VideoResolution, { label: string; useWhen: string }> = {
    '480p': { label: '480p', useWhen: 'drafts, animatics, anything you plan to revise' },
    '720p': { label: '720p', useWhen: 'WhatsApp, in-app previews, mid-fidelity review' },
    '1080p': { label: '1080p', useWhen: 'the final cut, Reels/Shorts, a client-facing film' },
  };
  return VIDEO_RESOLUTIONS.map((resolution) => {
    const rate = VIDEO_CREDITS_PER_SECOND[resolution];
    return {
      resolution,
      creditsPerSecond: rate,
      credits: Math.ceil(rate * safeSeconds),
      multipleOfDefault: Number((rate / base).toFixed(2)),
      ...meta[resolution],
      // label/useWhen already spread above
    };
  });
}

/** The question the agent must ask before generating, with the prices in it. */
export function resolutionQuestion(seconds: number): string {
  const rows = resolutionChoices(seconds)
    .map((c) => `  • ${c.label} — ${c.credits} credits for ~${Math.round(seconds)}s of footage (${c.multipleOfDefault}× 480p) · ${c.useWhen}`)
    .join('\n');
  return (
    `Which resolution?\n${rows}\n\n` +
    `480p is the default: it is a third of 1080p and most first cuts get revised.`
  );
}

/** Credits for a span of footage at one resolution. */
export function videoCreditsFor(seconds: number, resolution: VideoResolution = DEFAULT_VIDEO_RESOLUTION): number {
  const rate = VIDEO_CREDITS_PER_SECOND[resolution];
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return Math.ceil(rate * safe);
}

/**
 * Draft-then-final economics.
 *
 * Generating once at the final resolution costs `rate_final`. Drafting at 480p and re-generating
 * only the shots that survive costs `rate_draft + keepRate × rate_final`. The two break even at a
 * keep rate of 1 − rate_draft/rate_final — 0.70 for 480p→1080p. Below that, drafting first is
 * strictly cheaper AND buys an approval point for free; above it, go straight to final.
 */
export interface DraftEconomics {
  directToFinal: number;
  draftThenFinal: number;
  /** Keep rate at which both strategies cost the same. */
  breakEvenKeepRate: number;
  /** Which strategy wins if the operator expects this many shots to survive. */
  cheaperAt: (keepRate: number) => 'draft-first' | 'direct-to-final';
}

export function draftThenFinalEconomics(
  seconds: number,
  finalResolution: VideoResolution = '1080p',
  draftResolution: VideoResolution = DEFAULT_VIDEO_RESOLUTION,
): DraftEconomics {
  const finalRate = VIDEO_CREDITS_PER_SECOND[finalResolution];
  const draftRate = VIDEO_CREDITS_PER_SECOND[draftResolution];
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const breakEven = Number((1 - draftRate / finalRate).toFixed(3));
  return {
    directToFinal: Math.ceil(finalRate * safe),
    draftThenFinal: Math.ceil((draftRate + breakEven * finalRate) * safe),
    breakEvenKeepRate: breakEven,
    cheaperAt: (keepRate: number) =>
      keepRate <= breakEven ? 'draft-first' : 'direct-to-final',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Lane — reference-driven, or the creation-tab default
// ────────────────────────────────────────────────────────────────────────────

export type Lane = 'reference' | 'default';

export interface LaneInput {
  /** True when the operator supplied a reference film or a link to one. */
  hasReference: boolean;
  /** How many usable attachments (their own footage, product clips) came with the brief. */
  attachmentCount?: number;
}

export interface LaneDecision {
  lane: Lane;
  because: string;
  /** The first thing to do in this lane. */
  firstStep: string;
}

/**
 * Which pipeline to run.
 *
 * `reference` means the style must be MEASURED first (the reverse skill costs 0 media credits) and
 * nothing generates until a storyboard is approved. `default` means the creation-tab pipeline:
 * ask the few questions that matter, build the base, then revise by instruction.
 */
export function decideLane(input: LaneInput): LaneDecision {
  if (input.hasReference) {
    return {
      lane: 'reference',
      because: 'a reference was supplied, so "same style" is a measurement problem, not a guess',
      firstStep:
        'Run the reference analysis (cuts, shot lengths, palette, type placement, voice pace) and show the ' +
        'Style Card. It costs no media credits. Then state what will NOT be copied.',
    };
  }
  return {
    lane: 'default',
    because: 'no reference, so the creation-tab pipeline applies and the brief is the only source of style',
    firstStep:
      (input.attachmentCount ?? 0) > 0
        ? 'Inventory the attachments first — their own footage is free and accurate, so it outranks generation.'
        : 'Ask the few questions that change the output: resolution, length, and whether anything must appear on screen.',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Brief consistency — say the conflict out loud
// ────────────────────────────────────────────────────────────────────────────

/** What a reference film actually does, as measured (not as described). */
export interface ReferenceTraits {
  /** A person or character on camera, speaking. */
  hasPresenter?: boolean;
  /** Hard cuts per minute. 0 means one continuous morph. */
  cutsPerMinute?: number;
  /** Narration exists but nobody speaks on camera. */
  isVoiceoverOnly?: boolean;
  hasCaptions?: boolean;
  aspect?: string;
}

export interface BriefIntent {
  /** The brief needs a character speaking on camera. */
  wantsSpeakingCharacter?: boolean;
  /** The brief needs a cut-driven edit (several distinct shots). */
  wantsMultiShot?: boolean;
  /** The brief needs a voiceover track. */
  wantsVoiceover?: boolean;
  /** The operator's credit ceiling for this job, if they set one. */
  creditCeiling?: number;
}

export interface Conflict {
  id: string;
  /** The question to put to the operator. One conflict, one question. */
  question: string;
  /** Why the two cannot both be satisfied. */
  because: string;
}

/**
 * Find the places where the reference and the brief contradict each other.
 *
 * This is the check that was missing. A reference with no presenter cannot also be a film where a
 * mascot speaks to camera, and a reference with zero cuts cannot also be a fast multi-shot edit.
 * Both were true of the work done here, the conflict was noticed, and it was resolved silently in
 * favour of the brief — which is how a motion-graphics reference turned into a mascot spot.
 *
 * Returns conflicts in the order they should be asked. Empty array means the brief is coherent.
 */
export function checkBriefConsistency(
  traits: ReferenceTraits,
  intent: BriefIntent,
): readonly Conflict[] {
  const out: Conflict[] = [];

  if (traits.hasPresenter === false && intent.wantsSpeakingCharacter) {
    out.push({
      id: 'presenter',
      because:
        'the reference carries its message with design and motion and has nobody on camera, so a speaking ' +
        'character will read as a different genre however well it is executed',
      question:
        'The reference has no presenter, but you want a character speaking on camera. Which matters more — ' +
        'the reference look, or the mascot talking? (A narrator over the reference-style visuals keeps both.)',
    });
  }

  if (traits.cutsPerMinute !== undefined && traits.cutsPerMinute <= 1 && intent.wantsMultiShot) {
    out.push({
      id: 'cuts',
      because:
        `the reference runs at ${traits.cutsPerMinute} cuts per minute — it is one continuous morph, and a ` +
        'generated-shot edit is a slideshow by comparison',
      question:
        'The reference has essentially no cuts. Do you want a continuous morph (built as graphics, not ' +
        'generated clips), or a cut-driven edit (generated clips, which will not feel like the reference)?',
    });
  }

  if (traits.isVoiceoverOnly && intent.wantsSpeakingCharacter) {
    out.push({
      id: 'voiceover',
      because: 'the reference is voiceover over visuals, with nobody speaking on camera',
      question:
        'The reference voices over its visuals. Should the character speak on camera, or narrate over them?',
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. The plan — and the waste it prevents
// ────────────────────────────────────────────────────────────────────────────

/**
 * What a beat needs from the vendor.
 *
 * `audio-only` is the important one: a spoken line that will play over graphics still needs a
 * dialogue plate generated, because that is how the model's own voice is obtained — but its PICTURE
 * is thrown away. Counting it explicitly is what surfaces "you are paying for footage you will not
 * show" before the batch, instead of during the edit.
 */
export type BeatRole = 'picture' | 'audio-only';

export interface PlannedBeat {
  id: string;
  role: BeatRole;
  /** Seconds of footage this beat needs generated. 0 when an attachment covers it. */
  generateSeconds: number;
  /** An attached file covers this beat, so nothing is generated. */
  coveredByAttachment?: boolean;
}

export interface VideoPlanCost {
  pictureSeconds: number;
  audioOnlySeconds: number;
  generatedSeconds: number;
  /** Seconds that came from the operator's own footage. */
  attachmentSeconds: number;
  credits: number;
  /** Credits that buy footage nobody will see — the audio-only plates. */
  creditsForUnseenPicture: number;
  /** Beats that need no generation at all. */
  freeBeats: number;
  notes: string[];
}

/**
 * Cost a beat list at a resolution, and say out loud how much of it buys picture that is discarded.
 */
export function planCost(
  beats: readonly PlannedBeat[],
  resolution: VideoResolution = DEFAULT_VIDEO_RESOLUTION,
): VideoPlanCost {
  let pictureSeconds = 0;
  let audioOnlySeconds = 0;
  let attachmentSeconds = 0;
  let freeBeats = 0;

  for (const b of beats) {
    if (b.coveredByAttachment) {
      attachmentSeconds += b.generateSeconds;
      freeBeats += 1;
      continue;
    }
    if (b.role === 'picture') pictureSeconds += b.generateSeconds;
    else audioOnlySeconds += b.generateSeconds;
  }

  const generatedSeconds = pictureSeconds + audioOnlySeconds;
  const credits = videoCreditsFor(generatedSeconds, resolution);
  const creditsForUnseenPicture = videoCreditsFor(audioOnlySeconds, resolution);

  const notes: string[] = [];
  if (freeBeats > 0) {
    notes.push(
      `${freeBeats} beat(s) come from the operator's own footage (${attachmentSeconds.toFixed(1)}s) — no ` +
        'credits, and it is accurate rather than invented.',
    );
  }
  if (audioOnlySeconds > 0) {
    notes.push(
      `${audioOnlySeconds.toFixed(1)}s of the generation buys picture nobody sees: those lines are heard, not ` +
        'shown. It cannot be avoided — a model-voiced line only exists as a video clip — but it must be budgeted.',
    );
  }
  if (resolution === DEFAULT_VIDEO_RESOLUTION) {
    notes.push('Priced at the 480p default. Quote the resolution choice before generating.');
  }

  return {
    pictureSeconds,
    audioOnlySeconds,
    generatedSeconds,
    attachmentSeconds,
    credits,
    creditsForUnseenPicture,
    freeBeats,
    notes,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Verify what came back — the truncation catcher
// ────────────────────────────────────────────────────────────────────────────

export interface LineCheck {
  /** Share of the script's words that appear in the transcript at all. */
  coverage: number;
  firstWordPresent: boolean;
  lastWordPresent: boolean;
  missingWords: string[];
  ok: boolean;
  reason?: string;
}

const WORD = /[\p{L}\p{N}']+/gu;

function words(text: string): string[] {
  return (String(text ?? '').toLowerCase().match(WORD) ?? []).filter((w) => w.length > 1);
}

/**
 * Did the model say the line, or something plausible?
 *
 * `DIALOGUE_MIN_COVERAGE` is 0.4 and compares unordered word sets, so a line that dropped its
 * OPENING still passes: "The AI that runs your entire real estate business" scores 0.82 against
 * "Meet Nobo. The AI that runs your entire real estate business." — and "Meet Nobo" is the two
 * words that carry the brand. So the first and last words are checked as ordered facts, and the
 * bar for `ok` is a real share of the line, not a bag of words.
 */
export function verifySpokenLine(
  script: string,
  heard: string,
  options: { minCoverage?: number } = {},
): LineCheck {
  const minCoverage = options.minCoverage ?? 0.8;
  const want = words(script);
  const got = words(heard);

  if (want.length === 0) {
    return { coverage: 1, firstWordPresent: true, lastWordPresent: true, missingWords: [], ok: false, reason: 'the script line has no words' };
  }
  if (got.length === 0) {
    return { coverage: 0, firstWordPresent: false, lastWordPresent: false, missingWords: want, ok: false, reason: 'the clip produced no speech' };
  }

  const gotSet = new Set(got);
  const missingWords = want.filter((w) => !gotSet.has(w));
  const coverage = Number(((want.length - missingWords.length) / want.length).toFixed(3));

  const firstWordPresent = gotSet.has(want[0]);
  const lastWordPresent = gotSet.has(want[want.length - 1]);

  if (!firstWordPresent) {
    return {
      coverage,
      firstWordPresent,
      lastWordPresent,
      missingWords,
      ok: false,
      reason: `the clip dropped its opening word ("${want[0]}") — retry with a longer duration and an explicit "begin speaking in the first frame"`,
    };
  }
  if (!lastWordPresent) {
    return {
      coverage,
      firstWordPresent,
      lastWordPresent,
      missingWords,
      ok: false,
      reason: `the clip dropped its final word ("${want[want.length - 1]}") — usually a trim, not the model`,
    };
  }
  if (coverage < minCoverage) {
    return {
      coverage,
      firstWordPresent,
      lastWordPresent,
      missingWords,
      ok: false,
      reason: `coverage ${coverage} is under ${minCoverage} — the model improvised`,
    };
  }
  return { coverage, firstWordPresent, lastWordPresent, missingWords, ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. The circuit breaker
// ────────────────────────────────────────────────────────────────────────────

export interface BatchOutcome {
  ok: boolean;
  reason?: string;
}

export interface BreakerVerdict {
  abort: boolean;
  reason?: string;
  /** How many of the trailing outcomes failed for the same reason. */
  consecutiveSameReason: number;
}

/**
 * Stop a batch when the vendor is down, rather than walking every item through retry + fallback.
 *
 * `withMediaFallback` is per-item by design, so seven voice lines became seven independent 524
 * storms — 42 calls before a route change. A control payload is the other half of this: if a
 * known-good request also fails, the vendor is down and no amount of retrying helps.
 */
export function shouldAbortBatch(
  outcomes: readonly BatchOutcome[],
  options: { minSample?: number } = {},
): BreakerVerdict {
  const minSample = options.minSample ?? 3;
  if (outcomes.length < minSample) return { abort: false, consecutiveSameReason: 0 };

  const tail = [...outcomes].slice(-minSample);
  if (!tail.every((o) => !o.ok)) return { abort: false, consecutiveSameReason: 0 };

  const reasons = new Set(tail.map((o) => (o.reason ?? '').trim()));
  const sameReason = reasons.size === 1 ? tail.length : 0;

  if (sameReason >= minSample) {
    return {
      abort: true,
      consecutiveSameReason: sameReason,
      reason:
        `the last ${sameReason} item(s) all failed with "${[...reasons][0]}" — that is an outage, not a bad ` +
        'request. Stop the batch, run one control payload, and switch route instead of retrying.',
    };
  }
  if (tail.every((o) => !o.ok)) {
    return {
      abort: true,
      consecutiveSameReason: 0,
      reason:
        `the last ${minSample} item(s) failed for different reasons — stop and check the plan before spending more.`,
    };
  }
  return { abort: false, consecutiveSameReason: 0 };
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Attachments outrank generation
// ────────────────────────────────────────────────────────────────────────────

export interface AttachmentInventoryItem {
  id: string;
  kind: 'video' | 'image';
  seconds?: number;
  aspect?: string;
  /** Free-text description from the vision pass: what is actually in it. */
  shows?: string;
  /** Usable in/out points, when the clip is only partly relevant. */
  usableRange?: { from: number; to: number };
  hasOwnAudio?: boolean;
  /** A watermark or letterbox that would have to be cropped. */
  hasDefect?: boolean;
  /**
   * Why it is unusable, in the operator's words. A clip silently skipped is worse than one that
   * says "unreadable file" — the owner can fix a corrupt upload, but not a decision they cannot see.
   */
  problem?: string;
}

export interface AttachmentAssignment {
  beatId: string;
  attachmentId: string;
  because: string;
}

/**
 * Pick which attached files cover which beats, cheapest-and-most-accurate first.
 *
 * The rule is not "prefer attachments" as a preference — it is that an operator's own footage of
 * their own product is both free and TRUE, and a generated stand-in is neither. A clip is only
 * assigned when its usable length covers the beat and it carries no defect that would need work.
 */
export function assignAttachments(
  beats: readonly { id: string; role: BeatRole; seconds: number }[],
  inventory: readonly AttachmentInventoryItem[],
): readonly AttachmentAssignment[] {
  const usable = inventory.filter((a) => a.kind === 'video' && !a.hasDefect);
  const used = new Set<string>();
  const out: AttachmentAssignment[] = [];

  for (const beat of beats) {
    if (beat.role !== 'picture') continue;
    const candidate = usable.find((a) => {
      if (used.has(a.id)) return false;
      const length = a.usableRange ? a.usableRange.to - a.usableRange.from : (a.seconds ?? 0);
      return length >= beat.seconds;
    });
    if (!candidate) continue;
    used.add(candidate.id);
    out.push({
      beatId: beat.id,
      attachmentId: candidate.id,
      because: `covers ${beat.seconds.toFixed(1)}s of this beat, costs nothing, and shows the real thing${
        candidate.shows ? ` — ${candidate.shows}` : ''
      }`,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 8. The gates, in order
// ────────────────────────────────────────────────────────────────────────────

export interface Gate {
  id: string;
  /** What the operator sees at this gate. */
  artefact: string;
  /** Media credits this gate costs to reach. */
  mediaCredits: number;
  /** Nothing past this gate may spend until it is approved. */
  blocks: string;
}

/**
 * The ordered gates. Every expensive step sits BEHIND an approval of something cheap.
 *
 * The two films built here failed at gate 2 and gate 0 respectively, and in both cases the operator
 * saw the first frame of the result only after the whole thing had been generated and rendered.
 */
export const GATES: readonly Gate[] = [
  {
    id: 'measure',
    artefact: 'Style Card — the reference measured (cuts/min, shot lengths, palette, type placement, voice pace)',
    mediaCredits: 0,
    blocks: 'everything',
  },
  {
    id: 'consistency',
    artefact: 'The conflicts between the reference and the brief, stated as questions',
    mediaCredits: 0,
    blocks: 'the storyboard',
  },
  {
    id: 'storyboard',
    artefact: 'beats.json + greyscale cards + a rendered animatic at the real timings',
    mediaCredits: 0,
    blocks: 'any batch generation',
  },
  {
    id: 'resolution',
    artefact: 'The resolution choice, priced (480p default)',
    mediaCredits: 0,
    blocks: 'any generation',
  },
  {
    id: 'hero-frame',
    artefact: 'One approved still per distinct framing, not per shot',
    mediaCredits: 8,
    blocks: 'the batch',
  },
  {
    id: 'verify',
    artefact: 'Every generated asset checked against its own spec (first/last word, duration, frozen frame)',
    mediaCredits: 0,
    blocks: 'assembly',
  },
  {
    id: 'draft',
    artefact: 'A draft render before the delivery render',
    mediaCredits: 0,
    blocks: 'the final render',
  },
];

/** The gates that must be approved before the first credit is spent. */
export function gatesBeforeSpend(): readonly Gate[] {
  return GATES.filter((g) => g.mediaCredits === 0 && g.id !== 'verify' && g.id !== 'draft');
}

// ────────────────────────────────────────────────────────────────────────────
// 9. The rule as the agent reads it
// ────────────────────────────────────────────────────────────────────────────

/**
 * The policy rendered as instructions, for the `nobogent-video-gates` house skill.
 *
 * Rendered from the constants above rather than retyped, for the same reason the credit table is
 * read rather than copied: a prompt that quotes a price the code no longer charges is worse than a
 * prompt that quotes none.
 */
export function renderVideoGateGuidance(): string {
  const priceRows = VIDEO_RESOLUTIONS.map((r) => {
    const rate = VIDEO_CREDITS_PER_SECOND[r];
    const multiple = (rate / VIDEO_CREDITS_PER_SECOND[DEFAULT_VIDEO_RESOLUTION]).toFixed(2);
    return `| ${r}${r === DEFAULT_VIDEO_RESOLUTION ? ' **(default)**' : ''} | ${rate} credits/sec | ${multiple}× |`;
  }).join('\n');

  const gateRows = GATES.map(
    (g, i) => `${i + 1}. **${g.id}** — ${g.artefact}${g.mediaCredits ? ` _(${g.mediaCredits} media credits)_` : ' _(free)_'}`,
  ).join('\n');

  return `# Before you generate any video

Every one of these rules exists because a film was built without it and had to be thrown away.

## 1. Ask the resolution, and quote the price

Never generate video without asking. Ask in these words, with these numbers:

| Resolution | Price | vs default |
|---|---|---|
${priceRows}

${DEFAULT_VIDEO_RESOLUTION} is the DEFAULT. Say so. A first cut usually gets revised, and 1080p costs
${
  (
    VIDEO_CREDITS_PER_SECOND['1080p'] / VIDEO_CREDITS_PER_SECOND[DEFAULT_VIDEO_RESOLUTION]
  ).toFixed(2)
}× more for the same seconds. If they expect to keep most of the shots, going straight to 1080p is
cheaper; if they expect revisions, draft at 480p and re-generate only what survives. Both answers are
right — the point is that they choose it, not you.

## 2. The order of gates — nothing expensive before an approval

${gateRows}

Gate 3 (the storyboard) is the one that stops this going wrong. Render the film with greyscale cards
at the REAL timings before a single clip exists — it costs no media credits and it is the moment the
operator can tell you the pacing is wrong. Every rejected film in this repo's history got its first
look at the finished render.

## 3. If there is a reference, measure it — do not describe it

"Same style as this video" is a measurement problem. Run the reference analysis first: cuts per
minute, shot lengths, palette, where type sits, and the narrator's words per second. It costs no
media credits. Show the numbers.

Then say what you will NOT copy, and if the reference and the brief contradict each other, ASK
rather than choosing: a reference with no presenter cannot also be a film where a mascot speaks to
camera; a reference with zero cuts cannot also be a fast multi-shot edit.

## 4. Check every generated line before you use it

A video model will drop the opening words of a line and still return a clean clip. Pass the
transcript through \`verifySpokenLine\` against the script:

- the FIRST word and the LAST word must both be present — a dropped opening is the common failure,
  and a bag-of-words coverage check passes it;
- coverage must clear 0.8;
- on failure, retry ONCE with a longer duration and "begin speaking in the first frame", then ask a
  human. Never loop.

## 5. Stop a batch when the vendor is down

If the last three items failed for the same reason, that is an outage, not a bad request. Call
\`shouldAbortBatch\`, stop, run ONE known-good control payload, and only then consider a fallback
route. Do not walk seven items through retry-then-fallback and call it resilience.

## 6. The operator's own footage wins

Their own clips and their product's clips cost nothing and are TRUE. Inventory every attachment
(what it shows, how long it is usable, any watermark) and let it cover beats before you generate a
stand-in. A generated stand-in for a real product is both expensive and a lie.

## 7. Count the footage nobody sees

A spoken line generated as a \`dialogue\` plate still costs a video generation even when its picture
is thrown away and only the audio is used. Say that out loud in the credit estimate, per line. It is
the difference between a plan that looks affordable and one that is.`;
}

