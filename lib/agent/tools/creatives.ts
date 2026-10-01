import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

export function createCreativeTools(supabase: SupabaseClient, userId: string) {
  return {
    get_user_media_assets: tool({
      description: 'Fetches recent rendered video assets, images, and creative media from the user library.',
      inputSchema: z.object({
        type: z.enum(['video', 'image', 'all']).default('all').describe('Filter by media type'),
        limit: z.number().default(8).describe('Max assets to return'),
      }),
      execute: async ({ type, limit }) => {
        try {
          let q = supabase
            .from('assets')
            .select('id, title, url, status, created_at, metadata')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

          const { data, error } = await q;
          if (error) throw error;

          return {
            success: true,
            count: data?.length || 0,
            assets: (data || []).map((a: any) => ({
              id: a.id,
              title: a.title || 'Untitled Asset',
              url: a.url,
              status: a.status || 'ready',
              created: a.created_at,
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    generate_video_script_and_angle: tool({
      description: 'Generates high-converting marketing hooks, viral video scripts, and Hormozi offer angles for any product, service, or catalog item.',
      inputSchema: z.object({
        offeringTitle: z.string().describe('Name of the product, service, or offering'),
        targetAudience: z.string().default('High-intent buyers').describe('Target demographic or buyer persona'),
        keyFeatures: z.array(z.string()).describe('Top 3-4 selling points, benefits, or differentiators'),
        format: z.enum(['9:16_reel', '16:9_landscape']).default('9:16_reel'),
      }),
      execute: async ({ offeringTitle, targetAudience, keyFeatures, format }) => {
        const featuresText = keyFeatures.join(', ');
        const hook = `Struggling to find the best ${offeringTitle}? Here is what makes this different.`;
        const script = `
[Scene 1 - Pattern Interrupt (0-3s)]: ${hook}
[Scene 2 - Core Benefit / Transformation (3-8s)]: Featuring ${featuresText}. Engineered to deliver results fast.
[Scene 3 - Social Proof & Value Stack (8-12s)]: Exclusive limited availability with special launch pricing available now.
[Scene 4 - Direct Call to Action (12-15s)]: Tap the link below to get full details and claim your offer today.
        `.trim();

        return {
          success: true,
          concept: {
            title: `Showcase: ${offeringTitle}`,
            hook,
            format,
            audience: targetAudience,
            script,
            scenesCount: 4,
          },
          artifact: {
            type: 'html_sandbox',
            title: `Video Storyboard: ${offeringTitle}`,
            html: `
<div style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; border-radius: 12px; max-width: 420px; margin: 0 auto;">
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
    <span style="font-size: 11px; background: #3b82f6; padding: 3px 8px; border-radius: 20px; font-weight: bold; text-transform: uppercase;">9:16 Reel Storyboard</span>
    <span style="font-size: 12px; color: #94a3b8;">15 Seconds</span>
  </div>
  <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #ffffff;">${offeringTitle}</h3>
  <div style="background: #1e293b; border-left: 3px solid #3b82f6; padding: 10px; border-radius: 6px; font-size: 13px; font-style: italic; margin-bottom: 12px;">
    "${hook}"
  </div>
  <div style="font-size: 12px; line-height: 1.6; color: #cbd5e1; white-space: pre-wrap;">${script}</div>
</div>
            `.trim(),
          },
        };
      },
    }),
  };
}
