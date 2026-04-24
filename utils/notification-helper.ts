import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:hello@adrolls.in',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// 1. Initialize Supabase Admin Client using Service Role Key
// This bypasses RLS, allowing background processes (like webhooks) to read subscriptions
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
  // 2. Fetch user subscriptions using Admin Client
  const { data: subscriptions, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('[PUSH] Error fetching subscriptions:', error);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log(`[PUSH] No active subscriptions for user ${userId}`);
    return;
  }

  const payload = JSON.stringify({ title, body, url, type });

  // Move 'Urgency' safely into the headers object. This forces iOS to prioritize
  // the notification without triggering a 400 Bad Request from the endpoint.
  const options = {
    TTL: 86400, // 24 hours
    headers: {
      'Urgency': 'high'
    }
  };

  const sendPromises = subscriptions.map(async (sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };

    try {
      await webpush.sendNotification(pushSubscription, payload, options);
      console.log(`[PUSH] Sent successfully to device ID: ${sub.id}`);
    } catch (error: any) {
      console.error(`[PUSH] Failed for ${sub.id}:`, error.statusCode, error.body || '');
      
      // If the browser unsubscribed, delete the ghost record using Admin Client
      if (error.statusCode === 404 || error.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  });

  // allSettled ensures that if one dead device fails, it doesn't block active devices
  await Promise.allSettled(sendPromises);
}