/**
 * GATE: a lead is always offered the three actions, whatever a tenant saved in its button row.
 *
 * WHY THIS GATE EXISTS
 * The owner's report: "we used to send 3 buttons with each response, view products/courses/properties etc
 * that took the user to the website, connect with expert that pushed a notification to the admin and book
 * appointment that gets the user to the admin's nobogent account booking page. what the hell is going on?"
 *
 * Measured in production for Procolor Film Academy: `profiles.whatsapp_buttons` held ONE entry,
 * `[{ "url": "", "text": "View Courses" }]`, and the reply builder used that array AS the menu
 * (`ownerButtons.length > 0` → map it), so the lead was offered exactly one button. "Connect with Expert"
 * and "Book Appointment" were dropped from the message entirely. The one button that remained was emitted
 * with a synthetic id and an empty URL, matched no handler, and fell through to the free-form AI answer —
 * which is why tapping "View Courses" produced course text instead of opening the academy's website.
 *
 * The rules pinned here:
 *   1. the menu is ALWAYS the same three actions, in the same order, with the ids the inbound webhook
 *      matches on — a per-tenant row may change words, never which actions exist;
 *   2. the first button's LABEL comes from the tenant (their "View Courses") but its ID stays
 *      `view_properties`, which is the id that sends the website/catalogue link;
 *   3. junk config cannot shrink the menu — null, empty objects, blank text, a 40-character label;
 *   4. configured buttons beyond the first are reported back, not silently dropped;
 *   5. the webhook uses this builder rather than branching on the config itself.
 *
 *   npm run verify:whatsapp-menu
 */
import { readFileSync } from 'node:fs';
import {
  WHATSAPP_MENU_IDS,
  buildWhatsAppMenu,
  clampButtonTitle,
  whatsAppMenuPayload,
} from '../lib/automation/whatsapp-button-menu';
import {
  appointmentSubtitleFor,
  catalogueCtaCopy,
  containsPropertyVocabulary,
  offeringKindFor,
} from '../lib/automation/catalogue-cta';

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

// ── 1. the production case, exactly as it was stored ────────────────────────
head('1. Procolor\'s one-entry config still yields the three actions');

{
  const menu = buildWhatsAppMenu({
    ownerButtons: [{ url: '', text: 'View Courses' }],
    catalogueLabel: 'View Courses',
    industryLabel: 'View Courses',
  });
  check('three buttons', menu.buttons.length === 3, menu.buttons.length);
  check(
    'the ids are the contract the handler matches on',
    menu.buttons.map((b) => b.id).join(',') === WHATSAPP_MENU_IDS.join(','),
    menu.buttons.map((b) => b.id).join(','),
  );
  check('the first button keeps the owner\'s words', menu.buttons[0].title === 'View Courses', menu.buttons[0].title);
  check('and the label is credited to their config', menu.firstLabel.source === 'owner-config', menu.firstLabel.source);
  check('"Talk to Expert" is back', /expert/i.test(menu.buttons[1].title), menu.buttons[1].title);
  check('"Book Appointment" is back', /book/i.test(menu.buttons[2].title), menu.buttons[2].title);
  check(
    'the first id is view_properties, so tapping it sends the website link',
    menu.buttons[0].id === 'view_properties',
    menu.buttons[0].id,
  );
  check('no synthetic btn_custom ids anywhere', !menu.buttons.some((b) => b.id.startsWith('btn_custom')));
}

// ── 2. no config at all still means three actions ───────────────────────────
head('2. With nothing configured the menu is still complete');

{
  const byCat = buildWhatsAppMenu({ catalogueLabel: 'View Courses', industryLabel: 'x' });
  check('catalogue label wins when there is no owner button', byCat.buttons[0].title === 'View Courses', byCat.buttons[0].title);
  check('and is credited to the catalogue label', byCat.firstLabel.source === 'catalogue-label');
  check('still three buttons', byCat.buttons.length === 3);

  const byIndustry = buildWhatsAppMenu({ industryLabel: 'View Properties' });
  check('the industry default is the last resort', byIndustry.buttons[0].title === 'View Properties', byIndustry.buttons[0].title);
  check('and is credited to the industry', byIndustry.firstLabel.source === 'industry-default');

  const nothing = buildWhatsAppMenu({});
  check('nothing at all still gives three buttons', nothing.buttons.length === 3, nothing.buttons.map((b) => b.title).join(' | '));
  check('with a readable first label', nothing.buttons[0].title.length > 0, nothing.buttons[0].title);
}

