/**
 * emit.ts — beats.json + timing.json -> the HyperFrames project, as strings.
 *
 * Why strings: the whole composition is decided by pure functions here, so the
 * timing, the safe areas and the readability rule can be proven in a test without
 * a browser, a sandbox or a network. `index.ts` writes these files into the
 * sandbox; nothing in this module touches a disk.
 *
 * THE TRAPS THIS FILE ENCODES (each one cost the reference film a failed render)
 *
 *  1. `s0-lead` — a 0.5 s plate-only scene, always. A scene on screen at t = 0
 *     never reveals its non-media `.clip` overlays, so the hook must be a later
 *     scene.
 *  2. `.clip { position: absolute; inset: 0 }` in every composition's own style
 *     block. Without a box, a full-frame scrim collapses to zero height and the
 *     contrast audit fails on a frame that looks fine in the editor.
 *  3. A plate used by two scenes gets a COPY per scene (`hook-a__s3.mp4`), never a
 *     shared source with a different `data-media-start` — that combination dies
 *     ~70% into a render with `ENOENT … frame_00087.jpg`.
 *  4. Every text block is `position: absolute`. The end card is where this matters:
 *     a stacked flex column reads correctly in the preview and collapses on
 *     export.
 *  5. Readable type needs `0.5 s + 0.3 s per word`. Every on-screen line is
 *     measured here and the emit REFUSES rather than shipping an unreadable card.
 *  6. One warm grade, baked with ffmpeg (`grading.sh`), never a CSS filter.
 *  7. Type stays inside the safe band (nothing above 168 px at 9:16, all words
 *     above 1330 px); overflow is a plan error, not a design choice.
 *  8. No `Date.now()`, no `Math.random()`: ids come from beats + timing, and the
 *     same input emits byte-identical files.
 *
 * PURE: no I/O, no clock, no randomness.
 */

import {
  beatsSeed,
  minHoldSeconds,
  plateFor,
  roundTo,
  sceneBeats,
  type AspectRatio,
  type Beats,
  type Beat,
  type PlateSpec,
  type SceneKind,
  type SceneSpec,
} from './beats';
import { timingJsonText, type Timing } from './timing';

/** The CLI the reference film was delivered with. Pinned: a project re-renders identically. */
export const PROJECT_CLI_VERSION = '0.9.43';

/** Where the graded plates live inside the project. */
export const FOOTAGE_DIR = 'assets/footage';
export const VOICE_DIR = 'assets/voice';
export const BRAND_DIR = 'assets/brand';

/**
 * One warm grade for every plate, so real footage and generated b-roll read as one
 * film. Exactly the chain the reference used; baked with ffmpeg (trap 6), applied
 * once per plate in `grading.sh`, never as a CSS filter (which the renderer may
 * evaluate per frame and which the contrast audit cannot see).
 */
export const GRADE_FILTER =
  'eq=contrast=1.09:brightness=-0.012:saturation=1.06,' +
  'colorbalance=rs=0.045:bs=-0.06:rm=0.02:bm=-0.035:rh=0.02:bh=-0.025,' +
  'unsharp=5:5:0.45:5:5:0.0,' +
  'vignette=angle=PI/4.9,' +
  'noise=alls=4:allf=t,' +
  'format=yuv420p';

/** Frame geometry and type scale for one aspect. */
export interface Layout {
  width: number;
  height: number;
  /** Side margin for type. */
  margin: number;
  /** Nothing may be drawn above this line. */
  safeTop: number;
  /** Every word stays above this line (below it: texture, address strip, plaques). */
  safeBottom: number;
  hookSize: number;
  beatSize: number;
  rowSize: number;
  plaqueSize: number;
  labelSize: number;
  lineHeight: number;
  /** Seconds between two lines inside one beat. */
  lineStagger: number;
}

/**
 * 9:16 is the tight one: 1080 wide, 1080−2×66 = 948 px of usable width, and the
 * 168–1330 px band keeps type clear of the platform UI and the right-hand action
 * rail. 16:9 gets a wider band and slightly smaller type because it is watched
 * further away.
 */
export function layoutFor(aspect: AspectRatio): Layout {
  if (aspect === '16:9') {
    return {
      width: 1920,
      height: 1080,
      margin: 96,
      safeTop: 96,
      safeBottom: 980,
      hookSize: 108,
      beatSize: 92,
      rowSize: 62,
      plaqueSize: 88,
      labelSize: 26,
      lineHeight: 1.12,
      lineStagger: 0.22,
    };
  }
  return {
    width: 1080,
    height: 1920,
    margin: 66,
    safeTop: 168,
    safeBottom: 1330,
    hookSize: 128,
    beatSize: 110,
    rowSize: 76,
    plaqueSize: 82,
    labelSize: 30,
    lineHeight: 1.1,
    lineStagger: 0.24,
  };
}

export interface EmittedFile {
  /** Project-relative POSIX path, e.g. `compositions/s1-hook.html`. */
  path: string;
  content: string;
}

export interface PlateUsage {
  scene: string;
  beat: string | null;
  plate: string;
  /** Project-relative file this scene actually plays. */
  file: string;
  mediaStart: number;
  /** True when this usage plays a per-scene copy rather than the plate itself. */
  copied: boolean;
}

