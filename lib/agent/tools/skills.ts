import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

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
        'List the skills this business has uploaded, with a one-line description of each. ' +
        'A skill is the client\'s own written procedure — how they write listings, how they qualify a ' +
        'lead, their brand voice, their objection handling. Call this BEFORE improvising an approach ' +
        'in their domain: if a skill exists for the task, follow it rather than inventing one. ' +
        'Then call get_skill to read the full instructions.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { data, error } = await supabase
            .from('agent_skills')
            .select('name, description, updated_at')
            .eq('user_id', userId)
            .eq('enabled', true)
            .order('updated_at', { ascending: false });

          if (error) {
            if (/does not exist|schema cache/i.test(error.message)) {
              return { success: true, count: 0, skills: [], message: 'No skills have been uploaded yet.' };
            }
            return { success: false, error: error.message };
          }
          if (!data?.length) {
            return {
              success: true,
              count: 0,
              skills: [],
              message: 'This business has not uploaded any skills. Proceed with your own judgement.',
            };
          }
          return {
            success: true,
            count: data.length,
            skills: data.map((s: any) => ({ name: s.name, description: s.description })),
            message: 'Call get_skill(name) to read the full instructions before acting.',
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not list skills.' };
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
              available: (all || []).map((s: any) => s.name),
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
  if (!skills.length) return '';
  const lines = skills
    .slice(0, 40)
    .map((s) => `  - "${s.name}": ${s.description.replace(/\s+/g, ' ').slice(0, 160)}`);
  return `
BUSINESS SKILLS — this client has uploaded their own procedures:
${lines.join('\n')}
These are how THIS business does things. When a request falls inside one of them, call 'get_skill' and
follow it instead of your own default approach. Do not mention the catalogue unless it is relevant.
`;
}
