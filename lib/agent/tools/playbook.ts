/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped (stale generated types). */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getActivePlaybook } from '@/lib/automation/ceo';
import {
  applyPlaybookPatch,
  describePatch,
  PATCHABLE_SECTIONS,
  type PatchableSection,
} from '@/lib/automation/playbook-service';
import { resolveRecipes } from '@/lib/automation/recipes';

/**
 * Playbook tools — this is what makes the CEO answer to plain language.
 *
 * The user never edits a form. They say "warmer tone, skip videos on Sundays,
 * call people Sir"; the agent turns that into a structured patch and calls
 * update_playbook. Every write is a new VERSION, the previous one is archived,
 * and a failed write restores it — so behaviour is always explainable.
 *
 * Two invariants the agent cannot break, enforced in the service layer:
 *  - the three reply buttons always survive, with stable ids
 *  - only allowlisted sections can be written
 */
export function createPlaybookTools(supabase: SupabaseClient, userId: string) {
  const auto = supabase as any;

  const sectionEnum = z.enum(PATCHABLE_SECTIONS as unknown as [string, ...string[]]);

  return {
    get_playbook: tool({
      description:
        'Read the active playbook for this business: positioning, industry, website spec, call script, WhatsApp reply copy, the three mandatory reply buttons, cadence, the daily routine, and the first-draft recipes for creative/video/copy. Read this BEFORE answering any question about how the business is marketed or how the agent behaves. Read-only.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const playbook = await getActivePlaybook(auto, userId);
          const recipes = resolveRecipes((playbook as any).recipes);
          return {
            ok: true,
            playbook,
            recipes,
            // Always surface the button contract so the agent never proposes
            // removing it.
            button_contract: {
              ids: ['view_properties', 'talk_expert', 'book_appointment'],
              rule: 'These three are mandatory on every message to a lead. Labels may change; ids may not.',
            },
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not read the playbook' };
        }
      },
    }),

    update_playbook: tool({
      description:
        'Change how this business is marketed or how the agent behaves, from a natural-language request. Translate what the user asked into ONE structured patch: pick the section and supply only the keys that change (they are deep-merged, so unrelated settings survive). Sections: positioning, industry, website_spec, call_script, whatsapp_replies, buttons, cadence, daily_routine, recipes. The three reply buttons always survive a patch and their ids cannot be changed — you may only relabel them. Returns the new version number and the resulting buttons. Show the user what you changed after calling this.',
      inputSchema: z.object({
        section: sectionEnum,
        value: z
          .record(z.string(), z.any())
          .describe('Object of the keys to change within that section. Deep-merged over the current value.'),
        reason: z.string().optional().describe('One short sentence explaining the change, stored on the version.'),
      }),
      execute: async (input: any) => {
        try {
          const section = input.section as PatchableSection;
          const result = await applyPlaybookPatch(
            auto,
            userId,
            { section, value: input.value },
            { authoredBy: 'ceo', note: input.reason }
          );

          if (!result.ok) {
            return { ok: false, error: result.error || 'Patch rejected' };
          }

          return {
            ok: true,
            version: result.version,
            section,
            summary: describePatch({ section, value: input.value }),
            buttons: result.buttons,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not update the playbook' };
        }
      },
    }),
  };
}
