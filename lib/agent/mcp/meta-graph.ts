import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { campaignLaunchRefusal } from '../preflight';
import { LOCATION_TYPES } from '@/lib/ads/advantage-plus';

/**
 * Direct Meta Marketing API (Graph) tools.
 *
 * These exist because Meta's OFFICIAL ads MCP server needs the
 * `ads_mcp_management` permission, which today's connected tokens do not have.
 * The tokens DO carry `ads_management`, which is enough to manage a connected
 * ad account end to end — so this suite is what makes "the agent can do
 * everything in the user's Meta account" true right now.
 *
 * `meta_graph_query` is the deliberate escape hatch: any Graph endpoint the
 * token is authorised for, so the agent is never boxed into our subset.
 */
const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$',
};

/**
 * A Meta customer-list identifier, hashed the way Meta requires.
 *
 * Meta matches on SHA-256 of a NORMALISED value, and it does not tell you when the normalisation was
 * wrong — the audience simply matches nobody. So: phone numbers are digits only, with the country
 * code, no `+`, no spaces, no dashes; emails are lowercased and trimmed. A 10-digit number is given
 * the caller's country code rather than being uploaded bare (which matches nothing).
 */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalisePhoneList(phones: string[], countryCode = '91'): string[] {
  const cc = String(countryCode || '91').replace(/\D/g, '') || '91';
  const seen = new Set<string>();
  for (const raw of phones) {
    let digits = String(raw ?? '').replace(/\D/g, '');
    if (!digits) continue;
    // A leading zero is a national-format trunk prefix, never part of the E.164 number.
    digits = digits.replace(/^0+/, '');
    if (digits.length === 10 && cc) digits = `${cc}${digits}`;
    if (digits.length < 7) continue;
    seen.add(sha256(digits));
  }
  return Array.from(seen);
}

export function normaliseEmailList(emails: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of emails) {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    seen.add(sha256(email));
  }
  return Array.from(seen);
}

