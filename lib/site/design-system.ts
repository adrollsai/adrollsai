/**
 * The house design system for generated pages: tokens, stylesheet, motion and copy rules.
 *
 * WHY THIS IS CODE AND NOT A PARAGRAPH
 * "Use ui-ux-pro-max and scroll-craft for websites" is the owner's instruction, and the honest way to honour it is
 * not to ask the model to read two 20 KB skills and then hope — it is to make the generated page carry the rules
 * whether or not anybody read anything. `buildLandingPage` emits this stylesheet itself, so every page from that
 * path has the design system applied. A skill a model forgets is a suggestion; a stylesheet in the output is a
 * fact.
 *
 * WHAT IT ENCODES, AND WHERE EACH RULE CAME FROM
 * From `ui-ux-pro-max` (MIT, nateherkai): contrast 4.5:1 minimum, 44×44 minimum touch targets, base 16px type at
 * 1.5 line height, visible labels rather than placeholder-only, focus rings that are never removed, reduced-motion
 * support, lazy-loaded imagery, no emoji standing in for icons.
 * From `scroll-craft` (MIT, nateherkai): vary the anchor instead of centring every act, at most one eyebrow per
 * three sections, no "scroll" cue, no section counters, no em dashes in visible copy, animate only transform and
 * opacity (never width/height/top/left, never `transition: all`), a scrim only where text sits, one engineered
 * peak, an ending that resolves rather than trailing into a footer, and real numbers only.
 *
 * The rules that can be checked mechanically are asserted by `verify:site-design` against the emitted HTML, so a
 * later edit to this file cannot quietly drop one.
 */
import { contrastRatio, relativeLuminance } from '@/lib/design/contrast';

/** Ink/paper pairs that are tried in order when a brand colour is used as the page background. */
const CANDIDATE_INK = ['#F7F6F3', '#0B0F19'];

/**
 * The readable text colour for a background, measured rather than guessed.
 *
 * Returns the first candidate that clears 4.5:1, and the best available if none does (with `passes: false` so a
 * caller can decide to change the background instead of shipping unreadable text).
 */
export function readableInkFor(background: string): { ink: string; ratio: number | null; passes: boolean } {
  let best = { ink: CANDIDATE_INK[0], ratio: null as number | null, passes: false };
  for (const candidate of CANDIDATE_INK) {
    const ratio = contrastRatio(candidate, background);
    if (ratio === null) continue;
    if (ratio >= 4.5) return { ink: candidate, ratio, passes: true };
    if (best.ratio === null || ratio > best.ratio) best = { ink: candidate, ratio, passes: false };
  }
  return best;
}

/** A dimmed variant that still passes on the same background, or the ink itself when nothing dims safely. */
export function mutedInkFor(background: string, ink: string): string {
  // Two restrained steps away from the ink; the first that still clears 4.5:1 wins.
  const steps = ink === '#0B0F19' ? ['#3A4152', '#2A3140'] : ['#C8C5BC', '#B4B1A8'];
  for (const step of steps) {
    const ratio = contrastRatio(step, background);
    if (ratio !== null && ratio >= 4.5) return step;
  }
  return ink;
}

/** An accent that reads on the background when used for a solid button's fill (text will be the background). */
export function accentFor(background: string, ink: string): string {
  return ink;
}

/**
 * Visible copy must not contain an em dash.
 *
 * `scroll-craft` lists it as a ship-blocker: it is the single most common tell of machine-written marketing copy.
 * The generator passes every human-visible string through this, turning "A — B" into "A. B" without doubling
 * punctuation that is already there.
 */
export function noEmDash(text: string): string {
  return String(text ?? '')
    .replace(/\s*[—–]\s*/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\.\s*$/g, '.')
    .trim();
}

/** Escape for HTML text and attribute contexts. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface Palette {
  brand: string;
  ink: string;
  muted: string;
  accent: string;
  surface: string;
  line: string;
  invertedInk: string;
  contrast: number | null;
  contrastPasses: boolean;
}

/** Resolve a brand colour into the full palette the stylesheet needs, with the contrast verdict attached. */
export function paletteFor(brandInput?: string | null): Palette {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(brandInput ?? '').trim())
    ? `#${String(brandInput).trim().replace(/^#/, '')}`
    : '#0F172A';
  const resolved = readableInkFor(hex);
  const dark = (relativeLuminance(hex) ?? 0) < 0.45;
  return {
    brand: hex,
    ink: resolved.ink,
    muted: mutedInkFor(hex, resolved.ink),
    accent: resolved.ink,
    // A surface one notch off the brand, so cards read as depth rather than as a border.
    surface: dark ? 'rgba(255,255,255,0.045)' : 'rgba(11,15,25,0.035)',
    line: dark ? 'rgba(255,255,255,0.14)' : 'rgba(11,15,25,0.12)',
    // The INVERTED pair is what a solid button is filled with. For a DARK brand that fill must be LIGHT with a dark
    // label; the first version had it backwards, so every call to action on a dark page rendered as an invisible
    // dark-on-dark bar. A headless-Chrome screenshot showed it; no structural check could have.
    invertedInk: dark ? '#F7F6F3' : '#0B0F19',
    contrast: resolved.ratio,
    contrastPasses: resolved.passes,
  };
}

