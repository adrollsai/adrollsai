/**
 * The plan table: what a rupee buys, in credits.
 *
 * WHY THIS FILE EXISTS
 * Before it, the price of a plan and the cost of a feature lived in different
 * places and nothing checked that they agreed. `CREDIT_COSTS` (utils/credits.ts)
 * says an image costs 10 credits and 15 s of video costs 50; a plan says it grants
 * 5,000 credits a month. Only when you put those two numbers side by side does
 * "5,000 credits" become a promise a customer can hold you to — 500 images, or
 * 1,500 seconds of video, or 1,000 call minutes. So this module owns the plan
 * table AND the translation from credits into what they actually buy, and
 * `tierTableProblems()` makes a bad edit to the table fail a gate rather than
 * quietly sell credits below cost.
 *
 * NOTHING HERE MOVES MONEY. The one place a purchase becomes credits is
 * `grantTierOnce` in `credit-grants.ts`, which wraps
 * `billing.grantCreditsOnce` so a retried Razorpay callback cannot pay twice.
 * This file is pure: no I/O, no clock, no network.
 *
 * THE DECISION THIS ENCODES (final, from the platform brief)
 *   ₹9,999 buys 5,000 credits. Everything else is priced around that.
 */

import { CREDIT_COSTS } from '@/utils/credits';

/** Razorpay works in paise, so the table does too — no float rupees anywhere. */
export const PAISE_PER_RUPEE = 100;

export interface CreditTier {
  /** Stable id. Appears in idempotency keys, so it must never be renamed. */
  id: string;
  /** What the pricing card calls it. */
  label: string;
  /** Price per month, in paise, GST-inclusive. */
  pricePaise: number;
  /** Credits granted per month at that price. Integers only. */
  monthlyCredits: number;
  /** The one we point at. Exactly one tier may be recommended. */
  recommended: boolean;
  /** One line for the card, written for an Indian SMB owner. */
  blurb: string;
}

/**
 * The table.
 *
 * Three paid plans, and the rate IMPROVES as the price rises: ₹5.00 → ₹3.33 →
 * ₹2.50 per credit. A larger plan that cost more per credit would be a pricing
 * bug, and `tierTableProblems()` refuses one.
 *
 * Deliberately absent: a free tier. The free experience is the 7-day trial grant
 * (`category: 'trial'`), which is a one-off idempotent credit, not a plan.
 */
export const CREDIT_TIERS: readonly CreditTier[] = [
  {
    id: 'starter',
    label: 'Starter',
    pricePaise: 499_900, // ₹4,999 → 1,500 credits, ₹3.33 per credit
    monthlyCredits: 1_500,
    recommended: false,
    blurb: 'Enough for a month of posts and a few short videos.',
  },
  {
    id: 'growth',
    label: 'Growth',
    pricePaise: 999_900, // ₹9,999 → 5,000 credits, ₹2.00 per credit — the decision
    monthlyCredits: 5_000,
    recommended: true,
    blurb: 'The plan we recommend: daily content, a weekly film, and calls.',
  },
  {
    id: 'scale',
    label: 'Scale',
    pricePaise: 2_499_900, // ₹24,999 → 15,000 credits, ₹1.67 per credit
    monthlyCredits: 15_000,
    recommended: false,
    blurb: 'For a team running campaigns across several locations.',
  },
];

/** The tier the pricing page points at. */
export const RECOMMENDED_TIER_ID = 'growth';

/** Look a tier up by id. Returns null rather than guessing a default. */
export function tierById(id: string): CreditTier | null {
  return CREDIT_TIERS.find((tier) => tier.id === String(id)) ?? null;
}

/** Every tier id, in table order. */
export function tierIds(): string[] {
  return CREDIT_TIERS.map((tier) => tier.id);
}

// ────────────────────────────────────────────────────────────────────────────
// Money
// ────────────────────────────────────────────────────────────────────────────

/** Rupees from paise, exactly: `999900 -> 9999`. */
export function rupeesFromPaise(paise: number): number {
  return Math.round(Number(paise) || 0) / PAISE_PER_RUPEE;
}

/** `999900 -> "₹9,999"`. Indian grouping (last three, then pairs), paise only when present. */
export function formatInr(paise: number): string {
  const amount = Number(paise) || 0;
  const whole = Math.trunc(amount / PAISE_PER_RUPEE);
  const minor = Math.abs(Math.round(amount % PAISE_PER_RUPEE));
  const sign = whole < 0 ? '-' : '';
  const grouped = groupIndian(String(Math.abs(whole)));
  return minor === 0 ? `₹${sign}${grouped}` : `₹${sign}${grouped}.${String(minor).padStart(2, '0')}`;
}