export function createMetaGraphTools(supabase: SupabaseClient, userId: string) {
  async function creds() {
    const { data, error } = await supabase
      .from('profiles')
      .select('facebook_token, ad_account_id, selected_page_id, selected_page_token, business_name, currency')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) throw new Error('User profile not found.');
    const token = String(data.facebook_token || '').replace(/^["']|["']$/g, '').trim();
    if (!token) throw new Error('Meta Ad Account is not connected. Connect Facebook/Meta in Nobogent settings.');

    const raw = String(data.ad_account_id || '').replace(/^act_/, '').trim();
    const adAccountId = raw ? `act_${raw}` : '';
    return { token, adAccountId, pageId: data.selected_page_id, pageToken: data.selected_page_token, profile: data };
  }

  /** Ad account metadata, cached per call chain so money is always formatted right. */
  const accountCache = new Map<string, any>();
  async function account(token: string, adAccountId: string) {
    if (!adAccountId) throw new Error('No Meta ad account is connected to this profile.');
    if (accountCache.has(adAccountId)) return accountCache.get(adAccountId);
    const res = await fetch(
      `${GRAPH}/${adAccountId}?fields=name,currency,timezone_name,account_status,amount_spent,spend_cap,balance,disable_reason,funding_source_details&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json();
    if (json.error) throw new Error(`Meta: ${json.error.message}`);
    accountCache.set(adAccountId, json);
    return json;
  }

  function money(minorUnits: any, currency: string) {
    const n = Number(minorUnits);
    if (!Number.isFinite(n)) return null;
    return `${CURRENCY_SYMBOLS[currency] || `${currency} `}${(n / 100).toFixed(2)}`;
  }

  /**
 * Which token a Graph path needs.
 *
 * A PAGE-SCOPED path needs a PAGE token. A user token gets "(#190) This method must be
 * called with a Page Access Token" — which is what a live client's agent hit while trying
 * to read its own lead forms, and it read as a permissions failure when the page token on
 * the account was perfectly good.
 *
 * Ad-account paths keep the user token: swapping it there would break insights and
 * campaign management, which the page token cannot do.
 */
const PAGE_SCOPED_EDGES = new Set([
  'leadgen_forms',
  'leadgen_forms_data',
  'feed',
  'photos',
  'tagged',
  'promotable_posts',
  'messages',
  'conversations',
  'ratings',
  'subscribed_apps',
  'insights',
  'posts',
]);

function tokenForPath(
  path: string,
  credsValue: { token: string; pageId?: string | null; pageToken?: string | null }
): string {
  const { token, pageId, pageToken } = credsValue;
  if (!pageToken || !pageId) return token;
  const clean = String(path || '').replace(/^\/+/, '');
  const segments = clean.split(/[/?]/).filter(Boolean);
  const [head, edge] = [segments[0] || '', segments[1] || ''];
  if (head !== String(pageId)) return token;
  return PAGE_SCOPED_EDGES.has(edge) ? pageToken : token;
}


async function graphGet(path: string, params: Record<string, any>, token: string) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    qs.set('access_token', token);
    const res = await fetch(`${GRAPH}/${path.replace(/^\//, '')}?${qs.toString()}`);
    const json = await res.json();
    if (json.error) {
      const e = new Error(`Meta API error: ${json.error.message}`) as any;
      e.code = json.error.code;
      e.subcode = json.error.error_subcode;
      e.type = json.error.type;
      throw e;
    }
    return json;
  }

  async function graphPost(path: string, body: Record<string, any>, token: string) {
    const payload = new URLSearchParams();
    for (const [k, v] of Object.entries(body || {})) {
      if (v === undefined || v === null) continue;
      payload.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    payload.set('access_token', token);
    const res = await fetch(`${GRAPH}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      body: payload,
    });
    const json = await res.json();
    if (json.error) {
      const e = new Error(`Meta API error: ${json.error.message}`) as any;
      e.code = json.error.code;
      e.subcode = json.error.error_subcode;
      e.type = json.error.type;
      throw e;
    }
    return json;
  }

  const fail = (err: any) => ({ success: false, error: err?.message || 'Meta API call failed', code: err?.code, type: err?.type });

  /** Entity edge names for each manageable level. */
  const EDGE: Record<string, string> = {
    campaign: 'campaigns',
    adset: 'adsets',
    ad: 'ads',
    creative: 'adcreatives',
    audience: 'customaudiences',
    lead_form: 'leadgen_forms',
  };

  return {
    meta_graph_account: tool({
      description:
        'Meta Ads: the connected ad account\'s identity and health — name, currency, timezone, account status, total spent, spend cap, outstanding balance — plus every ad account this user token can reach. Call this first to learn the real currency before talking about budgets. ' +
        'Also reports whether the account can actually SPEND: paymentMethod.present, disableReason and readyToSpend, with a plain-English readinessWarning when something is missing. An ad account with no payment method accepts campaigns and then never delivers them, so check readyToSpend before you promise the owner any budget will run.',
      inputSchema: z.object({
        includeAccessibleAccounts: z.boolean().default(true).describe('Also list all ad accounts the token can access'),
      }),
      execute: async ({ includeAccessibleAccounts }) => {
        try {
          const { token, adAccountId } = await creds();
          const acct = await account(token, adAccountId);
          const currency = acct.currency || 'INR';

          let accessible: any[] | undefined;
          if (includeAccessibleAccounts) {
            const list = await graphGet('me/adaccounts', { fields: 'id,name,currency,account_status', limit: 50 }, token);
            accessible = (list.data || []).map((a: any) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status }));
          }

          // PAYMENT METHOD — the readiness check that was missing.
          // A campaign on an ad account with no funding source is accepted by Meta and then never
          // delivers, so the owner discovers it only after waiting for spend that cannot happen.
          // `funding_source_details` is the authoritative field; it is absent (or empty) exactly when
          // no payment method is attached. Reported plainly rather than left for the model to infer
          // from `account_status`, which stays ACTIVE in that state.
          const funding = acct.funding_source_details ?? null;
          const hasPaymentMethod = Boolean(funding && Object.keys(funding).length > 0);
          const adReady = hasPaymentMethod && Number(acct.account_status) === 1;
          const readinessWarning = !hasPaymentMethod
            ? 'NO PAYMENT METHOD on this ad account. Meta will accept a campaign and then not deliver it. ' +
              'Tell the owner to add a payment method in Meta Ads Manager before any budget is promised.'
            : Number(acct.account_status) !== 1
              ? `The ad account is not active (account_status ${acct.account_status}). Nothing will deliver until it is.`
              : null;

          return {
            success: true,
            adAccountId,
            name: acct.name,
            currency,
            timezone: acct.timezone_name,
            accountStatus: acct.account_status,
            amountSpent: money(acct.amount_spent, currency),
            spendCap: acct.spend_cap && Number(acct.spend_cap) > 0 ? money(acct.spend_cap, currency) : 'none',
            balance: money(acct.balance, currency),
            paymentMethod: {
              present: hasPaymentMethod,
              type: funding?.type ?? null,
              // Never echo the card digits or the funding id back into a chat transcript.
              lastFour: funding?.last_4 ?? null,
            },
            disableReason: acct.disable_reason ?? null,
            readyToSpend: adReady,
            readinessWarning,
            accessibleAccounts: accessible,
          };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_list: tool({
      description:
        'Meta Ads: lists entities in the ad account — campaigns, adsets, ads, adcreatives, custom audiences or lead forms — with the fields you ask for, filtering and paging. Use this to inspect the live state before changing anything.',
      inputSchema: z.object({
        entity: z.enum(['campaign', 'adset', 'ad', 'creative', 'audience', 'lead_form']).describe('What to list'),
        fields: z.string().optional().describe('Comma-separated Graph fields. Sensible defaults are used per entity when omitted.'),
        status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'ALL']).default('ALL').describe('Filter by effective status'),
        underId: z.string().optional().describe('Restrict to a parent id, e.g. list adsets under a campaign id'),
        limit: z.number().default(25).describe('Max entities (1-100)'),
        after: z.string().optional().describe('Paging cursor from a previous result'),
      }),
      execute: async ({ entity, fields, status, underId, limit, after }) => {
        try {
          const credential = await creds();
          const { token, adAccountId } = credential;
          const acct = await account(token, adAccountId);
          const currency = acct.currency || 'INR';

          const defaults: Record<string, string> = {
            campaign: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,created_time,start_time,stop_time',
            adset: 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting,start_time,end_time',
            ad: 'id,name,status,effective_status,adset_id,campaign_id,creative{id,name}',
            creative: 'id,name,status,object_story_spec,image_hash,video_id,effective_object_story_id',
            audience: 'id,name,approximate_count_lower_bound,approximate_count_upper_bound,subtype,delivery_status',
            lead_form: 'id,name,status,leads_count,created_time,questions',
          };

          const path = underId ? `${underId}/${EDGE[entity]}` : `${adAccountId}/${EDGE[entity]}`;
          const params: Record<string, any> = {
            fields: fields || defaults[entity],
            limit: Math.min(Math.max(limit || 25, 1), 100),
            after,
          };
          // `status: 'ALL'` means "do not filter". A caller that OMITS status entirely (allowed by the schema) used to
          // send `effective_status: [undefined]`, which Meta rejects with "(#100) effective_status[0] must be one of
          // the following values" — an error that reads like a permissions problem and is really a missing default.
          const statusFilter = String(status ?? 'ALL').trim();
          if (statusFilter && statusFilter.toUpperCase() !== 'ALL') params.effective_status = [statusFilter];

          // A lead form lives on the PAGE, not the ad account, so this path needs the page
          // token; `tokenForPath` hands it over for page-scoped edges and leaves every
          // ad-account path on the user token.
          const res = await graphGet(path, params, tokenForPath(path, credential));

          const rows = (res.data || []).map((r: any) => {
            const row: any = { ...r };
            if (r.daily_budget) row.daily_budget = money(r.daily_budget, currency);
            if (r.lifetime_budget) row.lifetime_budget = money(r.lifetime_budget, currency);
            return row;
          });

          return {
            success: true,
            entity,
            count: rows.length,
            currency,
            nextCursor: res.paging?.cursors?.after,
            items: rows,
          };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_get: tool({
      description:
        'Meta Ads: reads one entity in full by id — a campaign, adset, ad, creative or lead form. Use it to inspect an adset\'s real targeting, bids and schedule before you change or duplicate it.',
      inputSchema: z.object({
        id: z.string().describe('Entity id (campaign, adset, ad, creative or lead form)'),
        fields: z.string().optional().describe('Comma-separated fields; omit for a broad default'),
      }),
      execute: async ({ id, fields }) => {
        try {
          const { token } = await creds();
          const res = await graphGet(id, {
            fields:
              fields ||
              'id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,billing_event,optimization_goal,targeting,start_time,end_time,campaign_id,adset_id,creative,issues_info,questions',
          }, token);
          return { success: true, entity: res };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_create: tool({
      description:
        'Meta Ads: creates a campaign, adset, ad or adcreative. Provide the Graph fields for that entity (e.g. campaign: name, objective, status, special_ad_categories, daily_budget; adset: campaign_id, optimization_goal, billing_event, targeting, daily_budget; ad: adset_id, creative). Money values must be in minor units (50000 = 500.00). New spend is created PAUSED unless you explicitly set status ACTIVE. PRE-FLIGHT GUARDED: a campaign with no objective or no budget, or an ad set with no targeting, creates NOTHING and returns status "missing_inputs" with the questions to ask through request_user_input first.',
      inputSchema: z.object({
        entity: z.enum(['campaign', 'adset', 'ad', 'creative']).describe('What to create'),
        fields: z
          .record(z.string(), z.any())
          .describe('Graph API fields for this entity. Money in minor units. JSON objects/arrays allowed.'),
        parentId: z
          .string()
          .optional()
          .describe('Parent id when creating under a specific object, e.g. create an ad under an adset'),
      }),
      execute: async ({ entity, fields, parentId }) => {
        // PRE-FLIGHT GUARD. A campaign and an ad set are where real money and a
        // real audience first exist, so the inputs only the owner can supply are
        // checked before the POST. Creatives and ads are guarded by the campaign
        // that carries them and by the approval gate.
        if (entity === 'campaign' || entity === 'adset') {
          const f: Record<string, any> = fields || {};
          const toMajor = (minor: any) => {
            const n = Number(minor);
            return Number.isFinite(n) && n > 0 ? n / 100 : undefined;
          };
          const refusal = await campaignLaunchRefusal(
            entity === 'campaign'
              ? {
                  objective: f.objective,
                  budget: toMajor(f.daily_budget) ?? toMajor(f.lifetime_budget),
                  // A bare campaign draft carries no audience or creative yet:
                  // those are set on the ad set and the ad.
                  notRequired: ['locations', 'creative', 'qualifying_questions'],
                }
              : {
                  // The ad set is where the audience lives; it inherits the
                  // campaign's objective and, under CBO, its budget too.
                  locations: f.targeting,
                  budget: toMajor(f.daily_budget),
                  notRequired: ['objective', 'budget', 'creative', 'qualifying_questions'],
                },
            {
              tool: 'meta_graph_create',
              action: entity === 'campaign' ? 'create a campaign' : 'create an ad set',
              supabase,
              userId,
            }
          );
          if (refusal) return refusal;
        }

        try {
          const { token, adAccountId, pageId } = await creds();
          const body: Record<string, any> = { ...(fields || {}) };

          // Safety default: never create live spend implicitly.
          if (entity !== 'creative' && body.status === undefined) body.status = 'PAUSED';
          if (body.special_ad_categories === undefined) body.special_ad_categories = [];

          // The location types Meta still offers. "People living in this location"
          // (['home']) was removed from Ads Manager, so an ad set carrying it can be
          // created through the API but never published or edited in the UI. Callers
          // that send a targeting object get the surviving combination enforced.
          if (body.targeting && typeof body.targeting === 'object') {
            const geo = (body.targeting as any).geo_locations;
            if (geo && typeof geo === 'object') {
              (body.targeting as any).geo_locations = { ...geo, location_types: [...LOCATION_TYPES] };
            }
          }

          let path: string;
          if (entity === 'creative') {
            path = parentId ? `${parentId}/adcreatives` : `${adAccountId}/adcreatives`;
            if (body.object_story_spec && pageId && !body.object_story_spec.page_id) {
              body.object_story_spec.page_id = pageId;
            }
          } else if (entity === 'ad' && parentId) {
            path = `${parentId}/ads`;
          } else {
            path = `${adAccountId}/${EDGE[entity]}`;
          }

          const res = await graphPost(path, body, token);
          return {
            success: true,
            entity,
            id: res.id,
            status: body.status,
            message: `${entity} created${body.status ? ` (${body.status})` : ''}.`,
          };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_update: tool({
      description:
        'Meta Ads: updates an existing campaign, adset, ad or creative — rename, change budgets (minor units), bid strategy, schedule, targeting, or status. This is how you raise/lower budgets and retarget live entities.',
      inputSchema: z.object({
        id: z.string().describe('Entity id to update'),
        fields: z.record(z.string(), z.any()).describe('Graph fields to change, e.g. { daily_budget: 75000 } or { name: "New name" }'),
      }),
      execute: async ({ id, fields }) => {
        try {
          const { token } = await creds();
          await graphPost(id, fields || {}, token);
          return { success: true, id, updated: fields, message: 'Update applied.' };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_set_status: tool({
      description:
        'Meta Ads: the everyday control — pause, activate, archive or delete a campaign, adset or ad. Use PAUSED to stop spend immediately, ACTIVE to go live, ARCHIVED to retire. Prefer PAUSED over DELETED; deletion is destructive and cannot be undone.',
      inputSchema: z.object({
        id: z.string().describe('Campaign, adset or ad id'),
        status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED']).describe('Target status'),
      }),
      execute: async ({ id, status }) => {
        try {
          const { token } = await creds();
          await graphPost(id, { status }, token);
          return {
            success: true,
            id,
            status,
            destructive: status === 'DELETED',
            message:
              status === 'DELETED'
                ? 'Entity deleted. This cannot be undone.'
                : `Status set to ${status}.`,
          };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_insights: tool({
      description:
        'Meta Ads: performance reporting at any level — ad account, campaign, adset or ad — with a date preset or custom range, and optional breakdowns (age, gender, region, platform, placement). Returns spend, impressions, clicks, CTR, CPC, CPM, results and cost per result in the account currency.',
      inputSchema: z.object({
        level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign').describe('Aggregation level'),
        datePreset: z
          .enum(['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'maximum'])
          .default('last_30d')
          .describe('Relative window; ignored when since/until are given'),
        since: z.string().optional().describe('YYYY-MM-DD start'),
        until: z.string().optional().describe('YYYY-MM-DD end'),
        breakdowns: z
          .array(z.enum(['age', 'gender', 'region', 'country', 'publisher_platform', 'platform_position', 'device_platform', 'impression_device']))
          .optional()
          .describe('Optional breakdown dimensions'),
        campaignId: z.string().optional().describe('Restrict to one campaign id'),
        limit: z.number().default(25),
      }),
      execute: async ({ level, datePreset, since, until, breakdowns, campaignId, limit }) => {
        try {
          const { token, adAccountId } = await creds();
          const acct = await account(token, adAccountId);
          const currency = acct.currency || 'INR';

          const params: Record<string, any> = {
            level,
            fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,purchase_roas',
            limit: Math.min(Math.max(limit || 25, 1), 500),
          };
          if (since && until) params.time_range = { since, until };
          else params.date_preset = datePreset;
          if (breakdowns?.length) params.breakdowns = breakdowns.join(',');
          if (campaignId) {
            const filter = [{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }];
            params.filtering = filter;
          }

          const res = await graphGet(`${adAccountId}/insights`, params, token);

          const rows = (res.data || []).map((r: any) => {
            const leads = (r.actions || []).find((a: any) =>
              ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'].includes(a.action_type)
            );
            const costPerLead = (r.cost_per_action_type || []).find((a: any) => a.action_type === 'lead');
            return {
              campaign: r.campaign_name,
              adset: r.adset_name,
              ad: r.ad_name,
              spend: money(r.spend ? Number(r.spend) * 100 : 0, currency),
              impressions: Number(r.impressions || 0),
              clicks: Number(r.clicks || 0),
              ctr: r.ctr ? `${Number(r.ctr).toFixed(2)}%` : '0%',
              cpc: r.cpc ? money(Number(r.cpc) * 100, currency) : null,
              cpm: r.cpm ? money(Number(r.cpm) * 100, currency) : null,
              reach: r.reach ? Number(r.reach) : undefined,
              leads: leads ? Number(leads.value) : undefined,
              costPerLead: costPerLead ? money(Number(costPerLead.value) * 100, currency) : undefined,
              ...(breakdowns?.length
                ? Object.fromEntries(breakdowns.map((b) => [b, r[b]]))
                : {}),
            };
          });

          return {
            success: true,
            level,
            currency,
            window: since && until ? `${since} to ${until}` : datePreset,
            breakdowns: breakdowns || [],
            count: rows.length,
            rows,
            /**
             * THE UNFORMATTED ROWS, and the reason this exists.
             *
             * `rows` above is built for a human or a model to read: money becomes "₹2,000.00", CTR becomes
             * "1.25%", and the entity IDS ARE DROPPED. That is right for display and useless for arithmetic.
             * `recommendOptimisation` reads `row.spend`, `row.ctr`, `row.frequency` and `row.adset_id`, so
             * handed the display rows it computed NaN against everything and reported "nothing has crossed
             * the spend threshold" no matter what the account was actually doing — a judgement tool that
             * could never judge. Passing Meta's own objects through unchanged keeps the numbers numeric and
             * the ids attached, which is what both the optimiser and the learning pass need.
             */
            raw: res.data || [],
            nextCursor: res.paging?.cursors?.after,
            note: rows.length === 0 ? 'No delivery recorded for this window.' : undefined,
          };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_upload_image: tool({
      description:
        'Meta Ads: uploads an image from a public URL into the ad account and returns its image_hash. Required before creating an image ad creative — the creative must reference a hash, not a URL.',
      inputSchema: z.object({
        imageUrl: z.string().describe('Publicly reachable image URL'),
      }),
      execute: async ({ imageUrl }) => {
        try {
          const { token, adAccountId } = await creds();
          const img = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!img.ok) throw new Error(`Could not download image (HTTP ${img.status})`);

          const form = new FormData();
          form.append('source', await img.blob(), 'creative.jpg');
          form.append('access_token', token);

          const res = await fetch(`${GRAPH}/${adAccountId}/adimages`, { method: 'POST', body: form });
          const json = await res.json();
          if (json.error) throw new Error(`Meta image upload error: ${json.error.message}`);

          const key = Object.keys(json.images || {})[0];
          const hash = key ? json.images[key].hash : undefined;
          if (!hash) throw new Error('Meta did not return an image hash.');

          return { success: true, imageHash: hash, imageUrl, url: key ? json.images[key].url : undefined };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_leads: tool({
      description:
        'Meta Ads: retrieves lead-form submissions (names, phone numbers, email, custom question answers) for a lead form or the whole account. This is how the agent reads real enquiries generated by ads.',
      inputSchema: z.object({
        leadFormId: z.string().optional().describe('Restrict to one lead form id'),
        limit: z.number().default(25).describe('Max leads (1-100)'),
        after: z.string().optional().describe('Paging cursor'),
      }),
      execute: async ({ leadFormId, limit, after }) => {
        try {
          const { token, adAccountId } = await creds();
          const path = leadFormId ? `${leadFormId}/leads` : `${adAccountId}/leads`;
          const res = await graphGet(path, {
            fields: 'id,created_time,field_data,form_id,campaign_id,adset_id,ad_id',
            limit: Math.min(Math.max(limit || 25, 1), 100),
            after,
          }, token);

          const leads = (res.data || []).map((l: any) => {
            const out: Record<string, string> = {};
            for (const f of l.field_data || []) {
              out[f.name] = Array.isArray(f.values) ? f.values.join(', ') : String(f.values);
            }
            return { leadId: l.id, createdTime: l.created_time, formId: l.form_id, campaignId: l.campaign_id, adId: l.ad_id, fields: out };
          });

          return { success: true, count: leads.length, nextCursor: res.paging?.cursors?.after, leads };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_search_targeting: tool({
      description:
        'Meta Ads: searches Meta targeting options — interests, behaviours, demographics, cities, regions or countries — returning the exact `key` values that ad set targeting requires. Use before setting targeting so you never invent ids.',
      inputSchema: z.object({
        type: z
          .enum(['adinterest', 'adTargetingCategory', 'adgeolocation', 'adlocale'])
          .default('adinterest')
          .describe('What to search'),
        query: z.string().describe('Search term, e.g. "real estate", "Dubai", "luxury"'),
        locationTypes: z.array(z.string()).optional().describe('For adgeolocation, e.g. ["city","region","country"]'),
        limit: z.number().default(15),
      }),
      execute: async ({ type, query, locationTypes, limit }) => {
        try {
          const { token } = await creds();
          const params: Record<string, any> = { type, q: query, limit };
          if (type === 'adgeolocation') params.location_types = locationTypes || ['city', 'region', 'country'];
          const res = await graphGet('search', params, token);
          return { success: true, type, query, results: res.data || [] };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_custom_audience_list: tool({
      description:
        'Meta Ads: lists the ad account\'s CUSTOM AUDIENCES with id, name, subtype, approximate size, delivery status and whether it is usable. Call it before creating one (a duplicate audience splits your data) and when the owner asks what audiences exist.',
      inputSchema: z.object({
        limit: z.number().default(25).describe('How many to return'),
      }),
      execute: async ({ limit }) => {
        try {
          const { token, adAccountId } = await creds();
          const res = await graphGet(`${adAccountId}/customaudiences`, {
            fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_updated',
            limit,
          }, token);
          const audiences = (res.data || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            subtype: a.subtype ?? null,
            size: a.approximate_count_lower_bound ?? null,
            deliveryStatus: a.delivery_status?.code !== undefined ? String(a.delivery_status.code) : (a.delivery_status ?? null),
            operationStatus: a.operation_status?.code !== undefined ? String(a.operation_status.code) : (a.operation_status ?? null),
            updatedAt: a.time_updated ? new Date(Number(a.time_updated) * 1000).toISOString() : null,
          }));
          return { success: true, count: audiences.length, audiences };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    /**
     * A custom audience you can actually target, built from data the business already has.
     *
     * Three shapes, because they are the three things an owner asks for:
     *   crm_leads  — "put my Diwali audience into Meta" (phones come from the CRM, hashed here)
     *   phones     — an explicit list (a CSV pasted into chat, a partner's list)
     *   lookalike  — "find me more people like my buyers", from an existing audience
     *
     * Meta matches on SHA-256 hashes of normalised identifiers: the phone number must be digits with
     * the country code and no punctuation, so `+91 98765 43210` is hashed as `919876543210`. Getting
     * that wrong produces an audience that silently matches nobody, which is why the count is
     * re-read after the upload and reported.
     */
    meta_custom_audience_create: tool({
      description:
        'Meta Ads: creates a CUSTOM AUDIENCE for ad targeting. source "crm_leads" uploads the phone numbers of a CRM audience group (or filters) as a hashed customer list; "phones" uploads an explicit list; "lookalike" builds a lookalike from an existing audience id. It spends no money and messages nobody, but it does send customer contact data to Meta, so it needs the owner\'s approval first. Returns the audience id, the number of identifiers uploaded and Meta\'s own count once it has matched them.',
      inputSchema: z.object({
        name: z.string().describe('Audience name the owner will recognise, e.g. "Diwali 3BHK buyers"'),
        source: z.enum(['crm_leads', 'phones', 'lookalike']).describe('Where the audience comes from'),
        description: z.string().optional().describe('One line describing the audience'),
        audienceGroupName: z.string().optional().describe('source=crm_leads: a saved CRM audience group name'),
        filters: z
          .object({
            matchMode: z.enum(['OR', 'AND']).optional(),
            campaigns: z.array(z.string()).optional(),
            forms: z.array(z.string()).optional(),
            sources: z.array(z.string()).optional(),
            pipelineStages: z.array(z.string()).optional(),
            propertyIds: z.array(z.string()).optional(),
            csvAudiences: z.array(z.string()).optional(),
            dateRange: z.enum(['all', '7d', '30d', '90d', 'custom']).optional(),
            startDate: z.string().optional(),
            endDate: z.string().optional(),
          })
          .optional()
          .describe('source=crm_leads: filters instead of a saved group'),
        phones: z.array(z.string()).optional().describe('source=phones: numbers with country code'),
        emails: z.array(z.string()).optional().describe('source=phones: emails, in addition to or instead of phones'),
        countryCode: z.string().default('91').describe('Prepended to a 10-digit number that has no country code'),
        originAudienceId: z.string().optional().describe('source=lookalike: the audience to model on'),
        lookalikeCountry: z.string().default('IN').describe('source=lookalike: the country the lookalike is for'),
        lookalikeRatio: z.number().default(0.01).describe('source=lookalike: 0.01 = 1% of the country population'),
        customerFileSource: z
          .enum(['USER_PROVIDED_ONLY', 'PARTNER_PROVIDED_ONLY', 'BOTH_USER_AND_PARTNER_PROVIDED'])
          .default('USER_PROVIDED_ONLY')
          .describe('How the business obtained this data — Meta requires an honest answer'),
      }),
      execute: async (input: any) => {
        try {
          const { token, adAccountId } = await creds();
          const name = String(input?.name || '').trim();
          if (!name) return { success: false, error: 'an audience needs a name' };
          if (!adAccountId) return { success: false, error: 'no Meta ad account is connected to this profile' };

          const countryCode = String(input?.countryCode || '91').replace(/\D/g, '') || '91';

          // ── lookalike: one call, no upload
          if (input?.source === 'lookalike') {
            const originAudienceId = String(input?.originAudienceId || '').trim();
            if (!originAudienceId) {
              return { success: false, error: 'a lookalike needs originAudienceId — list audiences with meta_custom_audience_list' };
            }
            const body: any = {
              name,
              subtype: 'LOOKALIKE',
              origin_audience_id: originAudienceId,
              lookalike_spec: JSON.stringify({
                type: 'similarity',
                country: String(input?.lookalikeCountry || 'IN').toUpperCase(),
                ratio: Number(input?.lookalikeRatio ?? 0.01),
              }),
            };
            if (input?.description) body.description = String(input.description);
            const created = await graphPost(`${adAccountId}/customaudiences`, body, token);
            return {
              success: true,
              audienceId: created?.id ?? null,
              name,
              source: 'lookalike',
              originAudienceId,
              message:
                `Lookalike audience "${name}" created from ${originAudienceId} (${body.lookalike_spec}). ` +
                'Meta needs a few hours to populate it before it can be targeted.',
            };
          }

          // ── customer list: create the container, then upload hashed identifiers
          let phones: string[] = [];
          let emails: string[] = [];

          if (input?.source === 'crm_leads') {
            const { fetchLeadsForAudience } = await import('@/lib/audiences/groups');
            const { dateWindow, leadMatchesFilters, normaliseFilters } = await import('@/lib/audiences/filters');
            const { findAudienceGroup } = await import('@/lib/audiences/groups');

            let filters;
            if (input?.audienceGroupName) {
              const group = await findAudienceGroup(supabase, userId, { name: String(input.audienceGroupName) });
              if (!group) {
                const existing = await (await import('@/lib/audiences/groups')).listAudienceGroups(supabase, userId);
                return {
                  success: false,
                  error: `there is no CRM audience group called "${input.audienceGroupName}"`,
                  available: existing.map((g) => g.name),
                };
              }
              filters = group.filters;
            } else {
              filters = normaliseFilters(input?.filters);
            }

            const { leads } = await fetchLeadsForAudience(supabase, userId);
            const window = dateWindow(filters);
            const matched = leads.filter((lead) => leadMatchesFilters(lead, filters, window));
            phones = matched.map((l) => String(l.phone ?? '')).filter(Boolean);
            emails = matched.map((l) => String(l.email ?? '')).filter(Boolean);
            if (!phones.length && !emails.length) {
              return {
                success: false,
                error: 'no lead in that CRM audience has a phone number or email, so the Meta audience would be empty',
              };
            }
          } else {
            phones = Array.isArray(input?.phones) ? input.phones.map((p: any) => String(p)) : [];
            emails = Array.isArray(input?.emails) ? input.emails.map((e: any) => String(e)) : [];
            if (!phones.length && !emails.length) {
              return { success: false, error: 'give at least one phone number or email' };
            }
          }

          const hashedPhones = normalisePhoneList(phones, countryCode);
          const hashedEmails = normaliseEmailList(emails);
          if (!hashedPhones.length && !hashedEmails.length) {
            return { success: false, error: 'none of the identifiers were usable (empty or malformed), so nothing was uploaded' };
          }

          const createBody: any = {
            name,
            subtype: 'CUSTOM',
            customer_file_source: String(input?.customerFileSource || 'USER_PROVIDED_ONLY'),
            description: String(input?.description || 'Uploaded by the Nobogent agent').slice(0, 500),
          };
          const created = await graphPost(`${adAccountId}/customaudiences`, createBody, token);
          const audienceId = created?.id ? String(created.id) : '';
          if (!audienceId) {
            return { success: false, error: 'Meta did not return an audience id' };
          }

          let uploaded = 0;
          try {
            if (hashedPhones.length) {
              await graphPost(`${audienceId}/users`, {
                payload: { schema: ['PHONE'], data: hashedPhones.map((h) => [h]) },
              }, token);
              uploaded += hashedPhones.length;
            }
            if (hashedEmails.length) {
              await graphPost(`${audienceId}/users`, {
                payload: { schema: ['EMAIL'], data: hashedEmails.map((h) => [h]) },
              }, token);
              uploaded += hashedEmails.length;
            }
          } catch (uploadError: any) {
            return {
              success: false,
              audienceId,
              error:
                `the audience "${name}" was created but the upload failed: ${uploadError?.message || uploadError}. ` +
                'It exists and is empty — delete it in Meta or re-run the upload.',
            };
          }

          // Meta matches asynchronously; report its count so "uploaded 400" is never mistaken for
          // "400 people will see this ad".
          let matched: number | null = null;
          try {
            const detail = await graphGet(audienceId, {
              fields: 'approximate_count_lower_bound,delivery_status,operation_status',
            }, token);
            matched = detail?.approximate_count_lower_bound ?? null;
          } catch {
            /* the audience exists; the count is a nicety */
          }

          return {
            success: true,
            audienceId,
            name,
            source: input?.source,
            identifiersUploaded: uploaded,
            phones: hashedPhones.length,
            emails: hashedEmails.length,
            matchedByMeta: matched,
            message:
              `Custom audience "${name}" created with ${uploaded} hashed identifier(s)` +
              (matched !== null ? `; Meta currently matches about ${matched}.` : '; Meta matches them over the next few hours.') +
              ' It can be used in ad set targeting once populated.',
          };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),

    meta_graph_query: tool({
      description:
        'Meta Ads: direct escape hatch to the Graph API for anything the other tools do not cover — read or write any endpoint the connected token is authorised for (e.g. pixels, product catalogs, ad account rules, insights with exotic params, business assets). The access token is injected automatically.',
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'DELETE']).default('GET'),
        path: z
          .string()
          .describe('Graph path without the host, e.g. "act_123/insights", "me/adaccounts", "123456/rules"'),
        params: z.record(z.string(), z.any()).default({}).describe('Query params (GET/DELETE) or body fields (POST)'),
      }),
      execute: async ({ method, path, params }) => {
        try {
          const credential = await creds();
          const clean = String(path || '').replace(/^\/+/, '');
          if (/^https?:/i.test(clean)) {
            return { success: false, error: 'Pass a Graph path, not a full URL. The host is fixed to graph.facebook.com.' };
          }
          // Page-scoped paths (lead forms, page feed, page insights) need the page token.
          const token = tokenForPath(clean, credential);
          const data =
            method === 'GET'
              ? await graphGet(clean, params || {}, token)
              : await graphPost(clean, params || {}, token);
          return { success: true, method, path: clean, data };
        } catch (err: any) {
          return fail(err);
        }
      },
    }),
  };
}
