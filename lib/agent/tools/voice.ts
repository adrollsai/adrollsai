/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows and business_info JSON are untyped. */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { bulkActionRefusal } from '../preflight';
import { applyPlaybookPatch } from '@/lib/automation/playbook-service';
import { getActivePlaybook } from '@/lib/automation/ceo';
import { callingScriptPatch, resolveCallingScript } from '@/lib/automation/calling-script';
import { CALL_SCENARIOS, parseVoiceScenarios, resolveCallPlan } from '@/lib/automation/calling-scenarios';

/**
 * The default calling agent, as something the owner can change in words.
 *
 * WHAT WAS WRONG
 * `update_default_voice_settings` existed but was never registered in the orchestrator, so the agent
 * did not have it at all. Worse, had it been registered it would have written the wrong places:
 *   - `profiles.default_calling_language` is not a column (the real value lives in
 *     `business_info.default_calling_language`, which is where the voice settings screen puts it),
 *     so every call would have failed with "column not found";
 *   - `systemPromptScript` was written to `profiles.custom_prompt`, which is the BRAND'S VISUAL
 *     STYLE prompt for creatives and video. "Change my calling script" would have silently
 *     rewritten the art direction for every future image.
 *
 * WHERE EACH SETTING ACTUALLY LIVES (verified against the code that reads them)
 *   voice + starting language + auto-call   -> profiles.voice_name / business_info.default_calling_language
 *                                              / profiles.auto_call_new_leads (read by the answer webhook)
 *   the words spoken on the call            -> the playbook's `call_script` section, resolved by
 *                                              lib/automation/calling-script.ts (campaign > playbook >
 *                                              dynamic > shipped default)
 *
 * So this module reads and writes exactly those, and never touches custom_prompt.
 */

/** The voices the product offers in its own settings screen. */
export const CALLING_VOICES = ['Aoede', 'Kore', 'Charon', 'Fenrir', 'Puck'] as const;
export type CallingVoice = (typeof CALLING_VOICES)[number];

/** Starting languages the voice settings screen offers. */
export const CALLING_LANGUAGES = [
  'hinglish',
  'english',
  'hindi',
  'punjabi',
  'kannada',
  'telugu',
  'tamil',
  'marathi',
  'gujarati',
  'bengali',
] as const;
export type CallingLanguage = (typeof CALLING_LANGUAGES)[number];

/** A script shorter than this is not a script, it is a fragment of one. */
const MIN_SCRIPT_CHARS = 40;

/** Match a caller's voice casing/wording to a real voice name. Pure, so it can be tested. */
export function normaliseVoice(raw: unknown): { voice?: CallingVoice; error?: string } {
  const wanted = String(raw ?? '').trim();
  if (!wanted) return { error: 'voiceName is empty' };
  const hit = CALLING_VOICES.find((v) => v.toLowerCase() === wanted.toLowerCase());
  if (hit) return { voice: hit };
  return {
    error: `"${wanted}" is not one of the voices this account can use. Pick one of: ${CALLING_VOICES.join(', ')}.`,
  };
}

/** How the owner actually says each language, mapped onto the stored value. */
const LANGUAGE_ALIASES: Record<string, CallingLanguage> = {
  'hindi english': 'hinglish',
  'hindi+english': 'hinglish',
  'hinglish': 'hinglish',
  'indian english': 'english',
  'english': 'english',
  'hindi': 'hindi',
};

