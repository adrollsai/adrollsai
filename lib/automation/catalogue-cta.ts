/**
 * WHAT KIND OF THING IS THIS BUSINESS SELLING? — the copy for the WhatsApp catalogue button.
 *
 * WHY THIS FILE EXISTS
 * The owner, twice, and increasingly bluntly: "i asked you that there should be nothing property or real estate
 * specific". The bot still sent a film academy:
 *
 *   "🏢 Available Properties — Explore our latest premium properties catalog with pricing, layouts, and amenities"
 *
 * Two mistakes produced that sentence. The first is copy: those words were hardcoded in the handler. The second
 * is the inference behind them: `hasProperties` was computed as "the account has rows in the `properties` table",
 * and Procolor's four rows are COURSES — "Diploma in Cinematography", "Diploma in Photography", "Master Video
 * Editing", "Smartphone Content Creator" — every one of them saved with `property_type: 'Generic'`. The
 * `properties` table is the catalogue, not a claim about the industry.
 *
 * So the kind of offering is derived from the INDUSTRY first and the ROW TYPES second, and the copy follows the
 * kind. A real estate business keeps its property wording because that is what it sells; everyone else gets words
 * about their own catalogue. Nothing here can emit property vocabulary to a business that does not sell property.
 */

export type OfferingKind = 'properties' | 'courses' | 'services' | 'offerings';

/** Real-estate vocabulary. Only a property business may see any of it. */
export const PROPERTY_VOCABULARY = [
  'propert',
  'real estate',
  'amenit',
  'bhk',
  'site visit',
  'flat',
  'apartment',
  'villa',
  'plot',
  'floor plan',
  'layout',
] as const;

const realEstateIndustry = /real.?estate|propert|realt|infra|homes|realty|builder|developer/i;
const educationIndustry = /educat|academy|film|school|institute|coach|training|course/i;
const serviceIndustry = /service|consult|agenc|clinic|health|salon|studio|law|financ/i;

/** `property_type` values that are a real claim about the offering, i.e. not the generic catalogue bucket. */
function isSpecificPropertyType(value: unknown): boolean {
  const type = String(value ?? '').trim().toLowerCase();
  if (!type) return false;
  // 'Generic' is what this codebase writes for anything that is not a physical property.
  if (type === 'generic' || type === 'other' || type === 'item' || type === 'product') return false;
  return /residential|commercial|plot|villa|flat|apartment|land|farm|row.?house|penthouse|shop|office|property/.test(
    type
  );
}

/**
 * Decide the kind of offering.
 *
 * Industry wins when it is recognisably real estate. Otherwise the row types decide: only rows whose type names a
 * real property make an account a property business, so a film academy's `Generic` courses never do.
 */
export function offeringKindFor(input: {
  industry?: string | null;
  /** Every `properties.property_type` the account has. */
  rowTypes?: Array<string | null | undefined>;
}): OfferingKind {
  const industry = String(input.industry || '');
  if (realEstateIndustry.test(industry)) return 'properties';
  const rows = Array.isArray(input.rowTypes) ? input.rowTypes : [];
  if (rows.some(isSpecificPropertyType)) return 'properties';
  if (educationIndustry.test(industry)) return 'courses';
  if (serviceIndustry.test(industry)) return 'services';
  return 'offerings';
}

export interface CatalogueCtaCopy {
  title: string;
  body: string;
  buttonText: string;
  kind: OfferingKind;
}

/**
 * The CTA-URL message for the first button. Copy only — the URL is the caller's business.
 *
 * `catalogueLabel` is the tenant's own words ("View Courses"); it becomes the button, never a property word.
 */
export function catalogueCtaCopy(input: {
  kind: OfferingKind;
  catalogueLabel?: string | null;
  businessName?: string | null;
}): CatalogueCtaCopy {
  const label = String(input.catalogueLabel || '').trim();
  const business = String(input.businessName || '').trim();

  switch (input.kind) {
    case 'properties':
      return {
        kind: input.kind,
        title: '🏢 Available Properties',
        body: 'Explore our latest properties with pricing, layouts, and amenities:',
        buttonText: label || 'View Properties 🏢',
      };
    case 'courses':
      return {
        kind: input.kind,
        title: `🎓 ${business || 'Our Courses'}`,
        body: 'Explore our latest courses and programme details:',
        buttonText: label || 'View Courses',
      };
    case 'services':
      return {
        kind: input.kind,
        title: `✨ ${business || 'Our Services'}`,
        body: 'Explore the services we offer and how they work:',
        buttonText: label || 'View Services',
      };
    default:
      return {
        kind: input.kind,
        title: `✨ ${business || 'Our Offerings'}`,
        body: 'Explore our latest products, services, and solutions:',
        buttonText: label || 'Explore More ✨',
      };
  }
}

