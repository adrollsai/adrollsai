/**
 * The qualification questions an account gets when it has not saved its own.
 *
 * WHY THIS MODULE EXISTS
 * The product was written for Indian real-estate brokerages, and the "no saved flow yet"
 * fallback was a property questionnaire. So a film academy's leads were asked "What type
 * of property are you interested in?" and offered "Under ₹50 Lacs" — reported from a live
 * client (Procolor, an education business).
 *
 * The fallback belongs to the BUSINESS, not to the product's origin story:
 *
 *   1. The account's own saved questions always win. This module is only reached when
 *      there are none.
 *   2. Failing that, a property business gets the property set — decided from its own
 *      industry, and from its name as a secondary signal.
 *   3. Everybody else gets a neutral set built from their own industry vocabulary, so an
 *      education account is asked about "courses" and a generic one about "offerings".
 *      It is never a property question.
 *
 * Deliberately free of database and network access: it is pure, so the voice and WhatsApp
 * paths and the dashboard can all agree by construction rather than by convention.
 */
import { industryVocabulary } from './industry'

export interface QualifyingQuestion {
  question: string
  options: string[]
}

/**
 * Is this business actually in the property business?
 *
 * Industry is the primary signal. The name is a deliberate secondary one because a
 * brokerages' `profiles.industry` is frequently null while the name says "Infra",
 * "Realty" or "Properties" — and asking a land developer "which course are you
 * interested in?" is the same class of mistake in the other direction.
 */
export function isPropertyBusiness(
  industry?: string | null,
  businessName?: string | null
): boolean {
  if (industryVocabulary(industry).key === 'real_estate') return true
  const haystack = `${industry || ''} ${businessName || ''}`.toLowerCase()
  return /propert|real.?estate|realt|infra|homes|realty|land|plot/.test(haystack)
}

export const REAL_ESTATE_QUALIFYING_QUESTIONS: QualifyingQuestion[] = [
  { question: 'What type of property are you interested in?', options: ['Residential', 'Commercial', 'Plots / Land'] },
  { question: 'What is your budget range?', options: ['Under ₹50 Lacs', '₹50L - ₹1.5 Cr', 'Above ₹1.5 Cr'] },
  { question: 'What is your purchase timeline?', options: ['Immediate (<1 Mo)', '1 - 3 Months', 'Exploring'] },
]

/** The universal set: true of any business that sells anything to anybody. */
export const GENERIC_QUALIFYING_QUESTIONS: QualifyingQuestion[] = [
  { question: 'What specific service or requirement are you looking for?', options: ['Standard Consultation', 'Enterprise Solution', 'Custom Inquiries'] },
  { question: 'What is your expected timeline for getting started?', options: ['Immediately (< 1 Month)', 'Within 1 - 3 Months', 'Currently Exploring'] },
  { question: 'What is your estimated budget or investment scale?', options: ['Flexible / Discuss on Call', 'Standard Scale', 'High Growth Scale'] },
]

/**
 * The neutral set, phrased with the account's own product word.
 *
 * Every option here is answerable by any business: what you want, when you want it, and
 * what you need to know first. Nothing names a vertical.
 */
export function neutralQualifyingQuestions(industry?: string | null): QualifyingQuestion[] {
  const vocab = industryVocabulary(industry)
  return [
    { question: `Which ${vocab.productNoun} are you interested in?`, options: [] },
    { question: 'When are you planning to start?', options: ['This month', '1 - 3 Months', 'Just exploring'] },
    { question: 'What would you like to know first?', options: ['Pricing', 'What is included', 'How it works'] },
  ]
}

/**
 * The questions to use when an account has saved none.
 *
 * `industry` and `businessName` are the account's own — never a default.
 */
export function defaultQualifyingQuestions(
  industry?: string | null,
  businessName?: string | null
): QualifyingQuestion[] {
  return isPropertyBusiness(industry, businessName)
    ? REAL_ESTATE_QUALIFYING_QUESTIONS
    : neutralQualifyingQuestions(industry)
}
