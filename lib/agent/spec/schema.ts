/**
 * The spec: what a compiled reference becomes.
 *
 * A spec is deliberately NOT prose. It references a closed vocabulary of
 * operations the renderer implements, so a compiled reference can never ask for
 * something we cannot execute — which is the failure mode that cost two full
 * re-renders in the earlier attempts (ffmpeg `crop` cannot animate its own w/h;
 * Grok returns the source aspect regardless of what you ask for).
 *
 * `requires` is the honest part. A reference shot on a gimbal with a walking
 * presenter cannot be built from stills, and the compiler says so instead of
 * silently producing a weaker edit.
 */

export const OPERATIONS = [
  'cover',          // full-bleed crop of a still, with camera motion
  'plate',          // blurred backdrop + sharp centred plate (thin assets)
  'clip_window',    // travel a 9:16 window across a wide video frame
  'matte_behind',   // display type sandwiched BEHIND a presenter (occlusion)
  'matte_focus',    // subject sharp, background defocused ("locked focus")
  'type_display',   // big kinetic display type
  'subtitle_chunk', // N-word captions in the lower third
  'ui_insert',      // message pill / incoming-call card / badge
  'end_card',       // branded close slate
] as const;

export type Operation = (typeof OPERATIONS)[number];

export const MOTIONS = ['push', 'pull', 'panr', 'panl', 'drift_up', 'drift_down'] as const;
export type Motion = (typeof MOTIONS)[number];

export const TRANSITIONS = ['cut', 'flash', 'defocus_rack', 'fade_black'] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** What the footage must contain for the spec to be buildable as written. */
export const ASSET_REQUIREMENTS = [
  'presenter_motion', // presenter walking/moving on camera
  'presenter_static', // locked-off talking head
  'broll_video',      // real video of the subject
  'stills',           // photographs only
  'graphics_only',    // nothing real — type and generated imagery
] as const;
export type AssetRequirement = (typeof ASSET_REQUIREMENTS)[number];

export interface SpecSegment {
  start: number;
  end: number;
  operation: Operation;
  /** Free-form but vocabulary-limited parameters for the renderer. */
  params: {
    motion?: Motion;
    transition?: Transition;
    /** For clip_window: 0..1 travel range across the source. */
    travel?: [number, number];
    /** For matte_*: which asset the presenter comes from. */
    subject?: 'presenter' | 'none';
    note?: string;
  };
  /** Frame count from the measurement, so the renderer never re-derives timing. */
  frames?: number;
  /** DEPRECATED: text lives in Spec.textEvents so one shot can hold many. */
  text?: {
    lines: string[];
    role: 'hook' | 'supporting' | 'spec' | 'cta';
    behindSubject?: boolean;
    sizeHint?: 'huge' | 'medium' | 'small';
  } | null;
}

/**
 * On-screen text is an event on the timeline, not a property of a shot.
 *
 * The first compiler conflated the two and produced 15 "shots" for a 6-shot
 * reference, because it segmented wherever the words changed. Measuring the cuts
 * separately is what exposes that: in this style a single shot commonly carries
 * six or eight text events.
 */
export interface SpecTextEvent {
  start: number;
  end: number;
  lines: string[];
  role: 'hook' | 'supporting' | 'spec' | 'cta';
  /** True when the reference hides this type behind the presenter. */
  behindSubject: boolean;
  sizeHint: 'huge' | 'medium' | 'small';
}

export interface Spec {
  version: 1;
  compiledFrom: {
    referenceUrl: string;
    durationSec: number;
    aspect: string;
    fps?: number;
    frameCount?: number;
    compiledAt: string;
  };
  requires: AssetRequirement[];
  style: {
    palette: string[];
    typeFamily: string;
    typeCase: 'upper' | 'title' | 'mixed';
    typeTexture: 'flat' | 'gradient' | 'metallic' | 'grain';
    grain: 'none' | 'fine' | 'heavy';
    grade: string;
    /** Locked-off camera, shallow focus, rack focus, etc. */
    focus: string;
  };
  segments: SpecSegment[];
  textEvents: SpecTextEvent[];
  /** Filled by the compiler: the numeric diff against the measured reference. */
  verification?: {
    verdict: 'match' | 'close' | 'off';
    summary: string;
    missingCuts: number;
    extraCuts: number;
    durationDelta: number;
  };
  audio: {
    vo: { present: boolean; language?: string; wordsPerSecond?: number; delivery?: string } | null;
    music: { present: boolean; genre?: string; bpm?: number; energy?: string } | null;
    sfx: string[];
  };
  /** Filled by validateSpec against a supplied asset inventory. */
  feasibility?: Feasibility;
}

