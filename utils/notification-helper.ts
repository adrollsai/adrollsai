import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:hello@adrolls.in',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// Bypasses RLS so the server can find subscriptions without needing a user cookie
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function sendPushNotification(
    userId: string, 
    title: string, 
    body: string, 
    url: string = '/dashboard/crm',
    type: string = 'general'
) {
  console.log(`[PUSH DEBUG] Attempting to find subscriptions for User ID: ${userId}`);

  const { data: subscriptions, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('[PUSH DEBUG] Supabase Error fetching subscriptions:', error);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log(`[PUSH DEBUG] FAILED: 0 active subscriptions found in DB for User ID: ${userId}`);
    return;
  }

  const payload = JSON.stringify({ title, body, url, type });

  // CRITICAL FIX: 'urgency' must be a direct property, not inside a headers object.
  // Apple will silently drop notifications if this is formatted wrong.
  const options = {
    TTL: 86400,
    urgency: 'high' 
  } as webpush.RequestOptions; 

  const sendPromises = subscriptions.map(async (sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };

    try {
      await webpush.sendNotification(pushSubscription, payload, options);
      console.log(`[PUSH SUCCESS] Notification delivered to device ID: ${sub.id}`);
    } catch (error: any) {
      console.error(`[PUSH ERROR] Failed for device ${sub.id}. Status:`, error.statusCode);
      
      if (error.statusCode === 404 || error.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}