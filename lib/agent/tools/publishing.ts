import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { postToFacebook, postToInstagram, postToLinkedin } from '@/utils/external-apis';

/**
 * Publishing tools — the app's real social posting path, exposed to the agent.
 *
 * These call the same helpers `/api/post-universal` uses, so a post the agent
 * makes behaves exactly like one the user schedules from the dashboard:
 * Facebook Page, Instagram Business account, and LinkedIn personal/organisation.
 *
 * Credentials are read from the user's own linked accounts. When a platform is
 * not connected the tool says precisely what is missing instead of failing with
 * a generic provider error.
 */
type Platform = 'facebook' | 'instagram' | 'linkedin';

export function createPublishingTools(supabase: SupabaseClient, userId: string) {
  async function creds() {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'selected_page_token, selected_page_id, selected_page_name, facebook_token, linkedin_token, linkedin_id, linkedin_urn'
      )
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) throw new Error('User profile not found.');
    return data;
  }

  function connectionState(p: any) {
    return {
      facebook: {
        connected: Boolean(p.selected_page_token || p.facebook_token),
        pageName: p.selected_page_name || null,
        pageId: p.selected_page_id || null,
      },
      instagram: {
        connected: Boolean((p.selected_page_token || p.facebook_token) && p.selected_page_id),
        note: p.selected_page_id ? 'Posts through the linked Facebook Page' : 'Requires a Facebook Page with an Instagram Business account',
      },
      linkedin: {
        connected: Boolean(p.linkedin_token && (p.linkedin_urn || p.linkedin_id)),
        urn: p.linkedin_urn || p.linkedin_id || null,
      },
    };
  }

  return {
    social_connected_accounts: tool({
      description:
        'Lists which social accounts this business has connected for publishing — Facebook Page, Instagram Business, LinkedIn — with the page name and account id. Check this before promising a post.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const p = await creds();
          const state = connectionState(p);
          const platforms = (Object.keys(state) as Platform[]).filter((k) => state[k].connected);
          return {
            success: true,
            platforms,
            anyConnected: platforms.length > 0,
            details: state,
            ...(platforms.length === 0
              ? { remediation: 'No social account is connected. Connect Facebook/Instagram or LinkedIn in dashboard Settings first.' }
              : {}),
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Could not read social connections' };
        }
      },
    }),

    publish_social_post: tool({
      description:
        'Publishes a real post to the business\'s connected social accounts. Supports a photo or a video (pass the media URL, MP4 or image) with a caption, to any combination of facebook, instagram and linkedin. Use this whenever the user asks to post, publish, broadcast or go live with creative. This is a REAL public post on live accounts — confirm the creative and caption with the user first.',
      inputSchema: z.object({
        mediaUrl: z
          .string()
          .describe('Publicly reachable image or MP4 URL to publish (e.g. an R2 URL returned by another tool)'),
        caption: z.string().describe('The post caption / body copy, written and formatted as it should appear'),
        platforms: z
          .array(z.enum(['facebook', 'instagram', 'linkedin']))
          .describe('Which platforms to publish to. Only include platforms that are connected.'),
        mediaType: z
          .enum(['image', 'video'])
          .optional()
          .describe('Explicit media type; inferred from the file extension when omitted'),
        postType: z
          .string()
          .default('image')
          .describe('Legacy media-type hint passed to the platform helpers'),
      }),
      execute: async ({ mediaUrl, caption, platforms, mediaType, postType }) => {
        const url = (mediaUrl || '').trim();
        if (!url) return { success: false, error: 'mediaUrl is required.' };
        if (!platforms?.length) return { success: false, error: 'Select at least one platform.' };

        const isVideo = mediaType
          ? mediaType === 'video'
          : /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) || url.includes('/video/');
        const platformType = isVideo ? 'video' : (postType || 'image');

        try {
          const p = await creds();
          const fbToken = p.selected_page_token || p.facebook_token;
          const pageId = p.selected_page_id;
          const urn = p.linkedin_urn || p.linkedin_id;

          const results: Record<string, string> = {};
          const jobs: Promise<void>[] = [];

          if (platforms.includes('facebook')) {
            if (!fbToken) results.facebook = 'skipped: Facebook Page not connected';
            else
              jobs.push(
                postToFacebook(fbToken, url, caption, platformType, pageId || undefined)
                  .then(() => {
                    results.facebook = 'published';
                  })
                  .catch((e) => {
                    results.facebook = `failed: ${e?.message || e}`;
                  })
              );
          }

          if (platforms.includes('instagram')) {
            if (!fbToken || !pageId) results.instagram = 'skipped: needs a Facebook Page with an Instagram Business account';
            else
              jobs.push(
                postToInstagram(fbToken, pageId, url, caption, platformType)
                  .then(() => {
                    results.instagram = 'published';
                  })
                  .catch((e) => {
                    results.instagram = `failed: ${e?.message || e}`;
                  })
              );
          }

          if (platforms.includes('linkedin')) {
            if (!p.linkedin_token || !urn) results.linkedin = 'skipped: LinkedIn not connected';
            else
              jobs.push(
                postToLinkedin(p.linkedin_token, urn, url, caption, platformType)
                  .then(() => {
                    results.linkedin = 'published';
                  })
                  .catch((e) => {
                    results.linkedin = `failed: ${e?.message || e}`;
                  })
              );
          }

          await Promise.all(jobs);

          const published = Object.entries(results).filter(([, v]) => v === 'published').map(([k]) => k);
          return {
            success: published.length > 0,
            mediaUrl: url,
            mediaType: isVideo ? 'video' : 'image',
            publishedTo: published,
            results,
            ...(published.length === 0
              ? { error: 'Nothing was published — see results per platform for the reason.' }
              : { message: `Published to ${published.join(', ')}.` }),
          };
        } catch (err: any) {
          return { success: false, error: err?.message || 'Publishing failed' };
        }
      },
    }),
  };
}