export interface Feasibility {
  ok: boolean;
  have: AssetRequirement[];
  missing: AssetRequirement[];
  /** Concrete consequences, not vague warnings. */
  degradations: string[];
}

/**
 * Validate structure and vocabulary. Returns human-readable problems; empty means
 * the spec is executable as written.
 */
export function validateSpec(spec: any): string[] {
  const problems: string[] = [];
  if (!spec || typeof spec !== 'object') return ['spec is not an object'];
  if (spec.version !== 1) problems.push(`unsupported spec version: ${spec.version}`);

  if (!Array.isArray(spec.segments) || spec.segments.length === 0) {
    problems.push('spec has no segments');
    return problems;
  }

  let prevEnd = -1;
  spec.segments.forEach((seg: any, i: number) => {
    const at = `segment ${i}`;
    if (typeof seg.start !== 'number' || typeof seg.end !== 'number') {
      problems.push(`${at}: start/end must be numbers`);
    } else {
      if (seg.end <= seg.start) problems.push(`${at}: end (${seg.end}) must be after start (${seg.start})`);
      if (seg.start < prevEnd - 0.001) problems.push(`${at}: overlaps the previous segment`);
      prevEnd = seg.end;
    }
    if (!OPERATIONS.includes(seg.operation)) {
      problems.push(`${at}: unknown operation "${seg.operation}" (allowed: ${OPERATIONS.join(', ')})`);
    }
    const p = seg.params || {};
    if (p.motion && !MOTIONS.includes(p.motion)) {
      problems.push(`${at}: unknown motion "${p.motion}" (allowed: ${MOTIONS.join(', ')})`);
    }
    if (p.transition && !TRANSITIONS.includes(p.transition)) {
      problems.push(`${at}: unknown transition "${p.transition}" (allowed: ${TRANSITIONS.join(', ')})`);
    }
    if (p.travel) {
      const [a, b] = p.travel;
      if (typeof a !== 'number' || typeof b !== 'number' || a < 0 || b > 1) {
        problems.push(`${at}: travel must be two numbers in 0..1`);
      }
    }
    if (seg.text && (!Array.isArray(seg.text.lines) || seg.text.lines.length === 0)) {
      problems.push(`${at}: text present but no lines`);
    }
  });

  const dur = Number(spec.compiledFrom?.durationSec) || 0;
  if (Array.isArray(spec.textEvents)) {
    spec.textEvents.forEach((t: any, i: number) => {
      const at = `textEvent ${i}`;
      if (!Array.isArray(t.lines) || t.lines.length === 0) problems.push(`${at}: no lines`);
      if (typeof t.start !== 'number' || typeof t.end !== 'number') {
        problems.push(`${at}: start/end must be numbers`);
      } else {
        if (t.end <= t.start) problems.push(`${at}: end must be after start`);
        if (dur && (t.start < 0 || t.end > dur + 0.01)) {
          problems.push(`${at}: ${t.start}-${t.end}s falls outside the ${dur}s reference`);
        }
      }
      if (!['hook', 'supporting', 'spec', 'cta'].includes(t.role)) problems.push(`${at}: bad role "${t.role}"`);
    });
  }

  if (Array.isArray(spec.requires)) {
    for (const r of spec.requires) {
      if (!ASSET_REQUIREMENTS.includes(r)) problems.push(`unknown asset requirement "${r}"`);
    }
  }
  return problems;
}

/**
 * Compare what the reference needs against what we actually have.
 *
 * This is the step that decides whether a build will be honest or a disappointment.
 * `presenter_motion` is the one that cannot be faked from stills.
 */
export function assessFeasibility(spec: Spec, available: AssetRequirement[]): Feasibility {
  const have = available.slice();
  const missing = (spec.requires || []).filter((r) => !have.includes(r));
  const degradations: string[] = [];

  for (const m of missing) {
    if (m === 'presenter_motion') {
      degradations.push(
        'No moving presenter: type cannot be occluded by a human silhouette, which is the ' +
          "reference's signature effect. A locked-off talking head with a matte gets a static " +
          'version of it; stills cannot.'
      );
    } else if (m === 'presenter_static') {
      degradations.push('No presenter at all: display type sits unoccluded over the footage.');
    } else if (m === 'broll_video') {
      degradations.push(
        'No real footage: motion must be synthesised (image-to-video) or faked with pans, ' +
          'which reads as a slideshow at the reference\'s cut rate.'
      );
    } else if (m === 'stills') {
      degradations.push('No photographs: every frame must be generated, with the accuracy risk that carries.');
    } else if (m === 'graphics_only') {
      degradations.push('Reference expects only type and graphics; supplied footage would compete with it.');
    }
  }

  return { ok: missing.length === 0, have, missing, degradations };
}