export interface TypeReadCheck {
  scene: string;
  beat: string;
  kind: 'line' | 'label' | 'number' | 'address' | 'tagline';
  text: string;
  words: number;
  /** Scene-relative reveal. */
  reveal: number;
  /** How long the text is on screen. */
  hold: number;
  minHold: number;
  ok: boolean;
}

export interface SceneEmit {
  id: string;
  kind: SceneKind;
  file: string;
  start: number;
  duration: number;
  lines: string[];
}

export interface EmittedProject {
  jobId: string;
  seed: string;
  /** Project dir inside the sandbox / R2 working set, e.g. `video/acme-9x16-1a2b3c4d`. */
  dir: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  files: EmittedFile[];
  /** `timing.json` exactly as written, for callers that want to store it. */
  timingJson: string;
  /** Plates that had to be copied because more than one scene plays them. */
  copies: { from: string; to: string }[];
  plates: PlateUsage[];
  typeRead: TypeReadCheck[];
  scenes: SceneEmit[];
}

export class EmitError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`emit: ${problems.join('; ')}`);
    this.name = 'EmitError';
    this.problems = problems;
    Object.setPrototypeOf(this, EmitError.prototype);
  }
}

/** Escape text that goes into HTML. Deliberately tiny: these are our own strings. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const num = (value: number): string => String(roundTo(value, 3));

function slugFor(scene: SceneSpec): string {
  return `${scene.id}-${scene.kind}`;
}

function wordsOf(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Which file each scene plays for a plate, and where it starts.
 *
 * A plate used once plays itself. A plate used by more than one scene is copied
 * per scene (trap 3): `hook-a__s3.mp4` sits beside `hook-a__s1.mp4`, so no two
 * `<video>` elements ever share a source file with different `data-media-start`.
 */
function platePlan(
  beats: Beats,
): { usages: PlateUsage[]; copies: { from: string; to: string }[] } {
  const uses = new Map<string, number>();
  const order: { scene: SceneSpec; beat: Beat | null; plate: PlateSpec }[] = [];

  for (const scene of beats.scenes) {
    const sceneBeatList = sceneBeats(beats, scene);
    if (sceneBeatList.length === 0) {
      const plate = plateFor(beats, scene, null);
      if (plate) order.push({ scene, beat: null, plate });
      continue;
    }
    // One plate per scene: several <video> elements in one scene are the same
    // shared-source hazard, one layer down.
    const first = sceneBeatList[0];
    const plate = plateFor(beats, scene, first);
    if (plate) order.push({ scene, beat: first, plate });
    for (const beat of sceneBeatList.slice(1)) {
      const other = plateFor(beats, scene, beat);
      if (other && other.id !== plate?.id) {
        throw new EmitError([
          `scene ${scene.id} would need two plates ("${plate?.id}" and "${other.id}"); ` +
            'split it into two scenes — one scene plays one plate',
        ]);
      }
    }
  }

  const usages: PlateUsage[] = [];
  const copies: { from: string; to: string }[] = [];
  for (const use of order) {
    const index = uses.get(use.plate.id) ?? 0;
    uses.set(use.plate.id, index + 1);
    const shared = order.filter((o) => o.plate.id === use.plate.id).length > 1;
    const file = shared ? `${use.plate.id}__${use.scene.id}.mp4` : `${use.plate.id}.mp4`;
    const base = use.plate.mediaStart ?? 0;
    const mediaStart = roundTo(base + 0.8 * index, 3);
    usages.push({
      scene: use.scene.id,
      beat: use.beat?.id ?? null,
      plate: use.plate.id,
      file: `${FOOTAGE_DIR}/${file}`,
      mediaStart,
      copied: shared,
    });
    if (shared) copies.push({ from: `${FOOTAGE_DIR}/${use.plate.id}.mp4`, to: `${FOOTAGE_DIR}/${file}` });
  }
  return { usages, copies };
}

/** One absolutely-positioned text block, with the tween that bring it in. */
interface Element {
  /** CSS id. */
  id: string;
  className: string;
  text: string;
  top: number;
  size: number;
  /** Scene-relative reveal. */
  reveal: number;
  /** Scene-relative moment it starts leaving. */
  leave: number;
  /** Wrapper (`.clip`) it belongs to; elements in one wrapper share a track. */
  wrapper: string;
  /** Wrapper reveal = the earliest element's reveal. */
  track: number;
  kind: TypeReadCheck['kind'];
  /** Extra CSS declarations for this element (no selector: `top` is added). */
  css?: string;
  /** An <img> source, for the logo plate. */
  src?: string;
}

interface Wrapper {
  id: string;
  reveal: number;
  duration: number;
  track: number;
}

/** Where a kind's type starts, and how the beats stack. */
function typeOrigin(layout: Layout, kind: SceneKind): number {
  const band = layout.safeBottom - layout.safeTop;
  switch (kind) {
    case 'hook':
      // Below the brand bug: the bug is a small plate at the top-left, and type that
      // starts level with it disappears behind it (seen in a real frame, not guessed).
      return layout.safeTop + Math.round(band * 0.16);
    case 'numbers':
      return layout.safeTop + Math.round(band * 0.34);
    case 'endcard':
      return layout.safeTop + Math.round(band * 0.05);
    default:
      return layout.safeTop + Math.round(band * 0.16);
  }
}

/**
 * Turn one scene into wrappers + positioned elements, plus the readability checks
 * that go with them.
 */
