import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

const META_GRAPH_VERSION = 'v21.0';

/**
 * Meta Ads MCP Suite (Model Context Protocol).
 * Strictly scoped to the authenticated user's Facebook Token and Ad Account ID.
 * Completely industry-agnostic: supports any business type.
 */
export function createMetaAdsMcpTools(supabase: SupabaseClient, userId: string) {
  async function getUserMetaCredentials() {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('facebook_token, ad_account_id, selected_page_token, selected_page_id, business_name, mission_statement')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      throw new Error('User profile not found.');
    }

    const token = profile.facebook_token;
    const rawAccountId = profile.ad_account_id;

    if (!token || !rawAccountId) {
      throw new Error('Meta Ad Account is not connected. Please connect your Facebook/Meta account in Dashboard Settings.');
    }

    const adAccountId = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;
    return { token, adAccountId, profile };
  }

  return {
    meta_mcp_list_campaigns: tool({
      description: 'Meta Ads MCP: Lists all marketing campaigns in the user\'s Meta Ad Account with status, objective, budget, and spend.',
      inputSchema: z.object({
        statusFilter: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED', 'ALL']).default('ALL').describe('Filter by campaign status'),
        limit: z.number().default(20).describe('Max campaigns to retrieve'),
      }),
      execute: async ({ statusFilter, limit }) => {
        try {
          const { token, adAccountId } = await getUserMetaCredentials();

          let url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,created_time,start_time,stop_time&limit=${limit}&access_token=${token}`;

          if (statusFilter !== 'ALL') {
            url += `&effective_status=['${statusFilter}']`;
          }

          const res = await fetch(url);
          const data = await res.json();

          if (data.error) {
            return { success: false, error: data.error.message, code: data.error.code };
          }

          const campaigns = (data.data || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective,
            dailyBudget: c.daily_budget ? `₹${(parseInt(c.daily_budget, 10) / 100).toFixed(2)}` : null,
            lifetimeBudget: c.lifetime_budget ? `₹${(parseInt(c.lifetime_budget, 10) / 100).toFixed(2)}` : null,
            createdTime: c.created_time,
          }));

          return {
            success: true,
            adAccountId,
            total: campaigns.length,
            campaigns,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    meta_mcp_create_campaign: tool({
      description: 'Meta Ads MCP: Creates a new marketing campaign in Meta Ads (Lead Generation, Traffic, Engagement, Awareness, or Sales) for any business industry.',
      inputSchema: z.object({
        name: z.string().describe('Campaign name (e.g. Summer Launch Lead Gen)'),
        objective: z.enum([
          'OUTCOME_LEADS',
          'OUTCOME_TRAFFIC',
          'OUTCOME_ENGAGEMENT',
          'OUTCOME_AWARENESS',
          'OUTCOME_SALES',
        ]).default('OUTCOME_LEADS').describe('The campaign marketing objective'),
        dailyBudgetInr: z.number().describe('Daily budget in currency amount (e.g. 500 for 500/day)'),
        specialAdCategory: z.enum(['NONE', 'HOUSING', 'EMPLOYMENT', 'CREDIT']).default('NONE').describe('Special ad category if legally required (e.g. HOUSING for real estate, else NONE)'),
        status: z.enum(['PAUSED', 'ACTIVE']).default('PAUSED').describe('Default to PAUSED for safety so user can review before live spend'),
      }),
      execute: async ({ name, objective, dailyBudgetInr, specialAdCategory, status }) => {
        try {
          const { token, adAccountId } = await getUserMetaCredentials();

          const dailyBudgetSubunits = Math.round(dailyBudgetInr * 100);
          const categoryArray = specialAdCategory === 'NONE' ? '[]' : `["${specialAdCategory}"]`;

          const payload = new URLSearchParams({
            name,
            objective,
            status,
            special_ad_categories: categoryArray,
            daily_budget: dailyBudgetSubunits.toString(),
            access_token: token,
          });

          const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/campaigns`, {
            method: 'POST',
            body: payload,
          });

          const data = await res.json();
          if (data.error) {
            return { success: false, error: data.error.message, code: data.error.code };
          }

          return {
            success: true,
            campaignId: data.id,
            name,
            objective,
            status,
            dailyBudget: `${dailyBudgetInr}`,
            message: `Campaign "${name}" successfully created in Meta Ad Account (${status}).`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    meta_mcp_get_insights: tool({
      description: 'Meta Ads MCP: Fetches live analytics, cost per lead/acquisition (CPL/CPA), spend, impressions, clicks, and CTR for any campaign or the ad account. Supports presets (today, last_7d, last_14d, last_30d, maximum) OR custom time windows (e.g. timeRangeDays: 25 for last 25 days, or since/until dates).',
      inputSchema: z.object({
        campaignId: z.string().optional().describe('Specific campaign ID, or leave empty for total account performance'),
        datePreset: z.enum(['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month', 'maximum']).optional().describe('Standard Meta preset window. Ignored if timeRangeDays or since/until are provided.'),
        timeRangeDays: z.number().optional().describe('Number of past days (e.g. 25 for last 25 days). Computes exact since/until dates for Meta Graph API.'),
        since: z.string().optional().describe('Start date YYYY-MM-DD for custom range'),
        until: z.string().optional().describe('End date YYYY-MM-DD for custom range'),
        breakdownByCampaign: z.boolean().optional().describe('If true and inspecting ad account, also returns per-campaign spend breakdown for this time window'),
      }),
      execute: async ({ campaignId, datePreset, timeRangeDays, since, until, breakdownByCampaign }) => {
        try {
          const { token, adAccountId, profile } = await getUserMetaCredentials();
          const targetId = campaignId || adAccountId;

          // Compute date query parameter
          let dateQueryParam = '';
          let resolvedSince = since;
          let resolvedUntil = until;

          if (timeRangeDays && timeRangeDays > 0) {
            const now = new Date();
            resolvedUntil = now.toISOString().slice(0, 10);
            const pastDate = new Date(now.getTime() - timeRangeDays * 24 * 60 * 60 * 1000);
            resolvedSince = pastDate.toISOString().slice(0, 10);
            dateQueryParam = `time_range=${encodeURIComponent(JSON.stringify({ since: resolvedSince, until: resolvedUntil }))}`;
          } else if (resolvedSince && resolvedUntil) {
            dateQueryParam = `time_range=${encodeURIComponent(JSON.stringify({ since: resolvedSince, until: resolvedUntil }))}`;
          } else {
            const preset = datePreset || 'last_30d';
            dateQueryParam = `date_preset=${preset}`;
          }

          const fields = 'campaign_name,spend,impressions,clicks,cpc,cpm,ctr,actions,cost_per_action_type';
          const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${targetId}/insights?fields=${fields}&${dateQueryParam}&access_token=${token}`;

          const res = await fetch(url);
          const data = await res.json();

          if (data.error) {
            return { success: false, error: data.error.message, code: data.error.code, adAccountId };
          }

          const insights = data.data?.[0];
          if (!insights) {
            return {
              success: true,
              adAccountId,
              businessName: profile?.business_name,
              message: 'No ad spend or activity recorded for this date range.',
              dateRange: resolvedSince && resolvedUntil ? `${resolvedSince} to ${resolvedUntil}` : (datePreset || 'last_30d'),
            };
          }

          const spend = parseFloat(insights.spend || '0').toFixed(2);
          const leadsAction = (insights.actions || []).find((a: any) => a.action_type === 'lead');
          const costPerLead = (insights.cost_per_action_type || []).find((a: any) => a.action_type === 'lead');

          // Optional per-campaign breakdown if account-level insights were queried
          let campaignBreakdown = null;
          if (breakdownByCampaign && !campaignId) {
            try {
              const breakdownUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,actions&level=campaign&${dateQueryParam}&limit=25&access_token=${token}`;
              const bRes = await fetch(breakdownUrl);
              const bData = await bRes.json();
              if (bData.data) {
                campaignBreakdown = bData.data.map((c: any) => {
                  const cLeads = (c.actions || []).find((a: any) => a.action_type === 'lead');
                  return {
                    campaignId: c.campaign_id,
                    campaignName: c.campaign_name,
                    spend: `₹${parseFloat(c.spend || '0').toFixed(2)}`,
                    impressions: parseInt(c.impressions || '0', 10),
                    clicks: parseInt(c.clicks || '0', 10),
                    leads: cLeads ? parseInt(cLeads.value, 10) : 0,
                  };
                });
              }
            } catch (bErr) {
              // Ignore breakdown errors
            }
          }

          return {
            success: true,
            adAccountId,
            businessName: profile?.business_name,
            dateRange: resolvedSince && resolvedUntil ? `${resolvedSince} to ${resolvedUntil}` : (datePreset || 'last_30d'),
            windowDays: timeRangeDays || null,
            totalSpend: `₹${spend}`,
            rawSpend: parseFloat(insights.spend || '0'),
            impressions: parseInt(insights.impressions || '0', 10),
            clicks: parseInt(insights.clicks || '0', 10),
            ctr: `${parseFloat(insights.ctr || '0').toFixed(2)}%`,
            leadsGenerated: leadsAction ? parseInt(leadsAction.value, 10) : 0,
            costPerLead: costPerLead ? `₹${parseFloat(costPerLead.value).toFixed(2)}` : 'N/A',
            campaignBreakdown,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    meta_mcp_launch_leadgen_campaign: tool({
      description: 'Meta Ads MCP: Launches a complete, end-to-end Lead Generation campaign with High Intent Instant Lead Form, custom questions, target locations, ad creatives, and ad set.',
      inputSchema: z.object({
        campaignName: z.string().describe('Campaign name'),
        dailyBudgetInr: z.number().default(500).describe('Daily budget in INR (e.g. 500)'),
        imageUrl: z.string().describe('Public image URL for the ad creative'),
        adCopy: z.object({
          headline: z.string().describe('Ad headline (max 40 chars)'),
          primaryText: z.string().describe('Ad primary text copy'),
          description: z.string().default('View details & pricing').describe('Ad link subtext description'),
        }),
        formQuestions: z.array(z.object({
          label: z.string().describe('Question label text'),
          options: z.array(z.string()).describe('List of multiple choice options'),
        })).describe('Custom MCQ questions for the lead form'),
        highIntent: z.boolean().default(true).describe('Whether to enable Higher Intent review screen on the form'),
        whatsappRedirectUrl: z.string().describe('WhatsApp redirection URL on completion button (e.g. https://wa.me/919517831205)'),
        targetLocations: z.object({
          cities: z.array(z.object({
            key: z.string(),
            name: z.string().optional(),
            radius: z.number().default(25),
            distance_unit: z.enum(['kilometer', 'mile']).default('kilometer')
          })).optional(),
          regions: z.array(z.object({
            key: z.string(),
            name: z.string().optional(),
            country: z.string().default('IN')
          })).optional(),
          countries: z.array(z.string()).optional()
        }).optional(),
        ageMin: z.number().default(30),
        ageMax: z.number().default(65),
        status: z.enum(['ACTIVE', 'PAUSED']).default('ACTIVE'),
      }),
      execute: async ({
        campaignName,
        dailyBudgetInr,
        imageUrl,
        adCopy,
        formQuestions,
        highIntent,
        whatsappRedirectUrl,
        targetLocations,
        ageMin,
        ageMax,
        status,
      }) => {
        try {
          const { token, adAccountId, profile } = await getUserMetaCredentials();
          const pageId = profile.selected_page_id;

          if (!pageId) {
            throw new Error('No Facebook Page selected in profile. Please select a page first.');
          }

          // Resolve page token
          let pageAccessToken = profile.selected_page_token;
          if (!pageAccessToken && token && pageId) {
            try {
              const pRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}?fields=access_token&access_token=${token}`);
              const pData = await pRes.json();
              if (pData?.access_token) pageAccessToken = pData.access_token;
            } catch (e) {}
          }
          const tokenForPage = pageAccessToken || token;

          // 1. Upload Creative Image to Ad Account
          const imgFetch = await fetch(imageUrl);
          if (!imgFetch.ok) {
            throw new Error(`Failed to fetch image from URL: ${imageUrl} (status ${imgFetch.status})`);
          }
          const imgBlob = await imgFetch.blob();
          const formData = new FormData();
          formData.append('source', imgBlob, 'ad_creative.jpg');
          formData.append('access_token', token);

          const imgRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adimages`, {
            method: 'POST',
            body: formData,
          });
          const imgData = await imgRes.json();
          if (imgData.error || !imgData.images) {
            throw new Error(`Meta Ad Image upload error: ${imgData.error?.message || JSON.stringify(imgData)}`);
          }
          const imageHash = imgData.images[Object.keys(imgData.images)[0]].hash;

          // 2. Create High Intent Instant Lead Form
          const metaCustomQuestions = formQuestions.map(q => ({
            type: 'CUSTOM',
            label: q.label.trim(),
            options: q.options.map(opt => ({
              value: opt.trim(),
              key: opt.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50),
            })),
          }));

          const formPayload: any = {
            name: `Form - ${campaignName.slice(0, 40)} - ${Date.now().toString().slice(-4)}`,
            follow_up_action_url: whatsappRedirectUrl,
            question_page_custom_headline: 'Get Pricing & Details',
            question_page_custom_text: 'Confirm your details to view pricing & receive information on WhatsApp.',
            privacy_policy: {
              url: 'https://bioqueestatesinternational.com/privacy',
              link_text: 'Privacy Policy',
            },
            questions: [
              { type: 'FULL_NAME', key: 'full_name' },
              { type: 'PHONE', key: 'phone_number' },
              { type: 'EMAIL', key: 'email' },
              ...metaCustomQuestions,
            ],
            access_token: tokenForPage,
          };

          if (highIntent) {
            formPayload.is_optimized_for_quality = true;
          }

          const formRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pageId}/leadgen_forms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formPayload),
          });
          const formDataResp = await formRes.json();
          if (formDataResp.error || !formDataResp.id) {
            throw new Error(`Lead Form creation error: ${formDataResp.error?.message || JSON.stringify(formDataResp)}`);
          }
          const leadFormId = formDataResp.id;

          // 3. Create Campaign (CBO with daily budget)
          const dailyBudgetSubunits = Math.round(dailyBudgetInr * 100);
          const campaignPayload = {
            name: campaignName,
            objective: 'OUTCOME_LEADS',
            status,
            buying_type: 'AUCTION',
            daily_budget: dailyBudgetSubunits.toString(),
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            special_ad_categories: [],
            access_token: token,
          };

          const campRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(campaignPayload),
          });
          const campData = await campRes.json();
          if (campData.error || !campData.id) {
            throw new Error(`Campaign creation error: ${campData.error?.message || JSON.stringify(campData)}`);
          }
          const campaignId = campData.id;

          // 4. Create Ad Set
          const targetingConfig: any = {
            geo_locations: targetLocations || { countries: ['IN'], location_types: ['home'] },
            age_min: ageMin,
            targeting_automation: { advantage_audience: 0 },
            publisher_platforms: ['facebook', 'instagram'],
            device_platforms: ['mobile', 'desktop'],
          };
          if (ageMax < 65) {
            targetingConfig.age_max = ageMax;
          }

          const adSetPayload = {
            name: `${campaignName} - AdSet`,
            campaign_id: campaignId,
            billing_event: 'IMPRESSIONS',
            optimization_goal: 'LEAD_GENERATION',
            destination_type: 'ON_AD',
            promoted_object: { page_id: pageId },
            targeting: targetingConfig,
            status: 'ACTIVE',
            access_token: token,
          };

          const adsetRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adSetPayload),
          });
          const adsetData = await adsetRes.json();
          if (adsetData.error || !adsetData.id) {
            throw new Error(`AdSet creation error: ${adsetData.error?.message || JSON.stringify(adsetData)}`);
          }
          const adSetId = adsetData.id;

          // 5. Create Ad Creative
          const creativePayload = {
            name: `${campaignName} - Creative`,
            object_story_spec: {
              page_id: pageId,
              link_data: {
                message: adCopy.primaryText,
                name: adCopy.headline,
                description: adCopy.description,
                image_hash: imageHash,
                link: whatsappRedirectUrl,
                call_to_action: {
                  type: 'LEARN_MORE',
                  value: {
                    lead_gen_form_id: leadFormId,
                    link: whatsappRedirectUrl,
                  },
                },
              },
            },
            access_token: token,
          };

          const crRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/adcreatives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(creativePayload),
          });
          const crData = await crRes.json();
          if (crData.error || !crData.id) {
            throw new Error(`Ad Creative creation error: ${crData.error?.message || JSON.stringify(crData)}`);
          }
          const creativeId = crData.id;

          // 6. Create Ad
          const adPayload = {
            name: `${campaignName} - Ad`,
            adset_id: adSetId,
            creative: { creative_id: creativeId },
            status: 'ACTIVE',
            access_token: token,
          };

          const adRes = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${adAccountId}/ads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adPayload),
          });
          const adData = await adRes.json();
          if (adData.error || !adData.id) {
            throw new Error(`Ad creation error: ${adData.error?.message || JSON.stringify(adData)}`);
          }
          const adId = adData.id;

          return {
            success: true,
            campaignId,
            adSetId,
            adId,
            leadFormId,
            creativeId,
            imageHash,
            campaignName,
            status,
            dailyBudget: `₹${dailyBudgetInr}/day`,
            whatsappRedirectUrl,
            message: `Campaign "${campaignName}" successfully launched on Meta Ads!`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
