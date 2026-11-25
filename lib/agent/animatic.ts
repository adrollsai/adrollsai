/**
 * The animatic: the storyboard as something you can actually watch, for zero media credits.
 *
 * WHY
 * A beat sheet is hard to judge in the abstract — "beat 4 is 8 seconds" tells you nothing about
 * whether the film drags. Watching greyscale cards at the real timings with the real words tells you
 * almost everything that matters, and it costs nothing: it is a HyperFrames composition made of
 * solid rectangles and type.
 *
 * That is the whole point of gate 2. Both rejected films were judged only after every clip had been
 * generated, and in both cases the problem (pacing, structure, the wrong genre) was visible in the
 * card plan long before a single credit was spent.
 *
 * DETERMINISTIC BY CONSTRUCTION
 * No clock, no random, no network: the same spec always produces byte-identical HTML, which is what
 * makes the render reproducible and the gate able to assert on it.
 */

import type { AnimaticCard } from './storyboard';

export interface AnimaticSpec {
  total: number;
  cards: readonly AnimaticCard[];
}

export interface AnimaticOptions {
  width?: number;
  height?: number;
  /** Shown top-left, so a rendered animatic is never mistaken for a draft of the film. */
  title?: string;
}

const GREY = ['#1a1a1c', '#202024', '#171719', '#232326'];

/** Escape anything that came from the owner's brief. */
export function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const mmss = (seconds: number): string => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

/**
 * Render the animatic as a complete HyperFrames composition.
 *
 * The contract matters: a root with `data-composition-id` / `data-duration`, every card a `.clip`
 * carrying `data-start` and `data-duration`, and one GSAP timeline registered PAUSED on
 * `window.__timelines`. Without the paused registration the renderer produces identical frames and
 * reports no error, which is the failure this repo has already been bitten by.
 */
export function renderAnimaticHtml(spec: AnimaticSpec, options: AnimaticOptions = {}): string {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const title = options.title ?? 'STORYBOARD ANIMATIC';
  const compositionId = 'animatic';

  const cards = spec.cards
    .map((card, i) => {
      const bg = GREY[i % GREY.length];
      const start = Number(card.start.toFixed(3));
      const dur = Number(Math.max(0.4, card.dur).toFixed(3));
      // The id must match the selector the timeline targets, so it uses cssId — not escapeHtml.
      // Escaping here produced an id the tween could never reach, which is a silent no-op: the
      // cards would still render, just never fade, and nothing would report an error.
      return [
        `      <div id="card-${cssId(card.id)}" class="clip card" data-start="${start}" data-duration="${dur}"`,
        `           data-track-index="0" style="background:${bg}">`,
        `        <div class="card-body">`,
        `          <div class="card-meta">${String(i + 1).padStart(2, '0')} · ${mmss(card.start)}–${mmss(card.start + card.dur)} · ${dur.toFixed(1)}s</div>`,
        `          <div class="card-text">${escapeHtml(card.text)}</div>`,
        `          <div class="card-mark">${escapeHtml(card.watermark)}</div>`,
        `        </div>`,
        `      </div>`,
      ].join('\n');
    })
    .join('\n');

  // A single tween per card so the timeline is legal and seekable; deliberately minimal, because
  // anything more would start implying the finished film's motion.
  const tweens = spec.cards
    .map((card) => {
      const start = Number(card.start.toFixed(3));
      return `      tl.fromTo('#card-${cssId(card.id)}', { opacity: 0.55 }, { opacity: 1, duration: 0.18, ease: 'power1.out', immediateRender: false }, ${start});`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      /* Greyscale on purpose: this is a planning artefact, not a design. Nothing here should look
         finished enough to be approved as a look. */
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #101012; }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #101012;
        font-family: Inter, sans-serif;
        color: #e8e8ea;
      }
      #root > .card {
        position: absolute;
        left: 0;
        top: 0;
        width: ${width}px;
        height: ${height}px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .card-body { width: 72%; text-align: center; }
      .card-meta {
        font-family: 'IBM Plex Mono', monospace;
        font-size: ${Math.round(height * 0.022)}px;
        letter-spacing: 0.18em;
        color: #7a7a80;
      }
      .card-text {
        margin-top: ${Math.round(height * 0.035)}px;
        font-size: ${Math.round(height * 0.062)}px;
        font-weight: 300;
        line-height: 1.18;
        letter-spacing: -0.01em;
        color: #f2f2f4;
      }
      .card-mark {
        margin-top: ${Math.round(height * 0.04)}px;
        font-family: 'IBM Plex Mono', monospace;
        font-size: ${Math.round(height * 0.02)}px;
        letter-spacing: 0.24em;
        color: #9a9aa2;
      }
      #title {
        position: absolute;
        left: ${Math.round(width * 0.033)}px;
        top: ${Math.round(height * 0.045)}px;
        font-family: 'IBM Plex Mono', monospace;
        font-size: ${Math.round(height * 0.019)}px;
        letter-spacing: 0.3em;
        color: #5f5f66;
        z-index: 50;
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="${compositionId}" data-start="0" data-duration="${Number(
      spec.total.toFixed(3),
    )}" data-width="${width}" data-height="${height}">
${cards}
      <div id="title" class="clip" data-start="0" data-duration="${Number(spec.total.toFixed(3))}" data-track-index="10">${escapeHtml(
        title,
      )}</div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${tweens}
      window.__timelines['${compositionId}'] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

/** An id safe for a CSS selector, matching what the card markup uses. */
export function cssId(id: string): string {
  return String(id).replace(/[^A-Za-z0-9_-]/g, '_');
}