function sceneElements(
  beats: Beats,
  scene: SceneSpec,
  timing: Timing,
  layout: Layout,
  plateUsages: PlateUsage[],
): { wrappers: Wrapper[]; elements: Element[]; checks: TypeReadCheck[]; plates: PlateUsage[] } {
  const sceneTiming = timing.scenes[scene.id];
  if (!sceneTiming) throw new EmitError([`timing has no entry for scene ${scene.id}`]);

  const beatList = sceneBeats(beats, scene);
  const reveals = sceneTiming.beats;
  const { dur, out } = sceneTiming;
  // Accumulating kinds keep their earlier beats on screen; replacing kinds hand
  // the frame over at the next reveal.
  const accumulates =
    scene.kind === 'list' || scene.kind === 'info' || scene.kind === 'numbers' || scene.kind === 'endcard';

  const wrappers: Wrapper[] = [];
  const elements: Element[] = [];
  const checks: TypeReadCheck[] = [];
  const plates: PlateUsage[] = [];

  const origin = typeOrigin(layout, scene.kind);
  let track = 10;

  const pushCheck = (
    element: Element,
    beatId: string,
    from: number,
    to: number,
  ): void => {
    const hold = roundTo(to - from, 3);
    const minHold = minHoldSeconds(wordsOf(element.text));
    checks.push({
      scene: scene.id,
      beat: beatId,
      kind: element.kind,
      text: element.text,
      words: wordsOf(element.text),
      reveal: roundTo(from, 3),
      hold,
      minHold,
      ok: hold + 1e-9 >= minHold,
    });
  };

  if (scene.kind === 'endcard') {
    // The card is one wrapper held to the last frame: nothing may still be moving
    // at the end, and every line has the whole card to be read.
    const reveal = Math.max(0.12, reveals[0] ?? 0.12);
    const wrapper: Wrapper = { id: 't-card', reveal, duration: roundTo(dur - reveal, 3), track: track++ };
    wrappers.push(wrapper);

    const card = beats.endCard;
    const band = layout.safeBottom - layout.safeTop;

    interface CardItem {
      kind: TypeReadCheck['kind'];
      text: string;
      size: number;
      css: string;
      /** Seconds after the card's own reveal. */
      after: number;
      /** Space below this item, as a fraction of the safe band. */
      gap: number;
      src?: string;
    }

    const items: CardItem[] = [];
    if (card.logo) {
      items.push({ kind: 'label', text: '', src: card.logo, size: roundTo(band * 0.26, 0), css: '', after: 0, gap: 0.05 });
    } else {
      items.push({
        kind: 'tagline',
        text: card.name,
        size: Math.round(layout.plaqueSize * 0.9),
        css: 'letter-spacing: 0.02em;',
        after: 0,
        gap: 0.035,
      });
    }
    items.push({
      kind: 'tagline',
      text: card.tagline,
      size: Math.round(layout.plaqueSize * 0.58),
      css: 'opacity: 0.92;',
      after: 0.5,
      gap: 0.045,
    });
    for (const [i, number] of card.numbers.entries()) {
      items.push({
        kind: 'number',
        text: number,
        size: Math.round(layout.plaqueSize * 0.94),
        css: 'letter-spacing: 0.02em;',
        after: roundTo(0.95 + i * 0.16, 3),
        gap: 0.02,
      });
    }
    for (const [i, line] of card.address.entries()) {
      items.push({
        kind: 'address',
        text: line,
        size: Math.round(layout.labelSize * 1.05),
        css: 'opacity: 0.94;',
        after: roundTo(1.45 + i * 0.1, 3),
        gap: i === card.address.length - 1 ? 0.06 : 0.01,
      });
    }
    if (card.pledge) {
      items.push({
        kind: 'tagline',
        text: card.pledge,
        size: Math.round(layout.plaqueSize * 0.6),
        css: 'color: var(--accent);',
        after: 2.15,
        gap: 0,
      });
    }

    // The card must FIT its safe band in either aspect, so the stack is tried on a
    // fixed ladder of scales and the largest one that fits is used. Deterministic,
    // and a long address degrades the type instead of running off the frame.
    const LADDER = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4];
    let placed: { item: CardItem; top: number; height: number }[] | null = null;
    for (const scale of LADDER) {
      const attempt: { item: CardItem; top: number; height: number }[] = [];
      let cursorTop = origin;
      for (const item of items) {
        const height = Math.round(
          (item.src ? item.size : item.size * layout.lineHeight) * scale,
        );
        attempt.push({ item, top: roundTo(cursorTop, 1), height });
        cursorTop += height + Math.round(band * item.gap * scale);
      }
      placed = attempt;
      if (cursorTop <= layout.safeBottom) break;
    }
    if (!placed) throw new EmitError([`end card has nothing to draw`]);

    placed.forEach((entry, index) => {
      const item = entry.item;
      const element: Element = {
        id: item.src ? 'a-logo' : `a-${item.kind}-${index}`,
        className:
          item.src
            ? 'txt logo'
            : item.kind === 'address' || item.kind === 'tagline'
              ? 'txt body'
              : item.kind === 'number'
                ? 'txt plaque'
                : 'txt mark',
        text: item.text,
        ...(item.src ? { src: item.src } : {}),
        top: entry.top,
        size: entry.height,
        reveal: roundTo(reveal + item.after, 3),
        leave: dur,
        wrapper: wrapper.id,
        track: wrapper.track,
        kind: item.kind,
        css: item.src ? `height: ${entry.height}px;` : item.css,
      };
      elements.push(element);
      if (!item.src) pushCheck(element, beatList[0]?.id ?? scene.id, element.reveal, dur);
    });

    const bottom = roundTo(
      placed.reduce((max, entry) => Math.max(max, entry.top + entry.height), layout.safeTop),
      1,
    );
    if (bottom > layout.safeBottom) {
      throw new EmitError([
        `end card type runs to ${bottom}px, past the ${layout.safeBottom}px safe floor at ${beats.aspect}, ` +
          'even at the smallest scale on the ladder. Shorten the address, the tagline or the pledge.',
      ]);
    }
    const above = elements.filter((element) => element.top < layout.safeTop);
    if (above.length) {
      throw new EmitError(
        above.map((element) => `end card block "${element.id}" starts at ${element.top}px, above the ${layout.safeTop}px safe top`),
      );
    }
    return { wrappers, elements, checks, plates };
  }

  if (beatList.length === 0) {
    // A silent scene: plate only, plus its label if the plan gave it one.
    return { wrappers, elements, checks, plates };
  }

  /**
   * Where the NEXT accumulating beat starts.
   *
   * A list, an info card or a plaque column keeps every earlier beat on screen, so
   * each new one must start below the bottom of the previous one — including its
   * label. Stepping by a fixed row height instead makes a labelled row overlap the
   * row after it, which `check` reports as `content_overlap` and which reads as two
   * lines of type on top of each other.
   */
  let stackTop = origin;

  for (const [index, beat] of beatList.entries()) {
    const reveal = Math.max(0.12, reveals[index] ?? 0.12);
    const next = index + 1 < beatList.length ? Math.max(0.12, reveals[index + 1] ?? dur) : out;
    const visibleTo = accumulates ? dur : roundTo(next, 3);
    if (visibleTo <= reveal) {
      throw new EmitError([
        `scene ${scene.id} beat ${beat.id}: reveal ${reveal}s leaves no window before ${visibleTo}s`,
      ]);
    }

    const wrapper: Wrapper = {
      id: `t-b${index}`,
      reveal: roundTo(reveal, 3),
      duration: roundTo(visibleTo - reveal, 3),
      track: track++,
    };
    wrappers.push(wrapper);

    const size =
      scene.kind === 'hook'
        ? layout.hookSize
        : scene.kind === 'list' || scene.kind === 'info'
          ? layout.rowSize
          : scene.kind === 'numbers'
            ? layout.plaqueSize
            : layout.beatSize;

    // The replacing kinds (hook, beat, cta) all draw from the same origin and hand
    // the frame over at the next reveal; the accumulating kinds (list, info,
    // numbers) continue below whatever the previous beat actually used.
    let top = roundTo(accumulates ? stackTop : origin, 1);

    if (beat.label) {
      const element: Element = {
        id: `a-label-${index}`,
        className: 'txt lbl',
        text: beat.label,
        top: roundTo(top, 1),
        size: layout.labelSize,
        reveal,
        leave: visibleTo,
        wrapper: wrapper.id,
        track: wrapper.track,
        kind: 'label',
      };
      elements.push(element);
      pushCheck(element, beat.id, reveal, visibleTo);
      top += Math.round(layout.labelSize * 1.6) + 18;
    }

    for (const [j, text] of beat.lines.entries()) {
      const at = roundTo(reveal + j * layout.lineStagger, 3);
      const element: Element = {
        id: `a-line-${index}-${j}`,
        className: scene.kind === 'numbers' ? 'txt plaque' : 'txt ln',
        text,
        top: roundTo(top, 1),
        size,
        reveal: at,
        leave: visibleTo,
        wrapper: wrapper.id,
        track: wrapper.track,
        kind: scene.kind === 'numbers' ? 'number' : 'line',
      };
      elements.push(element);
      pushCheck(element, beat.id, at, visibleTo);
      top += Math.round(size * layout.lineHeight) + 14;
    }

    const bottom = roundTo(top, 1);
    if (bottom > layout.safeBottom) {
      throw new EmitError([
        `scene ${scene.id} beat ${beat.id}: type runs to ${bottom}px, past the ${layout.safeBottom}px ` +
          `safe floor at ${beats.aspect}. Fewer lines, or a smaller type step.`,
      ]);
    }
    for (const element of elements) {
      if (element.top < layout.safeTop) {
        throw new EmitError([
          `scene ${scene.id}: block "${element.id}" starts at ${element.top}px, above the ` +
            `${layout.safeTop}px safe top`,
        ]);
      }
    }

    // Leave a gap of the same order as the type before the next accumulated row.
    stackTop = roundTo(bottom + Math.round(size * 0.28), 1);
  }

  // One plate per scene, recorded once — a scene plays exactly one file.
  const usage = plateUsages.find((u) => u.scene === scene.id);
  if (usage) plates.push(usage);

  return { wrappers, elements, checks, plates };
}