/**
 * Indian digit grouping: the last three digits, then pairs.
 *
 * `9999 -> 9,999`, `100000 -> 1,00,000`, `2499900 -> 24,99,900`. Western grouping
 * (`100,000`) reads as a different number to the person paying.
 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/**
 * What one credit costs, in paise, at a given tier.
 *
 * Rounded UP to the nearest paise: never quote a price that is cheaper than the
 * table says.
 */
export function paisePerCredit(tier: CreditTier): number {
  if (!tier.monthlyCredits) return 0;
  return Math.ceil(tier.pricePaise / tier.monthlyCredits);
}

/** The effective cost of 1,000 credits, which is how owners compare plans. */
export function paisePerThousandCredits(tier: CreditTier): number {
  return paisePerCredit(tier) * 1000;
}

// ────────────────────────────────────────────────────────────────────────────
// What the credits actually buy
// ────────────────────────────────────────────────────────────────────────────

/**
 * The unit prices, read from the ONE place that defines them.
 *
 * `CREDIT_COSTS` is the source of truth; this is a view of it, not a copy, so a
 * change there moves every number below.
 */
export const TIER_UNIT_COSTS = {
  image: CREDIT_COSTS.AI_IMAGE_GENERATION,
  /** 15 seconds of generated video. */
  video15s: CREDIT_COSTS.AI_VIDEO_15SEC_CHUNK,
  callMinute: CREDIT_COSTS.VOICE_CALL_MINUTE,
  copy: CREDIT_COSTS.AI_COPY_GENERATION,
} as const;

export interface TierCapacity {
  /** Whole images the month covers. */
  images: number;
  /** Whole 15 s video chunks. */
  videoChunks: number;
  /** Seconds of video, from the whole chunks. */
  videoSeconds: number;
  /** Whole connected call minutes. */
  callMinutes: number;
  /** Whole pieces of copy. */
  copy: number;
}

/**
 * What a tier's monthly credits cover, in each of the four things an owner buys.
 *
 * Each figure is the whole units the month pays for, floored: a plan that covers
 * 999.6 calls does not cover 1,000 calls. The four are alternatives, not a
 * combined bundle — nobody spends the same credit on a call and on an image.
 */
export function tierCapacity(tier: CreditTier): TierCapacity {
  const credits = Math.max(0, Math.floor(Number(tier.monthlyCredits) || 0));
  const videoChunks = Math.floor(credits / TIER_UNIT_COSTS.video15s);
  return {
    images: Math.floor(credits / TIER_UNIT_COSTS.image),
    videoChunks,
    videoSeconds: videoChunks * 15,
    callMinutes: Math.floor(credits / TIER_UNIT_COSTS.callMinute),
    copy: Math.floor(credits / TIER_UNIT_COSTS.copy),
  };
}

