/**
 * Does any business ever get asked a property question it has no business answering?
 *
 * WHY THIS EXISTS
 * This exact bug has shipped twice. First the dashboard's qualification panel fell back to
 * REAL_ESTATE_DEFAULT_QUESTIONS for every account, then — after that was fixed — the
 * WhatsApp webhook and the voice TwiML route still carried their own hardcoded property
 * questionnaire for anything holding `properties` rows. Procolor, a film academy, was asked
 * "What type of property are you interested in?" and offered "Under ₹50 Lacs".
 *
 * Each fix was correct and each fix missed a copy. The lesson is not "be careful"; it is
 * that a fallback living in four places will drift in three of them. The fallback now lives
 * in lib/automation/qualifying-questions.ts, and this gate is what keeps it honest: it
 * asserts the ANSWERS a real account would see, not that a constant exists somewhere.
 *
 * Static and pure: no database, no network, no tokens.
 *
 *   npm run verify:qualifying-vocabulary
 */
import {
  defaultQualifyingQuestions,
  isPropertyBusiness,
  neutralQualifyingQuestions,
  GENERIC_QUALIFYING_QUESTIONS,
  REAL_ESTATE_QUALIFYING_QUESTIONS,
  type QualifyingQuestion,
} from '../lib/automation/qualifying-questions';

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

/** Words that only make sense to a property business. */
const VERTICAL_WORDS =
  /\b(propert(y|ies)|plot|plots|land|lacs?|crore|cr\b|residential|commercial|sq\.? ?(yd|ft)|site visit|possession|rera)\b/i;

const text = (qs: QualifyingQuestion[]) =>
  qs.map((q) => `${q.question} ${q.options.join(' ')}`).join(' | ');

function hasVertical(qs: QualifyingQuestion[]): string | null {
  const haystack = text(qs);
  const match = haystack.match(VERTICAL_WORDS);
  return match ? match[0] : null;
}

// ── the live incident, asserted by name ─────────────────────────────────────
console.log('\n▸ Procolor Film Academy (education)');
const procolor = defaultQualifyingQuestions('education', 'Procolor Film Academy');
check('gets questions that name no property word', hasVertical(procolor) === null, hasVertical(procolor));
check('is asked about its own courses', text(procolor).toLowerCase().includes('course'), text(procolor));
check('is not treated as a property business', isPropertyBusiness('education', 'Procolor Film Academy') === false);

// ── an untagged account cannot inherit real-estate copy ────────────────────
console.log('\n▸ an account with no industry');
const untagged = defaultQualifyingQuestions(null, null);
check('gets no property words either', hasVertical(untagged) === null, hasVertical(untagged));
check('is phrased with the neutral product word', text(untagged).includes('offering'), text(untagged));

// ── real-estate accounts still get their own set ───────────────────────────
console.log('\n▸ property businesses keep the property set');
check('industry real_estate is a property business', isPropertyBusiness('real_estate', null));
check('industry "Real Estate" (spaced) too', isPropertyBusiness('Real Estate', null));
check('a name-only signal counts: Blue Square Infra', isPropertyBusiness(null, 'Blue Square Infra'));
check('a name-only signal counts: Sunshine Realty', isPropertyBusiness('', 'Sunshine Realty Homes'));
const re = defaultQualifyingQuestions('real_estate', null);
check('and they get the property questions', text(re).includes('type of property'), text(re));
check(
  'the property set is exactly the shared constant',
  JSON.stringify(re) === JSON.stringify(REAL_ESTATE_QUALIFYING_QUESTIONS)
);

// ── the neutral set is genuinely neutral ───────────────────────────────────
console.log('\n▸ the universal fallback');
check('the universal set names no vertical', hasVertical(GENERIC_QUALIFYING_QUESTIONS) === null, hasVertical(GENERIC_QUALIFYING_QUESTIONS));
for (const industry of ['education', 'immigration', 'healthcare', 'retail', 'services', 'film', 'academy']) {
  const qs = neutralQualifyingQuestions(industry);
  check(`"${industry}" gets no property question`, hasVertical(qs) === null, hasVertical(qs));
}

// ── shape: every question is answerable ────────────────────────────────────
console.log('\n▸ shape');
for (const [label, qs] of [
  ['education', procolor],
  ['untagged', untagged],
  ['real estate', re],
  ['universal', GENERIC_QUALIFYING_QUESTIONS],
] as const) {
  check(`${label}: three questions`, qs.length === 3, qs.length);
  check(
    `${label}: every question has text and an options array`,
    qs.every((q) => typeof q.question === 'string' && q.question.trim().length > 0 && Array.isArray(q.options))
  );
}

// A question with no options is asked conversationally; one with options must not be empty
// strings, which would render as blank buttons.
const allSets = [procolor, untagged, re, GENERIC_QUALIFYING_QUESTIONS];
check(
  'no blank option strings anywhere',
  allSets.every((qs) => qs.every((q) => q.options.every((o) => o.trim().length > 0)))
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('\nQualification questions are naming a vertical the account is not in.');
  console.error('Every failure above is a fallback that would tell a business owner what their');
  console.error('business is. Fix it in lib/automation/qualifying-questions.ts, not at the call site.');
  process.exit(1);
}
console.log('Every account is asked about its own business, and a property business still gets its own set.');
