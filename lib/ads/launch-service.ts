/* eslint-disable @typescript-eslint/no-explicit-any -- Meta payloads, profile rows and job payloads are untyped. */
/**
 * Launching an ad as an ACTION, carrying the knowledge the product already has.
 *
 * WHY THIS FILE EXISTS
 * The app can launch a campaign from the ads modal, and it does it well: `lib/ads/campaign-plan.ts` decides the
 * objective/optimisation (the old code dropped the client's gender and hardcoded Name+Phone+Email), and
 * `utils/campaign-processor.ts` turns that plan into real Graph payloads - instant form, campaign, ad set,
 * creatives, ads, currency minor units, targeting. That is ~21 KB of decisions that took real bugs to get right.
 *
 * The agent could not call any of it. It had the PRIMITIVES (`meta_graph_create` with arbitrary Graph fields), so
 * "launch a campaign" meant the model re-deriving the objective, the lead-form question types, the hash of a phone
 * number, the minor-unit conversion and the ad-set optimisation from scratch - on a live ad account.
 *
 * DESIGN: COMPOSED FIRST, PRIMITIVES ALWAYS AVAILABLE.
 *   - These composed paths are the DEFAULT for the ordinary request, because they reuse the same plan and the same
 *     processor the UI uses. One definition of "what a launched campaign is".
 *   - The primitives stay registered and always reachable. Anything these composed paths do not cover - a special
 *     ad category, a bid strategy, an unusual placement, an asset the plan does not know about - is still possible
 *     through `meta_graph_create` / `meta_graph_update` / `meta_graph_query`. A composed tool that REFUSED to let you
 *     do the rest would be a regression, not a feature, so the prompt says so explicitly.
 *   - Both are behind the review gate: composed launches are `ad_spend`, primitive writes already are.
 *
 * Everything here defers to the same modules the UI path uses; nothing about Meta's field shapes is re-guessed.
 */

import {
  CAMPAIGN_GOALS,
  LEAD_FORM_FIELDS,
  resolveCampaignPlan,
  genderTargeting,
  normaliseConversionEvent,
  normaliseLeadFormFields,
  describeLeadFormFields,
  type CampaignPlan,
} from '@/lib/ads/campaign-plan';
import { checkAdCopy, sanitizeCopy, MECHANICALLY_REPAIRED_RULES } from '@/lib/ads/creative-specs';
import type { LaunchedCreative } from '@/lib/ads/creative-learning';

/** Meta will not run a daily budget below this in INR; quoting less creates a campaign that never delivers. */
export const MIN_DAILY_BUDGET_INR = 100;

export interface CampaignLocation {
  /** Meta geo key. A city key is numeric, a region key looks like "1234", a country is an ISO code. */
  key: string;
  type: 'city' | 'region' | 'country' | 'zip' | 'custom';
  country_code?: string;
  radius?: number;
}

export interface LaunchRequest {
  campaignName?: string;
  campaignType?: 'instant_form' | 'website_conversion' | 'whatsapp_chat';
  campaignGoal?: string;
  conversionEvent?: string;
  /** Daily budget in the account's currency, MAJOR units (500 = 500.00). */
  dailyBudget?: number;
  locations?: CampaignLocation[];
  gender?: string;
  ageMin?: number;
  ageMax?: number;
  interests?: any[];
  customAudienceIds?: string[];
  linkUrl?: string;
  privacyPolicyUrl?: string;
  creativeUrls?: string[];
  inventoryIds?: string[];
  assetIds?: string[];
  creativeProductIds?: string[];
  adCopy?: { headline?: string; primary_text?: string; description?: string };
  customInstructions?: string;
  pixelId?: string;
  whatsappNumber?: string;
  leadFormFields?: string[];
  /** Pause the campaign at creation instead of running it (the safe default when the owner is unsure). */
  startPaused?: boolean;
  /**
   * WHICH ARGUMENT THIS LAUNCH MAKES, recorded so the result can teach the next batch.
   *
   * This is the missing half of the performance loop. Meta returns numbers against an ad, never against an
   * idea; without a note of which angle an ad argued, a winning campaign tells you nothing you can repeat.
   * It rides in `campaign_jobs.payload` — a JSON column that already exists, whose other keys the processor
   * reads by name, so an extra key is inert to it. No migration, and nothing the client sees in Ads Manager.
   *
   * See lib/ads/creative-learning.ts, which joins this to the insights and decides what to make next.
   */
  creativePlan?: CreativePlan;
}

