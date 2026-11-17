/**
 * Is the paywall actually first, actually unskippable, and is the price on screen the price charged?
 *
 * The product rule: a new signup meets the paywall before anything else, cannot skip it, and buys one
 * of exactly two things — a ₹999 / 7-day / 1,000-credit trial (once per user), or the ₹9,999 / 1-month
 * / 5,000-credit plan. This gate pins all of that, because every part of it is a place where money or
 * entitlement can leak:
 *
 *   - a `paywall_skipped` flag that the layout counted as "paid" (it did);
 *   - a skip button that let a new signup into the product for free (it did);
 *   - THREE separate credit tables that disagreed with each other (they did: 2,500 / 10,000 / 25,000 /
 *     100,000 in RAZORPAY_PLANS, the PhonePe callback and the Razorpay verify fallback).
 *
 *   npx esbuild scripts/verify-paywall.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-paywall.mjs && node .tmp-paywall.mjs
 */
import fs from 'node:fs';
import { RAZORPAY_PLANS } from '../utils/razorpay';
import { decidePaywall, isPaywallExemptPath } from '../lib/entitlements';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const read = (p: string) => fs.readFileSync(p, 'utf8');
/**
 * Source with comments removed.
 *
 * Every "must not appear" assertion below is about CODE, and the fixes for these bugs left comments
 * that quote the old, wrong behaviour — so a naive substring test failed on the explanation rather
 * than on a regression. Stripping comments first is what makes these checks mean what they say.
 */
const codeOf = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const layoutRaw = read('app/dashboard/layout.tsx');
const onboardingRaw = read('app/dashboard/onboarding/page.tsx');
const completeRouteRaw = read('app/api/onboarding/complete/route.ts');
const verifyRouteRaw = read('app/api/payment/razorpay/verify/route.ts');
const callbackRouteRaw = read('app/api/payment/callback/route.ts');

const layout = codeOf(layoutRaw);
const onboarding = codeOf(onboardingRaw);
const completeRoute = codeOf(completeRouteRaw);
// Route files keep the explanation in comments; assertions that need the prose use the raw text.
const verifyRoute = codeOf(verifyRouteRaw);
const callbackRoute = codeOf(callbackRouteRaw);

// ─────────────────────────────────────────────────────────────────────────────
console.log('▸ the TWO products, and nothing else');
const trial = RAZORPAY_PLANS['trial'];
const monthly = RAZORPAY_PLANS['1-month'];

check('a ₹999 trial exists', trial?.basePrice === 999, `₹${trial?.basePrice}`);
check('the trial is 7 days', trial?.durationDays === 7, `${trial?.durationDays} days`);
check('the trial grants 1,000 credits', trial?.creditsIncluded === 1000, `${trial?.creditsIncluded} credits`);
check('the trial is once per user', trial?.oncePerUser === true);
check(
  'the 7-days-trial alias cannot drift from the trial',
  RAZORPAY_PLANS['7-days-trial']?.creditsIncluded === trial?.creditsIncluded &&
    RAZORPAY_PLANS['7-days-trial']?.durationDays === trial?.durationDays,
  `${RAZORPAY_PLANS['7-days-trial']?.creditsIncluded} credits / ${RAZORPAY_PLANS['7-days-trial']?.durationDays}d`,
);

