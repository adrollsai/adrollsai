/**
 * Proves the onboarding spine, WITHOUT a database or a browser.
 *
 * The spine's whole job is to answer one question honestly — "what is the single
 * next thing this business must do before the agent can work?" — so the gate is
 * about the ways that answer can go quietly wrong:
 *
 *   - it could trust `profiles.onboarding_completed` (a claim) instead of the data;
 *   - it could read a NULL credit balance as zero, or as "plenty";
 *   - it could let an unknown industry inherit PROPERTY wording, which is the bug
 *     the industry vocabulary exists to prevent;
 *   - it could ask for eight things at once, which is a form nobody finishes.
 *
 * Every case below is a worked example with a hand-written workspace.
 *
 *   npm run verify:onboarding
 */
import { industryVocabulary } from '../lib/automation/industry';
import {
  SPINE_STEPS,
  blockingSteps,
  describeStatus,
  evaluateSpine,
  nextQuestion,
  snapshotFromProfile,
  spineStepById,
  startBlocker,
  type SpineSnapshot,
} from '../lib/automation/onboarding-spine';

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

const section = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);

/** A workspace that is genuinely ready: every blocking step satisfied by data. */
function readyWorkspace(): SpineSnapshot {
  return {
    userId: 'user-1',
    ownerId: 'owner-1',
    businessName: 'Sharma Academy',
    businessInfo: 'We teach film editing to working professionals.',
    industry: 'education',
    contactNumber: '+91 98200 12345',
    whatsappPhoneNumber: '+91 98200 12345',
    logoUrl: 'https://cdn.example.com/logo.png',
    offeringsCount: 2,
    credits: 4_820,
    completedRuns: 1,
    onboardingCompletedFlag: true,
    welcomeCreditsGranted: true,
  };
}

/** A profile that has just signed up: nothing but an id. */
function emptyWorkspace(): SpineSnapshot {
  return snapshotFromProfile({ id: 'user-new', credits: 5_000 });
}

// ════════════════════════════════════════════════════════════════════════════
// 1. The spine itself
// ════════════════════════════════════════════════════════════════════════════

