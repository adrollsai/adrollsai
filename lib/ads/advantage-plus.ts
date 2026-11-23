/**
 * How a launched campaign is configured on Meta, in one place.
 *
 * WHY THIS FILE EXISTS
 * The launcher used to decide targeting in three different ways that each drifted
 * away from what Meta actually accepts:
 *
 *   1. every ad set carried `location_types: ["home"]` — "People living in this
 *      location". Meta removed that choice from Ads Manager, so an ad set built
 *      with it can be created by the API but cannot be published or edited in the
 *      UI afterwards: the advertiser is forced to pick the surviving option before
 *      the ad set will go live. The surviving option is "People living in or
 *      recently in this location", i.e. `["home", "recent"]`.
 *
 *   2. targeting automatically turned Advantage+ OFF (`advantage_audience: 0`)
 *      and then restricted placements to Facebook + Instagram on mobile and
 *      desktop. Those two lines together guarantee a campaign can never be an
 *      Advantage+ campaign: Meta requires all three levers — campaign budget,
 *      Advantage+ audience and unrestricted placements — before it will report
 *      `advantage_state: ADVANTAGE_PLUS_*`.
 *
 *   3. `special_ad_categories` was hardcoded to `[]` while our own privacy page
 *      promises that every campaign we create declares HOUSING. An undeclared
 *      housing campaign is a compliance problem, and a *declared* one has a hard
 *      consequence the launcher never knew about: Advantage+ audience is not
 *      available in a special ad category, and Meta refuses to publish an ad set
 *      that asks for it (error 2909055, "Advantage+ audience is unavailable for
 *      ads in this special ad category. To publish this ad set, use the original
 *      audience options instead."). That is a live failure on the platform today:
 *      Blue Square Infra's ad set 120247466552430424 is stuck WITH_ISSUES on it.
 *
 * So the rules live here, pure and testable, and both the campaign and the ad set
 * payloads are built from the same resolved plan.
 *
 * Verified against the live Graph API (v23.0) with `execution_options=["validate_only"]`
 * so nothing was created and nothing was spent:
 *   - `location_types: ["home"]` is still accepted by the API (legacy), which is why
 *     this bug never showed up as a launch failure — only as an unpublishable ad set.
 *   - mixing `countries` with cities/regions/zips/pins is rejected as a conflict.
 *   - `advantage_audience: 1` is accepted on any ad set, special category or not;
 *     the refusal happens at ad review/publish time, which is exactly why it has to
 *     be blocked here instead of handled as an API error.
 */

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * The only location-type combination Meta still offers to an advertiser.
 *
 * "People living in this location" (['home']) and "People travelling in this
 * location" (['recent'] alone) were removed from Ads Manager. An ad set carrying
 * either cannot be published or edited in the UI.
 */
export const LOCATION_TYPES = ['home', 'recent'] as const;

/** Meta's own floor and ceiling for a city/address radius, in kilometres. */
export const MIN_RADIUS_KM = 17;
export const MAX_RADIUS_KM = 80;

export interface GeoLocationInput {
  /** A location picked from the Meta location search. */
  type: 'city' | 'region' | 'zip' | 'country' | 'custom_location' | string;
  key?: string;
  country_code?: string;
  latitude?: number | string;
  longitude?: number | string;
  radius?: number | string;
}

export interface GeoLocationArgs {
  locations?: GeoLocationInput[] | null;
  /** Free-form pins dropped on the map. */
  pins?: Array<{ latitude?: number | string; longitude?: number | string; lat?: number | string; lng?: number | string; radius?: number | string }> | null;
  /** Country used when the caller gave no usable location at all. Defaults to IN. */
  fallbackCountry?: string;
}

export interface GeoLocations {
  geo_locations: Record<string, unknown>;
  /** Human-readable problems the caller should surface to the user. */
  warnings: string[];
}

const clampRadius = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.max(MIN_RADIUS_KM, Math.min(MAX_RADIUS_KM, Math.round(n)));
};

const finiteNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Build the `geo_locations` object Meta will accept.
 *
 * The one rule that matters: never send `countries` alongside granular locations.
 * Meta answers that combination with error 1487756 ("Some locations conflict with
 * each other"), which the old launcher hit whenever a caller passed both.
 */
export function buildGeoLocations(args: GeoLocationArgs): GeoLocations {
  const warnings: string[] = [];
  const cities: Array<Record<string, unknown>> = [];
  const regions: Array<Record<string, unknown>> = [];
  const zips: Array<Record<string, unknown>> = [];
  const countries: string[] = [];
  const customLocations: Array<Record<string, unknown>> = [];

  const pushPin = (latRaw: unknown, lngRaw: unknown, radiusRaw: unknown) => {
    const latitude = finiteNumber(latRaw);
    const longitude = finiteNumber(lngRaw);
    if (latitude === null || longitude === null) return;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      warnings.push(`Ignored a pin at ${latRaw}, ${lngRaw}: not a valid coordinate.`);
      return;
    }
    customLocations.push({
      latitude,
      longitude,
      radius: clampRadius(radiusRaw),
      distance_unit: 'kilometer',
    });
  };

  for (const raw of args.locations || []) {
    if (!raw) continue;
    if (raw.type === 'custom_location' || finiteNumber(raw.latitude) !== null) {
      pushPin(raw.latitude, raw.longitude, raw.radius);
      continue;
    }
    // A country may arrive with only `country_code` set, so it is handled before the
    // "needs a key" guard — otherwise a caller passing both a city and IN would ship
    // the city alone without ever noticing the country it also asked for.
    if (raw.type === 'country') {
      const code = String(raw.country_code || raw.key || '').toUpperCase();
      if (code && !countries.includes(code)) countries.push(code);
      continue;
    }
    if (!raw.key) continue;
    if (raw.type === 'city') {
      cities.push({ key: String(raw.key), radius: clampRadius(raw.radius), distance_unit: 'kilometer' });
    } else if (raw.type === 'region') {
      regions.push({ key: String(raw.key) });
    } else if (raw.type === 'zip' || raw.type === 'postal_code') {
      zips.push({ key: String(raw.key) });
    }
  }

  for (const pin of args.pins || []) {
    if (!pin) continue;
    pushPin(pin.latitude ?? pin.lat, pin.longitude ?? pin.lng, pin.radius);
  }

  const granularCount = cities.length + regions.length + zips.length + customLocations.length;
  const geo: Record<string, unknown> = {};
  if (cities.length) geo.cities = cities;
  if (regions.length) geo.regions = regions;
  if (zips.length) geo.zips = zips;
  if (customLocations.length) geo.custom_locations = customLocations;

  if (granularCount === 0) {
    const fallback = String(args.fallbackCountry || 'IN').toUpperCase();
    geo.countries = [fallback];
  } else if (countries.length) {
    // Countries cannot ride along with a granular location; they are implied by it.
    warnings.push(
      'Dropped the country restriction: Meta rejects a country combined with cities, regions, postal codes or map pins (error 1487756).'
    );
  }

  geo.location_types = [...LOCATION_TYPES];
  return { geo_locations: geo, warnings };
}

// ---------------------------------------------------------------------------
// Special ad categories
// ---------------------------------------------------------------------------

export type SpecialAdCategory = 'HOUSING' | 'EMPLOYMENT' | 'CREDIT' | 'SOCIAL_ISSUES_ELECTIONS_POLITICS';

export const SPECIAL_AD_CATEGORIES: SpecialAdCategory[] = [
  'HOUSING',
  'EMPLOYMENT',
  'CREDIT',
  'SOCIAL_ISSUES_ELECTIONS_POLITICS',
];

