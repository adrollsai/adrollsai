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
    business_info?: any;
  },
  targetPageId?: string,
  targetPageToken?: string
): Promise<EnsureSubscriptionResult> {
  // Collect all pages to subscribe
  const pagesToSubscribe: Array<{ id: string; token: string | null }> = [];

  if (targetPageId) {
    pagesToSubscribe.push({ id: targetPageId, token: targetPageToken || null });
  } else {
    if (profile.selected_page_id) {
      pagesToSubscribe.push({ id: profile.selected_page_id, token: profile.selected_page_token || null });
    }
    // Check business_info.selected_pages
    try {
      const bInfo = typeof profile.business_info === 'string'
        ? JSON.parse(profile.business_info)
        : (profile.business_info || {});
      if (Array.isArray(bInfo.selected_pages)) {
        for (const p of bInfo.selected_pages) {
          if (p.id && !pagesToSubscribe.some(x => x.id === p.id)) {
            pagesToSubscribe.push({ id: p.id, token: p.access_token || null });
          }
        }
      }
    } catch (e) {}
  }

  if (pagesToSubscribe.length === 0) {
    return { success: false, error: 'No pages to subscribe' };
  }

  let overallSuccess = true;
  let lastError: string | undefined;

  for (const item of pagesToSubscribe) {
    const pageId = item.id;
    let pageToken = item.token;

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
          console.log(`[Meta Webhook] Successfully subscribed page ${pageId} for user ${profile.email || profile.id}`);
          continue;
        }
        console.warn(`[Meta Webhook] Direct subscription with existing pageToken failed for page ${pageId}:`, data.error?.message);
      } catch (e: any) {
        console.warn(`[Meta Webhook] Network error subscribing page ${pageId}:`, e.message);
      }
    }

    // 2. If token missing or failed, attempt auto-heal using facebook_token
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

            // If it's the primary page, update selected_page_token in DB
            if (pageId === profile.selected_page_id) {
              await supabaseAdmin
                .from('profiles')
                .update({ selected_page_token: freshPageToken })
                .eq('id', profile.id);
            }

            // Now subscribe using fresh token
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
              continue;
            } else {
              console.error(`[Meta Webhook] Failed to subscribe page ${pageId} with fresh token:`, subData);
              overallSuccess = false;
              lastError = subData.error?.message || 'Subscription failed';
              continue;
            }
          }
        }
      } catch (refreshErr: any) {
        console.error(`[Meta Webhook] Error refreshing page token for user ${profile.id}:`, refreshErr.message);
        overallSuccess = false;
        lastError = refreshErr.message;
        continue;
      }
    }

    overallSuccess = false;
    lastError = `Could not subscribe page ${pageId}`;
  }

  return { success: overallSuccess, error: lastError };
}

/**
 * Subscribes a WhatsApp Business Account (WABA) to the Meta App webhooks
 * so inbound messages and delivery statuses are received by the webhook route.
 */
export async function ensureWabaSubscribed(
  wabaId: string,
  userToken?: string | null
): Promise<{ success: boolean; error?: string }> {
  if (!wabaId) return { success: false, error: 'Missing WABA ID' };

  const tokens = [
    process.env.DEV_WHATSAPP_ACCESS_TOKEN,
    userToken
  ].filter(Boolean) as string[];

  for (const token of tokens) {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (data.success) {
        console.log(`[WABA Subscription] ✅ Successfully subscribed WABA ${wabaId}`);
        return { success: true };
      }
    } catch (e: any) {
      console.warn(`[WABA Subscription] Error with token:`, e.message);
    }
  }
  return { success: false, error: 'Failed to subscribe WABA' };
}


