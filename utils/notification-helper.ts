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
  console.log(`[PUSH] Looking up DB for User: ${userId}`);

  const { data: subscriptions } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (!subscriptions || subscriptions.length === 0) {
      console.log(`[PUSH] FATAL: 0 devices found in DB for user! Cannot send.`);
      return;
  }

  console.log(`[PUSH] Found ${subscriptions.length} device(s). Firing to Apple/Google...`);

  const payload = JSON.stringify({ title, body, url, type });

  const options = {
    TTL: 86400,
    urgency: 'high',
    headers: { 'Urgency': 'high' }
  } as webpush.RequestOptions; 

  const sendPromises = subscriptions.map(async (sub) => {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };

    try {
      await webpush.sendNotification(pushSubscription, payload, options);
      console.log(`[PUSH] Success! Apple/Google accepted payload for device: ${sub.id}`);
    } catch (error: any) {
      console.error(`[PUSH] Failed. Status code: ${error.statusCode}`);
      if (error.statusCode === 404 || error.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}