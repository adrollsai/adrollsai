import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The other half of the CRM: changing a lead.
 *
 * The agent could read leads and create them, and that was all. "Move the Diwali batch to Site Visit
 * and note why" resolved to a truthful "I cannot do that" — a worse product than one that can, and
 * the missing half of every campaign follow-up.
 *
 * Two rules shape this:
 *   1. EVERY write leaves a `lead_history` row. The UI's own updates go through the browser and
 *      leave nothing; an agent changing 40 leads in a turn must be auditable, so each write writes
 *      the trail itself.
 *   2. DELETION IS GATED, ARCHIVING IS NOT. Archiving is reversible and is what "get this out of my
 *      pipeline" usually means; deleting rows cannot be undone, so it goes behind the review gate
 *      (REVIEW_POLICY `crm_delete_lead`) like every other irreversible action.
 *
 * Writes are scoped by `user_id` on every query, so a lead id from another tenant matches nothing.
 */

const STAGE_HINT =
  'New, Contacted, Qualified, Requirement Taken, Site Visit, Negotiation, Booked, Won, Lost';

async function recordHistory(
  supabase: SupabaseClient,
  leadId: string,
  userId: string,
  description: string
): Promise<void> {
  // Best effort by design: the lead change already happened, and a history insert failing must not
  // report the change as failed. It is logged loudly instead.
  try {
    await supabase.from('lead_history').insert({ lead_id: leadId, user_id: userId, action_type: 'REMARK', description });
  } catch (error: any) {
    console.warn('[CRM write] could not write lead_history:', error?.message || error);
  }
}