const CATEGORY_PATTERNS: Array<{ category: SpecialAdCategory; test: RegExp }> = [
  {
    category: 'HOUSING',
    // Deliberately does not match a bare "home": a "home loans" business is CREDIT,
    // and declaring HOUSING there would strip age/gender targeting for no reason.
    test: /\b(real\s*estate|realty|realtors?|propert(?:y|ies)|builders?|developers?|construct(?:ion|ions)?|housing|apartments?|flats?|plots?|villas?|townships?|land\s+sale|rent(?:al|als)?|pg\b|hostels?)\b/i,
  },
  {
    category: 'EMPLOYMENT',
    test: /\b(jobs?|hiring|recruit(?:ment|ers?)?|careers?|vacanc(?:y|ies)|staffing)\b/i,
  },
  {
    category: 'CREDIT',
    test: /\b(loans?|credit\s*cards?|mortgages?|lending|emi\b|finance\s*company|nbcf)\b/i,
  },
  {
    category: 'SOCIAL_ISSUES_ELECTIONS_POLITICS',
    test: /\b(elections?|political|politics|social\s+issue|public\s+policy|referendum)\b/i,
  },
];

const normaliseCategories = (input: unknown): SpecialAdCategory[] => {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const out: SpecialAdCategory[] = [];
  for (const item of raw) {
    const value = String(item || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!value || value === 'NONE') continue;
    if (SPECIAL_AD_CATEGORIES.includes(value as SpecialAdCategory) && !out.includes(value as SpecialAdCategory)) {
      out.push(value as SpecialAdCategory);
    }
  }
  return out;
};

/**
 * Work out the legally required special ad category from what we know about the
 * business. An explicit choice always wins; detection is only a fallback, because
 * a wrong category narrows the audience and a missing one is a policy violation.
 */
