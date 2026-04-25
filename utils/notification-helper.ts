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
  const { data: subscriptions } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (!subscriptions || subscriptions.length === 0) {
      return;
  }

  const payload = JSON.stringify({ title, body, url, type });

  // REVERTED to your original, working format. 
  // No 'topic', no extra urgency flags. Just the pure header.
  const options = {
    TTL: 86400,
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
    } catch (error: any) {
      console.error(`[PUSH] Failed for ${sub.id}:`, error.statusCode);
      // NOTE: The 410 error on Android is handled here. It safely deletes 
      // the dead token from the database and cleans itself up.
      if (error.statusCode === 404 || error.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}