/** Match a caller's language wording to a real starting language. Pure. */
export function normaliseLanguage(raw: unknown): { language?: CallingLanguage; error?: string } {
  const wanted = String(raw ?? '').trim().toLowerCase();
  if (!wanted) return { error: 'language is empty' };
  // "Hindi+English", "Hindi English", "Indian English" are all one answer in the owner's hands.
  const cleaned = wanted.replace(/\s*\+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const alias = LANGUAGE_ALIASES[cleaned];
  if (alias) return { language: alias };
  const hit = CALLING_LANGUAGES.find((l) => l === cleaned);
  if (hit) return { language: hit };
  const partial = CALLING_LANGUAGES.find((l) => cleaned.includes(l));
  if (partial) return { language: partial };
  return {
    error: `"${raw}" is not a starting language this account can use. Pick one of: ${CALLING_LANGUAGES.join(', ')}.`,
  };
}

/**
 * Is this a script the voice agent can actually speak?
 *
 * Deliberately structural rather than tasteful: it refuses the two failures that make a call worse
 * than no call - an empty/one-line fragment, and a script that claims to be a human being, which is
 * the one line the shipped default explicitly forbids.
 */
export function validateCallingScript(raw: unknown): { ok: boolean; error?: string; script?: string } {
  const script = String(raw ?? '').trim();
  if (!script) return { ok: false, error: 'The script is empty.' };
  if (script.length < MIN_SCRIPT_CHARS) {
    return {
      ok: false,
      error: `That script is ${script.length} characters. A calling script needs at least ${MIN_SCRIPT_CHARS} so the agent knows what it is doing on the call.`,
    };
  }
  if (script.length > 8000) {
    return { ok: false, error: 'That script is over 8,000 characters, which no caller can follow. Split it into the goal and the rules.' };
  }
  if (/\b(i am|i'm|this is)\s+(a\s+)?(real\s+)?human\b|\bpretend (to be|you are) (a )?human\b/i.test(script)) {
    return {
      ok: false,
      error:
        'A calling script may never claim to be a human being. Describe the role ("a property advisor calling on behalf of X") instead.',
    };
  }
  return { ok: true, script };
}

function parseBusinessInfo(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return { ...(raw as Record<string, any>) };
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A corrupt blob must not be silently overwritten: keep it verbatim so nothing is lost.
    return { _raw_text: String(raw) };
  }
}

export function createVoiceTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  const readProfile = async () => {
    const { data } = await db
      .from('profiles')
      .select('voice_name, auto_call_new_leads, voice_provider, business_info')
      .eq('id', userId)
      .maybeSingle();
    const bi = parseBusinessInfo(data?.business_info);
    return {
      voice: (data?.voice_name as string) || 'Aoede',
      language: (bi.default_calling_language as string) || 'hinglish',
      autoCall: data?.auto_call_new_leads === true,
      provider: (data?.voice_provider as string) || 'gemini',
      businessInfo: bi,
      /** Per-kind-of-call overrides, as stored in `business_info.voice_scenarios`. */
      scenarios: parseVoiceScenarios(bi?.voice_scenarios),
    };
  };

  const readScript = async () => {
    let playbook: any = null;
    try {
      playbook = await getActivePlaybook(db, userId);
    } catch {
      playbook = null;
    }
    const resolved = resolveCallingScript({
      playbook: playbook as any,
      industry: (playbook as any)?.industry ?? null,
    });
    return { playbook, resolved };
  };

  return {
    get_calling_defaults: tool({
      description:
        'Read the DEFAULT calling agent for this business: the voice character, the starting language, whether a new lead is called automatically, and the calling script itself (which layer it comes from, and the words). Read this before changing any of them, and before answering "what does your caller say?"',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const [profile, script] = await Promise.all([readProfile(), readScript()]);
          return {
            ok: true,
            voice: profile.voice,
            startingLanguage: profile.language,
            autoCallNewLeads: profile.autoCall,
            voiceProvider: profile.provider,
            availableVoices: [...CALLING_VOICES],
            availableLanguages: [...CALLING_LANGUAGES],
            callingScript: {
              source: script.resolved.source,
              // 'default' means the shipped, industry-neutral script: nothing has been authored yet.
              authored: script.resolved.source === 'playbook' || script.resolved.source === 'campaign',
              playbookVersion: (script.playbook as any)?.version ?? null,
              preview: script.resolved.script.slice(0, 600),
            },
            /**
             * One entry per kind of call, with what it sets and what it inherits.
             *
             * The agent has to be able to answer "what does my caller say when it chases a cold lead?"
             * and to change it, without the owner hunting through a settings page. Each entry is resolved
             * with a sample lead in that scenario, so the preview is the words that would actually be
             * spoken rather than the raw template.
             */
            scenarios: CALL_SCENARIOS.map((definition) => {
              const sample =
                definition.id === 'booked'
                  ? { booked_time: new Date().toISOString() }
                  : definition.id === 're-engage'
                    ? { pipeline_stage: 'Contacted', last_activity_at: new Date(Date.now() - 30 * 86_400_000).toISOString() }
                    : definition.id === 'follow-up'
                      ? { pipeline_stage: 'Contacted', last_activity_at: new Date().toISOString() }
                      : { pipeline_stage: 'New Lead' };
              const plan = resolveCallPlan({
                lead: sample,
                overrides: profile.scenarios,
                baseVoice: profile.voice,
                baseLanguage: profile.language,
                playbook: script.playbook as any,
                industry: (script.playbook as any)?.industry ?? null,
              });
              return {
                id: definition.id,
                label: definition.label,
                when: definition.when,
                purpose: definition.purpose,
                customised: !plan.inherited,
                scriptSource: plan.scriptSource,
                voice: plan.voice,
                voiceSource: plan.voiceSource,
                language: plan.language,
                languageSource: plan.languageSource,
                openingLine: plan.firstMessage,
                scriptPreview: plan.script.slice(0, 400),
              };
            }),
            where: {
              voice: 'profiles.voice_name',
              startingLanguage: 'business_info.default_calling_language',
              autoCall: 'profiles.auto_call_new_leads',
              callingScript: "the active playbook's call_script section",
              scenarioOverrides: 'business_info.voice_scenarios (empty field = inherit the default above)',
            },
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not read the calling defaults' };
        }
      },
    }),

    update_default_voice_settings: tool({
      description:
        'Change the DEFAULT calling agent this business uses for new leads and follow-up calls: the voice, the starting language, whether new leads are called automatically, and the calling script (the words spoken). Supply only what changes. The script is stored on the playbook as call_script.script, NOT in a profile field, and the brand visual style is left untouched. Changing THE SCRIPT or switching auto-calling ON needs the owner\'s approval first (it is what a real customer hears); voice and language changes apply immediately.',
      inputSchema: z.object({
        voiceName: z
          .string()
          .optional()
          .describe(`Voice character: one of ${CALLING_VOICES.join(', ')}`),
        defaultCallingLanguage: z
          .string()
          .optional()
          .describe(`Starting language: one of ${CALLING_LANGUAGES.join(', ')}`),
        autoCallNewLeads: z
          .boolean()
          .optional()
          .describe('Whether a new lead is phoned automatically as soon as it enters the CRM'),
        systemPromptScript: z
          .string()
          .optional()
          .describe(
            'The calling script: role, goal and rules in the owner\'s words. Placeholders {{name}}, {{business}}, {{products}} are filled per lead. This is what the agent says on the phone.'
          ),
        firstMessage: z
          .string()
          .optional()
          .describe('The opening line, used verbatim. Keep it one sentence ending in a question.'),
      }),
      execute: async (input: any) => {
        try {
          const changed: string[] = [];
          const refused: string[] = [];

          // ---- voice + language + auto-call live on the profile.
          const updatePayload: Record<string, any> = {};
          const current = await readProfile();

          if (input.voiceName !== undefined) {
            const norm = normaliseVoice(input.voiceName);
            if (norm.error) refused.push(norm.error);
            else if (norm.voice !== current.voice) {
              updatePayload.voice_name = norm.voice;
              changed.push(`voice: ${current.voice} -> ${norm.voice}`);
            }
          }

          let nextLanguage = current.language;
          if (input.defaultCallingLanguage !== undefined) {
            const norm = normaliseLanguage(input.defaultCallingLanguage);
            if (norm.error) refused.push(norm.error);
            else if (norm.language !== current.language) {
              nextLanguage = norm.language!;
              changed.push(`starting language: ${current.language} -> ${norm.language}`);
            }
          }

          if (input.autoCallNewLeads !== undefined) {
            const wanted = input.autoCallNewLeads === true;
            if (wanted !== current.autoCall) {
              updatePayload.auto_call_new_leads = wanted;
              changed.push(`auto-call new leads: ${current.autoCall} -> ${wanted}`);
            }
          }

          if (Object.keys(updatePayload).length) {
            if (input.defaultCallingLanguage !== undefined && nextLanguage !== current.language) {
              // business_info is JSON (sometimes a string): merge, never replace, so claimed numbers
              // and KYC data survive.
              const merged = { ...current.businessInfo, default_calling_language: nextLanguage };
              updatePayload.business_info = JSON.stringify(merged);
            }
            const { error } = await db.from('profiles').update(updatePayload).eq('id', userId);
            if (error) return { ok: false, error: `Could not save the voice settings: ${error.message}` };
          }

          // ---- the script lives on the playbook.
          let scriptResult: any = null;
          if (input.systemPromptScript !== undefined || input.firstMessage !== undefined) {
            const check = input.systemPromptScript !== undefined
              ? validateCallingScript(input.systemPromptScript)
              : { ok: true as const, script: undefined };
            if (!check.ok) {
              refused.push(check.error!);
            } else {
              const patch = callingScriptPatch(check.script || '', input.firstMessage || null);
              const applied = await applyPlaybookPatch(db, userId, patch as any, {
                authoredBy: 'ceo',
                note: 'Calling script changed through the agent',
              });
              if (!applied.ok) {
                refused.push(`The calling script was not saved: ${applied.error || 'unknown error'}`);
              } else {
                scriptResult = { playbookVersion: applied.version, scriptChars: (check.script || '').length };
                changed.push(
                  check.script
                    ? `calling script: rewritten (${(check.script || '').length} characters, playbook v${applied.version})`
                    : `first message: updated (playbook v${applied.version})`
                );
              }
            }
          }

          if (!changed.length && refused.length) {
            return { ok: false, error: refused.join(' '), refused };
          }

          const after = await readProfile();
          return {
            ok: true,
            changed,
            refused: refused.length ? refused : undefined,
            voice: after.voice,
            startingLanguage: after.language,
            autoCallNewLeads: after.autoCall,
            script: scriptResult,
            message: changed.length
              ? 'Saved. These are the defaults used for new leads and follow-up calls; the next call will use them.'
              : 'Nothing changed: the values supplied were already in place.',
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not update the calling defaults' };
        }
      },
    }),

    get_call_history: tool({
      description:
        'Fetches recent outbound AI phone call history, transcripts, and status (completed, busy, no-answer, failed).',
      inputSchema: z.object({
        limit: z.number().default(10).describe('Number of recent calls to retrieve'),
        status: z.string().optional().describe('Filter by status (e.g. completed, busy, no-answer)'),
      }),
      execute: async ({ limit, status }: any) => {
        try {
          let q = db
            .from('call_logs')
            .select('id, lead_id, phone_number, duration, status, recording_url, summary, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(Math.min(Math.max(Number(limit) || 10, 1), 50));

          if (status) q = q.eq('status', status);

          const { data, error } = await q;
          if (error) throw error;

          return {
            success: true,
            count: data?.length || 0,
            calls: (data || []).map((c: any) => ({
              id: c.id,
              phone: c.phone_number,
              duration: `${c.duration || 0}s`,
              status: c.status,
              summary: c.summary || 'No summary available',
              hasRecording: !!c.recording_url,
              time: c.created_at,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    /**
     * Kept, but deliberately NOT registered in the orchestrator.
     *
     * It only ever returns an approval payload; nothing in the app executes an approved
     * `bulk_call` action, so wiring it would put a card on the owner's screen whose approval does
     * nothing at all - worse than not offering it. Bulk calling already has a real, gated path:
     * `nobogent_voice_dispatch_call` and the voice campaign runner in the UI.
     */
    launch_bulk_calling_campaign: tool({
      description:
        'Launches or prepares a separate, on-demand bulk outbound AI calling campaign to a filtered list of leads using a custom one-time campaign script and voice. Kept completely separate from the default ongoing follow-up bot. PRE-FLIGHT GUARDED: without a segment, a script intent and an explicit calling window it launches NOTHING and returns status "missing_inputs" with the questions to ask through request_user_input first.',
      inputSchema: z.object({
        leadIds: z.array(z.string()).describe('Target lead UUIDs to call in this blast'),
        campaignName: z.string().describe('Campaign name (e.g., "Festive Offer Blast", "Weekend Site Visit Push")'),
        customCampaignScript: z.string().describe('The dedicated one-time pitch/script for this bulk campaign'),
        voiceName: z.string().default('Aoede').describe('Voice character for this campaign'),
        concurrency: z.number().default(3).describe('Number of simultaneous calls (1-5)'),
        when: z.string().optional().describe('When the calls should start - "now", a date/time, or a daily window. Ask the owner; never assume.'),
      }),
      execute: async ({ leadIds, campaignName, customCampaignScript, voiceName, concurrency, when }: any) => {
        const refusal = await bulkActionRefusal(
          {
            channel: 'call',
            recipients: Array.isArray(leadIds) ? leadIds.length : 0,
            segment: leadIds,
            messageIntent: customCampaignScript,
            when,
          },
          {
            tool: 'launch_bulk_calling_campaign',
            action: `launch a calling campaign to ${Array.isArray(leadIds) ? leadIds.length : 0} leads`,
            supabase,
            userId,
          }
        );
        if (refusal) return refusal;

        try {
          const totalCalls = leadIds.length;
          const estimatedCostInr = (totalCalls * 2.5).toFixed(2); // Avg telephony cost

          return {
            success: true,
            requiresApproval: true,
            campaignName,
            totalCalls,
            concurrency,
            estimatedCost: `Rs ${estimatedCostInr}`,
            actionPayload: {
              actionType: 'bulk_call',
              title: `Launch Calling Campaign: "${campaignName}"`,
              description: `On-demand blast to ${totalCalls} leads with custom script using voice "${voiceName}". Concurrency: ${concurrency} simultaneous lines.`,
              estimatedCost: `Rs ${estimatedCostInr}`,
              payload: {
                leadIds,
                campaignName,
                customCampaignScript,
                voiceName,
                concurrency,
              },
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}

/**
 * The subset the orchestrator registers.
 *
 * Named here rather than spread inline so the "never wired at all" mistake has one obvious place to
 * be checked, and so a tool with no executor behind it cannot be added by accident.
 */
export const REGISTERED_VOICE_TOOLS = [
  'get_calling_defaults',
  'update_default_voice_settings',
  'get_call_history',
] as const;

/**
 * The map the orchestrator spreads in: exactly `REGISTERED_VOICE_TOOLS`, nothing else.
 *
 * This is the one-line fix for the whole class of bug this module was carrying - a tool that
 * exists, is described in the UI's label table, and is never handed to the model.
 */
export function createRegisteredVoiceTools(supabase: SupabaseClient, userId: string) {
  const all = createVoiceTools(supabase, userId) as Record<string, any>;
  const picked: Record<string, any> = {};
  for (const name of REGISTERED_VOICE_TOOLS) picked[name] = all[name];
  return picked;
}