export function createCrmWriteTools(supabase: SupabaseClient, userId: string) {
  return {
    crm_update_lead_stage: tool({
      description:
        'Move a lead to a different pipeline stage and record why. This is the tool for "mark them as ' +
        'qualified", "move the interested ones to Site Visit", "close the lost ones". It writes the stage, ' +
        'keeps the old one in the lead history, and messages nobody.',
      inputSchema: z.object({
        leadId: z.string().describe('The lead id (UUID) — get it from nobogent_crm_query_leads'),
        stage: z.string().describe(`The new pipeline stage, e.g. ${STAGE_HINT}`),
        note: z.string().optional().describe('Why the stage changed — kept in the lead history'),
      }),
      execute: async (input: any) => {
        try {
          const leadId = String(input?.leadId ?? '').trim();
          const stage = String(input?.stage ?? '').trim();
          if (!leadId || !stage) return { success: false, error: 'leadId and stage are both required' };

          const { data: current } = await supabase
            .from('leads')
            .select('id, name, pipeline_stage')
            .eq('id', leadId)
            .eq('user_id', userId)
            .maybeSingle();
          if (!current) return { success: false, error: 'no such lead on this account' };

          const { data, error } = await supabase
            .from('leads')
            .update({ pipeline_stage: stage, status: stage, updated_at: new Date().toISOString() })
            .eq('id', leadId)
            .eq('user_id', userId)
            .select('id, name, pipeline_stage, status')
            .single();
          if (error) return { success: false, error: `the CRM refused the change: ${error.message}` };

          const previous = String((current as any).pipeline_stage ?? 'unknown');
          await recordHistory(
            supabase,
            leadId,
            userId,
            `Stage changed ${previous} → ${stage} by the agent${input?.note ? `: ${String(input.note)}` : ''}`
          );

          return {
            success: true,
            lead: data,
            previousStage: previous,
            message: `${(data as any)?.name || leadId} moved from ${previous} to ${stage}.`,
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),

    crm_update_lead: tool({
      description:
        'Update a lead\'s details: name, phone, email, notes, budget, next follow-up date, or stage. Use it to ' +
        'fill in what a conversation established ("budget is 80 lakh", "call back Tuesday"). Only the fields ' +
        'you pass are changed; the change is written to the lead history.',
      inputSchema: z.object({
        leadId: z.string().describe('The lead id (UUID)'),
        name: z.string().optional(),
        phone: z.string().optional().describe('Full number with country code'),
        email: z.string().optional(),
        notes: z.string().optional().describe('Notes about the requirement, context or feedback'),
        budget: z.string().optional().describe('Budget as text, e.g. "80 lakh"'),
        nextFollowUp: z.string().optional().describe('ISO timestamp for the next follow-up'),
        stage: z.string().optional().describe(`New pipeline stage, e.g. ${STAGE_HINT}`),
      }),
      execute: async (input: any) => {
        try {
          const leadId = String(input?.leadId ?? '').trim();
          if (!leadId) return { success: false, error: 'leadId is required' };

          const payload: Record<string, any> = { updated_at: new Date().toISOString() };
          const changed: string[] = [];
          for (const [key, column] of [
            ['name', 'name'],
            ['phone', 'phone'],
            ['email', 'email'],
            ['notes', 'notes'],
            ['budget', 'budget'],
            ['nextFollowUp', 'next_followup'],
          ] as const) {
            if (input?.[key] !== undefined && input?.[key] !== null && String(input[key]).trim() !== '') {
              payload[column] = String(input[key]);
              changed.push(column);
            }
          }
          if (input?.stage !== undefined && String(input.stage).trim()) {
            payload.pipeline_stage = String(input.stage).trim();
            payload.status = String(input.stage).trim();
            changed.push('pipeline_stage');
          }
          if (!changed.length) return { success: false, error: 'nothing to change — pass at least one field' };

          const { data, error } = await supabase
            .from('leads')
            .update(payload)
            .eq('id', leadId)
            .eq('user_id', userId)
            .select('id, name, phone, email, pipeline_stage, status, notes, budget, next_followup')
            .single();
          if (error) return { success: false, error: `the CRM refused the change: ${error.message}` };

          await recordHistory(supabase, leadId, userId, `Agent updated: ${changed.join(', ')}`);
          return {
            success: true,
            lead: data,
            changed,
            message: `Updated ${(data as any)?.name || leadId} (${changed.join(', ')}).`,
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),

    crm_archive_lead: tool({
      description:
        'Archive a lead: it leaves the pipeline (stage and status become "archived") but the record and its ' +
        'history stay. Use this instead of deleting when a lead is junk, a duplicate or closed for good. ' +
        'Reversible. Messages nobody.',
      inputSchema: z.object({
        leadId: z.string().describe('The lead id (UUID)'),
        reason: z.string().optional().describe('Why it is being archived — kept in the history'),
      }),
      execute: async (input: any) => {
        try {
          const leadId = String(input?.leadId ?? '').trim();
          if (!leadId) return { success: false, error: 'leadId is required' };

          const { data, error } = await supabase
            .from('leads')
            .update({ pipeline_stage: 'archived', status: 'archived', updated_at: new Date().toISOString() })
            .eq('id', leadId)
            .eq('user_id', userId)
            .select('id, name, pipeline_stage, status')
            .single();
          if (error) return { success: false, error: `the CRM refused the change: ${error.message}` };

          await recordHistory(supabase, leadId, userId, `Archived by the agent${input?.reason ? `: ${String(input.reason)}` : ''}`);
          return { success: true, lead: data, message: `${(data as any)?.name || leadId} archived (the record is kept).` };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),

    crm_delete_lead: tool({
      description:
        'PERMANENTLY delete a lead and its history. This cannot be undone, so it needs the owner\'s approval ' +
        'first (the review gate stages the exact lead for them). Prefer crm_archive_lead unless the owner ' +
        'explicitly asked for deletion.',
      inputSchema: z.object({
        leadId: z.string().describe('The lead id (UUID)'),
        reason: z.string().describe('Why it must be deleted — the owner sees this on the approval card'),
      }),
      execute: async (input: any) => {
        try {
          const leadId = String(input?.leadId ?? '').trim();
          if (!leadId) return { success: false, error: 'leadId is required' };

          const { data: lead } = await supabase
            .from('leads')
            .select('id, name, phone')
            .eq('id', leadId)
            .eq('user_id', userId)
            .maybeSingle();
          if (!lead) return { success: false, error: 'no such lead on this account' };

          const { error } = await supabase.from('leads').delete().eq('id', leadId).eq('user_id', userId);
          if (error) return { success: false, error: `the CRM refused the delete: ${error.message}` };

          return {
            success: true,
            deleted: { id: leadId, name: (lead as any).name ?? null },
            message: `Deleted ${(lead as any).name || leadId}. This cannot be undone.`,
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),
  };
}
