/**
 * Editing a generated page without re-rolling it.
 *
 * THE PROBLEM THIS SOLVES
 * `POST /api/landing-page/generate` in `mode: 'edit'` takes `instructions` plus the
 * whole `currentHtml` and asks a model to return the whole page again. So an owner
 * who says "change the phone number" gets a NEW page: the hero image is re-picked,
 * the headline is re-worded, the price sentence gains a number nobody measured. It
 * costs a credit, it is not repeatable, and there is no way to prove that the edit
 * did what was asked and nothing else — which is exactly what makes an owner stop
 * trusting the editor.
 *
 * So this module makes an edit a SURGICAL operation with a proof:
 *
 *   parsePage(html)            split a page into ordered, named sections
 *   ensureSections(html)       adopt a page that has no markers yet
 *   editSection(page, …)       replace ONE section; every other byte is unchanged
 *   replaceTextOnce(page, …)   replace ONE occurrence, refusing to guess at zero or
 *                              several — "Call Now" appears five times on a real page
 *   verifyEdit(before, after)  name exactly which sections changed, and refuse an
 *                              edit that leaked outside the one it named
 *
 * Markers. A section is delimited by HTML comments, which survive every template,
 * every sanitizer and every LLM round trip because they are not visible content:
 *
 *   <!-- nobo:section hero -->  …  <!-- /nobo:section hero -->
 *
 * A page written before this module existed has no markers, so `ensureSections`
 * ADOPTS it: it finds the top-level landmarks (`<header>`, each top-level
 * `<section>`, `<footer>`) and names each one from its `id`, then its `aria-label`,
 * then its position. Adoption is deterministic — the same page always yields the
 * same names — which is what makes a named section addressable at all.
 *
 * INDUSTRY. `sectionsForIndustry` decides which sections a business may have at
 * all. This is the bug that made a film academy receive a property-listing site: a
 * floor-plan section and a "possession date" block were emitted for every tenant.
 * Real-estate-only sections are dropped for every other industry, INCLUDING an
 * unknown one — never the other way round.
 *
 * PURE: strings in, strings out. No DOM, no I/O, no clock.
 */

import { industryVocabulary, type IndustryVocabulary } from '@/lib/automation/industry';

// ────────────────────────────────────────────────────────────────────────────
// Section kinds
// ────────────────────────────────────────────────────────────────────────────

export type SectionKind =
  | 'hero'
  | 'about'
  | 'offerings'
  | 'gallery'
  | 'floor-plan'
  | 'specifications'
  | 'process'
  | 'testimonials'
  | 'faq'
  | 'cta'
  | 'contact'
  | 'footer'
  // Learned from a real webinar-registration page an owner asked us to match
  // (`realestatewebinar.sonusharmaacademy.com`): a conversion page carries a mentor
  // block, hard numbers, a deadline, an event gallery, a logo wall and a registration
  // form. None of those existed, so a page "like that one" could not be built.
  | 'mentor'
  | 'proof'
  | 'logos'
  | 'countdown'
  | 'register';

export interface SectionSpec {
  kind: SectionKind;
  /** What this section is, for a human. */
  label: string;
  /** Industries that may have it. `null` = every industry, including unknown. */
  industries: readonly string[] | null;
  /** Fix the heading from the industry vocabulary instead of a constant. */
  headingFromVocabulary?: boolean;
}

/**
 * The sections a page can be made of.
 *
 * `industries: null` means universal. A list means ONLY those industries — an
 * unknown industry is not in any list, so it never gets a specialised section.
 */
