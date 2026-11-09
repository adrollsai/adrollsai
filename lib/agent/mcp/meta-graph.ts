import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

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
      `${GRAPH}/${adAccountId}?fields=name,currency,timezone_name,account_status,amount_spent,spend_cap,balance&access_token=${encodeURIComponent(token)}`
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
        'Meta Ads: the connected ad account\'s identity and health — name, currency, timezone, account status, total spent, spend cap, outstanding balance — plus every ad account this user token can reach. Call this first to learn the real currency before talking about budgets.',
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
          const { token, adAccountId } = await creds();
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
          if (status !== 'ALL') params.effective_status = [status];

          const res = await graphGet(path, params, token);

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
        'Meta Ads: creates a campaign, adset, ad or adcreative. Provide the Graph fields for that entity (e.g. campaign: name, objective, status, special_ad_categories, daily_budget; adset: campaign_id, optimization_goal, billing_event, targeting, daily_budget; ad: adset_id, creative). Money values must be in minor units (50000 = 500.00). New spend is created PAUSED unless you explicitly set status ACTIVE.',
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
        try {
          const { token, adAccountId, pageId } = await creds();
          const body: Record<string, any> = { ...(fields || {}) };

          // Safety default: never create live spend implicitly.
          if (entity !== 'creative' && body.status === undefined) body.status = 'PAUSED';
          if (body.special_ad_categories === undefined) body.special_ad_categories = [];

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
          const { token } = await creds();
          const clean = String(path || '').replace(/^\/+/, '');
          if (/^https?:/i.test(clean)) {
            return { success: false, error: 'Pass a Graph path, not a full URL. The host is fixed to graph.facebook.com.' };
          }
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
