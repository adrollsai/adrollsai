/**
 * The onboarding spine: the one ordered path from "signed up" to "the agent can go
 * to work", and the answer to "what is the single next thing to do?".
 *
 * THE PROBLEM
 * Onboarding was a 32 KB route plus a 114 KB page that each knew their own idea of
 * what a finished workspace looks like. Two consequences, both real:
 *
 *   1. Nothing could answer "is this business ready?" without loading the page. The
 *      agent itself had no way to know, so a run could start against a workspace
 *      with no business name, no offerings and no credits, and fail somewhere deep
 *      with a vendor error instead of asking for the one missing thing.
 *   2. `profiles.onboarding_completed` is a flag, and a flag is a claim. A row can
 *      say `true` while the business name is empty — the wizard was completed, then
 *      the data was edited, or an older client wrote the flag early.
 *
 * SO: readiness is RECOMPUTED FROM THE DATA, every time. The flag is read only to
 * be cross-checked, and a flag that disagrees with the data is reported as a
 * discrepancy rather than believed. That is what makes this a spine and not another
 * wizard step counter.
 *
 * WHAT IT IS NOT
 *   - It is not a UI. It names each step's dashboard route; the pages render whatever
 *     this says.
 *   - It is not a readiness gate that refuses work. `blockers` is what the agent
 *     should ASK for, in words an owner can act on — the platform's rule is to ask
 *     before spending, not to hard-fail into a blank screen.
 *   - It touches no database. `snapshotFromProfile` is a mapper; a caller reads the
 *     row.
 *
 * PURE: no I/O, no clock, no network.
 */

import { industryVocabulary } from './industry';

export type SpineStepId =
  | 'account'
  | 'business'
  | 'industry'
  | 'offerings'
  | 'contact'
  | 'whatsapp'
  | 'brand'
  | 'budget'
  | 'first-run';

export interface SpineStep {
  id: SpineStepId;
  /** Position in the spine. The first unfinished BLOCKING step is `next`. */
  order: number;
  /** What the owner sees, in their words. */
  title: string;
  /** Why the agent needs it. Shown under the title. */
  why: string;
  /** True when the agent cannot do useful work without it. */
  blocking: boolean;
  /** The dashboard route that completes it. */
  href: string;
}

/**
 * The spine, in order.
 *
 * Deliberately short. Every step here is something the agent genuinely needs; brand
 * assets and a WhatsApp connection are genuinely optional for a first run, and a
 * first run is a milestone rather than a prerequisite, so they are not blocking.
 */
export const SPINE_STEPS: readonly SpineStep[] = [
  {
    id: 'account',
    order: 1,
    title: 'Your workspace',
    why: 'Every credit, lead and campaign belongs to one owner, so there has to be an account to own them.',
    blocking: true,
    href: '/dashboard',
  },
  {
    id: 'business',
    order: 2,
    title: 'What your business is called',
    why: 'Everything we write carries your name, so we will not write anything until we have it.',
    blocking: true,
    href: '/dashboard/profile',
  },
  {
    id: 'industry',
    order: 3,
    title: 'What kind of business you run',
    why: 'It decides the words and what we must never invent. Without it we describe you as a general business — never as a property dealer — so this is worth answering but does not stop us working.',
    // NOT blocking, and that is a measured decision, not a soft one: a live read of
    // 96 production profiles found 74 with no usable industry. The vocabulary already
    // guarantees the thing that actually matters — an unknown industry gets neutral
    // wording and NEVER property wording — so blocking on the answer would stop three
    // quarters of the book from working in order to obtain a nicer noun.
    blocking: false,
    href: '/dashboard/profile',
  },
  {
    id: 'offerings',
    order: 4,
    title: 'At least one thing you sell',
    why: 'A post needs something to be about. One real offering is enough for the first run.',
    blocking: true,
    href: '/dashboard/profile',
  },
  {
    id: 'contact',
    order: 5,
    title: 'A phone number customers can reach',
    why: 'Leads are only worth capturing if somebody answers. This is the number we send them to.',
    blocking: true,
    href: '/dashboard/profile',
  },
  {
    id: 'whatsapp',
    order: 6,
    title: 'WhatsApp connected',
    why: 'Where the conversations actually happen. Without it we can still make content, but nobody can reply.',
    blocking: false,
    href: '/dashboard/settings',
  },
  {
    id: 'brand',
    order: 7,
    title: 'Your logo and colours',
    why: 'Makes everything look like you rather than like us. We use a neutral palette until you add them.',
    blocking: false,
    href: '/dashboard/profile',
  },
  {
    id: 'budget',
    order: 8,
    title: 'Credits to spend',
    why: 'We ask before we spend, so the work stops at the first step it cannot pay for. Credits are what it is paid with.',
    blocking: true,
    href: '/dashboard/billing',
  },
  {
    id: 'first-run',
    order: 9,
    title: 'Your first piece of work',
    why: 'The point of the spine. Once this is done you have seen the agent deliver something real.',
    blocking: false,
    href: '/dashboard',
  },
];

