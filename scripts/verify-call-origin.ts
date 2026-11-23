/**
 * Proves the voice bot describes the enquiry the lead actually made.
 *
 * THE BUG THIS GATE EXISTS FOR
 * The prompt decided the lead's origin with `source.includes('whatsapp') || custom_fields.meta_ad_origin`.
 * Every Meta lead-form submission carries `meta_ad_origin`, so the OR was always true for ad
 * leads: a student who filled a Facebook instant form and had never opened WhatsApp was greeted
 * with "aapne WhatsApp par inquiry start kiya tha" — a conversation that never happened. The two
 * Procolor leads (Varun arya, KARTIK) are that exact shape and were about to be called that way.
 *
 * What must hold:
 *   - a Meta ad/form lead is said to have come from the AD, never from WhatsApp
 *   - a lead with a real WhatsApp thread still hears WhatsApp, even if an ad also brought them in
 *   - the owner's own note about a lead outranks both
 *   - anything else is a generic ad enquiry, not a WhatsApp one
 *   - and the prompt for a non-property business does not talk about properties
 *
 *   npm run verify-call-origin
 */
import { readFileSync } from 'node:fs';
import { classifyLeadOrigin } from '../lib/automation/calling-script';
import { industryVocabulary } from '../lib/automation/industry';
import { computeValidCallingSlot, describeCallingWindow } from '../utils/calling-window';

/** The IST hour of an instant, for asserting where a blocked call gets scheduled. */
function istHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hourCycle: 'h23', hour: 'numeric' }).format(d),
  );
}

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
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);

head('1. A Meta lead-form lead is an AD lead, not a WhatsApp lead');

// Varun arya's real row: source "Facebook Ads", meta_ad_origin in custom_fields, no WhatsApp thread.
check(
  'the real Procolor lead shape classifies as meta-ad',
  classifyLeadOrigin({ source: 'Facebook Ads', hasMetaAdOrigin: true, hasWhatsAppThread: false }) === 'meta-ad',
  'source "Facebook Ads" + meta_ad_origin + no WhatsApp thread',
);
check(
  'meta_ad_origin alone is enough, whatever the source string says',
  classifyLeadOrigin({ source: 'Website', hasMetaAdOrigin: true }) === 'meta-ad',
);
check(
  'an Instagram source names Instagram',
  classifyLeadOrigin({ source: 'Instagram Lead Ads', hasMetaAdOrigin: true }) === 'meta-ad',
);
check(
  'a bare facebook source with no custom_fields is still an ad',
  classifyLeadOrigin({ source: 'Facebook Ads' }) === 'meta-ad',
);

head('2. A real WhatsApp conversation still wins');

check(
  'an actual WhatsApp thread outranks the ad',
  classifyLeadOrigin({ source: 'Facebook Ads', hasMetaAdOrigin: true, hasWhatsAppThread: true }) === 'whatsapp',
  'the lead really did message, whatever brought them in',
);
check(
  'a WhatsApp source is WhatsApp',
  classifyLeadOrigin({ source: 'WhatsApp' }) === 'whatsapp',
);
check(
  'and an empty thread does not count as a conversation',
  classifyLeadOrigin({ source: 'Facebook Ads', hasMetaAdOrigin: true, hasWhatsAppThread: false }) === 'meta-ad',
);

head("3. The owner's own note outranks everything");

check(
  'notes win over a WhatsApp thread and an ad origin',
  classifyLeadOrigin({ source: 'Facebook Ads', hasMetaAdOrigin: true, hasWhatsAppThread: true, hasNotes: true }) === 'notes',
);

head('4. Anything else is a generic enquiry');

check('a CSV import is not WhatsApp', classifyLeadOrigin({ source: 'CSV Import' }) === 'ad');
check('a portal lead is not WhatsApp', classifyLeadOrigin({ source: 'MagicBricks' }) === 'ad');
check('no source at all is not WhatsApp', classifyLeadOrigin({ source: null }) === 'ad');

head('5. A film academy is not talked to about properties');