check('the monthly plan is ₹9,999', monthly?.basePrice === 9999, `₹${monthly?.basePrice}`);
check('the monthly plan is one month', monthly?.durationMonths === 1, `${monthly?.durationMonths} month`);
check('the monthly plan grants 5,000 credits', monthly?.creditsIncluded === 5000, `${monthly?.creditsIncluded} credits`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ "recurring" appears nowhere a customer reads');
const customerFacing = Object.values(RAZORPAY_PLANS)
  .map((p) => `${p.title} ${p.description}`)
  .join(' ');
check('no plan title or description says "recurring"', !/recurring/i.test(customerFacing), customerFacing.slice(0, 120));
check(
  'the onboarding page never renders the word "recurring"',
  !/Recurring Payment|Subscribe Recurring|No auto-debit or recurring/i.test(onboarding),
  'the frequency switcher and its badges are gone',
);
check(
  'the plan is labelled plainly as "1 Month"',
  /Choose 1 Month \(₹9,999\)/.test(onboarding),
  'the button a customer clicks',
);

console.log('\n▸ ...but the renewal IS disclosed, once, in small print');
check(
  'a single small-print line states the monthly renewal',
  /renews every month at ₹9,999 until you cancel/i.test(onboarding),
  'Razorpay mandate rule and basic honesty',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ the paywall is FIRST and cannot be skipped');
check(
  'onboarding opens on the payment step',
  /useState<OnboardingStep>\('payment'\)/.test(onboarding),
  'not "profile"',
);
check(
  'the step order starts with payment',
  /\['payment', 'profile', 'integrations', 'templates'\]/.test(onboarding),
  'payment first',
);
check('the skip button is gone from the UI', !/Skip for now/i.test(onboarding));
check(
  'the client no longer writes a paywall-skip flag',
  !/paywall_skipped:\s*true/.test(onboarding),
  'the entitlement hole',
);
check(
  'the server ignores a skip request instead of honouring it',
  !/profileUpdates\.client_features\.paywall_skipped\s*=\s*true/.test(completeRoute) &&
    /IGNORED/.test(completeRoute),
  'any client could previously self-grant the product',
);
check(
  'the layout no longer reads paywall_skipped as paid',
  !/hasSkippedPaywall/.test(layout) && !/paywall_skipped/.test(layout),
  'the flag was treated as entitlement',
);

// Ordering, on CODE not comments: the unpaid redirect must be decided BEFORE the onboarding redirect,
// or an unpaid user is walked through setup and only then hits the wall.
const paywallIdx = layout.indexOf('const mustPay =');
const onboardingIdx = layout.indexOf('if (!onboardingCompleted && !isOnboardingPage && isAdminLike)');
check(
  'the paywall check is emitted before the onboarding check',
  paywallIdx > -1 && onboardingIdx > -1 && paywallIdx < onboardingIdx,
  `paywall@${paywallIdx} < onboarding@${onboardingIdx}`,
);
check(
  'an unpaid account is sent to the paywall step',
  /if \(!isPaid && isAdminLike && !isOnboardingPage && !isBillingPage && !isProfilePage\)/.test(layout) ||
    /mustPay && !isOnboardingPage && !isBillingPage && !isProfilePage/.test(layout),
  'billing and profile stay reachable; nothing else does',
);

// ── THE FAIL-OPEN BUG THE OWNER HIT ──────────────────────────────────────────────────────────────
// A brand-new signup was let into the dashboard and only met the paywall a moment later, because the
// check required `isAdminLike` — false whenever the profile row had not loaded yet — and the catch
// branch authorised the layout on any error. Both are fail-OPEN on a money gate.
console.log('\n▸ the paywall cannot fail open');
check(
  'the gate does not depend on a role being loaded',
  !/mustPay\s*=[^;\n]*isAdminLike/.test(layout) && !/!isPaid && isAdminLike/.test(layout),
  'a profile with no role yet used to slip through',
);
check(
  'the profile read is retried before it is judged',
  /for \(let attempt = 0; attempt < 6; attempt\+\+\)/.test(layout) && /maybeSingle\(\)/.test(layout),
  'a just-signed-up row may not exist for a moment',
);
check(
  'an unreadable profile is treated as unpaid, not as fine',
  /still unreadable after retries — treating as unpaid/.test(layout),
);
check(
  'an exception no longer authorises the dashboard',
  !/catch[\s\S]{0,400}?setIsAuthorized\(true\)/.test(layout),
  'the catch branch used to fail OPEN — the whole product on a network blip',
);
check(
  'the paywall redirect replaces history rather than pushing',
  /router\.replace\('\/dashboard\/onboarding'\)/.test(layout),
  'no back-button route into the dashboard',
);
check(
  'the layout still refuses to render until the check completes',
  /if \(!isAuthorized\) \{/.test(layout) && /Loader2/.test(layout),
  'children must not mount before the decision',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n▸ ONE source of truth for credits');
check('the PhonePe callback no longer carries its own credit table', !/creditsToAdd = 10000|creditsToAdd = 25000|creditsToAdd = 100000/.test(callbackRoute));
check(
  'the PhonePe callback reads RAZORPAY_PLANS',
  /RAZORPAY_PLANS\[planKey\]/.test(callbackRoute),
  'aliases map onto real plan ids',
);
check(
  'an unknown plan grants no credits rather than an invented number',
  /creditsToAdd = planConfig\?\.creditsIncluded \?\? 0/.test(callbackRoute),
);
check(
  'the Razorpay verify fallback no longer invents 2,500 / 10,000',
  !/isTrial \? 2500 : 10000/.test(verifyRoute),
  'a third table nobody priced',
);
check(
  'the trial fallback comes from the trial config',
  /RAZORPAY_PLANS\['trial'\]\.creditsIncluded/.test(verifyRoute),
);

// The monthly price must agree with the credits table the rest of the app reports.
const tiersSrc = read('lib/automation/credit-tiers.ts');
check(
  'the pricing table also says ₹9,999 buys 5,000 credits',
  /999_900[\s\S]{0,160}?monthlyCredits:\s*5_000/.test(tiersSrc),
  'the app and the payment gateway must not disagree',
);

// Only the two products are offered on the paywall.
check(
  'no 6-month or 12-month card is rendered',
  !/handlePurchasePlan\('6-months'\)/.test(onboarding) && !/handlePurchasePlan\('12-months'\)/.test(onboarding),
  'one plan plus the trial',
);
check(
  'their configs survive so existing renewals still resolve',
  Boolean(RAZORPAY_PLANS['6-months'] && RAZORPAY_PLANS['12-months']),
);

// Retired from SALE, not from honouring: 13 accounts are subscription_plan 'enterprise', which the
// PhonePe callback maps onto '12-months'. Deleting the config would make those renewals grant zero.
const billing = codeOf(read('app/dashboard/billing/page.tsx'));
check(
  'the billing picker no longer offers the 6 or 12 month plan',
  !/id: '6-months'/.test(billing) && !/id: '12-months'/.test(billing),
  'the last purchase surface',
);
check(
  'the billing picker still offers the 1 month plan',
  /id: '1-month'/.test(billing),
  'the plan that is for sale',
);
check(
  'the retirement is explained in the file, not silent',
  /retired from sale/i.test(read('app/dashboard/billing/page.tsx')),
);

// ---------------------------------------------------------------------------
// ONE paywall decision, made from one list, enforced on both sides
//
// The fail-open bug was a ROLE test: ['super_admin', ...].includes(role) is false when role is null, and
// null is exactly what a fresh signup has, so the gate waved through its newest and least-entitled
// account. These cases pin the decision itself, using the real function the layout and the middleware call.
// ---------------------------------------------------------------------------
console.log("\n▸ ONE paywall decision");

const freshSignup = decidePaywall({
  email: 'sbgrealestate7@gmail.com',
  role: null,
  parent_id: null,
  agency_id: null,
  subscription_status: null,
  subscription_valid_until: null,
});
check(
  'a brand-new signup must pay',
  freshSignup.mustPay === true && freshSignup.reason === 'unpaid',
  'role null, no parent, no subscription',
);
check(
  'the decision contains no role test',
  !/role/.test(decidePaywall.toString().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')),
  'a role test is what failed open on null',
);
check(
  'a missing profile must pay',
  decidePaywall(null).mustPay === true && decidePaywall(undefined).reason === 'no-profile',
  'a money gate may not be decided from data it failed to read',
);
check(
  'a paid status does not pay',
  decidePaywall({ email: 'a@b.com', role: 'client', subscription_status: 'active' }).mustPay === false,
);
check(
  'an expired subscription must pay again',
  decidePaywall({
    email: 'a@b.com',
    subscription_status: 'active',
    subscription_valid_until: '2020-01-01T00:00:00Z',
  }).mustPay === true,
  'an "active" row whose date has passed is not entitlement',
);
check(
  'a whitelisted account never pays',
  decidePaywall({ email: 'rchopra489@gmail.com', role: null, subscription_status: null }).mustPay === false,
);
check(
  'a team member is covered by the agency',
  decidePaywall({ email: 'x@y.com', parent_id: 'p1', subscription_status: null }).mustPay === false,
);
check(
  'onboarding, billing and profile are the only exempt routes',
  ['/dashboard/onboarding', '/dashboard/billing', '/dashboard/profile'].every(isPaywallExemptPath) &&
    !isPaywallExemptPath('/dashboard/crm') &&
    !isPaywallExemptPath('/dashboard/settings/billing'),
  'prefix matching, not substring matching',
);

// The gate must be enforced by the SERVER too, not only by a browser effect.
const middlewareSource = read('middleware.ts');
check(
  'the middleware enforces the paywall itself',
  /decidePaywall\(/.test(middlewareSource) && /isPaywallExemptPath\(/.test(middlewareSource),
  'a client-only paywall is a screen, not a boundary',
);
check(
  'the middleware redirects an unpaid account to onboarding',
  /decision\.mustPay[\s\S]{0,200}\/dashboard\/onboarding/.test(middlewareSource),
);
check(
  'a failed entitlement lookup does not bounce paying customers',
  /entitlement check skipped/.test(middlewareSource),
  'on a transient error the client gate decides instead',
);
check(
  'there is ONE whitelist',
  /WHITELISTED_EMAILS/.test(read('lib/entitlements.ts')) &&
    !/whitelistedEmails\s*=\s*\[/.test(read('app/dashboard/layout.tsx')),
  'it was copied in three files with three contents',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