export function spineStepById(id: SpineStepId): SpineStep | null {
  return SPINE_STEPS.find((step) => step.id === id) ?? null;
}

/** Steps that must be finished before the agent can be useful, in order. */
export function blockingSteps(): SpineStep[] {
  return SPINE_STEPS.filter((step) => step.blocking);
}

// ────────────────────────────────────────────────────────────────────────────
// The snapshot: what we actually know about a workspace
// ────────────────────────────────────────────────────────────────────────────

/**
 * A workspace, as far as the spine needs to know it.
 *
 * Field names follow `profiles` where a column exists (`business_name`,
 * `business_info`, `contact_number`, `whatsapp_phone_number`, `logo_url`,
 * `industry`, `credits`), because a mapper that renames things is a mapper that
 * silently reads undefined.
 */
export interface SpineSnapshot {
  userId?: string | null;
  /**
   * Who owns the workspace and the wallet.
   *
   * There is no `profiles.owner_id` column: a team member's owner is resolved from
   * `parent_id` / `agency_id` by `billing.resolveBillingOwner`, and the caller
   * passes the answer in. Falling back to `id` (a solo owner) is the mapper's job,
   * not a guess about the schema.
   */
  ownerId?: string | null;
  businessName?: string | null;
  /** `profiles.business_info` — what the business does, in its own words. */
  businessInfo?: string | null;
  industry?: string | null;
  /** `profiles.contact_number`. */
  contactNumber?: string | null;
  /** `profiles.whatsapp_phone_number`. */
  whatsappPhoneNumber?: string | null;
  logoUrl?: string | null;
  /** `profiles.custom_domain`, if they have a site. */
  customDomain?: string | null;
  /** How many offerings (products / properties / projects) they have. */
  offeringsCount?: number;
  /** `profiles.credits`. Null means "we could not read it", which is not zero. */
  credits?: number | null;
  /** Runs that finished successfully. */
  completedRuns?: number;
  /** `profiles.onboarding_completed` — the FLAG. Cross-checked, never trusted. */
  onboardingCompletedFlag?: boolean | null;
  /** `client_features.welcome_credits_granted` — has the welcome grant landed? */
  welcomeCreditsGranted?: boolean | null;
}

