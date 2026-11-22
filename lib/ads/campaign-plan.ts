/**
 * The one place that decides what a launched campaign actually IS.
 *
 * WHY THIS FILE EXISTS
 * Before this, three things were decided in three different places and disagreed:
 *   - the ads modal collected a gender that was sent and then silently dropped;
 *   - the immediate lead-form fields were hardcoded to Name + Phone + Email, so every
 *     campaign paid for an email field nobody used and skipped the City that the
 *     CRM filters on;
 *   - the objective / optimisation goal was re-derived inline in
 *     `utils/campaign-processor.ts`, which meant "optimise for conversions" was a
 *     boolean that only ever reached one branch and no UI could expose the others.
 *
 * This module is PURE: rows and strings in, a plan out. No database, no network, so
 * every rule below is testable and the modal and the server can share exactly one
 * definition of "what the client picked".
 *
 * Used by:
 *   - app/dashboard/ads/page.tsx       (renders the goal picker and the field chips)
 *   - utils/campaign-processor.ts      (turns the plan into real Meta payloads)
 *   - app/api/meta-ads/launch-campaign (parses what the modal sent)
 */

// ---------------------------------------------------------------------------
// Lead-form fields
// ---------------------------------------------------------------------------

/**
 * The standard (Meta-provided) fields we let a client put on an instant form.
 *
 * `type` and `key` must be the exact Meta identifiers — a made-up key is rejected by
 * the Lead Ads API — while `label` is only what we show in OUR UI. Meta draws its own
 * label for standard fields, so "WhatsApp number" is really Meta's Phone number field:
 * it collects the mobile number with the country code, which is the number a WhatsApp
 * follow-up needs. We do not pretend otherwise to the client (see `metaLabel`).
 */
export interface LeadFormFieldDef {
  id: string;
  type: string;
  key: string;
  /** What we call it in the modal. */
  label: string;
  /** What Meta calls it on the form itself. */
  metaLabel: string;
  /** One line of help, shown under the chip row. */
  hint?: string;
}

export const LEAD_FORM_FIELDS: LeadFormFieldDef[] = [
  {
    id: 'FULL_NAME',
    type: 'FULL_NAME',
    key: 'full_name',
    label: 'Full Name',
    metaLabel: 'Full name',
  },
  {
    id: 'PHONE',
    type: 'PHONE',
    key: 'phone_number',
    label: 'WhatsApp Number',
    metaLabel: 'Phone number',
    hint: 'Meta calls this "Phone number"; it captures the mobile with country code, which is what the WhatsApp follow-up uses.',
  },
  {
    id: 'CITY',
    type: 'CITY',
    key: 'city',
    label: 'City',
    metaLabel: 'City',
  },
  {
    id: 'EMAIL',
    type: 'EMAIL',
    key: 'email',
    label: 'Email',
    metaLabel: 'Email',
  },
  {
    id: 'STATE',
    type: 'STATE',
    key: 'state',
    label: 'State',
    metaLabel: 'State',
  },
  {
    id: 'ZIP',
    type: 'ZIP',
    key: 'zip',
    label: 'Postal Code',
    metaLabel: 'Zip',
  },
  {
    id: 'COUNTRY',
    type: 'COUNTRY',
    key: 'country',
    label: 'Country',
    metaLabel: 'Country',
  },
  {
    id: 'COMPANY_NAME',
    type: 'COMPANY_NAME',
    key: 'company_name',
    label: 'Company',
    metaLabel: 'Company name',
  },
  {
    id: 'JOB_TITLE',
    type: 'JOB_TITLE',
    key: 'job_title',
    label: 'Job Title',
    metaLabel: 'Job title',
  },
  {
    id: 'DATE_TIME',
    type: 'DATE_TIME',
    key: 'date_time',
    label: 'Preferred Date & Time',
    metaLabel: 'Date / time',
  },
];

/**
 * What a campaign asks for unless the client changes it.
 *
 * Name + mobile + city, and deliberately NOT email: the email field is the single
 * biggest drop-off on an Indian instant form, and every downstream step in this app
 * (CRM, calling queue, WhatsApp journey) keys off the phone number and the city.
 */
export const DEFAULT_LEAD_FORM_FIELDS: string[] = ['FULL_NAME', 'PHONE', 'CITY'];

const FIELD_BY_ID = new Map(LEAD_FORM_FIELDS.map((f) => [f.id, f]));

