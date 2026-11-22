/* eslint-disable @typescript-eslint/no-explicit-any -- tool inputs and rows are untyped. */
/**
 * Calling campaigns as an agent action.
 *
 * `start_calling_campaign` queues real phones, so it is pre-flight guarded (a segment, an intent and a window are
 * required before anything is queued) AND review gated (an approval card carries the audience, the script intent and
 * how many people it will ring). `stop_calling_campaign` is deliberately NOT gated: making a mistake stop must never
 * wait for a tap, and it is the tool an owner reaches for when something is going wrong.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { bulkActionRefusal } from '../preflight';
import {
  DEFAULT_MAX_LEADS_PER_CAMPAIGN,
  HARD_MAX_LEADS_PER_CAMPAIGN,
  listCallingCampaigns,
  startCallingCampaign,
  stopCallingCampaign,
} from '@/lib/automation/calling-campaign';
import { CALLING_LANGUAGES, CALLING_VOICES, normaliseLanguage, normaliseVoice } from './voice';

export function createCallingCampaignTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  return {
    start_calling_campaign: tool({
      description:
        'Start an outbound AI CALLING campaign: it takes an audience (a saved group, filters, or explicit lead ids), a purpose and a voice, creates the campaign, attaches the leads and starts dialling through the same runner the Voice campaigns screen uses (inside the 9am-7pm IST calling window; the 5-minute cron continues the queue). HARD CAPPED at ' +
        `${HARD_MAX_LEADS_PER_CAMPAIGN} leads per step (default ${DEFAULT_MAX_LEADS_PER_CAMPAIGN}) - run it again for the next batch rather than ringing hundreds of people in one step. Requires the owner's approval, and it refuses to queue anything without a segment, a purpose and a calling window. Use it for "call my Diwali leads", "follow up by phone with everyone who enquired last week". For a single lead use nobogent_voice_dispatch_call.`,
      inputSchema: z.object({
        name: z.string().describe('Campaign name the owner will recognise'),
        purpose: z
          .string()
          .describe('What the call is about, in the owner\'s words ("confirm the site visit for Saturday", "re-engage Diwali enquiries")'),
        audience: z
          .object({
            groupName: z.string().optional().describe('A saved CRM audience group'),
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
              })
              .optional()
              .describe('Filters instead of a saved group'),
            leadIds: z.array(z.string()).optional().describe('Explicit lead ids'),
          })
          .describe('Who to call - exactly one of groupName, filters or leadIds'),
        voiceName: z.string().optional().describe(`Voice: one of ${CALLING_VOICES.join(', ')}`),
        language: z.string().optional().describe(`Starting language: one of ${CALLING_LANGUAGES.join(', ')}`),
        scriptNotes: z.string().optional().describe('Tone, what to confirm, what to offer - anything the purpose does not cover'),
        maxLeads: z.number().optional().describe(`How many leads to queue this step (default ${DEFAULT_MAX_LEADS_PER_CAMPAIGN}, max ${HARD_MAX_LEADS_PER_CAMPAIGN})`),
        concurrency: z.number().optional().describe('Simultaneous lines, 1-5'),
        startPaused: z.boolean().optional().describe('Create the campaign but do not dial yet'),
        when: z.string().optional().describe('When it should run: "now", a date, or a daily window. Ask the owner; never assume.'),
      }),
      execute: async (input: any) => {
        // PRE-FLIGHT: a call campaign rings real people. No segment, no intent, no window -> nothing queued.
        const refusal = await bulkActionRefusal(
          {
            channel: 'call',
            recipients: input?.audience?.leadIds?.length || input?.maxLeads || DEFAULT_MAX_LEADS_PER_CAMPAIGN,
            segment: input?.audience,
            messageIntent: input?.purpose,
            when: input?.when,
          },
          {
            tool: 'start_calling_campaign',
            action: 'start an outbound calling campaign',
            supabase,
            userId,
          }
        );
        if (refusal) return refusal;

        const voice = normaliseVoice(input?.voiceName || 'Aoede');
        if (voice.error) return { ok: false, error: voice.error };

        const language = normaliseLanguage(input?.language || 'hinglish');
        if (language.error) return { ok: false, error: language.error };

        try {
          const result = await startCallingCampaign(
            db,
            userId,
            {
              name: input.name,
              purpose: input.purpose,
              audience: input.audience || {},
              scriptNotes: input.scriptNotes,
              maxLeads: input.maxLeads,
              concurrency: input.concurrency,
              startPaused: input.startPaused === true,
            },
            { language: language.language!, voiceName: voice.voice! }
          );
          return result;
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the calling campaign could not be started; nothing was queued' };
        }
      },
    }),

    stop_calling_campaign: tool({
      description:
        'Stop an outbound calling campaign immediately: pauses it AND detaches the leads that have not been dialled yet, so the cron cannot pick them back up. Use it the moment an owner says stop, pause, or that a campaign is calling the wrong people. It needs no approval - stopping is always allowed.',
      inputSchema: z.object({
        campaignId: z.string().describe('The campaign to stop (list_calling_campaigns shows the ids)'),
      }),
      execute: async ({ campaignId }: any) => {
        try {
          return await stopCallingCampaign(db, userId, String(campaignId || ''));
        } catch (e: any) {
          return { ok: false, error: e?.message || 'could not stop the campaign' };
        }
      },
    }),

    list_calling_campaigns: tool({
      description:
        'List this business\'s calling campaigns with how far the dialling has got (queued, calling, completed, no answer, failed), newest first. Read this before starting another campaign, and when an owner asks "how is the calling going?".',
      inputSchema: z.object({
        limit: z.number().default(10).describe('How many campaigns to return (max 25)'),
      }),
      execute: async ({ limit }: any) => {
        try {
          return await listCallingCampaigns(db, userId, limit);
        } catch (e: any) {
          return { ok: false, error: e?.message || 'could not read the campaigns' };
        }
      },
    }),
  };
}

/** Names this module registers, so a gate can assert they are actually wired. */
export const CALLING_CAMPAIGN_TOOLS = [
  'start_calling_campaign',
  'stop_calling_campaign',
  'list_calling_campaigns',
] as const;
