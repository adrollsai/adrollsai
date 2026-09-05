import { SupabaseClient } from '@supabase/supabase-js';

export interface EnsureSubscriptionResult {
  success: boolean;
  pageId?: string;
  error?: string;
  refreshedToken?: boolean;
}

/**
 * Robust Meta Webhook Subscription Handler
 * Subscribes Facebook Page to Nobogent app for real-time leadgen webhooks.
 * If the current page token is expired or unauthorized, automatically fetches
 * a fresh page token from Meta Graph API (/me/accounts) and updates the database.
 */
export async function ensureMetaPageSubscribed(
  supabaseAdmin: SupabaseClient,
  profile: {
    id: string;
    selected_page_id?: string | null;
    selected_page_token?: string | null;
    facebook_token?: string | null;
    email?: string | null;
  }
): Promise<EnsureSubscriptionResult> {
  const pageId = profile.selected_page_id;
  if (!pageId) {
    return { success: false, error: 'No selected_page_id on profile' };
  }

  let pageToken = profile.selected_page_token;

  // 1. Try with existing page token
  if (pageToken) {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscribed_fields: ['leadgen'],
          access_token: pageToken
        })
      });
      const data = await res.json();
      if (data.success) {
        return { success: true, pageId };
      }
      console.warn(`[Meta Webhook] Direct subscription with existing pageToken failed for page ${pageId}:`, data.error?.message);
    } catch (e: any) {
      console.warn(`[Meta Webhook] Network error subscribing page ${pageId}:`, e.message);
    }
  }

  // 2. If existing pageToken was missing or failed, attempt auto-heal using user's facebook_token
  const userToken = profile.facebook_token;
  if (userToken) {
    try {
      const accountsRes = await fetch(
        `https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`
      );
      if (accountsRes.ok) {
        const accountsData = await accountsRes.json();
        const matchingAccount = accountsData.data?.find((acc: any) => String(acc.id) === String(pageId));
        if (matchingAccount?.access_token) {
          const freshPageToken = matchingAccount.access_token;

          // Save fresh page token to profile in database
          await supabaseAdmin
            .from('profiles')
            .update({ selected_page_token: freshPageToken })
            .eq('id', profile.id);

          // Now subscribe using the freshly retrieved token
          const subRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscribed_fields: ['leadgen'],
              access_token: freshPageToken
            })
          });
          const subData = await subRes.json();
          if (subData.success) {
            console.log(`[Meta Webhook] Auto-healed token and subscribed page ${pageId} (${matchingAccount.name}) for user ${profile.email || profile.id}`);
            return { success: true, pageId, refreshedToken: true };
          } else {
            console.error(`[Meta Webhook] Failed to subscribe page ${pageId} with fresh token:`, subData);
            return { success: false, pageId, error: subData.error?.message || 'Subscription failed' };
          }
        }
      }
    } catch (refreshErr: any) {
      console.error(`[Meta Webhook] Error refreshing page token for user ${profile.id}:`, refreshErr.message);
      return { success: false, pageId, error: refreshErr.message };
    }
  }

  return { success: false, pageId, error: 'Could not subscribe page to webhooks' };
}