const education = industryVocabulary('education');
const property = industryVocabulary('real_estate');
check(
  'education vocabulary says courses, not properties',
  /course/i.test(education.productNoun) && !/propert/i.test(education.productNounPlural),
  `${education.productNoun} / ${education.productNounPlural}`,
);
check(
  'property vocabulary still says property-ish, so real-estate tenants lose nothing',
  // "listing" is the registry's real-estate noun; the point is that it did not collapse to the
  // generic "offering", which is what would happen if the industry lookup were ignored.
  /listing|propert|plot|project/i.test(property.productNoun) && !/offering/i.test(property.productNoun),
  property.productNoun,
);

head('6. The route actually uses the decision');

const route = readFileSync('app/api/voice/twiml/route.ts', 'utf8');
check(
  'the prompt classifies the origin through the shared function',
  /classifyLeadOrigin\(\{/.test(route),
);
check(
  'the old `meta_ad_origin` OR is gone, so the bug cannot come back inline',
  !/includes\('whatsapp'\)\s*\|\|\s*!!?\S*meta_ad_origin/.test(route),
);
check(
  'the meta-ad branch forbids mentioning WhatsApp',
  /Do NOT mention WhatsApp at any point/.test(route),
);
check(
  'the qualification block no longer promises "property options" to every business',
  !/exact property options matching/.test(route),
);

head('7. The calling window is per-account, and the default is unchanged');

// Build a moment at a given IST clock time. IST is UTC+5:30, so subtract to get the UTC instant.
const ist = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 23, hour - 5, minute - 30));

check(
  'the default window still ends at 19:00 — nobody else gets a longer day by accident',
  computeValidCallingSlot(ist(18, 59)).isWithinWindow === true &&
    computeValidCallingSlot(ist(19, 0)).isWithinWindow === false,
  '18:59 allowed, 19:00 blocked',
);
check(
  'the default window still opens at 09:00',
  computeValidCallingSlot(ist(9, 0)).isWithinWindow === true &&
    computeValidCallingSlot(ist(8, 59)).isWithinWindow === false,
  '09:00 allowed, 08:59 blocked',
);
check(
  'a 9-to-20 account can be dialled at 19:30',
  computeValidCallingSlot(ist(19, 30), 'Asia/Kolkata', false, { startHour: 9, endHour: 20 }).isWithinWindow === true,
);
check(
  'and is still blocked at 20:00',
  computeValidCallingSlot(ist(20, 0), 'Asia/Kolkata', false, { startHour: 9, endHour: 20 }).isWithinWindow === false,
);
check(
  'a blocked call is rescheduled to that account\'s own opening time, not 9 AM forever',
  (() => {
    const out = computeValidCallingSlot(ist(21, 0), 'Asia/Kolkata', false, { startHour: 10, endHour: 20 });
    return out.isWithinWindow === false && istHour(out.scheduledTime) === 10;
  })(),
  'opens at 10:00 for a 10-20 account',
);
check(
  'a nonsense window falls back to the default instead of blocking every call',
  computeValidCallingSlot(ist(12, 0), 'Asia/Kolkata', false, { startHour: 20, endHour: 9 }).isWithinWindow === true,
  'end <= start is treated as unset',
);
check(
  'the window is described in the logs so nobody has to guess which rule applied',
  describeCallingWindow({ startHour: 9, endHour: 20 }) === '9:00 AM - 8:00 PM IST',
  describeCallingWindow({ startHour: 9, endHour: 20 }),
);
check(
  'and the default description is unchanged',
  describeCallingWindow() === '9:00 AM - 7:00 PM IST',
  describeCallingWindow(),
);

head('8. The dialler actually reads the tenant window');

const dialler = readFileSync('utils/vobiz-helper.ts', 'utf8');
check(
  'the dial gate reads business_info.calling_hours',
  /calling_hours/.test(dialler),
);
check(
  'and passes it into the window check',
  /computeValidCallingSlot\(new Date\(\), 'Asia\/Kolkata', !!allowAfterHours, callingWindow\)/.test(dialler),
);

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nThe bot must describe the enquiry the lead actually made.');
  process.exit(1);
}
console.log('A Meta lead hears "the ad you saw"; a WhatsApp lead hears WhatsApp.');
