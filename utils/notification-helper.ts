import webpush from 'web-push';
import { createClient } from '@/utils/supabase/server';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:hello@adrolls.in',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function sendPushNotification(
    userId: string, 
    title: string, 
    body: string, 
    url: string = '/dashboard/crm',
    type: string = 'general'
) {
  const supabase = await createClient();

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (!subscriptions || subscriptions.length === 0) {
    console.log(`[PUSH] No active subscriptions for user ${userId}`);
    return;
  }

  const payload = JSON.stringify({ title, body, url, type });

  // ROBUST iOS CONFIGURATION
  // 'urgency' triggers APNs priority 10 (immediately wake device)
  // 'topic' tells Apple to group them, preventing them from being dropped as spam
  const options = {
    TTL: 86400, // 24 hours
    urgency: 'high', 
    topic: 'adrolls-crm-alert' 
  };

  const sendPromises = subscriptions.map(async (sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };

    try {
      await webpush.sendNotification(pushSubscription, payload, options as any);
      console.log(`[PUSH] Sent successfully to device ID: ${sub.id}`);
    } catch (error: any) {
      console.error(`[PUSH] Failed for ${sub.id}:`, error.statusCode);
      // Clean up stale or unsubscribed devices
      if (error.statusCode === 404 || error.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  });

  // Use allSettled! If one old token fails, it won't crash the current valid token's delivery
  await Promise.allSettled(sendPromises);
}