export function leadFormField(id: string): LeadFormFieldDef | null {
  return FIELD_BY_ID.get(String(id || '').toUpperCase()) || null;
}

/**
 * Clean whatever the modal (or an old job payload) sent into a usable field list.
 *
 * Rules, and why each one is here:
 *   - unknown ids are dropped, because Meta rejects a question type it does not own
 *     and that failure happens AFTER the campaign shell is created;
 *   - duplicates are dropped, because Meta rejects the same standard field twice;
 *   - an empty result falls back to the defaults rather than shipping a form with no
 *     questions (Meta answers that with "Invalid parameter");
 *   - the list is capped, because a 15-field instant form never converts.
 */
export function normaliseLeadFormFields(input: unknown, max = 8): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const id = String((item as { id?: unknown } | null)?.id ?? item ?? '').trim().toUpperCase();
    if (!id || seen.has(id) || !FIELD_BY_ID.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out.length ? out : [...DEFAULT_LEAD_FORM_FIELDS];
}

/** The `questions` the Lead Ads API wants for the standard fields, in order. */
export function buildStandardQuestions(fieldIds: unknown): Array<{ type: string; key: string }> {
  return normaliseLeadFormFields(fieldIds).map((id) => {
    const def = FIELD_BY_ID.get(id)!;
    return { type: def.type, key: def.key };
  });
}