export const SECTION_SPECS: readonly SectionSpec[] = [
  { kind: 'hero', label: 'Hero', industries: null },
  { kind: 'about', label: 'About', industries: null },
  { kind: 'offerings', label: 'Offerings', industries: null, headingFromVocabulary: true },
  // The five a registration page needs most: the person, the numbers, the deadline,
  // the proof-of-crowd and the form. All universal — every industry sells a date.
  { kind: 'proof', label: 'Numbers', industries: null },
  { kind: 'mentor', label: 'Your mentor', industries: null },
  { kind: 'countdown', label: 'Starts in', industries: null },
  { kind: 'register', label: 'Register', industries: null },
  { kind: 'gallery', label: 'Gallery', industries: null },
  { kind: 'logos', label: 'Trusted by', industries: null },
  { kind: 'floor-plan', label: 'Floor plans', industries: ['real_estate'] },
  { kind: 'specifications', label: 'Specifications', industries: ['real_estate'] },
  { kind: 'process', label: 'How it works', industries: ['real_estate', 'education', 'immigration'] },
  { kind: 'testimonials', label: 'Testimonials', industries: null },
  { kind: 'faq', label: 'Questions', industries: null },
  { kind: 'cta', label: 'Call to action', industries: null },
  { kind: 'contact', label: 'Contact', industries: null },
  { kind: 'footer', label: 'Footer', industries: null },
];

/** Sections that only some industries may have. Used by the guard, not the page. */
export function industryOnlySections(): SectionSpec[] {
  return SECTION_SPECS.filter((spec) => spec.industries !== null);
}

/**
 * The sections this industry may have, in page order, with headings resolved.
 *
 * The vocabulary decides the words: a real-estate page says "Property Listings" and
 * a film academy says "Courses & Programs", and an unknown industry says "Our
 * Offerings". No page ever inherits property wording unless its industry IS property.
 */
export function sectionsForIndustry(industry?: string | null): { kind: SectionKind; label: string; heading?: string }[] {
  const vocabulary = industryVocabulary(industry);
  return SECTION_SPECS.filter(
    (spec) => spec.industries === null || spec.industries.includes(vocabulary.key),
  ).map((spec) => ({
    kind: spec.kind,
    label: spec.label,
    ...(spec.headingFromVocabulary ? { heading: vocabulary.collectionHeading } : {}),
  }));
}

/**
 * May this industry have this section?
 *
 * An unknown industry is allowed only the universal sections — which is the whole
 * point. `floor-plan` for a film academy is a bug, and so is `floor-plan` for a
 * business whose industry nobody filled in.
 */
export function isSectionAllowed(industry: string | null | undefined, kind: SectionKind): boolean {
  const spec = SECTION_SPECS.find((entry) => entry.kind === kind);
  if (!spec) return false;
  if (spec.industries === null) return true;
  return spec.industries.includes(industryVocabulary(industry).key);
}

/** The vocabulary a page's copy should use. Exported so a renderer cannot invent its own. */
export function vocabularyFor(industry?: string | null): IndustryVocabulary {
  return industryVocabulary(industry);
}

// ────────────────────────────────────────────────────────────────────────────
// Parsing
// ────────────────────────────────────────────────────────────────────────────

export const SECTION_OPEN_PREFIX = '<!-- nobo:section ';
export const SECTION_CLOSE_PREFIX = '<!-- /nobo:section ';

export interface PageSection {
  /** Stable name: `hero`, `offerings`, or `block-3` for an adopted block. */
  id: string;
  /** The marker's kind, when the page declared one. */
  kind: SectionKind | 'unknown';
  /** The section's own HTML, WITHOUT the marker comments. */
  html: string;
  /**
   * Raw text between this section's close marker and the next marker.
   *
   * Usually just a newline. It is kept per section rather than swept into a single
   * preamble because a whitespace tail is POSITIONAL: folding every gap into the
   * front of the page is how renderPage stopped being the identity function, and a
   * page that does not round-trip cannot be edited surgically.
   */
  after: string;
  /** Character offsets of the whole delimited region, markers included. */
  start: number;
  end: number;
}

export interface ParsedPage {
  /** Everything before the first section (the doctype, `<head>`, `<body>` open…). */
  preamble: string;
  sections: PageSection[];
  /** Everything after the last section (scripts, `</body></html>`). */
  epilogue: string;
  /** True when the page carried `nobo:section` markers rather than being adopted. */
  marked: boolean;
}