/** The style block every composition carries. Trap 2 lives on its first line. */
function baseStyle(layout: Layout, extra: string): string {
  return `  <style>
    /* Trap 2: a .clip on a plain div has no box of its own. Without this the
       full-frame scrims collapse and the contrast audit fails on a frame that
       looks correct in the preview. */
    .clip { position: absolute; inset: 0; }
    #root {
      position: absolute;
      inset: 0;
      background: #0b0a08;
      overflow: hidden;
      --ink: #fff7ec;
      --accent: #e9a93c;
      --ground: #16301f;
    }
    .plate { position: absolute; inset: 0; overflow: hidden; }
    .plate video {
      position: absolute;
      left: 0;
      top: 0;
      width: ${layout.width}px;
      height: ${layout.height}px;
      object-fit: cover;
      display: block;
    }
    /* Trap 4: every text block is positioned, not flowed.
       Only families the renderer can auto-resolve are named here: "Archivo Black"
       and Inter are fetched and injected deterministically by the CLI. A stack that
       falls back to Impact or Arial Black fails check (font_family_without_font_face)
       and silently renders in the wrong face. */
    .txt { position: absolute; left: ${layout.margin}px; right: ${layout.margin}px; }
    .lbl {
      font-family: Inter, sans-serif;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--accent);
      white-space: nowrap;
    }
    .ln {
      font-family: "Archivo Black", sans-serif;
      font-weight: 900;
      line-height: ${layout.lineHeight};
      letter-spacing: -0.01em;
      color: var(--ink);
      text-shadow: 0 10px 44px rgba(0, 0, 0, 0.55);
      white-space: nowrap;
    }
    .plaque {
      font-family: "Archivo Black", sans-serif;
      font-weight: 900;
      line-height: ${layout.lineHeight};
      color: var(--ink);
      white-space: nowrap;
    }
    .mark {
      font-family: "Archivo Black", sans-serif;
      font-weight: 900;
      line-height: ${layout.lineHeight};
      color: var(--ink);
      white-space: nowrap;
    }
    .body {
      font-family: Inter, sans-serif;
      font-weight: 400;
      line-height: 1.4;
      color: var(--ink);
      white-space: nowrap;
    }
    .logo {
      left: ${Math.round(layout.width * 0.22)}px;
      right: ${Math.round(layout.width * 0.22)}px;
      background: #fffdf8;
      border-radius: 8px;
      padding: 18px 20px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
      box-sizing: border-box;
    }
    .logo img { width: 100%; display: block; }
    .scrim { z-index: 3; }
    .scrim-top { background: linear-gradient(180deg, rgba(11,10,8,0.88) 0%, rgba(11,10,8,0.7) 34%, rgba(11,10,8,0.22) 66%, rgba(11,10,8,0) 84%); }
    .scrim-full { background: linear-gradient(180deg, rgba(11,10,8,0.93) 0%, rgba(11,10,8,0.86) 30%, rgba(11,10,8,0.62) 58%, rgba(11,10,8,0.42) 100%); }
    .t { z-index: 20; }
${extra}  </style>`;
}

