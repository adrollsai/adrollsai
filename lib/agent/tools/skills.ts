import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { houseSkill, houseSkillCatalogue } from '../house-skills';
import {
  vendoredSkill,
  vendoredSkillCatalogue,
  englishOnly,
  skillContentFor,
  vendoredReference,
  vendoredReferencesFor,
} from '../skills-vendor';
import { describeRoute, rankSkills, type RoutableSkill } from '../skill-router';

/**
 * Skills the business uploaded themselves.
 *
 * Same shape as our own skill catalogue: a cheap `description` in view, the full
 * `content` only when the agent decides the skill applies. That is what keeps a
 * client with twenty skills from paying for twenty bodies on every step — the
 * whole reason the catalogue is split rather than pasted into the prompt.
 *
 * The prompt carries only the *names and descriptions*, injected at context-build
 * time; these tools fetch and apply them.
 */
export function createSkillTools(supabase: SupabaseClient, userId: string) {
  return {
    list_skills: tool({
      description:
        'List every skill you can load, with a one-line description of each: the platform rules (names ' +
        'starting "nobogent-"), the vendored craft skills (design, meta ads, ad copy), and this business\'s own ' +
        'written procedures. Prefer pick_skill(requirement) over reading this list when you already know ' +
        'what the task is — it ranks them for you. Then get_skill with the ONE that applies.',
      inputSchema: z.object({}),
      execute: async () => {
        const platform = [...houseSkillCatalogue(), ...vendoredSkillCatalogue()];
        try {
          const { data, error } = await supabase
            .from('agent_skills')
            .select('name, description, updated_at')
            .eq('user_id', userId)
            .eq('enabled', true)
            .order('updated_at', { ascending: false });

          if (error) {
            if (/does not exist|schema cache/i.test(error.message)) {
              return {
                success: true,
                count: platform.length,
                skills: platform,
                message: 'Only platform skills are available; this business has not uploaded any of its own.',
              };
            }
            return { success: false, error: error.message };
          }

          const own = (data ?? []).map((skill: any) => ({ name: skill.name, description: skill.description }));
          return {
            success: true,
            count: platform.length + own.length,
            skills: [...platform, ...own],
            message:
              (own.length ? '' : 'This business has not uploaded its own skills. ') +
              'Call get_skill(name) to read the full instructions before acting.',
          };
        } catch (err: any) {
          // A database problem must not hide the platform rules.
          return {
            success: true,
            count: platform.length,
            skills: platform,
            message: 'Could not read this business\'s own skills; platform skills are listed.',
            warning: err?.message || String(err),
          };
        }
      },
    }),

    get_skill: tool({
      description:
        'Read the full instructions of one uploaded skill. Use it immediately after list_skills when a ' +
        'skill matches the task, and follow the skill over your own default approach. If the skill and ' +
        'the user\'s explicit instruction disagree, the user wins — say so rather than silently doing either.',
      inputSchema: z.object({
        name: z.string().describe('The exact skill name from list_skills'),
      }),
      execute: async ({ name }) => {
        // Platform rules first: a tenant cannot shadow a house rule by uploading a skill
        // with the same name, and the rule is readable even when the database is not.
        const platform = houseSkill(name);
        if (platform) {
          return {
            success: true,
            name: platform.name,
            description: platform.description,
            source: 'platform',
            content: platform.content,
            message: 'These are platform rules. Follow them; they are not advisory.',
          };
        }

        // Vendored, MIT-licensed craft skills. Same progressive disclosure: the body is
        // only read when the agent asks for it by name.
        const vendored = vendoredSkill(name);
        if (vendored) {
          // A skill with companion documents is useless if the agent cannot reach them: the body says
          // "see references/platform-specs.md" and that path does not exist here. So the names come back
          // with the body, and get_skill_reference fetches exactly one.
          const references = vendoredReferencesFor(vendored.name).map((reference) => ({
            name: reference.name,
            title: reference.title,
            description: reference.description,
          }));
          return {
            success: true,
            name: vendored.name,
            description: englishOnly(vendored.description),
            source: 'vendor',
            attribution: vendored.attribution,
            ...(references.length ? { references } : {}),
            // Most vendored bodies are English. `video-shotcraft` comes from a
            // Chinese-language upstream, and a Chinese document in context is enough
            // to pull a Chinese-trained model into answering in Chinese — so a
            // foreign-language body is handed over with an instruction to keep
            // answering the owner in their own language.
            content: skillContentFor(vendored),
            message:
              `Vendored from ${vendored.attribution.repo} (${vendored.attribution.licence}). ` +
              'Follow it where it applies; our own platform rules win where they disagree.' +
              (references.length
                ? ' It has reference documents: call get_skill_reference with one of the names in `references`' +
                  ' when the task needs those specifics — do not load them all.'
                : ''),
          };
        }

        try {
          const { data, error } = await supabase
            .from('agent_skills')
            .select('name, description, content, source_filename')
            .eq('user_id', userId)
            .ilike('name', name)
            .eq('enabled', true)
            .maybeSingle();

          if (error) return { success: false, error: error.message };
          if (!data) {
            const { data: all } = await supabase
              .from('agent_skills')
              .select('name')
              .eq('user_id', userId)
              .eq('enabled', true);
            return {
              success: false,
              error: `No skill named "${name}".`,
              available: [...houseSkillCatalogue().map((skill) => skill.name), ...(all || []).map((s: any) => s.name)],
            };
          }
          return {
            success: true,
            name: data.name,
            description: data.description,
            source: data.source_filename,
            content: data.content,
            message: 'Follow these instructions for the task at hand.',
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not load that skill.' };
        }
      },
    }),

    /**
     * Read one companion document of a vendored skill.
     *
     * `ad-creative` points at eleven reference files totalling ~160 KB — platform specs, the static
     * template library, the hook system, the format taxonomy, the strategy loop. Loading them with the
     * skill body would cost a turn the budget of a conversation, and loading none of them leaves the
     * skill referring to files that are not there. So this fetches exactly the one a task needs.
     *
     * It is deliberately NOT in the catalogue and NOT routable: it returns a document, it does not
     * decide anything, and eleven extra catalogue lines would make every routing decision worse.
     */
    get_skill_reference: tool({
      description:
        'Read one reference document that belongs to a vendored skill — for example the platform character ' +
        'limits, the static ad template library, or the hook system behind get_skill("ad-creative"). The names ' +
        'are listed in the `references` field of a get_skill result. Fetch the ONE the task needs; do not ' +
        'fetch several to be safe. These are upstream documents, so where one disagrees with a "nobogent-" ' +
        'platform rule or with the limits build_ad_creative_prompt reports, the platform rule wins.',
      inputSchema: z.object({
        name: z
          .string()
          .describe('The reference name from a skill\'s `references` list, e.g. "ad-creative--platform-specs"'),
      }),
      execute: async ({ name }: { name: string }) => {
        const reference = vendoredReference(name);
        if (!reference) {
          // Name the alternatives rather than only refusing: a bare "not found" makes the agent guess
          // again, and guessing is what the whole catalogue split exists to avoid.
          const available = [...new Set(vendoredReferencesFor(name.split('--')[0] || ''))].map((entry) => entry.name);
          return {
            success: false,
            error: `No reference document named "${name}".`,
            available: available.length ? available : undefined,
            hint: 'The exact names are listed under `references` in the get_skill result for the parent skill.',
          };
        }
        return {
          success: true,
          name: reference.name,
          title: reference.title,
          belongsTo: reference.belongsTo,
          description: reference.description,
          attribution: reference.attribution,
          content: reference.content,
          message:
            `Reference document of "${reference.belongsTo}", vendored from ${reference.attribution.repo} ` +
            `(${reference.attribution.licence}). Follow it where it applies; our platform rules win where they disagree.`,
        };
      },
    }),

    /**
     * The router. Instead of the agent guessing which of ~11 skills applies, or loading
     * several "to be safe", this ranks them against the requirement and returns the best
     * few with the words that matched. Costs nothing: no model call, no tokens beyond the
     * result.
     */
    pick_skill: tool({
      description:
        'Rank which skill applies to a task, before reading any of them. Returns the best one or two ' +
        'with the words that matched, so the choice can be checked. Prefer this to list_skills when you ' +
        'already know the requirement: it is deterministic and costs nothing. Then call get_skill with ' +
        'the winner — do NOT load several skills "to be safe", because each one costs prompt space.',
      inputSchema: z.object({
        requirement: z
          .string()
          .min(3)
          .describe('What you are about to do, in the user\'s own words (e.g. "landing page for a webinar")'),
        limit: z.number().optional().describe('How many matches to return; default 3'),
      }),
      execute: async ({ requirement, limit }: { requirement: string; limit?: number }) => {
        const routable: RoutableSkill[] = [
          ...houseSkillCatalogue().map((skill) => ({ ...skill, source: 'platform' as const })),
          ...vendoredSkillCatalogue().map((skill) => ({ ...skill, source: 'vendor' as const })),
        ];
        // Tenant skills are routable too, when the database is reachable.
        try {
          const { data } = await supabase
            .from('agent_skills')
            .select('name, description')
            .eq('user_id', userId)
            .eq('enabled', true);
          for (const row of data ?? []) {
            routable.push({
              name: String((row as any).name),
              description: String((row as any).description ?? ''),
              source: 'tenant',
            });
          }
        } catch {
          /* routing works without the tenant's own skills */
        }

        const matches = rankSkills(requirement, routable, { ...(limit ? { limit } : {}) });
        return {
          success: true,
          requirement,
          picks: matches,
          message: describeRoute(requirement, matches),
        };
      },
    }),
  };
}

/**
 * The catalogue line for the system prompt: names and descriptions only.
 *
 * Returns '' when the business has none, so the prompt is unchanged for everyone
 * who never uploads a skill.
 */
export function formatSkillCatalogue(skills: Array<{ name: string; description: string }>): string {
  // Platform rules are always in view, even for a business that has uploaded nothing:
  // they are the difference between a film that renders and one that renders wrongly.
  const platform = houseSkillCatalogue();
  const own = skills.filter((skill) => !/^nobogent-/i.test(skill.name));
  const all = [...platform, ...own];
  if (!all.length) return '';
  const lines = all
    .slice(0, 40)
    .map((skill) => `  - "${skill.name}": ${skill.description.replace(/\s+/g, ' ').slice(0, 160)}`);
  return `
SKILLS — read the one that applies before you improvise:
${lines.join('\n')}
Skills named "nobogent-…" are PLATFORM RULES (how video, creatives and pages must be
made here) and always apply. The rest are how THIS business does things. When a request
falls inside one, call 'get_skill' and follow it instead of your own default approach.
Do not mention the catalogue unless it is relevant.
`;
}
