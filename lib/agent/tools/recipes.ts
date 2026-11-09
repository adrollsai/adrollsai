import { tool } from 'ai';
import { z } from 'zod';
import { RECIPES, getRecipeByName, recipeNames } from '../recipes';

/**
 * Recipes: tested pipelines the agent can pull in rather than reinvent.
 *
 * The point is cost and reliability. A live run of "text behind the person's
 * head" succeeded but spent 38 steps and ~14 minutes inventing the matte
 * pipeline and then brute-forcing type placement. That same work is stored here
 * as one script with the hard part already solved, so the agent adapts
 * parameters instead of rediscovering technique.
 */
export function createRecipeTools() {
  return {
    list_recipes: tool({
      description:
        'Lists the tested recipes (known-good pipelines with working code) available to you. Check this before building any non-trivial media pipeline from scratch — reusing a recipe is faster and far more reliable than reinventing it.',
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        count: recipeNames().length,
        recipes: recipeNames().map((n) => ({
          name: n,
          title: RECIPES[n].title,
          whenToUse: RECIPES[n].whenToUse,
        })),
      }),
    }),

    get_recipe: tool({
      description:
        'Returns a tested recipe: the exact working code plus usage notes and pitfalls. Write the returned files into the sandbox, adjust the parameters for the request, and run it. Prefer this over improvising.',
      inputSchema: z.object({
        name: z.string().describe('Recipe name from list_recipes, e.g. "text-behind-subject"'),
      }),
      execute: async ({ name }) => {
        const recipe = getRecipeByName(name);
        if (!recipe) {
          return {
            success: false,
            error: `Unknown recipe "${name}".`,
            available: recipeNames(),
          };
        }
        return {
          success: true,
          name: recipe.name,
          title: recipe.title,
          whenToUse: recipe.whenToUse,
          usage: recipe.usage,
          notes: recipe.notes,
          files: recipe.files,
          nextSteps: [
            'Write each file into the sandbox with sandbox_write_file.',
            'Install any prerequisites listed in notes, then run the usage command.',
            'Read the JSON it prints at the end; quote the real numbers.',
            'Verify the finished artefact with analyze_video_with_gemini before delivering.',
          ],
        };
      },
    }),
  };
}