function elementCss(element: Element): string {
  return `    #${element.id} { top: ${element.top}px; font-size: ${element.size}px;${element.css ? ` ${element.css}` : ''} }`;
}

function elementHtml(element: Element): string {
  if (element.src) {
    return `      <div class="${element.className}" id="${element.id}"><img src="${esc(element.src)}" alt="" /></div>`;
  }
  return `      <div class="${element.className}" id="${element.id}">${esc(element.text)}</div>`;
}

/**
 * GSAP tweens for one scene, in a fixed order so the file is reproducible.
 *
 * The WRAPPER owns the scene window (it fades in at the beat's reveal and out
 * before the next one); each ELEMENT owns its own opacity, so a second line can
 * land 0.24 s after the first inside an already-visible wrapper.
 */
function sceneScript(sceneId: string, wrappers: Wrapper[], elements: Element[]): string {
  const lines: string[] = [];
  lines.push('  <script>');
  lines.push('    window.__timelines = window.__timelines || {};');
  lines.push('    const tl = gsap.timeline({ paused: true });');
  for (const wrapper of wrappers) {
    lines.push(
      `    tl.fromTo("#${wrapper.id}", { opacity: 0 }, { opacity: 1, duration: 0.16, ease: "power1.out" }, ${num(wrapper.reveal)});`,
    );
    lines.push(
      `    tl.to("#${wrapper.id}", { opacity: 0, duration: 0.18, ease: "power2.in" }, ${num(
        roundTo(wrapper.reveal + wrapper.duration - 0.18, 3),
      )});`,
    );
  }
  for (const element of elements) {
    if (element.src) {
      lines.push(
        `    tl.fromTo("#${element.id}", { opacity: 0, y: 40, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.44, ease: "power4.out" }, ${num(element.reveal)});`,
      );
      continue;
    }
    const dy = element.kind === 'label' ? 18 : 44;
    lines.push(
      `    tl.fromTo("#${element.id}", { opacity: 0, y: ${dy} }, { opacity: 1, y: 0, duration: ${element.kind === 'label' ? 0.22 : 0.32}, ease: "power4.out" }, ${num(element.reveal)});`,
    );
  }
  lines.push(`    window.__timelines["${sceneId}"] = tl;`);
  lines.push('  </script>');
  return lines.join('\n');
}