/** Human list for the form's own name: "Name, WhatsApp Number, City". */
export function describeLeadFormFields(fieldIds: unknown): string {
  return normaliseLeadFormFields(fieldIds)
    .map((id) => FIELD_BY_ID.get(id)?.label || id)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Campaign goal (objective + optimisation)
// ---------------------------------------------------------------------------

export type CampaignGoalId = 'leads' | 'quality_leads' | 'conversions' | 'whatsapp';

export const CAMPAIGN_GOALS: Array<{
  id: CampaignGoalId;
  label: string;
  blurb: string;
  /** Which destination it implies. */
  campaignType: 'instant_form' | 'website_conversion' | 'whatsapp_chat';
}> = [
  {
    id: 'leads',
    label: 'Leads',
    blurb: 'An instant form on Facebook. Meta finds people who fill it in.',
    campaignType: 'instant_form',
  },
  {
    id: 'quality_leads',
    label: 'High-intent leads',
    blurb: 'Same instant form, but Meta optimises for leads that qualify — fewer, better.',
    campaignType: 'instant_form',
  },
  {
    id: 'conversions',
    label: 'Conversions',
    blurb: 'Send traffic to your site and optimise for a real conversion event on your pixel.',
    campaignType: 'website_conversion',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp chats',
    blurb: 'The ad opens a WhatsApp conversation with your number.',
    campaignType: 'whatsapp_chat',
  },
];

/**
 * Conversion events Meta will optimise for on a website campaign.
 *
 * These are Meta's own `custom_event_type` values — a typo here is an API error, so
 * the list is closed and the server re-validates against it.
 */
export const CONVERSION_EVENTS: Array<{ value: string; label: string; hint?: string }> = [
  { value: 'LEAD', label: 'Lead', hint: 'Form submit, enquiry or callback request' },
  { value: 'COMPLETE_REGISTRATION', label: 'Complete registration', hint: 'Sign-up finished' },
  { value: 'CONTACT', label: 'Contact', hint: 'Phone, WhatsApp or email click' },
  { value: 'SCHEDULE', label: 'Schedule', hint: 'Site visit or appointment booked' },
  { value: 'SUBMIT_APPLICATION', label: 'Submit application', hint: 'Application sent' },
  { value: 'PURCHASE', label: 'Purchase', hint: 'Booking amount or payment' },
  { value: 'INITIATE_CHECKOUT', label: 'Initiate checkout', hint: 'Checkout started' },
  { value: 'ADD_TO_CART', label: 'Add to cart', hint: 'Shortlist / cart added' },
  { value: 'VIEW_CONTENT', label: 'View content', hint: 'Key page viewed' },
  { value: 'SUBSCRIBE', label: 'Subscribe', hint: 'Paid or trial subscription started' },
];

const CONVERSION_EVENT_VALUES = new Set(CONVERSION_EVENTS.map((e) => e.value));

export function normaliseConversionEvent(input: unknown): string {
  const value = String(input || '').trim().toUpperCase();
  return CONVERSION_EVENT_VALUES.has(value) ? value : 'LEAD';
}

export interface CampaignPlanInput {
  /** 'instant_form' | 'website_conversion' | 'whatsapp_chat' — the destination. */
  campaignType?: string | null;
  /** Optional explicit goal from the modal; when absent it is derived. */
  campaignGoal?: string | null;
  /** Meta custom_event_type for a website/conversions campaign. */
  conversionEvent?: string | null;
  /** Legacy switch: "optimise for high-quality leads" on an instant form. */
  optimizeForConversions?: boolean | null;
}

export interface CampaignPlan {
  goal: CampaignGoalId;
  /** Meta campaign objective. */
  objective: 'OUTCOME_LEADS' | 'OUTCOME_ENGAGEMENT';
  /** Meta ad-set destination. */
  destinationType: 'ON_AD' | 'WEBSITE' | 'WHATSAPP';
  /** Meta ad-set optimisation goal. */
  optimizationGoal: 'LEAD_GENERATION' | 'QUALITY_LEAD' | 'OFFSITE_CONVERSIONS' | 'REPLIES';
  /** Only set for a conversions campaign. */
  conversionEvent: string | null;
  /** True when the pipeline must create an instant lead form. */
  requiresLeadForm: boolean;
  /** True when the campaign cannot run without a pixel/dataset. */
  requiresPixel: boolean;
  /** True when the campaign cannot run without a connected WhatsApp number. */
  requiresWhatsAppNumber: boolean;
}

/**
 * Resolve the goal, the objective and the ad-set optimisation in one place.
 *
 * The destination always wins on objective — Meta will not accept a lead form on an
 * OUTCOME_ENGAGEMENT campaign — so an explicit goal can only refine the optimisation
 * inside the destination it belongs to. That is why `goal` is reconciled against
 * `campaignType` instead of blindly trusted: a stale modal, a replayed job payload or
 * a hand-made API call can never produce an impossible combination.
 */
export function resolveCampaignPlan(input: CampaignPlanInput): CampaignPlan {
  const campaignType = String(input.campaignType || 'instant_form').toLowerCase();
  const requested = String(input.campaignGoal || '').trim().toLowerCase() as CampaignGoalId;

  if (campaignType === 'whatsapp_chat' || requested === 'whatsapp') {
    return {
      goal: 'whatsapp',
      objective: 'OUTCOME_ENGAGEMENT',
      destinationType: 'WHATSAPP',
      optimizationGoal: 'REPLIES',
      conversionEvent: null,
      requiresLeadForm: false,
      requiresPixel: false,
      requiresWhatsAppNumber: true,
    };
  }

  if (campaignType === 'website_conversion' || requested === 'conversions') {
    return {
      goal: 'conversions',
      objective: 'OUTCOME_LEADS',
      destinationType: 'WEBSITE',
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      conversionEvent: normaliseConversionEvent(input.conversionEvent),
      requiresLeadForm: false,
      requiresPixel: true,
      requiresWhatsAppNumber: false,
    };
  }

  // Instant form: two optimisations live here, and they are the whole difference
  // between "as many leads as possible" and "fewer leads that actually qualify".
  const wantsQuality = requested === 'quality_leads' || input.optimizeForConversions === true;
  return {
    goal: wantsQuality ? 'quality_leads' : 'leads',
    objective: 'OUTCOME_LEADS',
    destinationType: 'ON_AD',
    optimizationGoal: wantsQuality ? 'QUALITY_LEAD' : 'LEAD_GENERATION',
    conversionEvent: null,
    requiresLeadForm: true,
    requiresPixel: false,
    requiresWhatsAppNumber: false,
  };
}

/** The goal id that matches a destination, for a modal that only knows the destination. */
export function goalForCampaignType(
  campaignType: string | null | undefined,
  optimizeForConversions?: boolean
): CampaignGoalId {
  return resolveCampaignPlan({ campaignType, optimizeForConversions }).goal;
}

// ---------------------------------------------------------------------------
// Gender
// ---------------------------------------------------------------------------

/**
 * Meta genders: 1 = male, 2 = female, and OMITTED for "all".
 *
 * This is here because the ads modal has always had a gender dropdown whose value was
 * sent to the server and then never applied — every campaign ran "all" while the client
 * believed they had chosen. A wrong answer is worse than no control, so the mapping
 * lives next to the rest of the plan and is applied by the processor.
 */
export function genderTargeting(value: unknown): number[] | null {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'male' || v === 'men' || v === 'm' || v === '1') return [1];
  if (v === 'female' || v === 'women' || v === 'f' || v === '2') return [2];
  return null; // "All" or anything unrecognised: no gender restriction
}