/** A `profiles` row (or a partial one) as a snapshot. Tolerant of missing columns. */
export function snapshotFromProfile(row: Record<string, any> | null | undefined): SpineSnapshot {
  const profile = row ?? {};
  const features =
    profile.client_features && typeof profile.client_features === 'object' ? profile.client_features : {};
  const credits = profile.credits;
  return {
    userId: profile.id ?? profile.user_id ?? null,
    ownerId: profile.owner_id ?? profile.id ?? null,
    businessName: profile.business_name ?? null,
    businessInfo: profile.business_info ?? null,
    industry: profile.industry ?? null,
    contactNumber: profile.contact_number ?? null,
    whatsappPhoneNumber: profile.whatsapp_phone_number ?? null,
    logoUrl: profile.logo_url ?? null,
    customDomain: profile.custom_domain ?? null,
    offeringsCount: Number(profile.offerings_count ?? profile.properties_count ?? 0) || 0,
    // `Number(null)` is 0, which would silently read as "no credits" instead of
    // "unknown". The distinction matters: unknown must not be reported as empty.
    credits:
      credits === null || credits === undefined ? null : Number.isFinite(Number(credits)) ? Number(credits) : null,
    completedRuns: Number(profile.completed_runs ?? 0) || 0,
    onboardingCompletedFlag:
      profile.onboarding_completed === null || profile.onboarding_completed === undefined
        ? null
        : Boolean(profile.onboarding_completed),
    welcomeCreditsGranted: features.welcome_credits_granted === true,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Evaluation
// ────────────────────────────────────────────────────────────────────────────

const TEXT_MIN = 2;

/** True when a value is a non-empty string of at least `TEXT_MIN` characters. */
function filled(value: unknown, min = TEXT_MIN): boolean {
  return typeof value === 'string' && value.trim().length >= min;
}

export interface SpineStepState {
  step: SpineStep;
  done: boolean;
  /** Why it counts as done, or what exactly is missing. */
  detail: string;
}

export type Readiness =
  /** Every blocking step is done: the agent can go to work. */
  | 'ready'
  /** Something blocking is outstanding. `next` names it. */
  | 'incomplete';

export interface SpineStatus {
  steps: SpineStepState[];
  completedCount: number;
  totalCount: number;
  /** The first unfinished step in spine order, blocking or not. */
  next: SpineStepId | null;
  /** The first unfinished BLOCKING step — what the agent must ask for. */
  nextBlocking: SpineStepId | null;
  ready: boolean;
  readiness: Readiness;
  blockers: SpineStepId[];
  /** 0-100, over ALL steps, so an owner sees progress. */
  percent: number;
  /** One line for a dashboard header. */
  headline: string;
  /** Things that look wrong and are worth a human's attention. */
  discrepancies: string[];
}

/**
 * Where this workspace is on the spine.
 *
 * Reads the data, not the flag. `options.requireWhatsApp` exists because a workspace
 * sold on WhatsApp-first lead capture genuinely cannot operate without it, while one
 * that only makes content can.
 */
export function evaluateSpine(
  snapshot: SpineSnapshot,
  options: { requireWhatsApp?: boolean; minCredits?: number } = {},
): SpineStatus {
  const minCredits = Math.max(1, Number(options.minCredits ?? 1) || 1);
  const vocabulary = industryVocabulary(snapshot.industry);
  // Two different questions, deliberately kept apart:
  //   hasIndustry       — did somebody actually TELL us what they do? 'generic',
  //                       'other' and 'general' are the absence of an answer, not an
  //                       answer. 'general' is in that list because it is what the
  //                       landing-page generator defaults to, so production is full of
  //                       it and it means nothing.
  //   specificVocabulary — does that answer have its own words and guard rules?
  // A clinic says "healthcare", which has no specific vocabulary yet: that is an
  // ANSWERED step with neutral wording, not a missing one.
  const industryText = filled(snapshot.industry, 1) ? String(snapshot.industry).trim().toLowerCase() : '';
  const PLACEHOLDER_INDUSTRIES = ['generic', 'other', 'general', 'none', 'unknown'];
  const hasIndustry = industryText !== '' && !PLACEHOLDER_INDUSTRIES.includes(industryText);
  const specificVocabulary = vocabulary.key !== 'generic';
  const industryKnown = hasIndustry;
  const discrepancies: string[] = [];

  const state = (id: SpineStepId, done: boolean, detail: string): SpineStepState => ({
    step: spineStepById(id) as SpineStep,
    done,
    detail,
  });

  const hasWorkspace = filled(snapshot.userId, 1) || filled(snapshot.ownerId, 1);
  const hasName = filled(snapshot.businessName);
  const hasOfferings = (Number(snapshot.offeringsCount) || 0) > 0;
  const hasPhone = filled(snapshot.contactNumber, 6) || filled(snapshot.whatsappPhoneNumber, 6);
  const hasWhatsApp = filled(snapshot.whatsappPhoneNumber, 6);
  const hasBrand = filled(snapshot.logoUrl, 4);
  const creditsKnown = snapshot.credits !== null && snapshot.credits !== undefined;
  const hasCredits = creditsKnown && Number(snapshot.credits) >= minCredits;

  const steps: SpineStepState[] = [
    state('account', hasWorkspace, hasWorkspace ? 'workspace found' : 'no workspace id on this profile'),
    state('business', hasName, hasName ? `"${String(snapshot.businessName).trim()}"` : 'the business name is empty'),
    state(
      'industry',
      industryKnown,
      industryKnown && specificVocabulary
        ? `${vocabulary.key} (${vocabulary.productNoun})`
        : industryKnown
          ? `"${industryText}" has no specific vocabulary yet, so neutral wording is used — never property wording`
          : 'no industry set, so we use neutral wording — never property wording',
    ),
    state(
      'offerings',
      hasOfferings,
      hasOfferings
        ? `${snapshot.offeringsCount} ${Number(snapshot.offeringsCount) === 1 ? vocabulary.productNoun : vocabulary.productNounPlural}`
        : `no ${vocabulary.productNoun} yet`,
    ),
    state('contact', hasPhone, hasPhone ? String(snapshot.contactNumber || snapshot.whatsappPhoneNumber).trim() : 'no phone number'),
    state(
      'whatsapp',
      hasWhatsApp,
      hasWhatsApp ? 'connected' : 'not connected — content still works, replies do not',
    ),
    state('brand', hasBrand, hasBrand ? 'logo on file' : 'no logo — a neutral palette is used'),
    state(
      'budget',
      hasCredits,
      hasCredits
        ? `${snapshot.credits} credits`
        : creditsKnown
          ? `${snapshot.credits} credits, which is below the ${minCredits} a single step needs`
          : 'credits could not be read',
    ),
    state(
      'first-run',
      (Number(snapshot.completedRuns) || 0) > 0,
      (Number(snapshot.completedRuns) || 0) > 0
        ? `${snapshot.completedRuns} finished run(s)`
        : 'nothing has finished yet',
    ),
  ];

  // The flag is a claim. Check it against the data instead of believing it.
  const blockingIds = SPINE_STEPS.filter(
    (step) => step.blocking || (options.requireWhatsApp === true && step.id === 'whatsapp'),
  ).map((step) => step.id);
  const blockers = steps
    .filter((entry) => blockingIds.includes(entry.step.id) && !entry.done)
    .map((entry) => entry.step.id);
  const ready = blockers.length === 0;

  if (snapshot.onboardingCompletedFlag === true && !ready) {
    discrepancies.push(
      `profiles.onboarding_completed is true but ${blockers.length} required step(s) are still missing ` +
        `(${blockers.join(', ')}). The flag was written by a wizard, the data says otherwise — trust the data.`,
    );
  }
  if (snapshot.onboardingCompletedFlag === false && ready) {
    discrepancies.push(
      'the data says every required step is done but profiles.onboarding_completed is false. ' +
        'The flag was never set; set it from this evaluation rather than making the owner redo the wizard.',
    );
  }
  if (snapshot.welcomeCreditsGranted === false && creditsKnown && Number(snapshot.credits) > 0) {
    discrepancies.push(
      `there are ${snapshot.credits} credits but client_features.welcome_credits_granted is not set. ` +
        'Either the grant did not go through the one grant path, or the flag was never written — ' +
        'both are worth checking before the next grant runs.',
    );
  }
  if (snapshot.credits !== null && snapshot.credits !== undefined && Number(snapshot.credits) < 0) {
    discrepancies.push(
      `the wallet is negative (${snapshot.credits} credits). A hold can never charge more than it reserved, ` +
        'so this means money moved outside the hold model.',
    );
  }

  const completedCount = steps.filter((entry) => entry.done).length;
  const totalCount = steps.length;
  const nextState = steps.find((entry) => !entry.done) ?? null;
  const nextBlockingState = steps.find((entry) => blockingIds.includes(entry.step.id) && !entry.done) ?? null;
  const percent = Math.round((100 * completedCount) / totalCount);

  const headline = ready
    ? completedCount === totalCount
      ? 'Everything is set up and the agent has delivered its first work.'
      : 'The agent can go to work. The rest is optional polish.'
    : `${blockers.length} thing${blockers.length === 1 ? '' : 's'} to do before the agent can start: ` +
      `${spineStepById(blockers[0])?.title.toLowerCase() ?? blockers[0]}`;

  return {
    steps,
    completedCount,
    totalCount,
    next: nextState ? nextState.step.id : null,
    nextBlocking: nextBlockingState ? nextBlockingState.step.id : null,
    ready,
    readiness: ready ? 'ready' : 'incomplete',
    blockers,
    percent,
    headline,
    discrepancies,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// What to say
// ────────────────────────────────────────────────────────────────────────────

/**
 * The question the agent asks, in the owner's words.
 *
 * One question at a time, about the FIRST blocker only. A wall of eight missing
 * fields is how a welcome screen becomes a form nobody finishes.
 */
export function nextQuestion(status: SpineStatus): string | null {
  const id = status.nextBlocking;
  if (!id) return null;
  switch (id) {
    case 'account':
      return 'I need a workspace to work in before I can start. Sign in and I will set one up.';
    case 'business':
      return 'What is your business called? Everything I write will carry that name.';
    case 'industry':
      return 'What kind of business do you run — for example a coaching institute, a clinic, a store, a service? ' +
        'It changes the words I use and the things I must never make up.';
    case 'offerings':
      return 'Tell me one thing you sell — a course, a service, a product. One is enough for me to start.';
    case 'contact':
      return 'Which phone number should I send customer enquiries to? Somebody has to answer it.';
    case 'budget':
      return 'I need credits before I can produce anything, because I stop at the first step I cannot pay for. ' +
        'Pick a plan and I will show you exactly what it buys.';
    default:
      return null;
  }
}

/** A line an owner can read: `3 of 9 done — next: what your business is called`. */
export function describeStatus(status: SpineStatus): string {
  const nextStep = status.next ? spineStepById(status.next) : null;
  const base = `${status.completedCount} of ${status.totalCount} done (${status.percent}%)`;
  if (!nextStep) return `${base} — everything is set up`;
  return `${base} — next: ${nextStep.title.toLowerCase()}${status.ready ? ' (optional)' : ''}`;
}

/**
 * Everything the agent should NOT start without, in one line, for a log.
 *
 * `null` means go. A non-null string is the reason a run was not started, phrased
 * so it can be shown to the owner unchanged.
 */
export function startBlocker(snapshot: SpineSnapshot, options: { requireWhatsApp?: boolean } = {}): string | null {
  const status = evaluateSpine(snapshot, options);
  const question = nextQuestion(status);
  if (!question) return null;
  return question;
}