/** `compositions/s0-lead.html` — the plate-only lead-in. Always exactly 0.5 s. */
function leadInComposition(beats: Beats, layout: Layout, usages: PlateUsage[], leadDur: number): string {
  const usage = usages.find((u) => u.scene === 's0');
  const src = usage?.file ?? `${FOOTAGE_DIR}/s0-lead.mp4`;
  const mediaStart = usage?.mediaStart ?? 0;
  return `<template>
${baseStyle(layout, '')}
  <div id="root" data-composition-id="s0-lead" data-width="${layout.width}" data-height="${layout.height}">
    <div class="plate">
      <video class="clip" id="v-s0" src="${esc(src)}" muted playsinline preload="auto" data-start="0" data-duration="${num(
        leadDur,
      )}" data-track-index="0" data-media-start="${num(mediaStart)}"></video>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["s0-lead"] = gsap.timeline({ paused: true });
  </script>
</template>
`;
}

/** One scene's composition file. */
function sceneComposition(
  beats: Beats,
  scene: SceneSpec,
  timing: Timing,
  layout: Layout,
  usages: PlateUsage[],
  wrapperList: Wrapper[],
  elementList: Element[],
): string {
  const sceneTiming = timing.scenes[scene.id];
  const usage = usages.find((u) => u.scene === scene.id);
  const compositionId = slugFor(scene);

  const flatGround = scene.kind === 'info';
  const plateHtml = flatGround
    ? ''
    : `    <div class="plate">
      <video class="clip" id="v-plate" src="${esc(usage?.file ?? `${FOOTAGE_DIR}/plate.mp4`)}" muted playsinline preload="auto" data-start="0" data-duration="${num(
        sceneTiming.dur,
      )}" data-track-index="0" data-media-start="${num(usage?.mediaStart ?? 0)}"></video>
    </div>
`;
  const scrimClass = scene.kind === 'hook' || scene.kind === 'cta' ? 'scrim scrim-top' : 'scrim scrim-full';
  const scrimHtml = flatGround
    ? ''
    : `    <div id="scrim" class="${scrimClass} clip" data-start="0" data-duration="${num(
        sceneTiming.dur,
      )}" data-track-index="1"></div>
`;

  const wrapperHtml = wrapperList
    .map((wrapper) => {
      const children = elementList.filter((e) => e.wrapper === wrapper.id).map(elementHtml).join('\n');
      return `    <div id="${wrapper.id}" class="t clip" data-start="${num(wrapper.reveal)}" data-duration="${num(
        wrapper.duration,
      )}" data-track-index="${wrapper.track}">
${children}
    </div>`;
    })
    .join('\n');

  const css = elementList.map(elementCss).join('\n');

  // A flat card's ground is an INLINE style on the root, not a class. A
  // sub-composition's rules are scoped to `[data-composition-id=…] <selector>`, so a
  // selector whose leftmost part is a class on the root itself never matches
  // (`check` calls this `subcomposition_root_styled_by_class`).
  const rootStyle = flatGround
    ? ' style="background: linear-gradient(168deg, #16301f 0%, #10241a 58%, #0b1710 100%);"'
    : '';

  return `<template>
${baseStyle(layout, css ? `${css}\n` : '')}
  <div id="root" data-composition-id="${compositionId}" data-width="${layout.width}" data-height="${layout.height}"${rootStyle}>
${plateHtml}${scrimHtml}${wrapperHtml}
  </div>

${sceneScript(compositionId, wrapperList, elementList)}
</template>
`;
}

