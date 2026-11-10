import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';
import { sendPushNotification } from '@/utils/notification-helper';
import { sendGenericEmail } from '@/utils/email-helper';

/**
 * Notifications the agent can send the account owner.
 *
 * Push and email ONLY — deliberately no WhatsApp or SMS here. Those cost real
 * money per message and are already gated behind their own tools and consent;
 * letting the agent fire them as a "notification" would be an expensive
 * surprise. Both channels below respect the user's notification preferences,
 * so an opted-out user is not spammed by the agent either.
 */
export function createNotificationTools(supabase: SupabaseClient, userId: string) {
  async function recipient() {
    const { data } = await supabase
      .from('profiles')
      .select('email, business_name, parent_id, agency_id')
      .eq('id', userId)
      .maybeSingle();
    return data;
  }

  return {
    notify_user: tool({
      description:
        'Sends the account owner a notification. Use it when the user is not watching and needs to know something: a task finished, a long job failed, a post went live, an approval is waiting. Push is instant and cheap; email is for anything they should be able to find later. Never use it for conversational replies — just answer in chat for that.',
      inputSchema: z.object({
        title: z.string().describe('Short headline, under ~60 characters'),
        body: z.string().describe('One or two sentences of detail. What happened and what, if anything, they should do.'),
        channels: z
          .array(z.enum(['push', 'email']))
          .default(['push'])
          .describe('push = instant in-app/device notification. email = a permanent copy. Use both for anything important.'),
        url: z
          .string()
          .optional()
          .describe('Where to send them when they tap it, e.g. /dashboard/agent or /dashboard/assets'),
        emailSubject: z.string().optional().describe('Email subject; defaults to the title'),
      }),
      execute: async ({ title, body, channels, url, emailSubject }) => {
        const profile = await recipient();
        if (!profile) return { success: false, error: 'Profile not found.' };

        const results: Record<string, string> = {};
        const target = url || '/dashboard/agent';

        if (channels.includes('push')) {
          try {
            await sendPushNotification(userId, title, body, target, 'agent');
            results.push = 'sent';
          } catch (err: any) {
            results.push = `failed: ${err?.message || err}`;
          }
        }

        if (channels.includes('email')) {
          const to = profile.email;
          if (!to) {
            results.email = 'skipped: no email on the account';
          } else {
            try {
              const html = `
                <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
                  <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin:0 0 8px">
                    ${profile.business_name || 'Nobogent'} · agent
                  </p>
                  <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
                  <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px">${body}</p>
                  <a href="https://app.nobogent.com${target}"
                     style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">
                    Open in Nobogent
                  </a>
                </div>`;
              await sendGenericEmail(to, emailSubject || title, html);
              results.email = 'sent';
            } catch (err: any) {
              results.email = `failed: ${err?.message || err}`;
            }
          }
        }

        const ok = Object.values(results).some((v) => v === 'sent');
        return {
          success: ok,
          channels: results,
          ...(ok
            ? { message: `Notified the account owner via ${Object.entries(results).filter(([, v]) => v === 'sent').map(([k]) => k).join(' + ')}.` }
            : { error: 'No channel delivered. The user may have notifications turned off.' }),
        };
      },
    }),
  };
}
