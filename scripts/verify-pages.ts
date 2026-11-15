/**
 * Proves a page edit changes ONE thing, WITHOUT a browser or a model.
 *
 * The editor this replaces sent the whole page to a model with an instruction and
 * took the whole page back. Two things went wrong every time: the edit cost a
 * credit and was not repeatable, and asking for a new phone number could re-pick
 * the hero image and re-word the headline. Nobody could prove that an edit did what
 * was asked and nothing else, so nobody could trust it.
 *
 * So the gate is about the PROOF:
 *
 *   - a page can be adopted (named into sections) deterministically, and a marked
 *     page round-trips byte for byte;
 *   - a section edit changes that section and leaves every other section, the head
 *     and the scripts byte-identical;
 *   - a text edit refuses to guess: zero matches and multiple matches are both
 *     errors, because "Call Now" appears five times on a real page;
 *   - `verifyEdit` FAILS when a second section moves — the whole-page-rewrite case;
 *   - real-estate-only sections are dropped for every other industry, including an
 *     unknown one. That is the bug that gave a film academy a property-listing site.
 *
 *   npm run verify:pages
 */
import {
  PageEditError,
  SECTION_OPEN_PREFIX,
  SECTION_SPECS,
  describeEdit,
  disallowedSections,
  editSection,
  ensureSections,
  industryOnlySections,
  isSectionAllowed,
  markSection,
  parseMarkedPage,
  renderPage,
  replaceTextOnce,
  sectionById,
  sectionsForIndustry,
  stripDisallowedSections,
  verifyEdit,
} from '../lib/site/page-sections';
import { industryVocabulary } from '../lib/automation/industry';
import { describeEditPlan, parseEditRequest } from '../lib/site/page-edit-request';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

function throws(fn: () => unknown): { threw: boolean; message: string; reason: string } {
  try {
    fn();
    return { threw: false, message: '', reason: '' };
  } catch (error: any) {
    return { threw: true, message: String(error?.message ?? error), reason: String(error?.reason ?? '') };
  }
}

const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);

// ────────────────────────────────────────────────────────────────────────────
// Fixtures: one marked page, and the same page as a legacy (unmarked) file.
// ────────────────────────────────────────────────────────────────────────────

const MARKED_SECTIONS: { id: string; html: string }[] = [
  {
    id: 'hero',
    html:
      '<section id="hero" class="hero">\n  <h1>Edit your film like a pro</h1>\n' +
      '  <p>Six weeks, working editors, a portfolio you can show.</p>\n' +
      '  <a href="#enquire" class="btn">Talk to admissions</a>\n</section>',
  },
  {
    id: 'offerings',
    html:
      '<section id="offerings">\n  <h2>Courses &amp; Programs</h2>\n' +
      '  <article><h3>Editing Fundamentals</h3><p>Rs 24,000 for six weeks.</p></article>\n</section>',
  },
  {
    id: 'cta',
    html: '<section id="cta">\n  <p>Call Now to reserve a seat.</p>\n  <a href="tel:+919820012345">Call Now</a>\n</section>',
  },
  {
    id: 'footer',
    html: '<footer>\n  <p>Sharma Academy · Pune</p>\n  <p>Call Now: +91 98200 12345</p>\n</footer>',
  },
];

function markedPage(sections: typeof MARKED_SECTIONS = MARKED_SECTIONS): string {
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Sharma Academy</title>\n</head>\n<body>\n' +
    sections.map((entry) => `${markSection(entry.id, entry.html)}\n`).join('') +
    '<script>window.__track=1</script>\n</body>\n</html>\n'
  );
}