// ── 3. junk cannot shrink it ────────────────────────────────────────────────
head('3. Junk configuration cannot remove an action');

{
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty array', []],
    ['array of empty objects', [{}, {}]],
    ['a bare string', 'View Courses'],
    ['an object, not an array', { text: 'View Courses' }],
    ['blank text', [{ url: '', text: '   ' }]],
  ];
  for (const [label, ownerButtons] of cases) {
    const menu = buildWhatsAppMenu({ ownerButtons, catalogueLabel: 'View Courses' });
    check(`${label} -> three buttons`, menu.buttons.length === 3 && menu.buttons[1].id === 'talk_expert', menu.buttons.length);
  }

  const long = buildWhatsAppMenu({ ownerButtons: [{ text: 'View our entire course catalogue today' }] });
  check('a 20-character cap is applied to a long label', long.buttons[0].title.length <= 20, `${long.buttons[0].title.length}: ${long.buttons[0].title}`);
  check('clamping never returns an empty title', clampButtonTitle('   ', 'Fallback') === 'Fallback');

  const extra = buildWhatsAppMenu({
    ownerButtons: [{ text: 'View Courses' }, { text: 'Fee Structure' }, { text: 'Placements' }],
  });
  check('the three contract actions survive a chatty config', extra.buttons.length === 3 && extra.buttons[2].id === 'book_appointment');
  check('and the buttons that could not fit are reported, not hidden', extra.ignored.length === 2, extra.ignored.join(', '));
}

// ── 4. the payload WhatsApp actually receives ───────────────────────────────
head('4. The outbound payload is a three-button interactive message');

{
  const menu = buildWhatsAppMenu({ ownerButtons: [{ url: '', text: 'View Courses' }] });
  const payload: any = whatsAppMenuPayload('919999999999', 'What would you like to do next?', menu);
  check('it is an interactive message', payload.type === 'interactive' && payload.interactive.type === 'button');
  check('addressed to the lead', payload.to === '919999999999');
  check('carrying the body text', payload.interactive.body.text === 'What would you like to do next?');
  check('with exactly three reply buttons', payload.interactive.action.buttons.length === 3, payload.interactive.action.buttons.length);
  check(
    'every button is a reply with an id and a title',
    payload.interactive.action.buttons.every((b: any) => b.type === 'reply' && b.reply.id && b.reply.title),
  );
  check(
    'the ids reach the wire unchanged',
    payload.interactive.action.buttons.map((b: any) => b.reply.id).join(',') === WHATSAPP_MENU_IDS.join(','),
  );
}

// ── 5. the webhook actually uses it ─────────────────────────────────────────
head('5. The webhook builds the menu here, not from the tenant row');

