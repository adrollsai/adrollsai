import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:hello@adrolls.in',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

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
  console.log(`[PUSH] Looking for tokens for User: ${userId}`);

  const { data: subscriptions } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .or(`user_id.eq.${userId},catalog_owner_id.eq.${userId}`);

  if (!subscriptions || subscriptions.length === 0) {
      console.log(`[PUSH] FAILED: 0 tokens found in database! User is not subscribed.`);
      return;
  }

  console.log(`[PUSH] Found ${subscriptions.length} token(s). Dispatching to Apple/Google...`);
  const payload = JSON.stringify({ title, body, url, type });

  // THE COLD-STATE FIX:
  // 'urgency' must be a native root property, not inside a custom headers object.
  // The web-push library automatically converts this into the strict Apple APNs headers
  // required to wake a locked iPhone screen when the app is asleep.
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
      console.log(`[PUSH] SUCCESS: Dispatched safely!`);
    } catch (error: any) {
      console.error(`[PUSH] ERROR ${error.statusCode}`);
      if (error.statusCode === 404 || error.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}