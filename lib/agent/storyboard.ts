/**
 * The storyboard gate: the cheap artefact that decides whether the film is worth making.
 *
 * WHY THIS IS THE MOST IMPORTANT GATE
 * Both films built in this repo were rejected. In both cases the operator saw the first frame of
 * the result only after every clip had been generated and the whole thing rendered — 1,784 credits
 * spent before anyone could say "the pacing is wrong".
 *
 * A storyboard costs NO media credits. It is the beat list at the real timings, with the real words,
 * marked with which beat is generated and which is covered by the owner's own footage. Watching a
 * greyscale animatic of it for thirty seconds tells you more about whether the film works than any
 * amount of prompt refinement, because pacing and structure are what people are actually judging
 * when they say a film is wrong.
 *
 * PURE: no I/O, no clock, no random. The fingerprint is a stable hash of the plan, so the same plan
 * always produces the same approval request and a silently-edited plan cannot reuse an approval.
 */

import type { BeatRole } from './video-plan';

export interface StoryboardBeatInput {
  id: string;
  seconds: number;
  role: BeatRole;
  /** The on-screen words or the spoken line — whatever the operator needs to judge the beat. */
  label?: string;
  line?: string;
  source?: 'attachment' | 'generate' | 'existing';
  attachmentId?: string;
  /** Which scene the beat belongs to, for grouping in the sheet. */
  scene?: string;
}

export interface StoryboardCard {
  index: number;
  beatId: string;
  scene?: string;
  /** Absolute start of the beat in the finished film. */
  startSeconds: number;
  endSeconds: number;
  seconds: number;
  role: BeatRole;
  source: 'attachment' | 'generate' | 'existing';
  /** What the operator reads on the card. Never empty. */
  text: string;
  attachmentId?: string;
}

