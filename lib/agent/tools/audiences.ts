import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findAudienceGroup,
  listAudienceGroups,
  previewAudience,
  saveAudienceGroup,
} from '@/lib/audiences/groups';
import { describeFilters, normaliseFilters } from '@/lib/audiences/filters';
import { createAudienceBroadcast } from '@/lib/whatsapp/broadcasts';

/**
 * Audience groups and campaigns, for the agent.
 *
 * The Audience Maker was a screen the agent could not reach at all: it could talk about "the Diwali
 * buyers" and had no way to find out who they were, let alone build the group or message it. That
 * left the single most requested shape of work — "make an audience and run a campaign" — impossible
 * without the UI.
 *
 * THE ORDER THAT MAKES THIS SAFE
 *   1. `preview_audience`  — free, read-only, and answers "how many people is that?" before anything
 *      is tagged or sent. The agent is told to use it first.
 *   2. `create_audience_group` — tags leads and saves the definition. Reversible, messages nobody.
 *   3. `whatsapp_broadcast_to_audience` — reaches real customers, so it is behind the review gate:
 *      the owner approves the exact template, audience and recipient count, or nothing happens.
 *
 * A group is stored the way the UI stores it (a tag on the leads plus an `Audience-Group:` row
 * holding the filters), because a group the agent builds and a group the owner builds must be the
 * same object — otherwise the CRM filter and the broadcast targeting disagree about who is in it.
 */

const filterSchema = z
  .object({
    matchMode: z.enum(['OR', 'AND']).optional().describe('OR = any filter matches (default), AND = all must match'),
    campaigns: z.array(z.string()).optional().describe('Meta campaign names exactly as the CRM shows them'),
    forms: z.array(z.string()).optional().describe('Lead-form names'),
    sources: z.array(z.string()).optional().describe('Lead sources, e.g. "Meta Ads", "99acres", "Website"'),
    pipelineStages: z.array(z.string()).optional().describe('Pipeline stages, e.g. "New", "Qualified", "Site Visit"'),
    propertyIds: z.array(z.string()).optional().describe('Property UUIDs'),
    csvAudiences: z.array(z.string()).optional().describe('Other audience-group names to intersect with'),
    dateRange: z.enum(['all', '7d', '30d', '90d', 'custom']).optional().describe('How recently the lead arrived'),
    startDate: z.string().optional().describe('For dateRange "custom": ISO date'),
    endDate: z.string().optional().describe('For dateRange "custom": ISO date'),
  })
  .describe('What selects the leads. Omit everything only when the whole lead book is really the audience.');