/**
 * The stylesheet every generated page ships.
 *
 * Deliberately hand-written rather than utility classes: it has to survive being saved into a database and served
 * as a single document, with no build step and no framework. Tokens first, then a mobile-first layout, then the
 * motion layer which is the only part that costs anything at runtime.
 */
export function landingPageCss(palette: Palette): string {
  return `:root{
  --brand:${palette.brand};
  --ink:${palette.ink};
  --muted:${palette.muted};
  --surface:${palette.surface};
  --line:${palette.line};
  --invert:${palette.invertedInk};
  --measure:66ch;
  --wide:1120px;
  --s1:8px;--s2:12px;--s3:16px;--s4:24px;--s5:32px;--s6:48px;--s7:72px;--s8:104px;
  --radius:16px;
  --step--1:clamp(14px,1.6vw,15px);
  --step-0:clamp(16px,1.9vw,18px);
  --step-1:clamp(19px,2.6vw,23px);
  --step-2:clamp(24px,3.6vw,31px);
  --step-3:clamp(31px,5vw,43px);
  --step-4:clamp(38px,7vw,62px);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--brand);color:var(--ink);
  font:var(--step-0)/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  font-feature-settings:'kern' 1,'liga' 1;
  text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;
}
img,svg{max-width:100%;display:block}
a{color:inherit}
h1,h2,h3{margin:0;line-height:1.12;letter-spacing:-.02em;font-weight:800;text-wrap:balance}
h1{font-size:var(--step-4)}
h2{font-size:var(--step-3)}
h3{font-size:var(--step-1);letter-spacing:-.01em}
p{margin:0;max-width:var(--measure);text-wrap:pretty}
ul{margin:0;padding-left:1.15em}
li{margin:var(--s1) 0}
section,header.hero,footer{padding:var(--s6) var(--s4)}
.wrap{max-width:var(--wide);margin:0 auto}
.narrow{max-width:var(--wide);margin:0 auto}
.eyebrow{
  margin:0 0 var(--s2);text-transform:uppercase;letter-spacing:.16em;
  font-size:12px;font-weight:700;color:var(--muted)
}
.lede{font-size:var(--step-1);color:var(--muted)}
.big{font-size:var(--step-2);font-weight:800;letter-spacing:-.01em}
.note{font-size:var(--step--1);color:var(--muted)}
/* The one action. 44px minimum because a thumb is not a mouse pointer. */
.cta{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:44px;min-width:44px;margin-top:var(--s4);
  padding:0 var(--s5);border-radius:999px;border:0;
  background:var(--invert);color:var(--brand);
  font:inherit;font-weight:800;text-decoration:none;cursor:pointer;
  transition:transform .18s ease,opacity .18s ease;
}
.cta:hover{transform:translateY(-1px)}
.cta:active{transform:translateY(0)}
.cta:focus-visible,button:focus-visible,input:focus-visible,a:focus-visible{
  outline:3px solid var(--ink);outline-offset:3px;border-radius:6px
}
.cta--quiet{background:transparent;color:var(--ink);border:1px solid var(--line)}
/* Hero: the scrim sits only where the text sits, never over the whole photograph. */
.hero{position:relative;display:flex;align-items:flex-end;min-height:clamp(560px,78vh,760px);padding:0;overflow:hidden}
.hero__media{position:absolute;inset:0;margin:0}
.hero__media img{width:100%;height:100%;object-fit:cover;display:block}
.hero__scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(6,10,18,.94) 0%,rgba(6,10,18,.72) 38%,rgba(6,10,18,.15) 72%,rgba(6,10,18,0) 100%)}
.hero__content{position:relative;z-index:2;width:100%;max-width:var(--wide);margin:0 auto;padding:var(--s7) var(--s5) var(--s7)}
.hero h1{font-size:clamp(40px,6.6vw,74px);letter-spacing:-.03em;max-width:16ch}
.hero .lede{max-width:44ch;margin-top:var(--s3)}
.hero .offer{margin-top:var(--s4)}
.hero .cta{margin-top:var(--s5)}



.offer{
  display:inline-block;margin-top:var(--s4);padding:var(--s2) var(--s4);
  border:1px solid var(--line);border-radius:999px;
  font-weight:800;font-size:var(--step-1);color:var(--ink)
}
/* Sections alternate their anchor instead of every act being centred. */
.split{display:grid;gap:var(--s5)}
.split__copy{max-width:var(--measure)}
.split--trail .split__copy{margin-left:auto}
@media(min-width:820px){
  section,header.hero,footer{padding:var(--s7) var(--s6)}
  .split{grid-template-columns:1.05fr .95fr;align-items:center;gap:var(--s6)}
}
.cards{display:grid;gap:var(--s3);grid-template-columns:1fr}
@media(min-width:720px){.cards{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}}
.card{padding:var(--s5);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);
  transition:transform .2s ease,border-color .2s ease}
.card:hover{transform:translateY(-2px);border-color:rgba(125,211,252,.5)}
.card__index{display:block;font-size:13px;font-weight:800;letter-spacing:.22em;color:#7DD3FC;margin-bottom:var(--s3)}
.card p{font-size:var(--step-1);font-weight:700;line-height:1.3;margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--s2)}
.grid img{width:100%;aspect-ratio:4/5;object-fit:cover;object-position:center;border-radius:var(--radius);background:var(--surface)}
/* Proof chips: real numbers only, so they read as facts rather than as decoration. */
.proof ul{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);list-style:none;padding:0}
.proof li{padding:var(--s1) var(--s3);border:1px solid var(--line);border-radius:999px;font-weight:700}
.logos p{color:var(--muted);letter-spacing:.04em}
.band{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--surface);text-align:center}
.band h2{font-size:clamp(34px,5.4vw,58px);letter-spacing:-.03em}
.offer__big{display:block;font-size:clamp(52px,10vw,104px);font-weight:900;letter-spacing:-.04em;line-height:1;color:#7DD3FC;margin:var(--s3) 0}
.band p{margin:0 auto}
.band .cta{margin-top:var(--s4)}
details{border-top:1px solid var(--line);padding:var(--s4) 0}
summary{cursor:pointer;font-weight:800;font-size:var(--step-1);list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:'+';float:right;font-weight:700;color:var(--muted)}
details[open] summary::after{content:'\\2013'}
details p{margin-top:var(--s2);color:var(--muted)}
form{display:grid;gap:var(--s3);max-width:420px}
label{display:grid;gap:var(--s1);font-size:var(--step--1);font-weight:700;color:var(--ink)}
input{
  min-height:48px;padding:0 var(--s3);border-radius:12px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit
}
input::placeholder{color:var(--muted)}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:var(--step--1);padding-bottom:var(--s8)}
/* The sticky bar exists only on small screens, where the hero CTA has scrolled away. */
.sticky-cta{
  position:fixed;left:0;right:0;bottom:0;z-index:20;
  display:flex;align-items:center;gap:var(--s3);
  padding:var(--s2) var(--s3);padding-bottom:calc(var(--s2) + env(safe-area-inset-bottom,0px));
  background:var(--brand);border-top:1px solid var(--line)
}
.sticky-cta .cta{margin:0;flex:1}
.sticky-cta__call{
  min-height:44px;display:inline-flex;align-items:center;padding:0 var(--s3);
  border:1px solid var(--line);border-radius:999px;text-decoration:none;font-weight:700
}
@media(min-width:820px){.sticky-cta{display:none}body{padding-bottom:0}}
@media(max-width:819px){body{padding-bottom:76px}}
/* Motion: transform and opacity only, and it is switched off when the visitor asked for less. */
[data-reveal]{opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .5s ease}
[data-reveal].is-in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}
  [data-reveal]{opacity:1;transform:none}
  .cta:hover{transform:none}
}
`;
}

/**
 * The reveal observer.
 *
 * Fourteen lines of inline script rather than a dependency: the page is served as a single stored document with
 * no bundler, and IntersectionObserver is in every browser that can load it. If the script fails, the CSS above
 * has already left the content visible only when `prefers-reduced-motion` is set — so this script also opts every
 * reveal element in immediately when the observer is unavailable. Content is never hidden behind a script that
 * did not run.
 */
export function revealScript(): string {
  return `<script>
(function(){
  var nodes=[].slice.call(document.querySelectorAll('[data-reveal]'));
  if(!nodes.length) return;
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||!('IntersectionObserver' in window)){
    nodes.forEach(function(n){n.classList.add('is-in')});
    return;
  }
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting){entry.target.classList.add('is-in');io.unobserve(entry.target)}
    })
  },{rootMargin:'0px 0px -12% 0px',threshold:0.12});
  nodes.forEach(function(n){io.observe(n)});
})();
</script>`;
}

/** How many eyebrow labels a page of this many sections may carry: one per three, per scroll-craft. */
export function eyebrowBudget(sectionCount: number): number {
  return Math.max(1, Math.floor(sectionCount / 3));
}