/** The root composition: scene slots, brand bug, voice tracks. */
function rootComposition(beats: Beats, timing: Timing, layout: Layout): string {
  const sceneIds = ['s0-lead', ...beats.scenes.map(slugFor)];

  const slots = sceneIds
    .map((slug) => {
      const sceneId = slug.startsWith('s0') ? 's0' : slug.split('-')[0];
      const entry = timing.sceneList[sceneId];
      return `      <div
        id="${slug}"
        data-composition-id="${slug}"
        data-composition-src="compositions/${slug}.html"
        data-start="${num(entry.start)}"
        data-duration="${num(entry.dur)}"
        data-track-index="0"
        data-track-kind="graphics"
        data-width="${layout.width}"
        data-height="${layout.height}"
      ></div>`;
    })
    .join('\n\n');

  // The brand bug needs a logo FILE. Emitting the element without one is a broken
  // <img> (check: missing_local_asset / http_error 404) and the renderer silently
  // drops it, so the flag alone is not enough — `endCard.logo` has to be set.
  const brandBug =
    beats.logoOnScreen && beats.endCard.logo
      ? `
      <!-- the brand bug rides above every scene except the end card -->
      <div id="brand-bug" class="clip" data-start="${num(timing.vobug.start)}" data-duration="${num(
        roundTo(timing.vobug.end - timing.vobug.start, 3),
      )}" data-track-index="0" data-layout-ignore>
        <img src="${esc(beats.endCard.logo)}" alt="${esc(beats.endCard.name)}" />
      </div>`
      : '';

  const voice = timing.vo
    .map(
      (line) =>
        `      <audio id="vo-${line.id}" class="clip" src="${esc(`${VOICE_DIR}/${line.id}.wav`)}" data-start="${num(
          line.start,
        )}" data-duration="${num(line.dur)}" data-track-index="0" data-volume="1"></audio>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="${esc(beats.onScreenLanguage)}" data-composition-variables='${JSON.stringify([
    { id: 'taglineEn', type: 'string', label: 'English tagline', default: beats.endCard.tagline },
    { id: 'phoneA', type: 'string', label: 'Number 1', default: beats.endCard.numbers[0] },
    { id: 'phoneB', type: 'string', label: 'Number 2', default: beats.endCard.numbers[1] },
  ])}'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${layout.width}, height=${layout.height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      /* Trap 2 at the root as well: the root's own .clip children need a box. */
      .clip { position: absolute; inset: 0; }
      html, body { width: ${layout.width}px; height: ${layout.height}px; overflow: hidden; background: #0b0a08; }
      #root { position: relative; width: 100%; height: 100%; background: #0b0a08; }
      /* The brand bug is a SMALL plate. class="clip" brings inset: 0 with it, and
         with only a width set that stretches the element from top to the bottom of
         the frame — a real frame showed a 1700 px cream bar over a third of the film.
         So the inset is pinned back here and both dimensions are explicit. */
      #brand-bug { position: absolute; left: ${Math.round(layout.margin * 0.94)}px; top: ${
        layout.safeTop + 26
      }px; right: auto; bottom: auto; width: ${Math.round(layout.width * 0.198)}px; height: ${Math.round(
        layout.width * 0.092,
      )}px; padding: 13px 15px; box-sizing: border-box;
        background: #fffdf8; border-radius: 6px; z-index: 60; box-shadow: 0 10px 30px rgba(0,0,0,0.45); }
      #brand-bug img { width: 100%; height: 100%; object-fit: contain; display: block; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${num(timing.total)}"
      data-fps="${beats.fps}"
      data-width="${layout.width}"
      data-height="${layout.height}"
    >
${slots}
${brandBug}

      <!-- A music bed is OPTIONAL and is not generated by this skill: drop a track
           at assets/music/bed.mp3 and uncomment this to score the film.
      <audio id="score" class="clip" src="assets/music/bed.mp3" data-start="0" data-duration="${num(
        timing.total,
      )}" data-media-start="0" data-track-index="0" data-track-kind="audio" data-volume="0.72" data-fade-in="0.6" data-fade-out="2.4"></audio>
      -->

${voice}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

/**
 * `grading.sh`: fetch/grade every plate, then make the per-scene copies.
 *
 * Two things are load-bearing. The grade is baked here with ffmpeg (`eq`,
 * `colorbalance`, `unsharp`, `vignette`, `noise`) so nothing is a CSS filter; and
 * every copy in `copies` is a real second file, because one source mp4 backing two
 * scenes with different `data-media-start` kills the render ~70% in (trap 3).
 */
function gradingScript(beats: Beats, layout: Layout, copies: { from: string; to: string }[]): string {
  const lines: string[] = [];
  lines.push('#!/bin/sh');
  lines.push('# Generated by lib/agent/tools/skills/video/emit.ts — do not hand-edit.');
  lines.push('# One warm grade across every plate, baked with ffmpeg, never with a CSS filter.');
  lines.push('set -eu');
  lines.push('FFMPEG="${FFMPEG:-ffmpeg}"');
  lines.push('TMPDIR="${TMPDIR:-/tmp}"');
  lines.push(`mkdir -p "${FOOTAGE_DIR}" "${VOICE_DIR}" "${BRAND_DIR}" "$TMPDIR"`);
  lines.push('');
  lines.push(`GRADE="${GRADE_FILTER}"`);
  lines.push('');

  const sorted = [...beats.plates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const plate of sorted) {
    const out = `${FOOTAGE_DIR}/${plate.id}.mp4`;
    if (plate.source === 'asset') {
      const src = plate.key ?? `assets/src/${plate.id}.mp4`;
      lines.push(`# ${plate.id}: supplied asset, graded into the film's one look`);
      lines.push(
        `$FFMPEG -y -v error -i "${src}" -vf "scale=${layout.width}:${layout.height}:force_original_aspect_ratio=increase,crop=${layout.width}:${layout.height},$GRADE" -an -c:v libx264 -preset medium -crf 19 -r ${beats.fps} "${out}"`,
      );
    } else {
      lines.push(
        `# ${plate.id}: generated ${plate.seconds ?? 6}s clip (one slow move, no text), graded into the film's one look`,
      );
      lines.push(
        `$FFMPEG -y -v error -i "${FOOTAGE_DIR}/${plate.id}.raw.mp4" -vf "scale=${layout.width}:${layout.height}:force_original_aspect_ratio=increase,crop=${layout.width}:${layout.height},$GRADE" -an -c:v libx264 -preset medium -crf 19 -r ${beats.fps} "${out}"`,
      );
    }
    lines.push('');
  }

  if (copies.length) {
    lines.push('# Trap 3: a plate played by two scenes is COPIED, one file per scene.');
    lines.push('# Sharing one source with two different data-media-start values dies mid-render.');
    for (const copy of copies) {
      lines.push(`cp -f "${copy.from}" "${copy.to}"`);
    }
    lines.push('');
  }

  lines.push('# Every plate the film plays, with its size, so a missing copy is obvious in the log.');
  lines.push(`ls -l ${FOOTAGE_DIR}`);
  return `${lines.join('\n')}\n`;
}