const openMarker = (id: string) => `<!-- nobo:section ${id} -->`;
const closeMarker = (id: string) => `<!-- /nobo:section ${id} -->`;

/** Wrap a section's html in markers. */
export function markSection(id: string, html: string): string {
  return `${openMarker(id)}${html}${closeMarker(id)}`;
}

/**
 * Split a marked page into its pieces.
 *
 * Every byte of the input lands in exactly one place — `preamble`, a section's
 * `html`, a section's `after`, or `epilogue` — which is what makes `renderPage` the
 * identity function on a marked page. A marker pair that is not matched is left in
 * place as ordinary text rather than silently swallowed: an unclosed marker means
 * somebody hand-edited the HTML, and a surgical edit against a half-matched page
 * would cut a section in two.
 */
export function parseMarkedPage(html: string): ParsedPage {
  const text = String(html ?? '');
  const sections: PageSection[] = [];
  const pattern = /<!--\s*nobo:section\s+([A-Za-z0-9_.-]+)\s*-->([\s\S]*?)<!--\s*\/nobo:section\s+\1\s*-->/g;
  let preamble = '';
  let previousEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const gap = previousEnd === -1 ? text.slice(0, match.index) : text.slice(previousEnd, match.index);
    if (previousEnd === -1) {
      preamble = gap;
    } else {
      // The gap belongs after the PREVIOUS section, wherever it is.
      sections[sections.length - 1].after = gap;
    }

    const id = match[1];
    sections.push({
      id,
      kind: asKind(id),
      html: match[2],
      after: '',
      start: match.index,
      end: match.index + match[0].length,
    });
    previousEnd = match.index + match[0].length;
  }

  if (!sections.length) return { preamble: text, sections: [], epilogue: '', marked: false };

  return { preamble, sections, epilogue: text.slice(previousEnd), marked: true };
}

function asKind(id: string): SectionKind | 'unknown' {
  return SECTION_SPECS.some((spec) => spec.kind === id) ? (id as SectionKind) : 'unknown';
}

/**
 * Find the top-level occurrences of a tag, with nesting tracked.
 *
 * `<section>` nests inside `<section>` on real pages, so a flat regex would cut a
 * page in the wrong place. Depth counting is the smallest thing that is correct.
 */
function topLevelTagRanges(
  html: string,
  tag: string,
  from: number,
  to: number,
): { start: number; end: number }[] {
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  const ranges: { start: number; end: number }[] = [];
  let depth = 0;
  let start = -1;
  let index = from;

  while (index < to) {
    open.lastIndex = index;
    close.lastIndex = index;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    const openAt = nextOpen && nextOpen.index < to ? nextOpen.index : -1;
    const closeAt = nextClose && nextClose.index < to ? nextClose.index : -1;

    if (openAt === -1 && closeAt === -1) break;
    if (openAt !== -1 && (closeAt === -1 || openAt < closeAt)) {
      if (depth === 0) start = openAt;
      depth++;
      index = openAt + tag.length + 1;
      continue;
    }
    if (closeAt === -1) break;
    depth--;
    if (depth <= 0) {
      depth = 0;
      if (start !== -1) {
        ranges.push({ start, end: closeAt + tag.length + 3 });
        start = -1;
      }
    }
    index = closeAt + tag.length + 3;
  }

  // An unclosed top-level tag runs to the end of the region.
  if (start !== -1) ranges.push({ start, end: to });
  return ranges;
}

/** The `id` attribute of a tag at `at`, if it has one. */
function idOfTag(html: string, at: number, tag: string): string | null {
  const slice = html.slice(at, at + 400);
  const match = new RegExp(`^<${tag}\\b[^>]*\\bid\\s*=\\s*["']([^"']+)["']`, 'i').exec(slice);
  return match ? slug(match[1]) : null;
}