/** The same page as it would have been generated before markers existed. */
function legacyPage(): string {
  const body = MARKED_SECTIONS.map((entry) => entry.html).join('\n');
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>Sharma Academy</title>\n</head>\n<body>\n' +
    '<main>\n' +
    body +
    '\n</main>\n<script>window.__track=1</script>\n</body>\n</html>\n'
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Parsing and round-tripping
// ════════════════════════════════════════════════════════════════════════════

function checkParsing() {
  head('1. A marked page parses and round-trips');

  const html = markedPage();
  const page = parseMarkedPage(html);
  check(
    'the marked sections are found, in order, with their kinds',
    page.sections.map((entry) => entry.id).join(',') === 'hero,offerings,cta,footer' &&
      page.sections.map((entry) => entry.kind).join(',') === 'hero,offerings,cta,footer' &&
      page.marked,
    page.sections.map((entry) => `${entry.id}:${entry.kind}`).join(' '),
  );
  check(
    'the head and the trailing script stay OUTSIDE the sections',
    page.preamble.includes('<title>Sharma Academy</title>') &&
      page.epilogue.includes('window.__track=1') &&
      !page.sections.some((entry) => entry.html.includes('window.__track')),
    `${page.preamble.length} byte preamble, ${page.epilogue.length} byte epilogue`,
  );
  check(
    'a marked page round-trips byte for byte',
    renderPage(page) === html,
    `${html.length} bytes in, ${renderPage(page).length} bytes out`,
  );
  check(
    'the section html carries no marker of its own',
    page.sections.every((entry) => !entry.html.includes('nobo:section')),
    'markers are stripped from the body text',
  );
  check(
    'a section can be fetched by id, and an unknown id is null',
    sectionById(page, 'hero')?.id === 'hero' && sectionById(page, 'pricing') === null,
    'hero found, pricing null',
  );
}

function checkAdoption() {
  head('2. A legacy page is ADOPTED, not regenerated');

  const legacy = legacyPage();
  const adopted = ensureSections(legacy);
  check(
    'a legacy page with no markers is split at its landmarks',
    !adopted.marked &&
      adopted.sections.length === MARKED_SECTIONS.length &&
      adopted.sections.map((entry) => entry.id).join(',') === 'hero,offerings,cta,footer',
    adopted.sections.map((entry) => `${entry.id}:${entry.kind}`).join(' '),
  );
  check(
    'the id attribute names the section, so an edit can address it',
    adopted.sections[0].id === 'hero' && adopted.sections[1].id === 'offerings',
    adopted.sections.map((entry) => entry.id).join(', '),
  );
  check(
    'adoption does not lose a byte of the original',
    // Rendering back adds the markers and drops the now-redundant <main> wrapper,
    // so the CONTENT must all still be present even though the markup differs.
    MARKED_SECTIONS.every((entry) => renderPage(adopted).includes(entry.html.trim())) &&
      renderPage(adopted).includes('window.__track=1') &&
      renderPage(adopted).includes('<title>Sharma Academy</title>'),
    `${adopted.sections.length} sections adopted`,
  );
  check(
    'adoption is DETERMINISTIC: the same page always yields the same names',
    ensureSections(legacy).sections.map((entry) => entry.id).join(',') ===
      ensureSections(legacy).sections.map((entry) => entry.id).join(',') &&
      renderPage(ensureSections(legacy)) === renderPage(ensureSections(legacyPage())),
    'stable ids',
  );
  check(
    'an adopted page renders with markers, so the NEXT edit is surgical',
    renderPage(adopted).includes(SECTION_OPEN_PREFIX) &&
      parseMarkedPage(renderPage(adopted)).marked === true,
    'markers inserted on adoption',
  );
  check(
    'a page of unnamed sections still gets stable positional ids',
    (() => {
      const bare =
        '<html><body><section><h1>A</h1></section><section><h1>B</h1></section></body></html>';
      const named = ensureSections(bare);
      return (
        named.sections.length === 2 &&
        named.sections[0].id === 'section' &&
        named.sections[1].id === 'section-2'
      );
    })(),
    'section, section-2',
  );
  check(
    'sections nested inside a section belong to their parent, not to the page',
    (() => {
      const nested =
        '<html><body><section id="hero"><h1>A</h1><section id="inner"><p>B</p></section></section></body></html>';
      const named = ensureSections(nested);
      return named.sections.length === 1 && named.sections[0].id === 'hero' && named.sections[0].html.includes('inner');
    })(),
    'one landmark, nested content inside it',
  );
  check(
    'a fragment with no <body> is one block rather than an error',
    (() => {
      const named = ensureSections('<div><h1>Just a fragment</h1></div>');
      return named.sections.length === 1 && named.sections[0].html.includes('Just a fragment');
    })(),
    'block-1',
  );
  check(
    'an aria-label names a section that has no id',
    (() => {
      const named = ensureSections('<html><body><section aria-label="Pricing Plans"><p>x</p></section></body></html>');
      return named.sections[0].id === 'pricing-plans';
    })(),
    'pricing-plans',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. A surgical edit is surgical
// ════════════════════════════════════════════════════════════════════════════

function checkSectionEdit() {
  head('3. Editing one section leaves the rest byte-identical');

  const html = markedPage();
  const replacement = '<section id="cta">\n  <p>Only 4 seats left.</p>\n  <a href="tel:+919820012345">Call Now</a>\n</section>';
  const edited = editSection(html, 'cta', replacement);

  check(
    'the section that was edited really changed',
    sectionById(edited.after, 'cta')?.html === replacement && edited.html.includes('Only 4 seats left'),
    'cta replaced',
  );
  const untouched = MARKED_SECTIONS.filter((entry) => entry.id !== 'cta');
  check(
    'every OTHER section is byte-identical',
    untouched.every((entry) => sectionById(edited.after, entry.id)?.html === entry.html),
    untouched.map((entry) => entry.id).join(', ') + ' unchanged',
  );
  check(
    'the head and the scripts outside the sections are byte-identical',
    edited.after.preamble === edited.before.preamble && edited.after.epilogue === edited.before.epilogue,
    `${edited.after.preamble.length} + ${edited.after.epilogue.length} bytes outside, unchanged`,
  );
  check(
    'the proof names exactly one changed section and three untouched',
    edited && verifyEdit(edited.before, edited.after, 'cta').ok &&
      verifyEdit(edited.before, edited.after, 'cta').changed.join(',') === 'cta' &&
      verifyEdit(edited.before, edited.after, 'cta').unchanged.length === 3,
    describeEdit(verifyEdit(edited.before, edited.after, 'cta')),
  );
  check(
    'the edited page is still a page: doctype, title and scripts survive',
    edited.html.startsWith('<!DOCTYPE html>') &&
      edited.html.includes('<title>Sharma Academy</title>') &&
      edited.html.includes('window.__track=1') &&
      edited.html.trim().endsWith('</html>'),
    'structure intact',
  );
  check(
    'an edit to a section that does not exist is refused, with the sections that DO exist',
    (() => {
      const bad = throws(() => editSection(html, 'pricing', '<p>x</p>'));
      return bad.threw && bad.reason === 'no_such_section' && /hero, offerings, cta, footer/.test(bad.message);
    })(),
    'refused and listed',
  );
  check(
    'an edit that would empty a section is refused',
    (() => {
      const bad = throws(() => editSection(html, 'cta', '   '));
      return bad.threw && bad.reason === 'empty';
    })(),
    'refused',
  );
  check(
    'editing an ADOPTED page produces a marked page, and then edits are surgical',
    (() => {
      const first = editSection(legacyPage(), 'hero', '<section id="hero"><h1>New headline</h1></section>');
      const proof = verifyEdit(first.before, first.after, 'hero');
      // The first edit normalises the file by adding markers, but it must still not
      // have changed any other SECTION.
      return (
        proof.ok &&
        proof.changed.join(',') === 'hero' &&
        sectionById(first.after, 'offerings')?.html === MARKED_SECTIONS[1].html
      );
    })(),
    'adopt -> edit -> surgical',
  );
}

function checkTextEdit() {
  head('4. A text edit refuses to guess');

  const html = markedPage();
  const one = replaceTextOnce(html, 'Six weeks', 'Eight weeks');
  check(
    'a unique string is replaced exactly once, in the right section',
    one.html.includes('Eight weeks') &&
      !one.html.includes('Six weeks') &&
      one.replacedIn.join(',') === 'hero' &&
      verifyEdit(one.before, one.after, 'hero').ok,
    describeEdit(verifyEdit(one.before, one.after, 'hero')),
  );
  check(
    'replacing text leaves every other section untouched',
    sectionById(one.after, 'offerings')?.html === MARKED_SECTIONS[1].html &&
      sectionById(one.after, 'footer')?.html === MARKED_SECTIONS[3].html,
    'offerings and footer unchanged',
  );

  const ambiguous = throws(() => replaceTextOnce(html, 'Call Now', 'Enquire Now'));
  check(
    'an ambiguous string is REFUSED, naming how many and where',
    ambiguous.threw &&
      ambiguous.reason === 'ambiguous_text' &&
      /appears 3 times/.test(ambiguous.message) &&
      /cta, footer/.test(ambiguous.message),
    ambiguous.message.slice(0, 110),
  );
  const scoped = replaceTextOnce(html, 'Call Now', 'Enquire Now', { section: 'footer' });
  check(
    'naming the section makes an ambiguous string editable',
    scoped.replacedIn.join(',') === 'footer' &&
      sectionById(scoped.after, 'footer')?.html.includes('Enquire Now') === true &&
      sectionById(scoped.after, 'cta')?.html === MARKED_SECTIONS[2].html,
    'only the footer changed',
  );
  const missing = throws(() => replaceTextOnce(html, 'RERA number', 'x'));
  check(
    'a string that is not on the page is refused rather than silently doing nothing',
    missing.threw && missing.reason === 'text_not_found' && /does not appear/.test(missing.message),
    missing.message.slice(0, 90),
  );
  const wrongSection = throws(() => replaceTextOnce(html, 'Six weeks', 'Eight', { section: 'footer' }));
  check(
    'scoping the search to the wrong section is refused, not applied elsewhere',
    wrongSection.threw && wrongSection.reason === 'text_not_found' && /section "footer"/.test(wrongSection.message),
    wrongSection.message.slice(0, 96),
  );
  check(
    'an empty search string is refused',
    (() => {
      const bad = throws(() => replaceTextOnce(html, '', 'x'));
      return bad.threw && bad.reason === 'empty';
    })(),
    'refused',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. The proof catches the whole-page rewrite
// ════════════════════════════════════════════════════════════════════════════

function checkProof() {
  head('5. The proof FAILS when the edit leaks');

  const before = parseMarkedPage(markedPage());

  // Exactly the failure of a whole-page model rewrite: the section you asked about
  // changed, and so did two others you did not mention.
  const rewritten = parseMarkedPage(
    markedPage(
      MARKED_SECTIONS.map((entry) =>
        entry.id === 'hero'
          ? { ...entry, html: '<section id="hero"><h1>A NEW HEADLINE</h1></section>' }
          : entry.id === 'offerings'
            ? { ...entry, html: '<section id="offerings"><h2>PROGRAMMES</h2></section>' }
            : entry,
      ),
    ),
  );
  const leaked = verifyEdit(before, rewritten, 'hero');
  check(
    'an edit that changed a second section is REJECTED, and the second section is named',
    !leaked.ok && leaked.changed.includes('offerings') && /other section\(s\) also changed: offerings/.test(leaked.message),
    leaked.message.slice(0, 110),
  );
  check(
    'the rejection is reported as REJECTED, never as applied',
    /edit REJECTED/.test(describeEdit(leaked)),
    describeEdit(leaked),
  );
  check(
    'an edit that changed NOTHING is a rejection too',
    (() => {
      const same = verifyEdit(before, parseMarkedPage(markedPage()), 'hero');
      return !same.ok && /was supposed to change and did not/.test(same.message);
    })(),
    'a no-op edit is not success',
  );
  check(
    'a change to the head or the trailing script is caught',
    (() => {
      const retitled = parseMarkedPage(markedPage().replace('<title>Sharma Academy</title>', '<title>Someone Else</title>'));
      const proof = verifyEdit(before, retitled, 'hero');
      return !proof.ok && proof.outsideChanged && /outside the sections changed/.test(proof.message);
    })(),
    'preamble guarded',
  );
  check(
    'a section that disappeared is caught',
    (() => {
      const dropped = parseMarkedPage(markedPage(MARKED_SECTIONS.filter((entry) => entry.id !== 'footer')));
      const proof = verifyEdit(before, dropped, 'hero');
      return !proof.ok && proof.removed.join(',') === 'footer' && /disappeared/.test(proof.message);
    })(),
    'removal caught',
  );
  check(
    'a section that appeared is caught',
    (() => {
      const extra = parseMarkedPage(
        markedPage([...MARKED_SECTIONS, { id: 'faq', html: '<section id="faq"><h2>FAQ</h2></section>' }]),
      );
      const proof = verifyEdit(before, extra, 'hero');
      return !proof.ok && proof.added.join(',') === 'faq' && /appeared/.test(proof.message);
    })(),
    'insertion caught',
  );
  check(
    'without a named section, the proof still reports what changed',
    (() => {
      const proof = verifyEdit(before, parseMarkedPage(markedPage(
        MARKED_SECTIONS.map((entry) =>
          entry.id === 'cta' ? { ...entry, html: '<section id="cta"><p>New</p></section>' } : entry,
        ),
      )));
      return proof.ok && proof.changed.join(',') === 'cta' && proof.unchanged.length === 3;
    })(),
    'an unnamed expectation is a report, not a verdict',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Industry: a film academy must not get floor plans
// ════════════════════════════════════════════════════════════════════════════

function checkIndustry() {
  head('6. Sections follow the industry, never the old template');

  check(
    'some sections are industry-only, and the rest are universal',
    industryOnlySections().length >= 2 &&
      industryOnlySections().every((spec) => spec.industries !== null) &&
      SECTION_SPECS.some((spec) => spec.kind === 'hero' && spec.industries === null),
    industryOnlySections().map((spec) => `${spec.kind}(${spec.industries?.join('/')})`).join(' '),
  );
  check(
    'a real-estate page may have floor plans and specifications',
    isSectionAllowed('real_estate', 'floor-plan') &&
      isSectionAllowed('property', 'specifications') &&
      isSectionAllowed('real_estate', 'process'),
    'property keeps its specialised sections',
  );
  check(
    'a film academy may NOT have floor plans or specifications',
    !isSectionAllowed('education', 'floor-plan') &&
      !isSectionAllowed('film', 'specifications'),
    'education is refused',
  );
  check(
    'an UNKNOWN industry gets the universal sections only — never property',
    !isSectionAllowed(null, 'floor-plan') &&
      !isSectionAllowed(undefined, 'specifications') &&
      !isSectionAllowed('', 'floor-plan') &&
      !isSectionAllowed('generic', 'floor-plan') &&
      !isSectionAllowed('marble-polishing', 'floor-plan') &&
      isSectionAllowed(null, 'hero') &&
      isSectionAllowed(null, 'contact'),
    'unknown industry -> universal only',
  );
  check(
    'the offerings section is named from the vocabulary, per industry',
    (() => {
      const school = sectionsForIndustry('education').find((entry) => entry.kind === 'offerings');
      const broker = sectionsForIndustry('real_estate').find((entry) => entry.kind === 'offerings');
      const neutral = sectionsForIndustry(null).find((entry) => entry.kind === 'offerings');
      return (
        school?.heading === 'Courses & Programs' &&
        broker?.heading === 'Property Listings' &&
        neutral?.heading === 'Our Offerings' &&
        neutral?.heading === industryVocabulary(null).collectionHeading
      );
    })(),
    'education / property / neutral',
  );

  // The real page: a film academy's page that a template gave floor plans to.
  const academyPage = markedPage([
    ...MARKED_SECTIONS,
    { id: 'floor-plan', html: '<section id="floor-plan"><h2>Floor Plans</h2><img src="3bhk.webp"></section>' },
    { id: 'specifications', html: '<section id="specifications"><h2>Specifications</h2><p>Carpet area on request</p></section>' },
  ]);
  const found = disallowedSections(academyPage, 'education');
  check(
    'the film academy page is found to have floor plans and specifications',
    found.length === 2 && found.map((entry) => entry.kind).join(',') === 'floor-plan,specifications',
    found.map((entry) => entry.section).join(', '),
  );
  const cleaned = stripDisallowedSections(academyPage, 'education');
  check(
    'stripping removes exactly those two sections',
    cleaned.removed.join(',') === 'floor-plan,specifications' &&
      !cleaned.html.includes('Floor Plans') &&
      !cleaned.html.includes('Carpet area') &&
      cleaned.proof.ok &&
      cleaned.proof.removed.length === 2,
    cleaned.proof.message,
  );
  check(
    'stripping keeps everything the industry IS allowed to have',
    ['Edit your film like a pro', 'Courses &amp; Programs', 'Call Now', 'Sharma Academy · Pune'].every((text) =>
      cleaned.html.includes(text),
    ) && cleaned.html.includes('<title>Sharma Academy</title>'),
    'hero, offerings, cta and footer survive',
  );
  check(
    'a real-estate page keeps its floor plans',
    disallowedSections(academyPage, 'real_estate').length === 0 &&
      stripDisallowedSections(academyPage, 'real_estate').removed.length === 0,
    'nothing stripped for property',
  );
  check(
    'a page with no disallowed section is left alone, and says so',
    (() => {
      const clean = stripDisallowedSections(markedPage(), 'education');
      return clean.removed.length === 0 && clean.proof.ok;
    })(),
    'no-op is explicit',
  );
  check(
    'an unknown industry is stripped of property sections too',
    stripDisallowedSections(academyPage, null).removed.length === 2 &&
      stripDisallowedSections(academyPage, 'marble-polishing').removed.length === 2,
    'never the other way round',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. The request layer: one shape, decided before anything is touched
// ════════════════════════════════════════════════════════════════════════════

function checkRequestLayer() {
  head('7. An edit request is one thing, or it is refused');

  const sectionPlan = parseEditRequest({ section: 'hero', html: '<section><h1>New</h1></section>' });
  check(
    'a section request is read as a section replacement',
    sectionPlan.ok && sectionPlan.plan.kind === 'section' && sectionPlan.plan.section === 'hero',
    sectionPlan.ok ? sectionPlan.detail : 'refused',
  );
  const textPlan = parseEditRequest({ find: '+91 98200 12345', replace: '+91 98200 99999' });
  check(
    'a find/replace request is read as a text replacement',
    textPlan.ok && textPlan.plan.kind === 'text' && textPlan.plan.find === '+91 98200 12345',
    textPlan.ok ? textPlan.detail : 'refused',
  );
  const scopedPlan = parseEditRequest({ find: 'Call Now', replace: 'Enquire', section: 'footer' });
  check(
    'a text request may be scoped to one section',
    scopedPlan.ok && scopedPlan.plan.kind === 'text' && scopedPlan.plan.section === 'footer',
    scopedPlan.ok ? scopedPlan.detail : 'refused',
  );
  check(
    'naming BOTH shapes is refused rather than half-applied',
    (() => {
      const bad = parseEditRequest({ section: 'hero', html: '<p>x</p>', find: 'a', replace: 'b' });
      return !bad.ok && bad.rejection.reason === 'both_shapes' && bad.rejection.status === 400;
    })(),
    'both_shapes',
  );
  check(
    'an empty request is refused, and says what the two shapes are',
    (() => {
      const bad = parseEditRequest({});
      return !bad.ok && bad.rejection.reason === 'nothing_to_do' && /section, html/.test(bad.rejection.error);
    })(),
    'nothing_to_do',
  );
  check(
    'html without a section name is refused',
    (() => {
      const bad = parseEditRequest({ html: '<p>x</p>' });
      return !bad.ok && bad.rejection.reason === 'missing_section';
    })(),
    'missing_section',
  );
  check(
    'find without replace is refused, so a phrase cannot be deleted by omission',
    (() => {
      const bad = parseEditRequest({ find: 'Call Now' });
      return !bad.ok && bad.rejection.reason === 'missing_replace' && /Pass ""/.test(bad.rejection.error);
    })(),
    'missing_replace',
  );
  check(
    'replace: "" IS accepted, because deleting a phrase deliberately is a real edit',
    (() => {
      const ok = parseEditRequest({ find: 'Call Now to reserve a seat. ', replace: '' });
      return ok.ok && ok.plan.kind === 'text' && ok.plan.replace === '';
    })(),
    'explicit deletion allowed',
  );
  check(
    'a non-object body is refused',
    !parseEditRequest('hero').ok && !parseEditRequest(null).ok && !parseEditRequest(['hero']).ok,
    'not_an_object',
  );
  check(
    'an empty html string is not a section replacement',
    (() => {
      const bad = parseEditRequest({ section: 'hero', html: '   ' });
      return !bad.ok;
    })(),
    'whitespace is not content',
  );
  check(
    'the plan has a one-line description for the log',
    /section edit: hero/.test(describeEditPlan({ kind: 'section', section: 'hero', html: '<p>x</p>' })) &&
      /text edit/.test(describeEditPlan({ kind: 'text', find: 'a', replace: 'b' })),
    describeEditPlan({ kind: 'text', find: 'Call Now', replace: 'Enquire', section: 'footer' }),
  );

  // The request layer and the edit layer agree: a parsed plan applied to a real page
  // changes exactly the section it named, and the proof says so.
  const page = markedPage();
  const plan = parseEditRequest({ find: '+91 98200 12345', replace: '+91 98200 99999', section: 'footer' });
  check(
    'a parsed text plan applies cleanly and proves it changed one section',
    (() => {
      if (!plan.ok || plan.plan.kind !== 'text') return false;
      const applied = replaceTextOnce(page, plan.plan.find, plan.plan.replace, { section: 'footer' });
      const proof = verifyEdit(applied.before, applied.after, 'footer');
      return proof.ok && proof.changed.join(',') === 'footer' && proof.unchanged.length === 3;
    })(),
    'parse -> apply -> prove',
  );
  check(
    'a parsed section plan applies cleanly too',
    (() => {
      const parsed = parseEditRequest({ section: 'hero', html: '<section id="hero"><h1>Fresh</h1></section>' });
      if (!parsed.ok || parsed.plan.kind !== 'section') return false;
      const applied = editSection(page, parsed.plan.section, parsed.plan.html);
      const proof = verifyEdit(applied.before, applied.after, 'hero');
      return proof.ok && proof.changed.join(',') === 'hero' && applied.html.includes('Fresh');
    })(),
    'parse -> apply -> prove',
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────────

checkParsing();
checkAdoption();
checkSectionEdit();
checkTextEdit();
checkProof();
checkIndustry();
checkRequestLayer();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
