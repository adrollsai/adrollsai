import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function createCrmTools(supabase: SupabaseClient, userId: string) {
  return {
    query_leads: tool({
      description: 'Query leads from the CRM with flexible filters: stage/status, source (ads, website, whatsapp), date timeframe (today, yesterday, this_week, all), text search, and limit. Returns matched leads with names, phones, ad sources, campaigns, and timestamps.',
      inputSchema: z.object({
        stage: z.string().optional().describe('Filter by pipeline stage or status (e.g. New Lead, Qualified, Site Visit, Booking, Won, Lost)'),
        source: z.string().optional().describe('Filter by lead source or ad channel (e.g. "ads", "facebook", "whatsapp", "meta", "website")'),
        timeframe: z.enum(['today', 'yesterday', 'this_week', 'all']).default('all').describe('Filter leads by created date (today, yesterday, this_week, or all)'),
        search: z.string().optional().describe('Search query for lead name, phone number, notes, or ad campaign name'),
        limit: z.number().default(50).describe('Maximum number of leads to return (max 100)'),
      }),
      execute: async ({ stage, source, timeframe, search, limit }) => {
        try {
          let query = supabase
            .from('leads')
            .select('id, name, phone, email, pipeline_stage, status, source, ad_name, notes, created_at, budget, summary')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(Math.min(limit || 50, 100));

          if (stage) {
            query = query.or(`pipeline_stage.ilike.%${stage}%,status.ilike.%${stage}%`);
          }

          if (source) {
            const sLower = source.toLowerCase();
            if (sLower === 'ads' || sLower === 'ad' || sLower === 'meta' || sLower === 'facebook') {
              query = query.or('source.ilike.%ad%,source.ilike.%facebook%,source.ilike.%meta%,ad_name.not.is.null');
            } else {
              query = query.ilike('source', `%${source}%`);
            }
          }

          if (timeframe === 'today') {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            query = query.gte('created_at', startOfToday.toISOString());
          } else if (timeframe === 'yesterday') {
            const startOfYesterday = new Date();
            startOfYesterday.setDate(startOfYesterday.getDate() - 1);
            startOfYesterday.setHours(0, 0, 0, 0);
            const endOfYesterday = new Date();
            endOfYesterday.setHours(0, 0, 0, 0);
            query = query.gte('created_at', startOfYesterday.toISOString()).lt('created_at', endOfYesterday.toISOString());
          } else if (timeframe === 'this_week') {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            query = query.gte('created_at', weekAgo.toISOString());
          }

          if (search) {
            query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,notes.ilike.%${search}%,ad_name.ilike.%${search}%`);
          }

          const { data, error } = await query;
          if (error) throw error;

          return {
            success: true,
            count: data?.length || 0,
            leads: (data || []).map((l: any) => ({
              id: l.id,
              name: l.name || 'Unnamed Lead',
              phone: l.phone,
              email: l.email,
              stage: l.pipeline_stage || l.status || 'New Lead',
              source: l.source || 'Direct',
              adName: l.ad_name,
              notes: l.notes,
              createdAt: l.created_at,
              budget: l.budget,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    get_crm_metrics: tool({
      description: 'Fetches high-level CRM statistics including total leads, leads received today, leads from ads today, and breakdown by pipeline stages and sources.',
      inputSchema: z.object({
        timeframe: z.enum(['today', 'all']).default('all').describe('Filter metrics for today only or all-time'),
      }),
      execute: async ({ timeframe }) => {
        try {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          const isoToday = startOfToday.toISOString();

          // Fetch all leads for user to compute metrics
          let query = supabase
            .from('leads')
            .select('id, pipeline_stage, status, source, ad_name, created_at')
            .eq('user_id', userId);

          if (timeframe === 'today') {
            query = query.gte('created_at', isoToday);
          }

          const { data, error } = await query;
          if (error) throw error;

          const stages: Record<string, number> = {};
          const sources: Record<string, number> = {};
          let totalCount = 0;
          let leadsToday = 0;
          let adsLeadsToday = 0;

          (data || []).forEach((row: any) => {
            totalCount++;
            const s = (row.pipeline_stage || row.status || 'New Lead').trim();
            stages[s] = (stages[s] || 0) + 1;

            const src = (row.source || (row.ad_name ? 'Facebook Ads' : 'Direct')).trim();
            sources[src] = (sources[src] || 0) + 1;

            const isToday = row.created_at && row.created_at >= isoToday;
            if (isToday) {
              leadsToday++;
              const isAd = (row.source && /ad|meta|facebook/i.test(row.source)) || !!row.ad_name;
              if (isAd) {
                adsLeadsToday++;
              }
            }
          });

          return {
            success: true,
            totalLeads: totalCount,
            leadsReceivedToday: leadsToday,
            leadsFromAdsToday: adsLeadsToday,
            stageBreakdown: stages,
            sourceBreakdown: sources,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    update_lead_stage: tool({
      description: 'Updates a lead stage and status in the CRM (e.g. from New Lead to Qualified, Site Visit, or Won).',
      inputSchema: z.object({
        leadId: z.string().describe('The UUID of the lead'),
        newStage: z.string().describe('Target stage (e.g., Qualified, Booked, Requirement Taken, Won, Lost)'),
        note: z.string().optional().describe('Optional note detailing why the stage was changed'),
      }),
      execute: async ({ leadId, newStage, note }) => {
        try {
          const updatePayload: Record<string, any> = {
            pipeline_stage: newStage,
            status: newStage,
          };

          if (note) {
            updatePayload.notes = note;
          }

          const { data, error } = await supabase
            .from('leads')
            .update(updatePayload)
            .eq('id', leadId)
            .eq('user_id', userId)
            .select('id, name, pipeline_stage, status')
            .single();

          if (error) throw error;

          return {
            success: true,
            message: `Lead ${data.name || leadId} updated to stage '${newStage}'.`,
            lead: data,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    update_lead_details: tool({
      description: 'Updates lead details in the CRM including name, phone, email, notes, follow-up date, or budget.',
      inputSchema: z.object({
        leadId: z.string().describe('The UUID of the lead to update'),
        name: z.string().optional().describe('Updated full name'),
        phone: z.string().optional().describe('Updated phone number'),
        email: z.string().optional().describe('Updated email address'),
        stage: z.string().optional().describe('Updated pipeline stage/status'),
        notes: z.string().optional().describe('Notes, context, or feedback on this lead'),
        next_followup: z.string().optional().describe('ISO timestamp for next scheduled follow-up'),
        budget: z.string().optional().describe('Budget estimate or price point'),
      }),
      execute: async ({ leadId, name, phone, email, stage, notes, next_followup, budget }) => {
        try {
          const payload: Record<string, any> = {};

          if (name !== undefined) payload.name = name;
          if (phone !== undefined) payload.phone = phone;
          if (email !== undefined) payload.email = email;
          if (stage !== undefined) {
            payload.pipeline_stage = stage;
            payload.status = stage;
          }
          if (notes !== undefined) payload.notes = notes;
          if (next_followup !== undefined) payload.next_followup = next_followup;
          if (budget !== undefined) payload.budget = budget;

          const { data, error } = await supabase
            .from('leads')
            .update(payload)
            .eq('id', leadId)
            .eq('user_id', userId)
            .select('*')
            .single();

          if (error) throw error;

          return {
            success: true,
            message: `Lead ${data.name || leadId} successfully updated.`,
            lead: data,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    create_lead: tool({
      description: 'Creates a new lead directly in the CRM pipeline.',
      inputSchema: z.object({
        name: z.string().describe('Full name of the contact / lead'),
        phone: z.string().describe('Phone number with country code'),
        email: z.string().optional().describe('Email address'),
        stage: z.string().default('New Lead').describe('Initial pipeline stage (default: New Lead)'),
        source: z.string().default('AI Agent').describe('Lead source (e.g. Meta Ads, Website, Manual, WhatsApp)'),
        notes: z.string().optional().describe('Initial notes or requirements from the contact'),
      }),
      execute: async ({ name, phone, email, stage, source, notes }) => {
        try {
          const { data, error } = await supabase
            .from('leads')
            .insert({
              user_id: userId,
              name,
              phone,
              email: email || null,
              pipeline_stage: stage || 'New Lead',
              status: stage || 'New Lead',
              source: source || 'AI Agent',
              notes: notes || null,
              created_at: new Date().toISOString(),
            })
            .select('*')
            .single();

          if (error) throw error;

          return {
            success: true,
            message: `Lead ${name} (${phone}) created in CRM stage '${stage}'.`,
            lead: data,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    delete_or_archive_lead: tool({
      description: 'Archives or permanently deletes a lead from the CRM pipeline.',
      inputSchema: z.object({
        leadId: z.string().describe('The UUID of the lead to delete or archive'),
        action: z.enum(['archive', 'delete']).default('archive').describe('Whether to mark as archived or permanently delete'),
      }),
      execute: async ({ leadId, action }) => {
        try {
          if (action === 'delete') {
            const { error } = await supabase
              .from('leads')
              .delete()
              .eq('id', leadId)
              .eq('user_id', userId);

            if (error) throw error;
            return { success: true, message: `Lead ${leadId} permanently deleted.` };
          } else {
            const { data, error } = await supabase
              .from('leads')
              .update({ pipeline_stage: 'archived', status: 'archived' })
              .eq('id', leadId)
              .eq('user_id', userId)
              .select('id, name, pipeline_stage, status')
              .single();

            if (error) throw error;
            return { success: true, message: `Lead ${data.name || leadId} marked as archived.`, lead: data };
          }
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}