/** The `aria-label` of a tag at `at`, if it has one. */
function ariaLabelOfTag(html: string, at: number, tag: string): string | null {
  const slice = html.slice(at, at + 400);
  const match = new RegExp(`^<${tag}\\b[^>]*\\baria-label\\s*=\\s*["']([^"']+)["']`, 'i').exec(slice);
  return match ? slug(match[1]) : null;
}

function slug(text: string): string {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Where `<body>` starts, and where it ends. */
function bodyRange(html: string): { start: number; end: number } | null {
  const openMatch = /<body\b[^>]*>/i.exec(html);
  if (!openMatch) return null;
  const start = openMatch.index + openMatch[0].length;
  const closeMatch = /<\/body\s*>/i.exec(html.slice(start));
  return { start, end: closeMatch ? start + closeMatch.index : html.length };
}

/**
 * The region inside `<main>` when a single `main` wraps the content, else the body.
 *
 * A wrapper is not a section. Treating `<main>` as content is what made an adopted
 * page grow a bogus leading `block` section and lose its wrapper; keeping the open
 * tag in the preamble and the close tag in the epilogue preserves the page exactly.
 */
function contentRange(html: string): { start: number; end: number } | null {
  const body = bodyRange(html);
  if (!body) return null;
  const mains = topLevelTagRanges(html, 'main', body.start, body.end);
  if (mains.length !== 1) return body;

  const main = mains[0];
  const openTag = /<main\b[^>]*>/i.exec(html.slice(main.start, main.start + 400));
  const closeAt = html.lastIndexOf('</main', main.end);
  const innerStart = main.start + (openTag ? openTag[0].length : 0);
  const innerEnd = closeAt > innerStart ? closeAt : main.end;
  // Only unwrap when main actually holds the landmarks, not when it holds nothing.
  return innerStart < innerEnd ? { start: innerStart, end: innerEnd } : body;
}

/**
 * Adopt a page that has no markers: name each top-level landmark, and keep
 * everything around them as `preamble` / `epilogue`.
 *
 * This is what makes an already-generated page editable without regenerating it —
 * and not regenerating it is the entire point. The naming is deterministic:
 * `id` first, then `aria-label`, then the tag and its position (`section-2`). The
 * same page always adopts to the same names, so an edit saved against `hero` still
 * finds `hero` next week.
 *
 * ONE CAVEAT, stated because it matters: adopting an UNMARKED page and rendering it
 * back inserts the marker comments, so the first edit on a legacy page changes the
 * file by exactly those markers and nothing else. Every edit after that is surgical.
 * `renderPage(ensureSections(x)) === x` holds for a page that is already marked.
 */
export function ensureSections(html: string): ParsedPage {
  const text = String(html ?? '');
  const marked = parseMarkedPage(text);
  if (marked.sections.length) return marked;

  const region = contentRange(text);
  if (!region) {
    // A fragment with no <body>: the whole thing is one block.
    return {
      preamble: '',
      sections: [{ id: 'block-1', kind: 'unknown', html: text, after: '', start: 0, end: text.length }],
      epilogue: '',
      marked: false,
    };
  }

  // Landmarks are the outermost `header`, `section` and `footer` in the content. A
  // `section` nested inside another landmark is part of its parent, not a sibling.
  const candidates: { start: number; end: number; tag: string }[] = [];
  for (const tag of ['header', 'section', 'footer']) {
    for (const range of topLevelTagRanges(text, tag, region.start, region.end)) {
      candidates.push({ ...range, tag });
    }
  }
  candidates.sort((a, b) => (a.start === b.start ? b.end - a.end : a.start - b.start));
  const landmarks: { start: number; end: number; tag: string }[] = [];
  for (const range of candidates) {
    if (landmarks.some((host) => range.start >= host.start && range.end <= host.end)) continue;
    landmarks.push(range);
  }
  landmarks.sort((a, b) => a.start - b.start);

  if (!landmarks.length) {
    return {
      preamble: text.slice(0, region.start),
      sections: [
        { id: 'block-1', kind: 'unknown', html: text.slice(region.start, region.end), after: '', start: region.start, end: region.end },
      ],
      epilogue: text.slice(region.end),
      marked: false,
    };
  }

  const sections: PageSection[] = [];
  const used = new Map<string, number>();
  let cursor = region.start;
  let preamble = text.slice(0, region.start);

  /** A gap between landmarks: whitespace tails its neighbour, real content is a block. */
  const absorbGap = (from: number, to: number) => {
    if (to <= from) return;
    const gap = text.slice(from, to);
    if (!gap) return;
    if (!gap.trim()) {
      if (sections.length) sections[sections.length - 1].after += gap;
      else preamble += gap;
      return;
    }
    if (sections.length) sections[sections.length - 1].after = '';
    sections.push({
      id: uniqueId('block', used),
      kind: 'unknown',
      html: gap,
      after: '',
      start: from,
      end: to,
    });
  };

  for (const landmark of landmarks) {
    absorbGap(cursor, landmark.start);
    const named = idOfTag(text, landmark.start, landmark.tag) ?? ariaLabelOfTag(text, landmark.start, landmark.tag);
    const namedKind = named ? asKind(named) : 'unknown';
    const tagKind: SectionKind | 'unknown' =
      landmark.tag === 'header' ? 'hero' : landmark.tag === 'footer' ? 'footer' : 'unknown';

    sections.push({
      id: uniqueId(named ?? landmark.tag, used),
      kind: namedKind === 'unknown' ? tagKind : namedKind,
      html: text.slice(landmark.start, landmark.end),
      after: '',
      start: landmark.start,
      end: landmark.end,
    });
    cursor = landmark.end;
  }

  // Everything after the last landmark is the epilogue (`</main>`, the scripts,
  // `</body></html>`). It is deliberately NOT split into a whitespace tail: a marked
  // page keeps its post-last-marker text in the epilogue, so adoption has to put it
  // in the same place or the first edit would look like a change to the last section.
  return { preamble, sections, epilogue: text.slice(cursor), marked: false };
}

function uniqueId(base: string, used: Map<string, number>): string {
  const clean = slug(base) || 'block';
  const count = (used.get(clean) ?? 0) + 1;
  used.set(clean, count);
  return count === 1 ? clean : `${clean}-${count}`;
}

/** Rebuild a page from its pieces. `render(parsePage(x)) === x` for a marked page. */
export function renderPage(page: ParsedPage): string {
  return [
    page.preamble,
    ...page.sections.map((section) => `${markSection(section.id, section.html)}${section.after ?? ''}`),
    page.epilogue,
  ].join('');
}

/** A page's sections by id. */
export function sectionById(page: ParsedPage, id: string): PageSection | null {
  return page.sections.find((section) => section.id === String(id)) ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Editing
// ────────────────────────────────────────────────────────────────────────────

export class PageEditError extends Error {
  readonly reason: 'no_such_section' | 'ambiguous_text' | 'text_not_found' | 'leaked_outside' | 'empty';
  constructor(reason: PageEditError['reason'], message: string) {
    super(message);
    this.name = 'PageEditError';
    this.reason = reason;
    Object.setPrototypeOf(this, PageEditError.prototype);
  }
}

/**
 * Replace ONE section's html. Everything else is preserved byte for byte.
 *
 * The new html is not validated as HTML — a real page has enough shapes that a
 * validator here would reject valid work. What IS checked is that the replacement
 * happened exactly once and that nothing outside the section moved, because that is
 * the failure an owner actually notices.
 */
export function editSection(
  html: string,
  sectionId: string,
  newHtml: string,
): { html: string; before: ParsedPage; after: ParsedPage } {
  const before = ensureSections(html);
  const index = before.sections.findIndex((section) => section.id === String(sectionId));
  if (index === -1) {
    throw new PageEditError(
      'no_such_section',
      `there is no section "${sectionId}" on this page (it has: ${before.sections.map((section) => section.id).join(', ')})`,
    );
  }
  if (!String(newHtml ?? '').trim()) {
    throw new PageEditError('empty', 'refusing to empty a section: delete it deliberately or edit it');
  }

  const sections = before.sections.map((section, position) =>
    position === index ? { ...section, html: newHtml } : section,
  );
  const next = renderPage({ ...before, sections });
  const after = ensureSections(next);
  const proof = verifyEdit(before, after, String(sectionId));
  if (!proof.ok) throw new PageEditError('leaked_outside', proof.message);
  return { html: next, before, after };
}

/**
 * Replace ONE occurrence of a literal string.
 *
 * Refuses zero matches (the text is not there, so the instruction was about
 * something else) and refuses several (the instruction is ambiguous — "Call Now"
 * appears in the hero, the sticky bar and the footer of a real page). An editor that
 * guesses which one you meant is worse than one that asks.
 */
export function replaceTextOnce(
  html: string,
  find: string,
  replace: string,
  options: { section?: string } = {},
): { html: string; before: ParsedPage; after: ParsedPage; replacedIn: string[] } {
  const needle = String(find ?? '');
  if (!needle) throw new PageEditError('empty', 'nothing to find: the search text is empty');

  const before = ensureSections(html);
  const scope = options.section ? [sectionById(before, options.section)] : before.sections;
  if (options.section && !sectionById(before, options.section)) {
    throw new PageEditError(
      'no_such_section',
      `there is no section "${options.section}" on this page (it has: ${before.sections.map((entry) => entry.id).join(', ')})`,
    );
  }

  const hits: { index: number; id: string }[] = [];
  for (const section of scope) {
    if (!section) continue;
    let from = 0;
    for (;;) {
      const at = section.html.indexOf(needle, from);
      if (at === -1) break;
      hits.push({ index: at, id: section.id });
      from = at + needle.length;
    }
  }

  if (hits.length === 0) {
    throw new PageEditError(
      'text_not_found',
      `"${truncate(needle)}" does not appear in ${options.section ? `section "${options.section}"` : 'this page'}`,
    );
  }
  if (hits.length > 1) {
    const where = [...new Set(hits.map((hit) => hit.id))].join(', ');
    throw new PageEditError(
      'ambiguous_text',
      `"${truncate(needle)}" appears ${hits.length} times (in ${where}). Name the section, or quote more of the text.`,
    );
  }

  const target = hits[0].id;
  const sections = before.sections.map((section) =>
    section.id === target ? { ...section, html: section.html.split(needle).join(replace) } : section,
  );
  const next = renderPage({ ...before, sections });
  const after = ensureSections(next);
  const proof = verifyEdit(before, after, target);
  if (!proof.ok) throw new PageEditError('leaked_outside', proof.message);
  return { html: next, before, after, replacedIn: [target] };
}

function truncate(text: string, max = 48): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// ────────────────────────────────────────────────────────────────────────────
// The proof
// ────────────────────────────────────────────────────────────────────────────

export interface EditProof {
  ok: boolean;
  /** Sections whose html differs. */
  changed: string[];
  /** Sections present on both sides with identical html. */
  unchanged: string[];
  /** Sections that exist only on one side. */
  added: string[];
  removed: string[];
  /** True when the preamble or the epilogue changed. */
  outsideChanged: boolean;
  message: string;
}

/**
 * What did this edit actually change?
 *
 * `expected` is the section the caller says it edited. The proof fails when anything
 * ELSE changed, because that is the failure mode of a whole-page rewrite: you asked
 * for a phone number and the hero image moved too.
 *
 * `allowRemoval` exists for `stripDisallowedSections`, where removing a section IS
 * the instruction — everywhere else, a vanished section is a bug.
 */
export function verifyEdit(
  before: ParsedPage,
  after: ParsedPage,
  expected?: string,
  options: { allowRemoval?: boolean } = {},
): EditProof {
  const beforeById = new Map(before.sections.map((section) => [section.id, `${section.html}\u0000${section.after ?? ''}`]));
  const afterById = new Map(after.sections.map((section) => [section.id, `${section.html}\u0000${section.after ?? ''}`]));

  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [id, html] of beforeById) {
    const next = afterById.get(id);
    if (next === undefined) continue;
    if (next === html) unchanged.push(id);
    else changed.push(id);
  }
  const added = [...afterById.keys()].filter((id) => !beforeById.has(id));
  const removed = [...beforeById.keys()].filter((id) => !afterById.has(id));
  const outsideChanged = before.preamble !== after.preamble || before.epilogue !== after.epilogue;

  const problems: string[] = [];
  if (expected && !changed.includes(expected)) {
    problems.push(`section "${expected}" was supposed to change and did not`);
  }
  if (expected) {
    const leaked = changed.filter((id) => id !== expected);
    if (leaked.length) problems.push(`${leaked.length} other section(s) also changed: ${leaked.join(', ')}`);
  }
  if (added.length) problems.push(`section(s) appeared: ${added.join(', ')}`);
  if (removed.length && options.allowRemoval !== true) {
    problems.push(`section(s) disappeared: ${removed.join(', ')}`);
  }
  if (outsideChanged) problems.push('the page outside the sections changed (preamble or trailing markup)');

  const ok = problems.length === 0;
  const removedNote = removed.length ? `, ${removed.length} removed on purpose` : '';
  return {
    ok,
    changed,
    unchanged,
    added,
    removed,
    outsideChanged,
    message: ok
      ? expected
        ? `only ${expected} changed; ${unchanged.length} section(s) byte-identical${removedNote}`
        : `${changed.length} section(s) changed; ${unchanged.length} byte-identical${removedNote}`
      : problems.join('; '),
  };
}

/** A one-line summary for the log or an API response. */
export function describeEdit(proof: EditProof): string {
  if (!proof.ok) return `edit REJECTED: ${proof.message}`;
  return `edit applied: ${proof.changed.join(', ')} changed, ${proof.unchanged.length} section(s) byte-identical`;
}

// ────────────────────────────────────────────────────────────────────────────
// The industry guard
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sections on a page that its industry is not allowed to have.
 *
 * Run this before publishing a page, whatever produced it — a model, a template, or
 * a hand edit. It is the check that would have caught the film academy that got
 * floor plans.
 */
export function disallowedSections(html: string, industry?: string | null): { section: string; kind: SectionKind }[] {
  const page = ensureSections(html);
  return page.sections
    .filter((section) => section.kind !== 'unknown' && !isSectionAllowed(industry, section.kind))
    .map((section) => ({ section: section.id, kind: section.kind as SectionKind }));
}

/**
 * Remove every section this industry may not have, leaving the rest untouched.
 *
 * The proof still applies: what comes back differs only by the removed sections.
 */
export function stripDisallowedSections(
  html: string,
  industry?: string | null,
): { html: string; removed: string[]; proof: EditProof } {
  const before = ensureSections(html);
  const disallowed = disallowedSections(html, industry);
  if (disallowed.length === 0) {
    return { html: renderPage(before), removed: [], proof: verifyEdit(before, before) };
  }
  const doomed = new Set(disallowed.map((entry) => entry.section));
  const kept = before.sections.filter((section) => !doomed.has(section.id)).map((section) => ({ ...section }));
  // `after` is the separator that FOLLOWS a section, and the last section never has
  // one (its trailing text lives in the epilogue). Removing the sections that used to
  // be last would otherwise leave their separator behind and read as a change to the
  // page outside the sections.
  if (kept.length) kept[kept.length - 1].after = '';

  const next = renderPage({ ...before, sections: kept });
  const after = ensureSections(next);
  const proof = verifyEdit(before, after, undefined, { allowRemoval: true });
  return { html: next, removed: [...doomed], proof };
}