export interface Storyboard {
  cards: readonly StoryboardCard[];
  totalSeconds: number;
  /** Beats that will be generated. */
  generatedBeats: number;
  /** Beats covered by the owner's own footage — free and accurate. */
  attachmentBeats: number;
  /** Spoken beats whose picture will not be shown (only their voice is used). */
  audioOnlyBeats: number;
  /** Seconds of generated footage, i.e. what costs credits. */
  generatedSeconds: number;
  /** Seconds of the owner's own footage. */
  attachmentSeconds: number;
  notes: readonly string[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Lay the beats out on a timeline and mark what each one costs.
 *
 * Deliberately tolerant of incomplete input: a beat with no label gets its id, a beat with zero
 * seconds still occupies the sheet. A storyboard that refuses to render because a field is missing
 * is a storyboard nobody sees, which defeats the entire point of the gate.
 */
export function buildStoryboard(beats: readonly StoryboardBeatInput[]): Storyboard {
  let cursor = 0;
  const cards: StoryboardCard[] = beats.map((beat, i) => {
    const seconds = Math.max(0, Number.isFinite(beat.seconds) ? beat.seconds : 0);
    const start = round(cursor);
    const end = round(cursor + seconds);
    cursor = end;
    const text = (beat.label ?? beat.line ?? beat.id).toString().trim() || beat.id;
    return {
      index: i + 1,
      beatId: beat.id,
      scene: beat.scene,
      startSeconds: start,
      endSeconds: end,
      seconds: round(seconds),
      role: beat.role,
      source: beat.source ?? (beat.attachmentId ? 'attachment' : 'generate'),
      text,
      attachmentId: beat.attachmentId,
    };
  });

  const generated = cards.filter((c) => c.role === 'picture' && c.source === 'generate');
  const attached = cards.filter((c) => c.source === 'attachment');
  const audioOnly = cards.filter((c) => c.role === 'audio-only');

  const notes: string[] = [];
  if (attached.length) {
    notes.push(
      `${attached.length} beat(s) use the owner's own footage (${attached
        .reduce((s, c) => s + c.seconds, 0)
        .toFixed(1)}s) — no credits and no invention.`,
    );
  }
  if (audioOnly.length) {
    notes.push(
      `${audioOnly.length} beat(s) are heard but not shown. Their picture is generated and discarded — that is ` +
        'how a model-voiced line works, and it is budgeted.',
    );
  }
  if (generated.length === 0 && attached.length === 0) {
    notes.push('Nothing in this plan needs generating. If that is wrong, the beats file is incomplete.');
  }

  return {
    cards,
    totalSeconds: round(cursor),
    generatedBeats: generated.length,
    attachmentBeats: attached.length,
    audioOnlyBeats: audioOnly.length,
    generatedSeconds: round(generated.reduce((s, c) => s + c.seconds, 0)),
    attachmentSeconds: round(attached.reduce((s, c) => s + c.seconds, 0)),
    notes,
  };
}

const mmss = (seconds: number): string => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
};

/**
 * The sheet the operator reads.
 *
 * One line per beat, in order, with the timecode first so a note like "the middle drags" can be
 * answered with "beat 4, 0:12–0:18" instead of a discussion.
 */
export function storyboardSummary(storyboard: Storyboard): string {
  const rows = storyboard.cards.map((c) => {
    const where = `${mmss(c.startSeconds)}–${mmss(c.endSeconds)}`;
    const each = `${c.seconds.toFixed(1)}s`;
    const kind =
      c.source === 'attachment'
        ? 'YOUR FOOTAGE'
        : c.role === 'audio-only'
          ? 'VOICE ONLY'
          : c.source === 'existing'
            ? 'EXISTING'
            : 'GENERATE';
    return `${String(c.index).padStart(2)}. ${where.padEnd(15)} ${each.padStart(6)}  ${kind.padEnd(12)} ${c.text}`;
  });

  return [
    `STORYBOARD — ${storyboard.totalSeconds.toFixed(1)}s, ${storyboard.cards.length} beat(s)`,
    '',
    ...rows,
    '',
    storyboard.notes.length ? storyboard.notes.join('\n') : 'Every beat is generated.',
    '',
    'Nothing is generated until this sheet is approved. Changes here cost nothing; changes after ' +
      'generation cost the credits for every shot that has to be re-made.',
  ].join('\n');
}

export interface ApprovalRequest {
  /** What the operator is shown and approves. */
  artefact: string;
  /**
   * A stable payload to hash for the review gate's fingerprint, so an approval cannot be reused for
   * an edited plan. Sorted and rounded so two identical plans produce an identical string.
   */
  fingerprintPayload: string;
  /** The gates that remain blocked until this is approved. */
  blockedUntilApproved: readonly string[];
}

/**
 * The approval request for the storyboard gate.
 *
 * `fingerprintPayload` deliberately contains only what changes the film — beat ids, timings, roles,
 * sources and text — and nothing about presentation. Editing the sheet's wording must not invalidate
 * an approval; changing the film must.
 */
export function storyboardApprovalRequest(storyboard: Storyboard): ApprovalRequest {
  const payload = storyboard.cards.map((c) => ({
    id: c.beatId,
    s: c.startSeconds,
    e: c.endSeconds,
    role: c.role,
    src: c.source,
    a: c.attachmentId ?? null,
    t: c.text,
  }));
  return {
    artefact: storyboardSummary(storyboard),
    fingerprintPayload: JSON.stringify({ v: 1, beats: payload }),
    blockedUntilApproved: ['any generation', 'the hero frame', 'the batch', 'assembly', 'the final render'],
  };
}

/**
 * The plan a placeholder renderer needs to build the animatic.
 *
 * A greyscale card per beat, at the real timing, carrying the real words — that is enough to judge
 * pacing, and it needs no media at all. The renderer is the existing video skill with its plates
 * swapped for solid cards.
 */
export interface AnimaticCard {
  id: string;
  start: number;
  dur: number;
  text: string;
  /** Greyscale: nothing in the animatic may look like a finished frame. */
  tone: 'card';
  /** Marked so a viewer never mistakes it for a draft of the real visual. */
  watermark: string;
}

export function toAnimaticSpec(storyboard: Storyboard): { total: number; cards: AnimaticCard[] } {
  return {
    total: storyboard.totalSeconds,
    cards: storyboard.cards.map((c) => ({
      id: c.beatId,
      start: c.startSeconds,
      dur: Math.max(0.4, c.seconds),
      text: c.text,
      tone: 'card',
      watermark:
        c.source === 'attachment'
          ? `YOUR FOOTAGE${c.attachmentId ? ` · ${c.attachmentId}` : ''}`
          : c.role === 'audio-only'
            ? 'VOICE ONLY'
            : 'TO BE GENERATED',
    })),
  };
}