export function createAudienceTools(supabase: SupabaseClient, userId: string) {
  return {
    preview_audience: tool({
      description:
        'Count the leads an audience would contain, WITHOUT creating anything: give the filters (or an ' +
        'existing audience group name) and it returns the count, a few sample names, and a sentence ' +
        'describing the selection. Call this before create_audience_group or any campaign so the owner ' +
        'hears a real number before anything is tagged or sent.',
      inputSchema: z.object({
        name: z.string().optional().describe('An existing audience group to count instead of using filters'),
        filters: filterSchema.optional(),
        manualPhoneNumbers: z.array(z.string()).optional().describe('Specific numbers to include regardless of filters'),
      }),
      execute: async (input: any) => {
        try {
          let filters = input?.filters;
          let selection = '';
          if (input?.name) {
            const group = await findAudienceGroup(supabase, userId, { name: String(input.name) });
            if (!group) {
              const groups = await listAudienceGroups(supabase, userId);
              return {
                success: false,
                error: `there is no audience group called "${input.name}"`,
                available: groups.map((g) => g.name),
              };
            }
            filters = group.filters;
            selection = `${group.name} (saved group)`;
          }
          const preview = await previewAudience(supabase, userId, {
            filters,
            ...(input?.manualPhoneNumbers ? { manualPhoneNumbers: input.manualPhoneNumbers } : {}),
          });
          return {
            success: true,
            count: preview.count,
            selection: selection || preview.selection,
            sample: preview.sample,
            scanned: preview.scanned,
            capped: preview.capped,
            warning: preview.capped
              ? `only the first ${preview.scanned} leads were scanned, so the real count may be higher`
              : undefined,
            note: preview.unfiltered
              ? 'No filters were given, so this is EVERY lead on the account. Say so before acting on it.'
              : undefined,
            message: `${preview.count} lead(s) match ${selection || preview.selection}.`,
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),

    create_audience_group: tool({
      description:
        'Create (or refresh) a saved audience group: it tags every matching lead with the group name and ' +
        'records the filters, exactly like the Audience Maker. It messages nobody and spends nothing, and ' +
        're-running it re-syncs the group. Use preview_audience first and tell the owner the number. After ' +
        'it exists it can be used for a campaign in one step.',
      inputSchema: z.object({
        name: z.string().describe('Group name the owner will recognise, e.g. "Diwali 3BHK buyers"'),
        description: z.string().optional().describe('One line on why this audience exists'),
        filters: filterSchema.optional(),
        manualPhoneNumbers: z.array(z.string()).optional().describe('Numbers to include regardless of filters'),
      }),
      execute: async (input: any) => {
        try {
          const name = String(input?.name ?? '').trim();
          if (!name) return { success: false, error: 'an audience group needs a name' };
          const result = await saveAudienceGroup(supabase, userId, {
            name,
            description: input?.description ? String(input.description) : '',
            filters: input?.filters,
            ...(input?.manualPhoneNumbers ? { manualPhoneNumbers: input.manualPhoneNumbers } : {}),
          });
          const filters = normaliseFilters(input?.filters);
          return {
            success: true,
            audienceGroupId: result.id,
            name: result.name,
            leadCount: result.leadCount,
            newlyTagged: result.tagged,
            selection: describeFilters(filters),
            capped: result.capped,
            created: result.created,
            message:
              `${result.created ? 'Created' : 'Refreshed'} "${result.name}": ${result.leadCount} lead(s) in it` +
              ` (${result.tagged} newly tagged).`,
            next:
              'To message them, call whatsapp_broadcast_to_audience with this group name and an APPROVED template; ' +
              'that one asks the owner to approve before anything is sent.',
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),

    list_audience_groups: tool({
      description:
        'List the saved audience groups on this account: name, how many leads, when it was last synced, ' +
        'and what it selects. Use it before creating a group (duplicates are confusing) or when the owner ' +
        'asks what audiences exist.',
      inputSchema: z.object({
        limit: z.number().optional().describe('How many to return, default 25'),
      }),
      execute: async (input: any) => {
        try {
          const groups = await listAudienceGroups(supabase, userId);
          const limit = Math.min(Number(input?.limit ?? 25) || 25, 100);
          const shown = groups.slice(0, limit);
          return {
            success: true,
            count: groups.length,
            groups: shown.map((g) => ({
              id: g.id,
              name: g.name,
              leadCount: g.leadCount,
              lastSyncedAt: g.lastSyncedAt,
              selects: g.selection,
              description: g.description || undefined,
            })),
            message: groups.length
              ? `${groups.length} audience group(s): ${shown.map((g) => `${g.name} (${g.leadCount})`).join(', ')}`
              : 'There are no saved audience groups on this account yet.',
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),

    whatsapp_broadcast_to_audience: tool({
      description:
        'Start a WhatsApp campaign to an audience group (or to filters, or to one stage). It queues one ' +
        'recipient per reachable lead using an APPROVED template, and the scheduler sends them in batches. ' +
        'It needs human approval first — the review gate stages the exact template, audience and recipient ' +
        'count for the owner to approve, because a real customer receives every message. It refuses when ' +
        'the template is not approved, WhatsApp is not connected, or nobody is reachable.',
      inputSchema: z.object({
        title: z.string().describe('Campaign title the owner sees in the broadcasts list'),
        templateName: z.string().describe('An APPROVED WhatsApp template name (see nobogent_whatsapp_list_templates)'),
        audienceGroupName: z.string().optional().describe('Target a saved audience group by name'),
        filters: filterSchema.optional().describe('Or target filters directly, without saving a group'),
        stage: z.string().optional().describe('Or target a single pipeline stage'),
        scheduledAt: z.string().optional().describe('ISO timestamp to send later; omit to send on the next scheduler tick'),
        limit: z.number().optional().describe('Cap the recipients (useful for a small first send)'),
      }),
      execute: async (input: any) => {
        try {
          const filters = input?.filters ? normaliseFilters(input.filters) : null;
          const audienceFilter = filters
            ? {
                targetType: 'custom' as const,
                ...(filters.csvAudiences.length ? { csvAudiences: filters.csvAudiences } : {}),
                ...(filters.sources.length ? { sources: filters.sources } : {}),
                ...(filters.pipelineStages.length ? { pipelineStages: filters.pipelineStages } : {}),
                ...(filters.propertyIds.length ? { propertyIds: filters.propertyIds } : {}),
                ...(filters.campaigns.length ? { metaCampaigns: filters.campaigns } : {}),
              }
            : null;

          const result = await createAudienceBroadcast(supabase, {
            userId,
            title: String(input?.title ?? ''),
            templateName: String(input?.templateName ?? ''),
            audienceGroupName: input?.audienceGroupName ? String(input.audienceGroupName) : null,
            audienceFilter,
            recipientStage: input?.stage ? String(input.stage) : null,
            scheduledAt: input?.scheduledAt ? String(input.scheduledAt) : null,
            limit: input?.limit ? Number(input.limit) : null,
          });

          if (!result.ok) {
            return {
              success: false,
              error: result.error,
              problems: result.problems,
              audience: result.audience,
              unreachable: result.unreachable,
            };
          }

          return {
            success: true,
            broadcastId: result.broadcastId,
            recipients: result.recipients,
            audience: result.audience,
            template: result.template,
            scheduledFor: result.scheduledFor,
            unreachable: result.unreachable,
            message:
              `Queued "${input?.title}" to ${result.recipients} lead(s) in ${result.audience} using the template ` +
              `"${result.template}". The scheduler sends them in batches` +
              (result.scheduledFor ? ` from ${result.scheduledFor}.` : ' within about ten minutes.'),
            caveat: result.unreachable.length
              ? `${result.unreachable.length} matching lead(s) were skipped and are listed with the reason.`
              : undefined,
          };
        } catch (error: any) {
          return { success: false, error: String(error?.message || error) };
        }
      },
    }),
  };
}