/** Project scaffolding: pinned CLI, registry config, metadata. */
function scaffold(beats: Beats, timing: Timing): EmittedFile[] {
  return [
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name: beats.jobId,
          private: true,
          type: 'module',
          scripts: {
            check: `npx --yes hyperframes@${PROJECT_CLI_VERSION} check`,
            render: `npx --yes hyperframes@${PROJECT_CLI_VERSION} render`,
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'hyperframes.json',
      content: `${JSON.stringify(
        {
          $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
          registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
          paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
          media: { autoProxy: true },
          authoringSkill: 'hyperframes',
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'meta.json',
      content: `${JSON.stringify({ id: beats.jobId, name: beats.jobId, aspect: beats.aspect, fps: beats.fps, durationSeconds: timing.total }, null, 2)}\n`,
    },
  ];
}

/** The seeded artefact slug: `acme-9x16-1a2b3c4d`. Same plan -> same slug, forever. */
export function projectSlug(beats: Beats): string {
  return `${beats.jobId}-${beats.aspect.replace(':', 'x')}-${beatsSeed(beats)}`;
}

/**
 * Emit the whole project.
 *
 * Deterministic by construction: files are produced in a fixed order, keyed by
 * plan and timing only. The same beats + the same measured onsets emit
 * byte-identical strings, which is what makes the artefact key meaningful.
 */
export function emitProject(beats: Beats, timing: Timing): EmittedProject {
  const layout = layoutFor(beats.aspect);
  const seed = beatsSeed(beats);
  const dir = `video/${projectSlug(beats)}`;

  const leadDur = timing.sceneList.s0?.dur ?? 0.5;
  if (roundTo(leadDur, 3) !== 0.5) {
    throw new EmitError([`s0 must be exactly 0.5s (timing says ${leadDur}s) — see trap 1`]);
  }

  const { usages, copies } = platePlan(beats);
  const leadUsages: PlateUsage[] = [];

  const files: EmittedFile[] = [];
  const typeRead: TypeReadCheck[] = [];
  const sceneEmits: SceneEmit[] = [];
  const allPlates: PlateUsage[] = [];

  // s0 plays the first scene's plate under its own copy, because it is a scene
  // like any other: two scenes, two files.
  const firstScene = beats.scenes[0];
  const firstUse = usages.find((u) => u.scene === firstScene.id);
  if (firstUse) {
    const file = `${firstUse.plate}__s0.mp4`;
    leadUsages.push({
      scene: 's0',
      beat: null,
      plate: firstUse.plate,
      file: `${FOOTAGE_DIR}/${file}`,
      mediaStart: 0,
      copied: true,
    });
    copies.push({ from: `${FOOTAGE_DIR}/${firstUse.plate}.mp4`, to: `${FOOTAGE_DIR}/${file}` });
  }

  files.push({ path: 'compositions/s0-lead.html', content: leadInComposition(beats, layout, leadUsages, leadDur) });

  for (const scene of beats.scenes) {
    const sceneTiming = timing.scenes[scene.id];
    if (!sceneTiming) throw new EmitError([`timing has no entry for scene ${scene.id}`]);

    const emitted = sceneElements(beats, scene, timing, layout, usages);
    for (const check of emitted.checks) typeRead.push(check);
    const file = `compositions/${slugFor(scene)}.html`;
    files.push({
      path: file,
      content: sceneComposition(beats, scene, timing, layout, usages, emitted.wrappers, emitted.elements),
    });
    sceneEmits.push({
      id: scene.id,
      kind: scene.kind,
      file,
      start: timing.sceneList[scene.id].start,
      duration: sceneTiming.dur,
      lines: sceneBeats(beats, scene).flatMap((b) => b.lines),
    });
    allPlates.push(...emitted.plates);
  }

  files.push({ path: 'index.html', content: rootComposition(beats, timing, layout) });
  files.push(...scaffold(beats, timing));

  const timingText = timingJsonText(timing);
  files.push({ path: 'timing.json', content: timingText });
  files.push({ path: 'beats.json', content: `${JSON.stringify(beats, null, 2)}\n` });
  files.push({ path: 'grading.sh', content: gradingScript(beats, layout, copies) });

  const unreadable = typeRead.filter((check) => !check.ok);
  if (unreadable.length) {
    throw new EmitError(
      unreadable.map(
        (check) =>
          `${check.scene}/${check.beat}: "${check.text}" is on screen ${check.hold}s but needs ` +
          `${check.minHold}s (0.5s + 0.3s × ${check.words} words). Give the beat more voice, or cut a line.`,
      ),
    );
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    jobId: beats.jobId,
    seed,
    dir,
    width: layout.width,
    height: layout.height,
    fps: beats.fps,
    durationSeconds: timing.total,
    files,
    timingJson: timingText,
    copies: copies.sort((a, b) => (a.to < b.to ? -1 : 1)),
    plates: [...leadUsages, ...allPlates].sort((a, b) => (a.scene < b.scene ? -1 : 1)),
    typeRead,
    scenes: sceneEmits,
  };
}

/** One string standing for the whole project — the determinism assertion. */
export function emittedText(project: EmittedProject): string {
  return project.files.map((file) => `### ${file.path}\n${file.content}`).join('\n');
}

/** The composition files only, for the "no Date.now / no Math.random" guard. */
export function compositionFiles(project: EmittedProject): EmittedFile[] {
  return project.files.filter(
    (file) => file.path === 'index.html' || file.path.startsWith('compositions/'),
  );
}
