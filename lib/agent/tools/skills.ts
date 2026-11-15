import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { houseSkill, houseSkillCatalogue } from '../house-skills';

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
        'List the skills you can load, with a one-line description of each. These are BOTH the ' +
        'platform rules for making videos, creatives and pages, and this business\'s own written ' +
        'procedures (how they write listings, qualify a lead, their brand voice). Call this BEFORE ' +
        'improvising an approach in their domain, then get_skill to read the one that applies. ' +
        'Skills whose name starts with "nobogent-" are platform rules and always apply.',
      inputSchema: z.object({}),
      execute: async () => {
        const platform = houseSkillCatalogue();
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
