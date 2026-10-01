import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function createCrmTools(supabase: SupabaseClient, userId: string) {
  return {
    query_leads: tool({
      description: 'Query leads from the CRM with flexible filters (stage, tag, search text, limit). Returns matched leads.',
      inputSchema: z.object({
        stage: z.string().optional().describe('Filter by pipeline stage (e.g. new, qualified, follow_up, booked, closed, dnp)'),
        search: z.string().optional().describe('Search query for lead name, phone number, or notes'),
        tag: z.string().optional().describe('Filter by specific lead tag'),
        limit: z.number().default(25).describe('Maximum number of leads to return (max 100)'),
      }),
      execute: async ({ stage, search, tag, limit }) => {
        try {
          let query = supabase
            .from('leads')
            .select('id, name, phone, email, stage, tags, notes, created_at, last_contacted_at, source')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(Math.min(limit, 100));

          if (stage) {
            query = query.ilike('stage', `%${stage}%`);
          }

          if (search) {
            query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,notes.ilike.%${search}%`);
          }

          if (tag) {
            query = query.contains('tags', [tag]);
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
              stage: l.stage || 'new',
              tags: l.tags || [],
              notes: l.notes,
              lastContact: l.last_contacted_at,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    get_crm_metrics: tool({
      description: 'Fetches high-level CRM statistics (total leads count, breakdown by stages, recent leads).',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { data, error } = await supabase
            .from('leads')
            .select('stage')
            .eq('user_id', userId);

          if (error) throw error;

          const stages: Record<string, number> = {};
          let total = 0;

          (data || []).forEach((row: any) => {
            total++;
            const s = (row.stage || 'new').toLowerCase();
            stages[s] = (stages[s] || 0) + 1;
          });

          return {
            success: true,
            totalLeads: total,
            stageBreakdown: stages,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    update_lead_stage: tool({
      description: 'Updates a lead stage in the CRM (e.g. from qualified to booked, or follow_up).',
      inputSchema: z.object({
        leadId: z.string().describe('The UUID of the lead'),
        newStage: z.string().describe('Target stage (e.g., qualified, booked, negotiation, closed, dnp)'),
        note: z.string().optional().describe('Optional note detailing why the stage was changed'),
      }),
      execute: async ({ leadId, newStage, note }) => {
        try {
          const updatePayload: Record<string, any> = {
            stage: newStage,
            updated_at: new Date().toISOString(),
          };

          if (note) {
            updatePayload.notes = note;
          }

          const { data, error } = await supabase
            .from('leads')
            .update(updatePayload)
            .eq('id', leadId)
            .eq('user_id', userId)
            .select('id, name, stage')
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
      description: 'Updates any lead details in the CRM including name, phone, email, notes, tags, follow-up date, or budget.',
      inputSchema: z.object({
        leadId: z.string().describe('The UUID of the lead to update'),
        name: z.string().optional().describe('Updated full name'),
        phone: z.string().optional().describe('Updated phone number (E.164 format or national)'),
        email: z.string().optional().describe('Updated email address'),
        stage: z.string().optional().describe('Updated pipeline stage (new, qualified, booked, closed, dnp)'),
        tags: z.array(z.string()).optional().describe('List of tags to assign to the lead'),
        notes: z.string().optional().describe('Notes, context, or feedback on this lead'),
        next_action_due_at: z.string().optional().describe('ISO timestamp for next scheduled action or follow-up'),
        budget: z.string().optional().describe('Budget estimate or price point'),
      }),
      execute: async ({ leadId, name, phone, email, stage, tags, notes, next_action_due_at, budget }) => {
        try {
          const payload: Record<string, any> = {
            updated_at: new Date().toISOString(),
          };

          if (name !== undefined) payload.name = name;
          if (phone !== undefined) payload.phone = phone;
          if (email !== undefined) payload.email = email;
          if (stage !== undefined) payload.stage = stage;
          if (tags !== undefined) payload.tags = tags;
          if (notes !== undefined) payload.notes = notes;
          if (next_action_due_at !== undefined) payload.next_action_due_at = next_action_due_at;
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
        stage: z.string().default('new').describe('Initial stage (default: new)'),
        source: z.string().default('ai_agent').describe('Lead source (e.g. meta_ads, website, manual, whatsapp)'),
        notes: z.string().optional().describe('Initial notes or requirements from the contact'),
        tags: z.array(z.string()).optional().describe('Tags to assign'),
        next_action_due_at: z.string().optional().describe('ISO timestamp when follow-up or check is due'),
      }),
      execute: async ({ name, phone, email, stage, source, notes, tags, next_action_due_at }) => {
        try {
          const { data, error } = await supabase
            .from('leads')
            .insert({
              user_id: userId,
              name,
              phone,
              email: email || null,
              stage: stage || 'new',
              source: source || 'ai_agent',
              notes: notes || null,
              tags: tags || [],
              next_action_due_at: next_action_due_at || null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
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
      description: 'Archives or deletes a lead from the CRM pipeline.',
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
              .update({ stage: 'archived', updated_at: new Date().toISOString() })
              .eq('id', leadId)
              .eq('user_id', userId)
              .select('id, name, stage')
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
