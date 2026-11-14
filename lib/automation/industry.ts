/**
 * Industry vocabulary.
 *
 * The product was written for Indian real-estate brokerages: the website template
 * is a brokerage site, the prompts say "property commercial", the factual guard
 * talks about RERA and carpet area, and the SEO copy says "Property Listings &
 * Site Visits". A film academy therefore received a property-listing site.
 *
 * Everything brand-facing now derives its nouns, schema type and guard rules from
 * `profiles.industry`. NULL or an unrecognised value means NEUTRAL — see
 * `industryVocabulary()` below.
 */

export interface IndustryVocabulary {
  key: string
  /** Singular product word: "listing", "course", "service". */
  productNoun: string
  /** Plural product word used in headings. */
  productNounPlural: string
  /** Label for the `property_type` column in prompt facts. */
  typeLabel: string
  /** Collection heading, e.g. "Property Listings", "Courses & Programs". */
  collectionHeading: string
  /** schema.org type for JSON-LD. */
  schemaType: string
  /** Primary call to action. */
  enquiryCta: string
  /** Industry-specific "never invent …" clause appended to the factual guard. */
  guardDomainLine: string
  /** Fallback one-liner when the tenant has no mission statement. */
  taglineFallback: string
}

const REAL_ESTATE: IndustryVocabulary = {
  key: 'real_estate',
  productNoun: 'listing',
  productNounPlural: 'listings',
  typeLabel: 'Property type',
  collectionHeading: 'Property Listings',
  schemaType: 'RealEstateAgent',
  enquiryCta: 'Chat with us on WhatsApp',
  guardDomainLine:
    'Never invent amenities, carpet area, floor, facing, approvals, possession dates or a RERA number.',
  taglineFallback: 'Verified listings. Honest advice. Site visits that actually happen.',
}

const EDUCATION: IndustryVocabulary = {
  key: 'education',
  productNoun: 'course',
  productNounPlural: 'courses',
  typeLabel: 'Course format',
  collectionHeading: 'Courses & Programs',
  schemaType: 'EducationalOrganization',
  enquiryCta: 'Talk to admissions on WhatsApp',
  guardDomainLine:
    'Never invent course duration, fees, certifications, placement guarantees, faculty names or batch dates.',
  taglineFallback: 'Practical training, working mentors, and a portfolio you can show.',
}

const IMMIGRATION: IndustryVocabulary = {
  key: 'immigration',
  productNoun: 'service',
  productNounPlural: 'services',
  typeLabel: 'Service type',
  collectionHeading: 'Services & Programmes',
  schemaType: 'ProfessionalService',
  enquiryCta: 'Talk to a consultant on WhatsApp',
  guardDomainLine:
    'Never invent visa success rates, processing times, government approvals or guaranteed outcomes.',
  taglineFallback: 'Clear guidance, honest timelines, and paperwork done right.',
}

const GENERIC: IndustryVocabulary = {
  key: 'generic',
  productNoun: 'offering',
  productNounPlural: 'offerings',
  typeLabel: 'Type',
  collectionHeading: 'Our Offerings',
  schemaType: 'Organization',
  enquiryCta: 'Chat with us on WhatsApp',
  guardDomainLine:
    'Never invent features, specifications, prices, certifications, dates or guarantees.',
  taglineFallback: 'Quality work, clear pricing, and people who answer the phone.',
}

const MAP: Record<string, IndustryVocabulary> = {
  real_estate: REAL_ESTATE,
  realestate: REAL_ESTATE,
  property: REAL_ESTATE,
  education: EDUCATION,
  academy: EDUCATION,
  film: EDUCATION,
  training: EDUCATION,
  immigration: IMMIGRATION,
  visa: IMMIGRATION,
  generic: GENERIC,
  other: GENERIC,
  healthcare: GENERIC,
  retail: GENERIC,
  services: GENERIC,
}

export function industryVocabulary(industry?: string | null): IndustryVocabulary {
  const key = String(industry || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  // Never assume property sales: anything unrecognised (including NULL) gets the
  // neutral vocabulary, so an untagged tenant cannot inherit real-estate copy.
  return MAP[key] || GENERIC
}

/** Human label for the schema.org type, used in JSON-LD `@type`. */
export function schemaTypeFor(industry?: string | null): string {
  return industryVocabulary(industry).schemaType
}
