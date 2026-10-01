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
      description: 'Meta Ads MCP: Fetches live analytics, cost per lead/acquisition (CPL/CPA), spend, impressions, clicks, and CTR for any campaign or the ad account.',
      inputSchema: z.object({
        campaignId: z.string().optional().describe('Specific campaign ID, or leave empty for total account performance'),
        datePreset: z.enum(['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'maximum']).default('last_7d'),
      }),
      execute: async ({ campaignId, datePreset }) => {
        try {
          const { token, adAccountId } = await getUserMetaCredentials();
          const targetId = campaignId || adAccountId;

          const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${targetId}/insights?fields=campaign_name,spend,impressions,clicks,cpc,cpm,ctr,actions,cost_per_action_type&date_preset=${datePreset}&access_token=${token}`;

          const res = await fetch(url);
          const data = await res.json();

          if (data.error) {
            return { success: false, error: data.error.message };
          }

          const insights = data.data?.[0];
          if (!insights) {
            return { success: true, message: 'No ad spend or activity recorded for this date range.', datePreset };
          }

          const spend = parseFloat(insights.spend || '0').toFixed(2);
          const leadsAction = (insights.actions || []).find((a: any) => a.action_type === 'lead');
          const costPerLead = (insights.cost_per_action_type || []).find((a: any) => a.action_type === 'lead');

          return {
            success: true,
            dateRange: datePreset,
            totalSpend: `${spend}`,
            impressions: parseInt(insights.impressions || '0', 10),
            clicks: parseInt(insights.clicks || '0', 10),
            ctr: `${parseFloat(insights.ctr || '0').toFixed(2)}%`,
            leadsGenerated: leadsAction ? parseInt(leadsAction.value, 10) : 0,
            costPerLead: costPerLead ? `${parseFloat(costPerLead.value).toFixed(2)}` : 'N/A',
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