/** The appointment CTA's subtitle. "Site visit" belongs to a property business and to nobody else. */
export function appointmentSubtitleFor(kind: OfferingKind | 'platform' | 'agency'): string {
  if (kind === 'platform') return 'Select a convenient slot for a 1-on-1 walkthrough of the Nobogent AI sales platform:';
  if (kind === 'agency') return 'Select a convenient slot for a 1-on-1 digital growth consultation with our marketing team:';
  if (kind === 'properties') return 'Select a convenient consultation or site visit slot directly from our calendar:';
  return 'Select a convenient consultation slot directly from our calendar:';
}

/** True when any property word appears in the text — used by the gate, and cheap enough to assert in tests. */
export function containsPropertyVocabulary(text: string): string[] {
  const haystack = String(text || '').toLowerCase();
  return PROPERTY_VOCABULARY.filter((word) => haystack.includes(word));
}

export interface VoiceNotifyCopy {
  /** Title for "the lead booked something" — property accounts keep "site visit". */
  appointmentTitle: string;
  /** What the call was about, when the lead's own answers name nothing. */
  enquiryFallback: string;
  /** "Project / Property" label used inside notification bodies. */
  subjectLabel: string;
}

/**
 * The words in the admin notifications a finished call sends.
 *
 * These said "Site Visit / Appointment Booked" and "🏢 Project / Property" to EVERY account, and fell back to
 * "Real Estate Inquiry" when nothing named the enquiry — so a film academy's staff were emailed about a property
 * project that does not exist. Same rule as everywhere else in this file: the account's own kind decides, and a
 * business that does not sell property is never told about one.
 */
export function voiceNotifyCopyFor(kind: OfferingKind): VoiceNotifyCopy {
  if (kind === 'properties') {
    return {
      appointmentTitle: '🎙️ Site Visit / Appointment Booked',
      enquiryFallback: 'a property enquiry you had made',
      subjectLabel: '🏢 Project / Property',
    };
  }
  if (kind === 'courses') {
    return {
      appointmentTitle: '🎙️ Appointment Booked',
      enquiryFallback: 'a course enquiry you had made',
      subjectLabel: '🎓 Course / Programme',
    };
  }
  return {
    appointmentTitle: '🎙️ Appointment Booked',
    enquiryFallback: 'an enquiry you had made',
    subjectLabel: '🏷️ Product / Service',
  };
}

export interface CatalogueSharing {
  kind: OfferingKind;
  /** Page/OG/Twitter title tail: "Courses", "Properties", … */
  titleNoun: string;
  /** First words of the meta description. */
  descriptionLead: string;
  /** schema.org type for the business. */
  schemaType: string;
  /** schema.org type for one catalogue entry. */
  itemType: string;
  /** "Courses by X" in the ItemList. */
  listNoun: string;
  /** The crawlable h1 tail. */
  heading: string;
}

/**
 * The words for a tenant's PUBLIC catalogue page: title, description, structured data, heading.
 *
 * These were all hardcoded to real estate — the page for a film academy served the title
 * "… - Premium Real Estate Listings", described "exclusive real estate listings" to Google, and declared
 * itself a `RealEstateAgent` with `RealEstateListing` items. Wrong words, and wrong structured data, for
 * every tenant that is not a brokerage. The kind decides all of it.
 */
export function catalogueSharingFor(input: {
  industry?: string | null;
  businessName?: string | null;
  rowTypes?: Array<string | null | undefined>;
}): CatalogueSharing {
  const kind = offeringKindFor({ industry: input.industry, rowTypes: input.rowTypes });
  switch (kind) {
    case 'properties':
      return {
        kind,
        titleNoun: 'Premium Real Estate',
        descriptionLead: 'Explore premium properties, market updates, and exclusive real estate listings',
        schemaType: 'RealEstateAgent',
        itemType: 'RealEstateListing',
        listNoun: 'Properties by',
        heading: 'Premium Real Estate Listings',
      };
    case 'courses':
      return {
        kind,
        titleNoun: 'Courses & Programmes',
        descriptionLead: 'Explore our courses, programmes and admission details',
        schemaType: 'EducationalOrganization',
        itemType: 'Course',
        listNoun: 'Courses by',
        heading: 'Courses & Programmes',
      };
    case 'services':
      return {
        kind,
        titleNoun: 'Services',
        descriptionLead: 'Explore the services we offer and how they work',
        schemaType: 'LocalBusiness',
        itemType: 'Service',
        listNoun: 'Services by',
        heading: 'Our Services',
      };
    default:
      return {
        kind,
        titleNoun: 'Our Offerings',
        descriptionLead: 'Explore our latest products, services and solutions',
        schemaType: 'LocalBusiness',
        itemType: 'Product',
        listNoun: 'Offerings by',
        heading: 'Our Offerings',
      };
  }
}