{
  const route = readFileSync('app/api/webhooks/facebook/route.ts', 'utf8');
  check('the menu is built by the helper', /buildWhatsAppMenu\(\{/.test(route));
  check('the payload comes from the helper', /whatsAppMenuPayload\(cleanFrom, promptText, menu\)/.test(route));
  check(
    'the old "use the config as the whole menu" branch is gone from the menu sender',
    !/threeButtonsList = ownerButtons\.slice\(0, 3\)/.test(route),
  );
  check('no synthetic button ids are minted for the menu', !/btn_custom_\$\{idx\}/.test(route.split('const sendThreeButtons')[1]?.slice(0, 4000) || ''));
  check(
    'the industry label is taken from the owner row that actually holds it',
    /industryLabel: defaultProductButtonLabel\(ownerIndustry\)/.test(route),
  );
  check(
    'the three contract ids are still matched by the inbound handlers',
    /buttonReplyId === 'view_properties'/.test(route) &&
      /buttonReplyId === 'talk_expert'/.test(route) &&
      /buttonReplyId === 'book_appointment'/.test(route),
  );
}

// ── 6. no property vocabulary for a business that does not sell property ────
head('6. A film academy is never offered "premium properties"');

{
  // Procolor's real rows, verbatim: courses, all stored with the generic catalogue type.
  const procolorRows = ['Generic', 'Generic', 'Generic', 'Generic'];
  const kind = offeringKindFor({ industry: 'education', rowTypes: procolorRows });
  check("an academy's generic catalogue rows are courses, not properties", kind === 'courses', kind);

  const cta = catalogueCtaCopy({
    kind,
    catalogueLabel: 'View Courses',
    businessName: 'Procolor Film Academy',
  });
  const allowed = containsPropertyVocabulary(`${cta.title} ${cta.body} ${cta.buttonText}`);
  check('its CTA copy contains zero property vocabulary', allowed.length === 0, allowed.join(', ') || 'clean');
  check('the button keeps the tenant\'s words', cta.buttonText === 'View Courses', cta.buttonText);
  check('and the copy is about courses', /course/i.test(`${cta.title} ${cta.body}`), `${cta.title} | ${cta.body}`);

  const subtitle = appointmentSubtitleFor(kind);
  check('no "site visit" in a non-property appointment CTA', containsPropertyVocabulary(subtitle).length === 0, containsPropertyVocabulary(subtitle).join(', ') || 'clean');

  // A real brokerage keeps its own words — the point is not to erase property language, it is to stop leaking it.
  const brokerage = offeringKindFor({ industry: 'Real Estate', rowTypes: ['Residential', 'Plot'] });
  check('a real estate account still reads as properties', brokerage === 'properties', brokerage);
  const brokerageCta = catalogueCtaCopy({ kind: brokerage, catalogueLabel: 'View Properties', businessName: 'Blue Square' });
  check('and keeps its property wording', /propert/i.test(brokerageCta.title), brokerageCta.title);
  check('with "site visit" reserved for it', /site visit/i.test(appointmentSubtitleFor('properties')));

  // The row type is the second signal, so a brokerage that has not set an industry still reads correctly.
  check(
    'a specific property row type alone is enough',
    offeringKindFor({ industry: null, rowTypes: ['Generic', 'Villa'] }) === 'properties',
  );
  for (const industry of ['education', 'healthcare', 'immigration', 'digital agency', '']) {
    const copy = catalogueCtaCopy({ kind: offeringKindFor({ industry, rowTypes: ['Generic'] }), businessName: 'X' });
    check(
      `${industry || '(no industry)'} gets no property words`,
      containsPropertyVocabulary(`${copy.title} ${copy.body} ${copy.buttonText}`).length === 0,
    );
  }
}

// ── 7. the hardcoded property copy is gone from the webhook ─────────────────
head('7. The webhook no longer carries property copy for everyone');

{
  const route = readFileSync('app/api/webhooks/facebook/route.ts', 'utf8');
  // Assert on the CALL, not on prose: the file legitimately quotes the old wording in a comment explaining it.
  check(
    'the hardcoded property CTA call is gone',
    !/sendCtaUrlMessage\(\s*"🏢 Available Properties"/.test(route) &&
      !/"Explore our latest premium properties catalog with pricing, layouts, and amenities:"/.test(route),
  );
  check('the CTA copy comes from the helper', /catalogueCtaCopy\(\{/.test(route));
  check('the appointment subtitle does too', /appointmentSubtitleFor\(offeringKind\)/.test(route));
  check('and the kind is derived from industry + row types', /offeringKindFor\(\{/.test(route));
  check(
    'the "sells properties" test is no longer just a row count',
    !/const hasProperties = !isNobogentAccount && !isPipixelAccount && \(\(propertiesCount \|\| 0\) > 0\);/.test(route) ||
      /offeringKindFor\(\{/.test(route),
  );
}

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nA lead must always be offered the website, an expert and an appointment — in their own business\'s words.');
  process.exit(1);
}
console.log('Three buttons, always — and no property words for a business that sells courses.');