export function detectSpecialAdCategories(input: {
  industry?: string | null;
  businessInfo?: string | null;
  missionStatement?: string | null;
  explicit?: unknown;
}): { categories: SpecialAdCategory[]; detectedFrom: string[] } {
  const explicit = normaliseCategories(input.explicit);
  if (explicit.length) return { categories: explicit, detectedFrom: ['set explicitly when the campaign was launched'] };

  const haystack = [input.industry, input.businessInfo, input.missionStatement]
    .filter(Boolean)
    .join(' \n ')
    .slice(0, 4000);
  if (!haystack.trim()) return { categories: [], detectedFrom: [] };

  const categories: SpecialAdCategory[] = [];
  const detectedFrom: string[] = [];
  for (const { category, test } of CATEGORY_PATTERNS) {
    const match = haystack.match(test);
    if (match) {
      categories.push(category);
      detectedFrom.push(`${category} (matched "${match[0]}")`);
    }
  }
  return { categories, detectedFrom };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface AdvantagePlanInput {
  /** Meta campaign objective, e.g. OUTCOME_LEADS. */
  objective: string;
  campaignType?: string | null;
  /** Explicit special ad category(categories) from the caller, if any. */
  specialAdCategories?: unknown;
  industry?: string | null;
  businessInfo?: string | null;
  missionStatement?: string | null;
  /** True when the ad set targets a saved / custom audience (retargeting). */
  hasCustomAudience?: boolean;
  /** True when the advertiser picked interests. */
  hasDetailedTargeting?: boolean;
  /** True when the advertiser restricted age or gender. */
  hasAgeOrGender?: boolean;
  /** Explicit overrides, for callers that really do need manual targeting. */
  wantsAdvantageAudience?: boolean | null;
  wantsAdvantagePlacements?: boolean | null;
}

export interface AdvantagePlan {
  objective: string;
  specialAdCategories: SpecialAdCategory[];
  /** Advantages+ budget lever: one budget at campaign level. */
  campaignBudget: true;
  /** Advantage+ audience lever. */
  advantageAudience: boolean;
  /** Advantage+ placements lever: no placement targeting at all. */
  advantagePlacements: boolean;
  locationTypes: string[];
  /** Age/gender/detailed targeting marked as *suggestions* rather than constraints. */
  individualSetting: { age?: number; gender?: number; detailed_targeting?: number } | null;
  /** Relaxation switches that must stay off so an audience is not silently widened. */
  relaxation: { custom_audience?: number; lookalike?: number; detailed_targeting?: number } | null;
  /** True only when all three levers are on — the state Meta reports as ADVANTAGE_PLUS_*. */
  advantagePlus: boolean;
  /** Meta's own name for the resulting campaign shape. */
  advantageState: 'ADVANTAGE_PLUS_LEADS' | 'ADVANTAGE_PLUS_SALES' | 'ADVANTAGE_PLUS_ENGAGEMENT' | null;
  /** Why the plan looks the way it does, in the client's language. */
  reasons: string[];
  /** Problems Meta would refuse to publish, surfaced before anything is created. */
  blockers: string[];
}

/**
 * Resolve the Advantage+ configuration for one launch.
 *
 * Order of precedence, and why:
 *   - A special ad category wins over everything: Meta will not publish an ad set
 *     that asks for Advantage+ audience inside HOUSING/EMPLOYMENT/CREDIT/SOCIAL.
 *   - A custom audience wins over Advantage+ audience: retargeting exists precisely
 *     to reach a known list, and Advantage+ audience would expand beyond it.
 *   - An explicit caller choice wins over both, but each choice that Meta would
 *     refuse to publish is recorded as a blocker instead of being silently dropped.
 */
export function resolveAdvantagePlan(input: AdvantagePlanInput): AdvantagePlan {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const { categories, detectedFrom } = detectSpecialAdCategories({
    industry: input.industry,
    businessInfo: input.businessInfo,
    missionStatement: input.missionStatement,
    explicit: input.specialAdCategories,
  });

  if (categories.length) {
    reasons.push(
      `Special ad category ${categories.join(', ')} declared from ${detectedFrom.join('; ') || 'the campaign settings'}.`
    );
  }

  const wantsAudience = input.wantsAdvantageAudience !== false;
  const isRetargeting = Boolean(input.hasCustomAudience);

  let advantageAudience = wantsAudience;
  let relaxation: AdvantagePlan['relaxation'] = null;

  if (categories.length) {
    advantageAudience = false;
    relaxation = { custom_audience: 0, lookalike: 0 };
    reasons.push(
      `Advantage+ audience off: Meta does not allow it inside ${categories.join(', ')} and refuses to publish such an ad set (error 2909055), so the original audience options are used instead.`
    );
    if (input.wantsAdvantageAudience === true) {
      blockers.push(
        `Advantage+ audience was requested, but this campaign is in the ${categories.join(', ')} special ad category. Meta blocks publishing that combination (error 2909055), so it was disabled.`
      );
    }
  } else if (isRetargeting) {
    advantageAudience = false;
    relaxation = { custom_audience: 0, lookalike: 0, detailed_targeting: 0 };
    reasons.push(
      'Advantage+ audience off and audience expansion pinned to 0: this launch targets a saved audience, and expanding past it would reach people who are not in the list.'
    );
  } else {
    reasons.push(
      'Advantage+ audience on: Meta finds the buyers instead of being limited to the interests that were picked.'
    );
  }

  const advantagePlacements = input.wantsAdvantagePlacements !== false;
  if (advantagePlacements) {
    reasons.push(
      'Advantage+ placements on: no placement targeting is sent, so every placement Meta can optimise into is eligible.'
    );
  } else {
    reasons.push('Placement restrictions kept by request, which turns the Advantage+ placement lever off.');
  }

  let individualSetting: AdvantagePlan['individualSetting'] = null;
  if (advantageAudience && (input.hasAgeOrGender || input.hasDetailedTargeting)) {
    individualSetting = {
      ...(input.hasAgeOrGender ? { age: 1, gender: 1 } : {}),
      ...(input.hasDetailedTargeting ? { detailed_targeting: 1 } : {}),
    };
    reasons.push(
      'Age, gender and interests are kept as suggestions rather than hard limits, so Advantage+ can still expand past them.'
    );
  }

  if (categories.length && input.hasAgeOrGender) {
    // Special ad categories are not allowed to restrict age or gender at all.
    blockers.push(
      `Age and gender targeting were picked, but Meta does not allow them in the ${categories.join(', ')} special ad category. They are dropped so the ad set can publish.`
    );
  }

  const advantagePlus = advantageAudience && advantagePlacements;
  const advantageState = advantageAudience && advantagePlacements
    ? input.objective === 'OUTCOME_LEADS'
      ? 'ADVANTAGE_PLUS_LEADS'
      : input.objective === 'OUTCOME_SALES'
        ? 'ADVANTAGE_PLUS_SALES'
        : input.objective === 'OUTCOME_ENGAGEMENT'
          ? 'ADVANTAGE_PLUS_ENGAGEMENT'
          : null
    : null;

  return {
    objective: input.objective,
    specialAdCategories: categories,
    campaignBudget: true,
    advantageAudience,
    advantagePlacements,
    locationTypes: [...LOCATION_TYPES],
    individualSetting,
    relaxation,
    advantagePlus,
    advantageState,
    reasons,
    blockers,
  };
}

/** The 18–65 window: what "no age targeting" means to Meta. */
export const OPEN_AGE_RANGE = { min: 18, max: 65 } as const;

/**
 * Age and gender for the ad set, after the Advantage+ and special-category rules.
 *
 * Two hard Meta rules, both confirmed against the live API:
 *   - A special ad category may not narrow the audience by age or gender at all, so
 *     the range is opened up rather than quietly switched off.
 *   - With Advantage+ audience ON, the maximum age may not be below 65
 *     (error 1870189, "the maximum age audience control can't be set to lower than
 *     65"). The chosen ceiling stays on the ad set only as a *suggestion* through
 *     `individual_setting.age`, which is why the plan sets that flag.
 */
export function ageAndGenderTargeting(
  plan: AdvantagePlan,
  ageMin: unknown,
  ageMax: unknown,
  gender: unknown,
  genderTargetingFn: (value: unknown) => number[] | null
): { age_min: number; age_max: number; genders: number[] | null } {
  const restrictedByCategory = plan.specialAdCategories.length > 0;
  const min = Number(ageMin);
  const max = Number(ageMax);
  // `Number(null)` is 0 and `Number('')` is 0, both of which are FINITE — so a caller that omitted a
  // ceiling used to clamp to `Math.max(18, 0)` and send an 18-to-18 ad set: an audience of exactly one
  // year of age. Nothing errored; the campaign simply reached almost nobody, which is the hardest kind
  // of bug to notice because the ad account looks healthy. A non-positive age means "not set", always.
  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;

  if (restrictedByCategory) {
    return { age_min: OPEN_AGE_RANGE.min, age_max: OPEN_AGE_RANGE.max, genders: null };
  }

  const ageMinValue = hasMin
    ? Math.max(OPEN_AGE_RANGE.min, Math.min(OPEN_AGE_RANGE.max, Math.round(min)))
    : OPEN_AGE_RANGE.min;
  const requestedMax = hasMax
    ? Math.max(OPEN_AGE_RANGE.min, Math.min(OPEN_AGE_RANGE.max, Math.round(max)))
    : OPEN_AGE_RANGE.max;
  // Advantage+ audience refuses any ceiling below 65; the advertiser's ceiling is
  // still honoured as a suggestion, never as a hard limit.
  const ageMaxValue = plan.advantageAudience ? OPEN_AGE_RANGE.max : requestedMax;

  return {
    age_min: Math.min(ageMinValue, ageMaxValue),
    age_max: ageMaxValue,
    genders: genderTargetingFn(gender),
  };
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

/** Meta's placements fields. Advantage+ placements means none of them may be sent. */
export const PLACEMENT_FIELDS = [
  'publisher_platforms',
  'device_platforms',
  'facebook_positions',
  'instagram_positions',
  'messenger_positions',
  'audience_network_positions',
  'threads_positions',
  'whatsapp_positions',
] as const;

export interface CampaignPayloadArgs {
  name: string;
  plan: AdvantagePlan;
  /** Daily budget in the account currency (not minor units). */
  dailyBudget: number;
  status?: 'ACTIVE' | 'PAUSED';
  accessToken: string;
}

/**
 * The campaign object. Budget at campaign level is the Advantage+ budget lever, so
 * it is always set here and never on the ad set.
 */
export function buildCampaignPayload(args: CampaignPayloadArgs): Record<string, unknown> {
  const minor = Math.max(1, Math.round(Number(args.dailyBudget) * 100));
  return {
    name: args.name,
    objective: args.plan.objective,
    status: args.status || 'ACTIVE',
    buying_type: 'AUCTION',
    daily_budget: minor,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    special_ad_categories: args.plan.specialAdCategories,
    access_token: args.accessToken,
  };
}

/**
 * Fold the Advantage+ decisions into a targeting object.
 *
 * Placement fields are removed when the placement lever is on — leaving them in is
 * what silently downgraded every campaign the platform launched to a manual one.
 */
export function applyAdvantageTargeting(
  targeting: Record<string, any>,
  plan: AdvantagePlan
): Record<string, any> {
  const out: Record<string, any> = { ...targeting };

  if (plan.advantagePlacements) {
    for (const field of PLACEMENT_FIELDS) delete out[field];
  } else {
    out.publisher_platforms = out.publisher_platforms || ['facebook', 'instagram'];
  }

  const automation: Record<string, any> = { advantage_audience: plan.advantageAudience ? 1 : 0 };
  if (plan.advantageAudience && plan.individualSetting) automation.individual_setting = plan.individualSetting;
  out.targeting_automation = automation;

  if (!plan.advantageAudience) {
    // Meta refuses to switch Advantage+ audience off while an `age_range` is present:
    // "The field targeting_automation must be enabled to use the field age_range"
    // (subcode 1487079) — measured on a live ad set. Callers that pass a whole
    // targeting object through would hit exactly that, so the range leaves with the
    // lever.
    delete out.age_range;
  }

  if (plan.relaxation) out.targeting_relaxation_types = plan.relaxation;

  const geo = out.geo_locations && typeof out.geo_locations === 'object' ? out.geo_locations : {};
  out.geo_locations = { ...geo, location_types: [...plan.locationTypes] };

  return out;
}

/** One sentence the client can read in the launch notification. */
export function describeAdvantagePlan(plan: AdvantagePlan): string {
  const parts: string[] = [];
  parts.push(plan.advantagePlus && plan.advantageState ? `${plan.advantageState.replace(/_/g, ' ')}` : 'Manual campaign');
  parts.push(plan.advantageAudience ? 'Advantage+ audience ON' : 'Advantage+ audience off');
  parts.push(plan.advantagePlacements ? 'Advantage+ placements ON' : 'placements restricted');
  parts.push('budget at campaign level');
  if (plan.specialAdCategories.length) parts.push(`category ${plan.specialAdCategories.join(' + ')}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * The attribution window Meta actually accepts for a lead campaign.
 *
 * Measured, not assumed: on a lead ad set Meta rejects 7-day click and any
 * view-through window with *"For the selected objective and performance goal, use one
 * of these supported click-through and view-through attribution window combinations:
 * (1, 0)"*. So lead and messaging campaigns get a 1-day click window, explicitly,
 * instead of silently inheriting whatever the account default happens to be.
 *
 * Other objectives keep Meta's own default: the window they accept varies (7-day
 * click is still valid for sales/traffic), and guessing there would trade a working
 * default for a rejection.
 */
export function attributionSpecFor(objective: string): Array<{ event_type: string; window_days: number }> | null {
  const leadsLike = ['OUTCOME_LEADS', 'OUTCOME_ENGAGEMENT', 'LEAD_GENERATION', 'MESSAGES'];
  return leadsLike.includes(objective) ? [{ event_type: 'CLICK_THROUGH', window_days: 1 }] : null;
}

// ---------------------------------------------------------------------------
// Advantage+ creative
// ---------------------------------------------------------------------------

/**
 * Advantage+ creative enhancements, in the shape Marketing API v22+ accepts.
 *
 * `standard_enhancements` — the obvious name, and the one every older guide shows —
 * is rejected on v22 and later with *"Including standard enhancements field in
 * creative has been deprecated. Please choose to set individual features instead"*
 * (subcode 3858504). The catalog bundle is the surviving equivalent, and it validated
 * cleanly against v23.0.
 *
 * Only the catalog bundle is enrolled. Image animation and text translation are
 * separate features that change what the client's creative looks like, so they stay
 * an explicit choice rather than something a launcher switches on silently.
 */
export function creativeEnhancements(): Record<string, unknown> {
  return {
    creative_features_spec: {
      STANDARD_ENHANCEMENTS_CATALOG: { enroll_status: 'OPT_IN' },
    },
  };
}
