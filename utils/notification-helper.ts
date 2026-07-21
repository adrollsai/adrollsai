import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

let isVapidInitialized = false;

function ensureVapidDetails() {
  if (isVapidInitialized) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:info@nobogent.com';

  if (!publicKey || !privateKey) {
    console.warn('[PUSH] VAPID keys missing in environment (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    isVapidInitialized = true;
    return true;
  } catch (err: any) {
    console.error('[PUSH] Failed to set VAPID details:', err.message);
    return false;
  }
}

let _supabaseAdmin: any = null;
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabaseAdmin;
}

export async function sendPushNotification(
    userId: string,
    title: string,
    body: string,
    url: string = '/dashboard/crm',
    type: string = 'general'
) {
  console.log(`[PUSH] Looking for tokens for User: ${userId}`);

  const { data: subscriptions } = await getSupabaseAdmin()
    .from('push_subscriptions')
    .select('*')
    .or(`user_id.eq.${userId},catalog_owner_id.eq.${userId}`);

  if (!ensureVapidDetails()) {
    console.warn(`[PUSH] Skipping push dispatch: VAPID details not configured.`);
    return;
  }

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

  const sendPromises = subscriptions.map(async (sub: any) => {
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
        await getSupabaseAdmin().from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  });

  await Promise.allSettled(sendPromises);
}

export async function sendAdminMultiChannelNotification({
  ownerUserId,
  title,
  body,
  url = '/dashboard/crm',
  type = 'lead_event',
  emailSubject,
  emailHtml,
  skipEmail = false,
  skipWhatsApp = false,
  skipPush = false
}: {
  ownerUserId: string;
  title: string;
  body: string;
  url?: string;
  type?: string;
  emailSubject?: string;
  emailHtml?: string;
  skipEmail?: boolean;
  skipWhatsApp?: boolean;
  skipPush?: boolean;
}) {
  try {
    console.log(`[MULTI-CHANNEL] Processing notifications for owner: ${ownerUserId}`);

    // Fetch owner profile
    const { data: ownerProfile } = await getSupabaseAdmin()
      .from('profiles')
      .select('id, email, business_name, whatsapp_personal_number, contact_number, whatsapp_phone_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
      .eq('id', ownerUserId)
      .maybeSingle();

    if (!ownerProfile) {
      console.warn(`[MULTI-CHANNEL] Profile not found for owner ID: ${ownerUserId}`);
      return;
    }

    // 1. Push Notification
    if (!skipPush) {
      try {
        await sendPushNotification(ownerUserId, title, body, url, type);
      } catch (err: any) {
        console.error(`[MULTI-CHANNEL PUSH ERROR]`, err.message);
      }
    }

    // 2. WhatsApp Free-form Text Message to Admin
    if (!skipWhatsApp) {
      try {
        const rawPhone = ownerProfile.whatsapp_personal_number || ownerProfile.contact_number || ownerProfile.whatsapp_phone_number;
        if (rawPhone) {
          let cleanPhone = rawPhone.replace(/\D/g, '');
          if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
          }

          const token = ownerProfile.whatsapp_access_token || ownerProfile.facebook_token || process.env.WHATSAPP_ACCESS_TOKEN;
          const phoneId = ownerProfile.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

          if (cleanPhone && token && phoneId) {
            const waText = `${title}\n\n${body}`;
            const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
            const waRes = await fetch(metaUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'text',
                text: { body: waText }
              })
            });
            const waData = await waRes.json();
            if (!waRes.ok) {
              console.error(`[MULTI-CHANNEL WA ERROR] to ${cleanPhone}:`, waData);
            } else {
              console.log(`[MULTI-CHANNEL WA SUCCESS] Free-form text sent to admin: ${cleanPhone}`);
            }
          } else {
            console.warn(`[MULTI-CHANNEL WA SKIP] Missing WABA token or phoneId for ${cleanPhone}`);
          }
        }
      } catch (waErr: any) {
        console.error(`[MULTI-CHANNEL WA EXCEPTION]`, waErr.message);
      }
    }

    // 3. Email Notification to Admin
    if (!skipEmail && ownerProfile.email) {
      try {
        const subject = emailSubject || title;
        const defaultHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #0f172a; margin: 0; font-size: 22px; font-weight: bold; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">${title}</h2>
            </div>
            <p style="font-size: 15px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${body}</p>
            <div style="margin-top: 24px; text-align: center;">
              <a href="https://app.nobogent.com${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Open Dashboard</a>
            </div>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin-top: 24px;" />
            <p style="font-size: 11px; color: #94a3b8; text-align: center; text-transform: uppercase; letter-spacing: 0.05em;">Nobogent Business Automation Notification</p>
          </div>
        `;
        const { sendGenericEmail } = await import('@/utils/email-helper');
        await sendGenericEmail(ownerProfile.email, subject, emailHtml || defaultHtml);
        console.log(`[MULTI-CHANNEL EMAIL SUCCESS] Email sent to admin: ${ownerProfile.email}`);
      } catch (emailErr: any) {
        console.error(`[MULTI-CHANNEL EMAIL ERROR]`, emailErr.message);
      }
    }
  } catch (err: any) {
    console.error(`[MULTI-CHANNEL NOTIFICATION FATAL ERROR]`, err.message);
  }
}