function checkShape() {
  section('1. The spine is one ordered list');

  check(
    'the spine is a single ordered list with unique ids',
    SPINE_STEPS.length >= 5 &&
      new Set(SPINE_STEPS.map((step) => step.id)).size === SPINE_STEPS.length &&
      SPINE_STEPS.every((step, index) => step.order === index + 1),
    SPINE_STEPS.map((step) => `${step.order}.${step.id}`).join(' '),
  );
  check(
    'every step says WHY the agent needs it, and where it is completed',
    SPINE_STEPS.every(
      (step) => step.title.length > 3 && step.why.length > 20 && step.href.startsWith('/dashboard'),
    ),
    `${SPINE_STEPS.length} steps, all with a reason and a route`,
  );
  check(
    'some steps block the agent and some are genuinely optional',
    blockingSteps().length >= 3 && blockingSteps().length < SPINE_STEPS.length,
    `${blockingSteps().length} blocking of ${SPINE_STEPS.length}`,
  );
  check(
    'the first run is the GOAL, not a prerequisite — it cannot block itself',
    spineStepById('first-run')?.blocking === false &&
      spineStepById('first-run')?.order === SPINE_STEPS.length,
    'last step, not blocking',
  );
  check(
    'a step id that does not exist is null, not a default',
    spineStepById('verify-pan-card' as never) === null,
    'null',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Readiness is recomputed from data
// ════════════════════════════════════════════════════════════════════════════

function checkReadiness() {
  section('2. Readiness comes from the data, not from the flag');

  const ready = evaluateSpine(readyWorkspace());
  check(
    'a fully set-up workspace is ready, with no blockers',
    ready.ready && ready.readiness === 'ready' && ready.blockers.length === 0 && ready.nextBlocking === null,
    ready.headline,
  );
  check(
    'a fully set-up workspace still reports the optional work left',
    ready.next === 'whatsapp' || ready.next === null,
    `next: ${ready.next ?? 'nothing'}`,
  );
  check(
    'progress counts every step, so optional work shows as progress',
    ready.completedCount === SPINE_STEPS.length && ready.percent === 100,
    `${ready.completedCount}/${ready.totalCount} (${ready.percent}%)`,
  );
  check(
    'a ready workspace produces no discrepancies',
    ready.discrepancies.length === 0,
    ready.discrepancies.join('; ') || 'none',
  );

  const fresh = evaluateSpine(emptyWorkspace());
  check(
    'a brand new workspace is not ready, and the blocker list is in spine order',
    !fresh.ready &&
      fresh.readiness === 'incomplete' &&
      fresh.blockers.length === 3 &&
      fresh.blockers.join(',') === 'business,offerings,contact',
    fresh.blockers.join(', '),
  );
  check(
    'a new workspace is told ONE next thing, not eight',
    fresh.next === 'business' && fresh.nextBlocking === 'business',
    `next ${fresh.next}`,
  );
  check(
    'the welcome credits alone do not make a workspace ready',
    fresh.steps.find((entry) => entry.step.id === 'budget')?.done === true && !fresh.ready,
    'credits done, four steps still open',
  );
  check(
    'the headline names the first blocker in the owner\'s words',
    /3 things to do/.test(fresh.headline) && /what your business is called/.test(fresh.headline),
    fresh.headline,
  );
  check(
    'the status line reads as progress plus the next step',
    /^\d+ of 9 done \(\d+%\) — next: /.test(describeStatus(fresh)),
    describeStatus(fresh),
  );

  // The flag is a claim, and it is cross-checked rather than believed.
  const lying = evaluateSpine({ ...readyWorkspace(), businessName: '', offeringsCount: 0 });
  check(
    'a flag that says "completed" over missing data is REPORTED, and the data wins',
    !lying.ready &&
      lying.discrepancies.some((entry) => /onboarding_completed is true but/.test(entry)) &&
      lying.blockers.includes('business') &&
      lying.blockers.includes('offerings'),
    lying.discrepancies[0]?.slice(0, 120) ?? 'no discrepancy reported',
  );
  const overlooked = evaluateSpine({ ...readyWorkspace(), onboardingCompletedFlag: false });
  check(
    'data that is complete under a false flag is reported the other way round',
    overlooked.ready && overlooked.discrepancies.some((entry) => /onboarding_completed is false/.test(entry)),
    overlooked.discrepancies[0]?.slice(0, 110) ?? 'no discrepancy reported',
  );
  check(
    'a null flag is not a discrepancy — it is simply unset',
    evaluateSpine({ ...readyWorkspace(), onboardingCompletedFlag: null }).discrepancies.length === 0,
    'no flag, no complaint',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Industry: unknown must never become real estate
// ════════════════════════════════════════════════════════════════════════════

function checkIndustry() {
  section('3. An unknown industry never inherits property wording');

  check(
    'no industry at all gives neutral wording, never property wording',
    industryVocabulary(null).key === 'generic' &&
      industryVocabulary(undefined).key === 'generic' &&
      industryVocabulary('').key === 'generic' &&
      /^Never invent features, specifications, prices/.test(industryVocabulary(null).guardDomainLine),
    industryVocabulary(null).schemaType,
  );
  check(
    'an unrecognised industry also gives neutral wording',
    industryVocabulary('marble-polishing').key === 'generic' &&
      industryVocabulary('MARBLE POLISHING').key === 'generic' &&
      industryVocabulary('property').key === 'real_estate',
    'only an explicit property value maps to property',
  );
  check(
    'the generic vocabulary does not mention property, carpet area or RERA',
    !/property|carpet|RERA|listing/i.test(industryVocabulary(null).guardDomainLine) &&
      !/listing/i.test(industryVocabulary(null).productNoun),
    industryVocabulary(null).guardDomainLine.slice(0, 80),
  );

  const noIndustry = evaluateSpine({ ...readyWorkspace(), industry: null });
  check(
    'no industry does NOT block the agent — neutral wording is a safe default',
    // Measured: a live read of 96 production profiles found 74 with no usable
    // industry. Blocking on the answer would stop most of the book from working in
    // order to obtain a nicer noun, while the thing that actually matters (never
    // property wording) is already guaranteed.
    noIndustry.ready &&
      !noIndustry.blockers.includes('industry') &&
      noIndustry.steps.some(
        (entry) => entry.step.id === 'industry' && entry.done === false && /neutral wording — never property wording/.test(entry.detail),
      ),
    noIndustry.steps.find((entry) => entry.step.id === 'industry')?.detail ?? 'no detail',
  );
  check(
    'a placeholder industry ("generic"/"other"/"general") is recorded as not answered',
    (() => {
      const placeholders = ['generic', 'other', 'general', 'none', 'unknown', '   '];
      return placeholders.every((value) => {
        const status = evaluateSpine({ ...readyWorkspace(), industry: value });
        const step = status.steps.find((entry) => entry.step.id === 'industry');
        // Not answered, but still not a blocker and still never property wording.
        return step?.done === false && status.ready && /neutral wording/.test(step.detail);
      });
    })(),
    'generic / other / general / none / unknown / blank are all "not answered"',
  );
  check(
    'an industry with no specific vocabulary is still an ANSWERED step',
    (() => {
      const clinic = evaluateSpine({ ...readyWorkspace(), industry: 'healthcare' });
      const detail = clinic.steps.find((entry) => entry.step.id === 'industry')?.detail ?? '';
      return !clinic.blockers.includes('industry') && /neutral wording/.test(detail) && /never property/.test(detail);
    })(),
    'healthcare: answered, neutral wording',
  );
  check(
    'the offering noun follows the industry, so the copy is not about properties',
    (() => {
      const school = evaluateSpine({ ...readyWorkspace(), industry: 'education', offeringsCount: 1 });
      const shop = evaluateSpine({ ...readyWorkspace(), industry: 'retail', offeringsCount: 3 });
      return (
        /1 course/.test(school.steps.find((entry) => entry.step.id === 'offerings')?.detail ?? '') &&
        /3 offerings/.test(shop.steps.find((entry) => entry.step.id === 'offerings')?.detail ?? '')
      );
    })(),
    'education -> course, retail -> offerings',
  );
  check(
    'a real-estate workspace is still served correctly',
    industryVocabulary('real_estate').key === 'real_estate' &&
      industryVocabulary('property').productNoun === 'listing',
    industryVocabulary('real_estate').schemaType,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Money and mid-spine states
// ════════════════════════════════════════════════════════════════════════════

function checkBudget() {
  section('4. Credits: unknown is not zero, and zero is not ready');

  check(
    'an unreadable balance is reported as unknown, never as zero',
    (() => {
      const status = evaluateSpine({ ...readyWorkspace(), credits: null });
      const detail = status.steps.find((entry) => entry.step.id === 'budget')?.detail ?? '';
      return !status.ready && status.blockers.includes('budget') && /could not be read/.test(detail);
    })(),
    'credits null -> "could not be read"',
  );
  check(
    'snapshotFromProfile keeps a NULL balance distinct from zero',
    snapshotFromProfile({ id: 'u', credits: null }).credits === null &&
      snapshotFromProfile({ id: 'u' }).credits === null &&
      snapshotFromProfile({ id: 'u', credits: 0 }).credits === 0,
    'null, missing, and 0 are three different things',
  );
  check(
    'a zero balance blocks the agent, and says so in credits',
    (() => {
      const status = evaluateSpine({ ...readyWorkspace(), credits: 0 });
      return !status.ready && status.blockers.includes('budget');
    })(),
    '0 credits is not enough for one step',
  );
  check(
    'the minimum a step needs can be raised by the caller',
    // 40 credits covers a cheap step, so the default minimum is satisfied…
    evaluateSpine({ ...readyWorkspace(), credits: 40 }).ready === true &&
      // …and a caller who knows the next step costs 50 says so.
      evaluateSpine({ ...readyWorkspace(), credits: 40 }, { minCredits: 50 }).blockers.join(',') === 'budget',
    '40 credits is enough by default, not enough for a 50-credit step',
  );
  check(
    'a negative wallet is flagged as money moving outside the hold model',
    evaluateSpine({ ...readyWorkspace(), credits: -30 }).discrepancies.some((entry) =>
      /negative/.test(entry),
    ),
    'negative balance',
  );
  check(
    'credits present while the welcome grant is not flagged is reported',
    evaluateSpine({ ...readyWorkspace(), welcomeCreditsGranted: false }).discrepancies.some((entry) =>
      /welcome_credits_granted/.test(entry),
    ),
    'grant flag missing',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. What the agent says, and what stops it
// ════════════════════════════════════════════════════════════════════════════

function checkVoice() {
  section('5. One question at a time');

  const fresh = evaluateSpine(emptyWorkspace());
  const question = nextQuestion(fresh);
  check(
    'the agent asks about the FIRST blocker only',
    question !== null && /What is your business called/.test(question) && !/credits/.test(question),
    question ?? 'no question',
  );
  check(
    'a ready workspace produces no question at all',
    nextQuestion(evaluateSpine(readyWorkspace())) === null,
    'null',
  );
  check(
    'each blocking step has its own question, in the owner\'s words',
    (() => {
      const questions = new Map<string, string | null>();
      for (const step of blockingSteps()) {
        // A workspace where ONLY this step is missing.
        const snapshot: SpineSnapshot = {
          ...readyWorkspace(),
          ...(step.id === 'account' ? { userId: null, ownerId: null } : {}),
          ...(step.id === 'business' ? { businessName: null } : {}),
          ...(step.id === 'industry' ? { industry: null } : {}),
          ...(step.id === 'offerings' ? { offeringsCount: 0 } : {}),
          ...(step.id === 'contact' ? { contactNumber: null, whatsappPhoneNumber: null } : {}),
          ...(step.id === 'budget' ? { credits: 0 } : {}),
        };
        const status = evaluateSpine(snapshot);
        questions.set(step.id, status.blockers.length === 1 ? nextQuestion(status) : `WRONG BLOCKERS: ${status.blockers}`);
      }
      return [...questions.entries()].every(
        ([id, text]) => typeof text === 'string' && text.length > 20 && !text.startsWith('WRONG'),
      );
    })(),
    [...blockingSteps().map((step) => step.id)].join(', '),
  );
  check(
    'startBlocker is null when the agent may go, and a sentence when it may not',
    startBlocker(readyWorkspace()) === null &&
      (startBlocker(emptyWorkspace()) ?? '').length > 20,
    startBlocker(emptyWorkspace())?.slice(0, 80) ?? 'null',
  );
  check(
    'startBlocker repeats exactly what the spine already decided',
    startBlocker(emptyWorkspace()) === nextQuestion(evaluateSpine(emptyWorkspace())),
    'no second opinion',
  );
  check(
    'asking for WhatsApp is opt-in, and only WhatsApp is affected',
    (() => {
      const optional = evaluateSpine({ ...readyWorkspace(), whatsappPhoneNumber: null, contactNumber: '+91 98200 12345' });
      const required = evaluateSpine(
        { ...readyWorkspace(), whatsappPhoneNumber: null, contactNumber: '+91 98200 12345' },
        { requireWhatsApp: true },
      );
      return (
        optional.ready &&
        !optional.blockers.includes('whatsapp') &&
        !required.ready &&
        required.blockers.join(',') === 'whatsapp'
      );
    })(),
    'content-only workspaces can run without WhatsApp',
  );
  check(
    'a phone number on EITHER field satisfies the contact step',
    evaluateSpine({ ...readyWorkspace(), whatsappPhoneNumber: null }).ready &&
      evaluateSpine({ ...readyWorkspace(), contactNumber: null }).ready,
    'contact_number or whatsapp_phone_number',
  );
  check(
    'a two-character "phone number" does not count',
    !evaluateSpine({ ...readyWorkspace(), contactNumber: '12', whatsappPhoneNumber: null }).ready,
    'too short to dial',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. The profile mapper reads the real columns
// ════════════════════════════════════════════════════════════════════════════

function checkMapper() {
  section('6. The mapper reads the columns that exist');

  // The exact columns app/api/onboarding/complete/route.ts selects and writes.
  const row = {
    id: 'user-9',
    business_name: 'Sharma Academy',
    business_info: 'Film editing for professionals',
    contact_number: '+91 98200 12345',
    whatsapp_phone_number: '+91 98200 12345',
    logo_url: 'https://cdn.example.com/logo.png',
    custom_domain: 'sharmaacademy.in',
    industry: 'education',
    credits: 4_820,
    onboarding_completed: true,
    client_features: { welcome_credits_granted: true },
  };
  const snapshot = snapshotFromProfile(row);
  check(
    'a real profiles row maps onto the snapshot field for field',
    snapshot.userId === 'user-9' &&
      snapshot.businessName === 'Sharma Academy' &&
      snapshot.businessInfo === 'Film editing for professionals' &&
      snapshot.contactNumber === '+91 98200 12345' &&
      snapshot.whatsappPhoneNumber === '+91 98200 12345' &&
      snapshot.logoUrl === 'https://cdn.example.com/logo.png' &&
      snapshot.customDomain === 'sharmaacademy.in' &&
      snapshot.industry === 'education' &&
      snapshot.credits === 4_820 &&
      snapshot.onboardingCompletedFlag === true &&
      snapshot.welcomeCreditsGranted === true,
    `${snapshot.businessName} / ${snapshot.industry} / ${snapshot.credits} credits`,
  );
  check(
    'a profiles row alone is not enough: the offering count comes from another table',
    evaluateSpine(snapshot).ready === false && evaluateSpine(snapshot).blockers.join(',') === 'offerings',
    // offerings_count is not a profiles column, so the caller supplies it. Its
    // absence here proves the spine cannot be satisfied by the profile row alone.
    'offerings still open',
  );
  check(
    'client_features that is missing or not an object does not throw',
    snapshotFromProfile({ id: 'u' }).welcomeCreditsGranted === false &&
      snapshotFromProfile({ id: 'u', client_features: 'not-an-object' }).welcomeCreditsGranted === false &&
      snapshotFromProfile({ id: 'u', client_features: null }).welcomeCreditsGranted === false,
    'tolerant of a stale column',
  );
  check(
    'an empty row maps to an empty snapshot rather than throwing',
    (() => {
      const empty = snapshotFromProfile({});
      return (
        empty.businessName === null &&
        empty.industry === null &&
        empty.credits === null &&
        empty.offeringsCount === 0 &&
        empty.onboardingCompletedFlag === null
      );
    })(),
    'no row, no crash',
  );
  check(
    'snapshotFromProfile({}) is treated as a brand new workspace',
    evaluateSpine(snapshotFromProfile({})).blockers.length >= 4,
    evaluateSpine(snapshotFromProfile({})).blockers.join(', '),
  );
  check(
    'the workspace owner the caller resolved wins; a solo owner falls back to the id',
    snapshotFromProfile({ id: 'staff-1', owner_id: 'owner-1' }).ownerId === 'owner-1' &&
      snapshotFromProfile({ id: 'solo-1' }).ownerId === 'solo-1',
    'owner_id is a caller-supplied override, not a profiles column',
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────────

checkShape();
checkReadiness();
checkIndustry();
checkBudget();
checkVoice();
checkMapper();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