/** The creative identity worth remembering about a launch. Deliberately small: it is a label, not an asset. */
export interface CreativePlan {
  /** One of AD_ANGLES ids from lib/agent/creative/ad-prompt-compiler. */
  angleId?: string | null;
  headline?: string | null;
  subhead?: string | null;
  offerLine?: string | null;
  /** The canvas it was designed for: 1:1, 4:5, 9:16, 16:9. */
  format?: string | null;
}

export interface LaunchContext {
  userId: string;
  token: string;
  adAccountId: string;
  pageId: string;
  pageToken: string | null;
  pixelId: string | null;
  currency: string;
  linkUrl: string;
  privacyPolicyUrl: string;
  businessName: string;
  contactNumber: string;
  whatsappNumber: string;
  businessInfo: string;
  missionStatement: string;
  logoUrl: string | null;
}

export interface LaunchContextResult {
  ok: boolean;
  ctx?: LaunchContext;
  missing?: string[];
  error?: string;
}

function parseBusinessInfo(raw: unknown): any {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

/**
 * Read everything a launch needs from the tenant's own profile.
 *
 * Missing pieces are reported as a LIST so the agent can ask for all of them in one question, and so the refusal
 * names the real field rather than failing inside Meta with a code nobody can act on.
 */
export async function resolveLaunchContext(db: any, userId: string): Promise<LaunchContextResult> {
  const { data: profile, error } = await db
    .from('profiles')
    .select(
      'facebook_token, ad_account_id, selected_page_id, selected_page_token, pixel_id, currency, custom_domain, ' +
        'business_name, contact_number, whatsapp_phone_number, business_info, mission_statement, logo_url'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error || !profile) return { ok: false, error: `could not read this business's profile: ${error?.message || 'not found'}` };

  const bi = parseBusinessInfo(profile.business_info);
  const pageId =
    profile.selected_page_id ||
    (Array.isArray(bi?.selected_pages) && bi.selected_pages[0]?.id ? bi.selected_pages[0].id : '') ||
    '';

  const baseUrl = profile.custom_domain ? `https://${profile.custom_domain}` : `https://app.nobogent.com/shared/${userId}`;

  const missing: string[] = [];
  if (!profile.facebook_token) missing.push('a connected Meta account (Settings -> Connections)');
  if (!profile.ad_account_id) missing.push('a selected ad account');
  if (!pageId) missing.push('a selected Facebook page for the ads to run from');

  return {
    ok: missing.length === 0,
    missing,
    ctx: {
      userId,
      token: profile.facebook_token || '',
      adAccountId: profile.ad_account_id || '',
      pageId,
      pageToken: profile.selected_page_token || null,
      pixelId: profile.pixel_id || null,
      currency: profile.currency || 'INR',
      linkUrl: baseUrl,
      privacyPolicyUrl: `${baseUrl}/privacy`,
      businessName: profile.business_name || 'Our Business',
      contactNumber: profile.contact_number || '',
      whatsappNumber: profile.whatsapp_phone_number || '',
      businessInfo: typeof profile.business_info === 'string' ? profile.business_info : JSON.stringify(profile.business_info || {}),
      missionStatement: profile.mission_statement || '',
      logoUrl: profile.logo_url || null,
    },
  };
}

export interface LaunchValidation {
  ok: boolean;
  missing?: string[];
  error?: string;
  plan?: CampaignPlan;
  /** True but worth saying: a field Meta will drop, copy that was mechanically repaired at build time. */
  notes?: string[];
}

/**
 * Is this launch request complete enough to spend money?
 *
 * Pure, so the refusals are testable without a database. Each refusal names the thing to supply, because the failure
 * this prevents is a half-built campaign that Meta accepts and then never delivers.
 */
export function validateLaunchRequest(req: LaunchRequest, ctx?: Partial<LaunchContext>): LaunchValidation {
  const missing: string[] = [];
  const notes: string[] = [];
  const request = req || {};

  const plan = resolveCampaignPlan({
    campaignType: request.campaignType,
    campaignGoal: request.campaignGoal,
    conversionEvent: request.conversionEvent,
  });

  const budget = Number(request.dailyBudget);
  if (!Number.isFinite(budget) || budget <= 0) {
    missing.push(`a daily budget (at least ${MIN_DAILY_BUDGET_INR} ${ctx?.currency || 'INR'} per day)`);
  } else if (budget < MIN_DAILY_BUDGET_INR) {
    return {
      ok: false,
      plan,
      error:
        `${budget} ${ctx?.currency || 'INR'}/day is below Meta's useful minimum of ${MIN_DAILY_BUDGET_INR}. ` +
        'A budget that small delivers almost nothing, so nothing was launched. Ask the owner for the real daily budget.',
    };
  }

  const creatives = [
    ...(request.creativeUrls || []),
    ...(request.inventoryIds || []),
    ...(request.assetIds || []),
    ...(request.creativeProductIds || []),
  ].filter(Boolean);
  if (!creatives.length && !request.adCopy?.headline) {
    missing.push('a creative - an image or video URL, a catalogue item, or at least the headline copy');
  }

  // COPY THAT FITS, AND READS AS WRITTEN BY A PERSON.
  //
  // Meta does not reject an over-long headline — it truncates it at 40 characters and reports nothing, so
  // the advertiser finds out when a customer reads "...starting at ₹85,00,0". The check therefore has to
  // happen before the launch, not after the bill.
  //
  // Two different failures, two different responses, and mixing them up is what makes an agent route
  // around a check instead of writing better copy:
  //   DOES NOT FIT     a writing problem. Refused, with a trimmed version quoted so the rewrite has a
  //                    starting point. Cutting it here would ship a sentence with its end missing.
  //   A COPY TIC       a stock phrase ("unlock the power") is refused. A dash or a curly quote is
  //                    repaired by sanitizeCopy in buildCampaignJobPayload, so it is not refused —
  //                    refusing punctuation we are about to fix would be theatre.
  const copyCheck = checkAdCopy('meta', request.adCopy || {});
  const mustRewrite = copyCheck.violations.filter(
    (issue) =>
      issue.severity === 'block' && !(MECHANICALLY_REPAIRED_RULES as readonly string[]).includes(issue.rule),
  );
  if (copyCheck.overLimit.length || mustRewrite.length) {
    const parts: string[] = [];
    for (const verdict of copyCheck.overLimit) {
      parts.push(
        `${verdict.field} is ${verdict.length} characters but Meta shows ${verdict.limit}` +
          (verdict.trimmed ? ` — rewrite it, or use "${verdict.trimmed}"` : ' — rewrite it shorter'),
      );
    }
    for (const issue of mustRewrite) {
      parts.push(`replace "${issue.match}" in ${issue.field || 'the copy'} — ${issue.fix}`);
    }
    return {
      ok: false,
      plan,
      error:
        `The ad copy needs a rewrite before this can launch. ${parts.join('. ')}. ` +
        'Nothing was created and no money was spent.',
    };
  }

  if (copyCheck.unknownFields.length) {
    // Not fatal — Meta drops an unknown field anyway — but silence is how a caller spends an hour
    // wondering why the description never appeared. Notes reach the caller without stopping the launch.
    notes.push(
      `${copyCheck.unknownFields.join(', ')} ${copyCheck.unknownFields.length === 1 ? 'is' : 'are'} not ` +
        'a Meta copy field and will be dropped (Meta uses headline, primary_text, description)',
    );
  }

  if (plan.requiresPixel) {
    const pixel = request.pixelId || ctx?.pixelId;
    if (!pixel) missing.push('a Meta pixel/dataset id (or a campaign goal that does not need one)');
  }
  if (plan.requiresWhatsAppNumber) {
    const wa = request.whatsappNumber || ctx?.whatsappNumber;
    if (!wa) missing.push('the WhatsApp number the ad should open a chat with');
  }

  /**
   * WHERE IT RUNS AND WHAT IT IS FOR ARE NOT DEFAULTS.
   *
   * A real instruction — "launch a campaign for <project> on ₹500/day, paused" — went straight through,
   * because the creative could be auto-written from the profile, the objective resolved itself, and the
   * targeting silently became the account's country. Nothing asked which cities, which creative, or which
   * goal, and the owner watched a launch they had not specified.
   *
   * For an ad on a real ad account those two are choices, not preferences: the wrong city is wasted money
   * and the wrong objective is the wrong optimisation altogether. So both must be SUPPLIED. When they are
   * not, this refuses and lists exactly what to ask — which is the intake the agent should have done
   * before it ever reached this function.
   */
  const locations = (request.locations || []).filter((l: any) => l && (l.key || l.country_code));
  if (!locations.length) {
    missing.push(
      'where the ad should run (the cities, regions or country it targets) — this is a choice, not a default'
    );
  }
  if (!request.campaignGoal) {
    missing.push('what the campaign is for (leads, whatsapp conversations, or website conversions)');
  }

  const ageMin = request.ageMin === undefined ? null : Number(request.ageMin);
  const ageMax = request.ageMax === undefined ? null : Number(request.ageMax);
  if (ageMin !== null && (!Number.isFinite(ageMin) || ageMin < 13 || ageMin > 65)) {
    return { ok: false, plan, error: 'ageMin must be between 13 and 65' };
  }
  if (ageMax !== null && (!Number.isFinite(ageMax) || ageMax < 13 || ageMax > 65)) {
    return { ok: false, plan, error: 'ageMax must be between 13 and 65' };
  }
  if (ageMin !== null && ageMax !== null && ageMin >= ageMax) {
    return { ok: false, plan, error: `ageMin (${ageMin}) must be lower than ageMax (${ageMax})` };
  }

  if (missing.length) {
    return {
      ok: false,
      plan,
      missing,
      error:
        `This launch is missing ${missing.length} thing(s): ${missing.join('; ')}. Nothing was created and no money was spent. ` +
        'Ask the owner for each of those, say back what you are about to launch (creative, places, budget, goal, and whether it ' +
        'starts paused), and only then call this again.',
    };
  }

  return { ok: true, plan, ...(notes.length ? { notes } : {}) };
}

/**
 * Repair the copy tics whose fix is not a matter of taste, on the way into the payload.
 *
 * This runs at BUILD time rather than in validation on purpose. `validateLaunchRequest` already refused
 * anything that needs a human rewrite, so what is left here is punctuation: an em dash, a curly quote, a
 * doubled word, a trailing space. Refusing a launch over those would teach the agent that the check is an
 * obstacle to route around; repairing them means the ad that goes live is the good version of the sentence
 * the owner approved.
 */
function sanitiseAdCopy(copy: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [field, raw] of Object.entries(copy || {})) {
    out[field] = typeof raw === 'string' ? sanitizeCopy(raw).text : raw;
  }
  return out;
}