/**
 * Seconds as the unit a person actually reads: `45s`, `25 min`.
 *
 * The doc comment on `describeTier` has always promised "25 min of video", and the code printed
 * "1500s" instead. Nobody budgets in fifteen hundred seconds. Anything under two minutes stays in
 * seconds, because "1.5 min" is worse than "90s".
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total < 120) return `${total}s`;
  const minutes = total / 60;
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
}

/** The pricing-card line: `₹9,999 — 5,000 credits: 500 images, or 25 min of video`. */
export function describeTier(tier: CreditTier): string {
  const capacity = tierCapacity(tier);
  return (
    `${formatInr(tier.pricePaise)} — ${tier.monthlyCredits.toLocaleString('en-IN')} credits: ` +
    `${capacity.images} images, or ${formatDuration(capacity.videoSeconds)} of video, or ` +
    `${capacity.callMinutes} call minutes`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Top-ups
// ────────────────────────────────────────────────────────────────────────────

/** The rate a top-up inherits: the recommended plan's, so a top-up never beats a plan. */
export function topUpRatePaisePerCredit(): number {
  const tier = tierById(RECOMMENDED_TIER_ID);
  return tier ? paisePerCredit(tier) : 0;
}

/**
 * Credits for a one-off payment, at the recommended plan's rate.
 *
 * Floored, so a part-credit payment buys a whole credit and never a fraction: the
 * ledger's `amount` column is numeric, but a wallet holding 0.4 credits cannot pay
 * for a 1-credit piece of copy.
 */
export function topUpCredits(amountPaise: number): number {
  const rate = topUpRatePaisePerCredit();
  if (rate <= 0) return 0;
  return Math.floor(Math.max(0, Number(amountPaise) || 0) / rate);
}

// ────────────────────────────────────────────────────────────────────────────
// The guard
// ────────────────────────────────────────────────────────────────────────────

/** Credits a paid plan must buy per rupee, as a sanity floor. */
export const MIN_CREDITS_PER_100_RUPEES = 5;

/**
 * The other end of the same guard.
 *
 * The floor catches a table that gives the customer too little. This ceiling
 * catches the mistake that actually costs money: a misplaced zero in `pricePaise`
 * (₹9,999 written as ₹999) or in `monthlyCredits` (5,000 written as 50,000), which
 * silently sells a plan at a tenth of its price. The real table sits at 30–60
 * credits per ₹100, so 200 is far above anything intended and far below a
 * ten-fold error.
 */
export const MAX_CREDITS_PER_100_RUPEES = 200;

/** Credits a plan buys per ₹100 spent. The number a typo moves by 10×. */
export function creditsPer100Rupees(tier: CreditTier): number {
  const rupees = tier.pricePaise / PAISE_PER_RUPEE;
  if (!rupees) return 0;
  return (tier.monthlyCredits / rupees) * 100;
}

/**
 * Everything wrong with the table, in plain words. Empty means the table is safe
 * to sell.
 *
 * This is what makes the table reviewable: a typo in `pricePaise` (a missing zero,
 * a decimal point in the wrong place) shows up as a problem here instead of as a
 * customer buying 5,000 credits for ₹999.
 */
export function tierTableProblems(tiers: readonly CreditTier[] = CREDIT_TIERS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  if (tiers.length === 0) problems.push('the tier table is empty');

  for (const tier of tiers) {
    if (!tier.id) problems.push('a tier has no id');
    else if (seen.has(tier.id)) problems.push(`tier id "${tier.id}" appears twice`);
    else seen.add(tier.id);

    if (!Number.isInteger(tier.pricePaise) || tier.pricePaise <= 0) {
      problems.push(`tier "${tier.id}": pricePaise must be a positive whole number of paise (got ${tier.pricePaise})`);
    }
    if (!Number.isInteger(tier.monthlyCredits) || tier.monthlyCredits <= 0) {
      problems.push(`tier "${tier.id}": monthlyCredits must be a positive whole number (got ${tier.monthlyCredits})`);
    }
    // Cents-in-paise would round away silently and the wallet would disagree with
    // the receipt, so the table is rupees only.
    if (tier.pricePaise % PAISE_PER_RUPEE !== 0) {
      problems.push(`tier "${tier.id}": pricePaise ${tier.pricePaise} is not a whole number of rupees`);
    }

    const per100 = creditsPer100Rupees(tier);
    if (per100 < MIN_CREDITS_PER_100_RUPEES) {
      problems.push(
        `tier "${tier.id}": ${per100.toFixed(2)} credits per ₹100 is below the floor of ` +
          `${MIN_CREDITS_PER_100_RUPEES} — the customer is getting almost nothing for the money; ` +
          'check for a misplaced zero in monthlyCredits or pricePaise',
      );
    }
    if (per100 > MAX_CREDITS_PER_100_RUPEES) {
      problems.push(
        `tier "${tier.id}": ${per100.toFixed(2)} credits per ₹100 is above the ceiling of ` +
          `${MAX_CREDITS_PER_100_RUPEES} — this plan is being sold at a fraction of its price; ` +
          'check for a misplaced zero in pricePaise or monthlyCredits',
      );
    }
  }

  const recommended = tiers.filter((tier) => tier.recommended);
  if (recommended.length !== 1) {
    problems.push(`exactly one tier must be recommended (found ${recommended.length})`);
  } else if (recommended[0].id !== RECOMMENDED_TIER_ID) {
    problems.push(`the recommended tier is "${recommended[0].id}" but RECOMMENDED_TIER_ID is "${RECOMMENDED_TIER_ID}"`);
  }

  // A bigger plan must be a better rate, or the table is upside down: nobody
  // should be able to pay more and get less.
  const ordered = [...tiers].sort((a, b) => a.pricePaise - b.pricePaise);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (paisePerCredit(current) > paisePerCredit(previous)) {
      problems.push(
        `tier "${current.id}" (${formatInr(current.pricePaise)}) costs more per credit ` +
          `(${paisePerCredit(current)} paise) than the cheaper tier "${previous.id}" ` +
          `(${paisePerCredit(previous)} paise) — a larger plan must be a better rate`,
      );
    }
    if (current.monthlyCredits <= previous.monthlyCredits) {
      problems.push(
        `tier "${current.id}" (${formatInr(current.pricePaise)}) grants no more credits than ` +
          `"${previous.id}" (${formatInr(previous.pricePaise)})`,
      );
    }
  }

  return problems;
}