/** A plan field, clipped to something a label should be. Anything else is dropped rather than forwarded. */
function planText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Keep only the creative-plan fields we understand, each clipped.
 *
 * Defensive rather than trusting: this value is written into a JSON column and read back months later to
 * decide what to make next, so a stray 4 KB prompt accidentally passed as `headline` would be attributed to
 * an angle forever. An unknown key is dropped, not stored.
 */
export function normaliseCreativePlan(raw: unknown): CreativePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const plan: CreativePlan = {
    angleId: planText(source.angleId, 60),
    headline: planText(source.headline, 200),
    subhead: planText(source.subhead, 300),
    offerLine: planText(source.offerLine, 200),
    format: planText(source.format, 10),
  };
  // A plan with no angle teaches nothing, so it is not worth persisting at all.
  return plan.angleId ? plan : null;
}

/**
 * The launches we recorded, newest first, for attribution.
 *
 * Read-only and best-effort: a missing table, an old row with no payload or a malformed plan all collapse to
 * "no launches", which makes the learning pass report nothing rather than assert something wrong.
 */
export async function loadRecordedLaunches(
  db: any,
  userId: string,
  opts: { limit?: number } = {},
): Promise<{ launches: LaunchedCreative[]; readError?: string }> {
  const limit = Math.max(1, Math.min(200, Number(opts.limit ?? 50)));
  try {
    const { data, error } = await db
      .from('campaign_jobs')
      .select('id, campaign_id, payload, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { launches: [], readError: error.message };

    const launches: LaunchedCreative[] = [];
    for (const row of data ?? []) {
      const plan = normaliseCreativePlan((row as any)?.payload?.creativePlan);
      if (!plan?.angleId) continue;
      launches.push({
        campaignId: (row as any).campaign_id ? String((row as any).campaign_id) : null,
        angleId: plan.angleId,
        headline: plan.headline ?? null,
      });
    }
    return { launches };
  } catch (e: any) {
    return { launches: [], readError: e?.message || 'could not read recorded launches' };
  }
}

/**
 * The `campaign_jobs.payload` shape the processor expects.
 *
 * Field-for-field what `app/api/meta-ads/launch-campaign/route.ts` builds, so there is exactly one contract between
 * a launch request and the code that talks to Meta. Anything the caller did not supply falls back to the profile, the
 * same way the modal's defaults do.
 */
export function buildCampaignJobPayload(ctx: LaunchContext, req: LaunchRequest, plan: CampaignPlan): any {
  const request = req || {};
  const fields = plan.requiresLeadForm ? normaliseLeadFormFields(request.leadFormFields) : [];

  return {
    facebookToken: ctx.token,
    adAccountId: ctx.adAccountId,
    pageId: ctx.pageId,
    selected_page_token: ctx.pageToken,
    linkUrl: request.linkUrl || ctx.linkUrl,
    privacyPolicyUrl: request.privacyPolicyUrl || ctx.privacyPolicyUrl,
    dailyBudget: Number(request.dailyBudget),
    metaLocationsStr: request.locations?.length ? JSON.stringify(request.locations) : '',
    optimizeForConversions: plan.goal === 'quality_leads',
    customQuestionsStr: fields.length ? JSON.stringify(fields) : '',
    campaignGoal: plan.goal,
    conversionEvent: plan.conversionEvent,
    gender: request.gender || 'all',
    inventoryIds: request.inventoryIds || [],
    assetIds: request.assetIds || [],
    creativeUrls: request.creativeUrls || [],
    creativeProductIds: request.creativeProductIds || [],
    campaignType: plan.requiresWhatsAppNumber ? 'whatsapp_chat' : plan.requiresPixel ? 'website_conversion' : 'instant_form',
    pixelId: request.pixelId || ctx.pixelId || null,
    ageMin: request.ageMin ?? 18,
    ageMax: request.ageMax ?? 65,
    customAudienceIds: request.customAudienceIds || [],
    adCopy: sanitiseAdCopy(request.adCopy || {}),
    // Recorded, not read by the processor. This is the only durable trace of WHICH ARGUMENT the ad made, and
    // it is what lets a future insights pass attribute performance back to an angle (lib/ads/creative-learning).
    creativePlan: normaliseCreativePlan(request.creativePlan),
    adCopies: [],
    whatsappNumber: request.whatsappNumber || ctx.whatsappNumber || '',
    businessName: ctx.businessName,
    contactNumber: plan.requiresWhatsAppNumber ? request.whatsappNumber || ctx.whatsappNumber : ctx.contactNumber,
    businessInfo: ctx.businessInfo,
    missionStatement: ctx.missionStatement,
    currency: ctx.currency,
    logoUrl: ctx.logoUrl,
    customInstructions: request.customInstructions || null,
    campaign_name: request.campaignName || null,
    adset_name: null,
    targetUserId: ctx.userId,
    interests: request.interests || [],
    leadFormConfig: null,
    existingLeadFormId: null,
    droppedPins: [],
    leadFormFields: fields,
  };
}

/** A service-role client, created here so a launch can write its job row regardless of RLS. */
function adminClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

export interface LaunchOutcome {
  ok: boolean;
  needsSetup?: boolean;
  missing?: string[];
  error?: string;
  jobId?: string | null;
  campaignId?: string | null;
  message?: string;
  plan?: CampaignPlan;
  summary?: Record<string, unknown>;
}

/**
 * Launch the campaign: the SAME processor the UI uses, with the plan resolved in the one place that owns it.
 *
 * The subscription counter is incremented before the work and refunded when it fails, exactly like the route - a
 * plan limit is a billing fact, not a suggestion.
 */
export async function launchCampaignAsAgent(db: any, userId: string, request: LaunchRequest): Promise<LaunchOutcome> {
  const context = await resolveLaunchContext(db, userId);
  if (!context.ok || !context.ctx) {
    return {
      ok: false,
      needsSetup: true,
      missing: context.missing,
      error:
        `This business cannot launch ads yet because it is missing: ${(context.missing || []).join('; ') || context.error}. ` +
        'Nothing was created.',
    };
  }
  const ctx = context.ctx;

  const validation = validateLaunchRequest(request, ctx);
  if (!validation.ok || !validation.plan) {
    return { ok: false, missing: validation.missing, error: validation.error, plan: validation.plan };
  }
  const plan = validation.plan;

  // Plan limits, refunded on failure.
  let counted = false;
  try {
    const { checkLimitAndIncrement, refundLimit } = await import('@/utils/subscription-server');
    await checkLimitAndIncrement(userId, 'campaign_launches');
    counted = true;
    void refundLimit;
  } catch (limitErr: any) {
    return { ok: false, error: limitErr?.message || 'this plan cannot launch another campaign right now' };
  }

  const payload = buildCampaignJobPayload(ctx, request, plan);
  const admin = adminClient() || db;

  let jobId: string | null = null;
  try {
    const { data: job, error: jobErr } = await admin
      .from('campaign_jobs')
      .insert({ user_id: userId, target_user_id: userId, status: 'pending', payload })
      .select('id')
      .single();
    if (!jobErr && job?.id) jobId = job.id;
  } catch {
    /* the processor also accepts an explicit payload, so a missing job table is not fatal */
  }

  try {
    const { runCampaignJob } = await import('@/utils/campaign-processor');
    const result = await runCampaignJob(jobId || `agent_${Date.now()}`, payload);
    return {
      ok: true,
      jobId,
      campaignId: result?.campaignId ?? null,
      message: result?.message || 'Campaign created.',
      plan,
      summary: {
        objective: plan.objective,
        optimisation: plan.optimizationGoal,
        dailyBudget: payload.dailyBudget,
        currency: ctx.currency,
        leadFormFields: plan.requiresLeadForm ? describeLeadFormFields(payload.leadFormFields) : null,
        customAudiences: payload.customAudienceIds,
        locations: request.locations?.length ? request.locations : 'the account default (IN)',
        gender: payload.gender,
        age: `${payload.ageMin}-${payload.ageMax}`,
      },
    };
  } catch (e: any) {
    if (counted) {
      try {
        const { refundLimit } = await import('@/utils/subscription-server');
        await refundLimit(userId, 'campaign_launches');
      } catch {
        /* best effort */
      }
    }
    return {
      ok: false,
      jobId,
      error:
        `Meta rejected the launch: ${e?.message || 'unknown error'}. ` +
        (jobId ? `The job row (${jobId}) is kept so the failure can be inspected.` : '') +
        ' Nothing was left half-created on purpose; check the ads screen before retrying.',
      plan,
    };
  }
}

/** The pieces a caller can offer for the audience in a retargeting launch. */
export type RetargetAudience =
  | { source: 'existing'; audienceId: string }
  | { source: 'crm_leads'; audienceGroupName?: string; filters?: Record<string, unknown>; name?: string }
  | { source: 'phones'; phones: string[]; emails?: string[]; name?: string }
  | { source: 'lookalike'; originAudienceId: string; ratio?: number; country?: string; name?: string };

export interface RetargetOutcome extends LaunchOutcome {
  audienceId?: string | null;
  audienceNote?: string;
  uploaded?: number;
}

/**
 * Retargeting, end to end: audience -> campaign that targets only that audience.
 *
 * The audience is created with the SAME tool the agent already had (`meta_custom_audience_create`, which hashes phone
 * numbers and reads CRM groups), and the campaign goes through the SAME launch path above, which already understands
 * `customAudienceIds` (the processor maps them to `targeting.custom_audiences`). Two well-tested halves instead of a
 * third implementation of both.
 */
export async function launchRetargetingAsAgent(
  db: any,
  userId: string,
  request: LaunchRequest,
  audience: RetargetAudience
): Promise<RetargetOutcome> {
  const context = await resolveLaunchContext(db, userId);
  if (!context.ok || !context.ctx) {
    return {
      ok: false,
      needsSetup: true,
      missing: context.missing,
      error: `This business cannot launch ads yet: ${(context.missing || []).join('; ') || context.error}. Nothing was created.`,
    };
  }
  const ctx = context.ctx;

  let audienceId: string | null = null;
  let audienceNote = '';
  let uploaded = 0;

  if (audience.source === 'existing') {
    audienceId = String(audience.audienceId || '').trim();
    if (!/^\d{5,}$/.test(audienceId)) {
      return { ok: false, error: `"${audience.audienceId}" is not a Meta audience id. List them with meta_custom_audience_list.` };
    }
    audienceNote = 'used an existing Meta custom audience';
  } else {
    const { createMetaGraphTools } = await import('@/lib/agent/mcp/meta-graph');
    const graphTools: any = createMetaGraphTools(db, userId);
    const created = await graphTools.meta_custom_audience_create.execute({
      name: (audience as any).name || `Retargeting - ${request.campaignName || new Date().toISOString().slice(0, 10)}`,
      source: audience.source,
      audienceGroupName: (audience as any).audienceGroupName,
      filters: (audience as any).filters,
      phones: (audience as any).phones,
      emails: (audience as any).emails,
      originAudienceId: (audience as any).originAudienceId,
      lookalikeRatio: (audience as any).ratio,
      lookalikeCountry: (audience as any).country,
    });
    if (!created?.success) {
      return { ok: false, error: created?.error || 'the custom audience could not be created, so nothing was launched' };
    }
    audienceId = String(created.audienceId || '');
    uploaded = Number(created.count ?? created.uploaded ?? 0) || 0;
    audienceNote =
      audience.source === 'lookalike'
        ? `lookalike from ${(audience as any).originAudienceId}`
        : `created from ${audience.source}${uploaded ? ` (${uploaded} identifiers)` : ''}`;
  }

  const launched = await launchCampaignAsAgent(
    db,
    userId,
    { ...request, customAudienceIds: [audienceId as string] },
  );

  return { ...launched, audienceId, audienceNote, uploaded };
}

export interface OptimisationAction {
  kind: 'pause' | 'reduce_budget' | 'increase_budget' | 'keep';
  target: string;
  reason: string;
  /** The primitive call that performs it, so applying it never needs a second plan. */
  primitive: { tool: string; args: Record<string, unknown> } | null;
}

/**
 * Turn performance rows into a short list of actions with the exact primitive call for each.
 *
 * Deliberately advisory: it returns the calls and lets the review gate handle them, instead of silently moving a
 * client's budget. A rule table rather than a model, so two runs on the same numbers agree.
 */
export function recommendOptimisation(rows: any[], opts: { minSpendForJudgement?: number } = {}): OptimisationAction[] {
  const minSpend = Number(opts.minSpendForJudgement ?? 500);
  const list = Array.isArray(rows) ? rows : [];
  const actions: OptimisationAction[] = [];

  for (const row of list) {
    const name = String(row?.adset_name || row?.ad_name || row?.campaign_name || row?.id || 'this item');
    const id = String(row?.adset_id || row?.ad_id || row?.campaign_id || row?.id || '');
    const spend = Number(row?.spend || 0);
    const results = Number(row?.results ?? 0);
    const ctr = Number(row?.ctr ?? 0);
    const frequency = Number(row?.frequency ?? 0);

    if (spend >= minSpend && results === 0) {
      actions.push({
        kind: 'pause',
        target: name,
        reason: `${spend.toFixed(0)} spent with no results at all.`,
        primitive: { tool: 'meta_graph_set_status', args: { entity: 'adset', id, status: 'PAUSED' } },
      });
      continue;
    }
    if (frequency > 3.5 && ctr < 0.8) {
      actions.push({
        kind: 'pause',
        target: name,
        reason: `Frequency ${frequency.toFixed(1)} with CTR ${ctr.toFixed(2)}%: the audience is tired and it is still spending.`,
        primitive: { tool: 'meta_graph_set_status', args: { entity: 'adset', id, status: 'PAUSED' } },
      });
      continue;
    }
    if (results > 0 && spend > 0) {
      actions.push({
        kind: 'keep',
        target: name,
        reason: `Cost per result is ${(spend / results).toFixed(0)} on ${spend.toFixed(0)} spent - the best signal here, so this is where budget belongs.`,
        primitive: null,
      });
    }
  }

  const keepers = actions.filter((a) => a.kind === 'keep').length;
  const pausers = actions.filter((a) => a.kind === 'pause').length;
  if (!actions.length) {
    actions.push({
      kind: 'keep',
      target: 'everything',
      reason: `No item has crossed the ${minSpend} spend threshold yet, so there is nothing honest to judge.`,
      primitive: null,
    });
  } else if (keepers && pausers) {
    actions.push({
      kind: 'increase_budget',
      target: 'the best performing ad set',
      reason: 'Move budget from the paused items into the one that converts, rather than raising the total spend.',
      primitive: null,
    });
  }

  return actions;
}

/** What the agent should say the plan means, in the owner's vocabulary. */
export function describePlan(plan: CampaignPlan, currency: string): string {
  const goal = CAMPAIGN_GOALS.find((g) => g.id === plan.goal);
  return (
    `${goal?.label || plan.goal}: Meta objective ${plan.objective}, optimising for ${plan.optimizationGoal}` +
    (plan.conversionEvent ? ` on ${plan.conversionEvent}` : '') +
    `. Budget is quoted per day in ${currency}.`
  );
}

export { LEAD_FORM_FIELDS, normaliseConversionEvent, genderTargeting };
