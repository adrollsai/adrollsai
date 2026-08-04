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
  leadPhone,
  leadName,
  leadId,
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
  leadPhone?: string;
  leadName?: string;
  leadId?: string;
  emailSubject?: string;
  emailHtml?: string;
  skipEmail?: boolean;
  skipWhatsApp?: boolean;
  skipPush?: boolean;
}) {
  try {
    console.log(`[MULTI-CHANNEL] Processing notifications for owner: ${ownerUserId}`);

    // Build absolute lead page URL for admin direct access
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
    let leadPageUrl = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
    if (leadId && !leadPageUrl.includes('leadId=')) {
      leadPageUrl = `${baseUrl}/dashboard/crm?leadId=${leadId}`;
    }

    // Extract actual lead phone number (from parameter or body parsing)
    let targetLeadPhone = leadPhone ? leadPhone.trim() : '';
    if (!targetLeadPhone && body) {
      const phoneMatch = body.match(/(?:Phone:\s*|\+?\b)(\+?\d{10,14})\b/i) || body.match(/(\+?\d{10,14})/);
      if (phoneMatch) {
        targetLeadPhone = phoneMatch[1] || phoneMatch[0];
      }
    }
    if (!targetLeadPhone || targetLeadPhone === 'N/A') {
      targetLeadPhone = 'N/A';
    }

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
        await sendPushNotification(ownerUserId, title, body, leadPageUrl, type);
      } catch (err: any) {
        console.error(`[MULTI-CHANNEL PUSH ERROR]`, err.message);
      }
    }

    // 2. WhatsApp Notification to Admin (Template-first with text fallback)
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
            const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
            
            const isExpertAlert = type === 'connect_expert' || /expert|callback|connect/i.test(title || '') || /expert|callback|connect/i.test(body || '');

            let payload: any;
            
            if (isExpertAlert) {
              // Direct clear text alert for Expert Connections / Callbacks
              payload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'text',
                text: { 
                  body: `☎️ HIGH-PRIORITY ALERT: Connect with Expert Requested!\n\nLead Name: ${leadName || 'Prospect'}\nPhone: ${targetLeadPhone}\n\n${body || 'Lead clicked "Connect with Expert" on WhatsApp.'}\n\n🔗 View CRM Record: ${leadPageUrl}` 
                }
              };
            } else {
              // Template for actual appointment bookings
              payload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'template',
                template: {
                  name: 'booking_notification_admin',
                  language: { code: 'en_US' },
                  components: [
                    {
                      type: 'body',
                      parameters: [
                        { type: 'text', text: leadName || title || 'Lead Request' },
                        { type: 'text', text: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) },
                        { type: 'text', text: ownerProfile.business_name || 'Nobogent' },
                        { type: 'text', text: targetLeadPhone },
                        { type: 'text', text: leadPageUrl }
                      ]
                    }
                  ]
                }
              };
            }

            let waRes = await fetch(metaUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            let waData = await waRes.json();

            if (!waRes.ok && payload.type === 'template') {
              console.warn(`[MULTI-CHANNEL WA TEMPLATE FALLBACK] Template failed (${waData.error?.message}), falling back to text:`, waData);
              const textPayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'text',
                text: { body: `${title}\n\n${body}\n\n🔗 View Lead: ${leadPageUrl}` }
              };
              waRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(textPayload)
              });
              waData = await waRes.json();
            }

            if (!waRes.ok) {
              console.error(`[MULTI-CHANNEL WA ERROR] to ${cleanPhone}:`, waData);
            } else {
              console.log(`[MULTI-CHANNEL WA SUCCESS] WhatsApp message delivered to admin: ${cleanPhone}`);
            }
          } else {
            console.warn(`[MULTI-CHANNEL WA SKIP] Missing WABA token or phoneId for ${cleanPhone}`);
          }
        }
      } catch (waErr: any) {
        console.error(`[MULTI-CHANNEL WA EXCEPTION]`, waErr.message);
      }
    }

    // 3. Email Notification to Admin (Restricted strictly to High Priority events: Meeting Booked, Connect with Expert)
    if (!skipEmail && ownerProfile.email) {
      const HIGH_PRIORITY_TYPES = [
        'meeting_booked',
        'appointment_booked',
        'connect_with_expert',
        'expert_requested',
        'expert_escalation',
        'expert_connection',
        'urgent_alert'
      ];
      
      const isHighPriorityEvent = (
        HIGH_PRIORITY_TYPES.includes((type || '').toLowerCase()) ||
        /meeting|appointment|expert|escalat|connect with expert|urgent/i.test(title || '') ||
        /meeting|appointment|expert|escalat|connect with expert|urgent/i.test(emailSubject || '')
      );

      if (!isHighPriorityEvent) {
        console.log(`[MULTI-CHANNEL EMAIL SKIP] Skipping email for non-priority event "${type}" ("${title}"). Email notifications are restricted to high-priority events (meeting booked, connect with expert).`);
      } else {
        try {
          const subject = emailSubject || title;
          const defaultHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #0f172a; margin: 0; font-size: 22px; font-weight: bold; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">${title}</h2>
              </div>
              <p style="font-size: 15px; color: #334155; line-height: 1.6; white-space: pre-wrap;">${body}</p>
              <div style="margin-top: 24px; text-align: center;">
                <a href="${leadPageUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">View Lead in CRM</a>
              </div>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin-top: 24px;" />
              <p style="font-size: 11px; color: #94a3b8; text-align: center; text-transform: uppercase; letter-spacing: 0.05em;">Nobogent Priority Alert</p>
            </div>
          `;
          const { sendGenericEmail } = await import('@/utils/email-helper');
          await sendGenericEmail(ownerProfile.email, subject, emailHtml || defaultHtml);
          console.log(`[MULTI-CHANNEL EMAIL SUCCESS] Priority notification email sent to admin: ${ownerProfile.email}`);
        } catch (emailErr: any) {
          console.error(`[MULTI-CHANNEL EMAIL ERROR]`, emailErr.message);
        }
      }
    }
  } catch (err: any) {
    console.error(`[MULTI-CHANNEL NOTIFICATION FATAL ERROR]`, err.message);
  }
}

export async function sendExpertEscalationNotification({
  leadId,
  userId,
  summary,
  unansweredQuestions = [],
  publicRecordingUrl = null,
  isExpertRequested = false
}: {
  leadId: string;
  userId: string;
  summary: string;
  unansweredQuestions?: string[];
  publicRecordingUrl?: string | null;
  isExpertRequested?: boolean;
}) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch Lead Data
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, assigned_to, source')
      .eq('id', leadId)
      .single();

    if (!lead) return;

    // 2. Fetch Admin Profile
    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, email, business_name, full_name, whatsapp_personal_number, contact_number, whatsapp_phone_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
      .eq('id', userId)
      .single();

    if (!adminProfile) return;

    // 3. Fetch Assigned Team Member Profile (if assigned)
    let assignedProfile: any = null;
    if (lead.assigned_to) {
      const { data: teamMember } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, business_name, whatsapp_personal_number, contact_number')
        .eq('id', lead.assigned_to)
        .maybeSingle();

      if (teamMember) {
        assignedProfile = teamMember;
      }
    }

    const leadName = lead.name || 'Lead';
    const leadPhone = lead.phone || 'N/A';
    const leadEmail = lead.email || 'N/A';
    const recUrl = publicRecordingUrl || null;

    let assignedInfoStr = 'Unassigned (Handled by Admin)';
    if (assignedProfile) {
      const agentName = assignedProfile.full_name || assignedProfile.business_name || 'Team Member';
      const agentPhone = assignedProfile.contact_number || assignedProfile.whatsapp_personal_number || 'N/A';
      assignedInfoStr = `${agentName} (Email: ${assignedProfile.email || 'N/A'}, Phone: ${agentPhone})`;
    }

    const reasonTitle = isExpertRequested 
      ? '🚨 Lead Requested Expert Connection' 
      : '❓ Flagged Question / Expert Assistance Needed';

    const reasonBody = unansweredQuestions.length > 0
      ? `Flagged Question(s):\n- ${unansweredQuestions.join('\n- ')}`
      : summary;

    // 4. Build Email HTML for Admin
    const adminEmailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #dc2626; margin: 0; font-size: 22px; font-weight: bold; border-bottom: 2px solid #dc2626; padding-bottom: 12px;">${reasonTitle}</h2>
        </div>
        <p style="font-size: 15px; color: #334155; line-height: 1.5;">
          Lead <strong>${leadName}</strong> has requested to speak with an expert or requires escalation during their AI phone call.
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; width: 140px;">Lead Name:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${leadName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase;">Lead Phone:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a; font-size: 15px;"><a href="tel:${leadPhone}" style="color: #2563eb; text-decoration: none;">${leadPhone}</a></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase;">Lead Email:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${leadEmail}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase;">Assigned Agent:</td>
              <td style="padding: 6px 0; font-weight: 600; color: #dc2626; font-size: 14px;">${assignedInfoStr}</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <h4 style="margin: 0 0 8px 0; color: #991b1b; font-size: 14px; text-transform: uppercase;">Call Details / Reason:</h4>
          <p style="margin: 0; color: #7f1d1d; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${reasonBody}</p>
        </div>

        ${recUrl ? `
        <div style="text-align: center; margin: 24px 0;">
          <a href="${recUrl}" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">🎙️ Listen to Call Recording</a>
        </div>
        ` : ''}

        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
          <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
            Nobogent AI Expert Escalation Alert
          </p>
        </div>
      </div>
    `;

    // 5. Send to Admin (Push, WhatsApp, Email) - Admin ALWAYS receives this!
    await sendAdminMultiChannelNotification({
      ownerUserId: userId,
      title: reasonTitle,
      body: `Lead: ${leadName} (${leadPhone})\nAssigned Agent: ${assignedInfoStr}\n\n${reasonBody}${recUrl ? `\n\n🎙️ Call Recording: ${recUrl}` : ''}`,
      url: '/dashboard/crm',
      type: 'expert_escalation',
      emailSubject: `${reasonTitle}: ${leadName}`,
      emailHtml: adminEmailHtml
    });

    // 6. Send to Assigned Team Member if assigned
    if (assignedProfile && assignedProfile.id && assignedProfile.id !== userId) {
      const teamEmailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #dc2626; margin: 0; font-size: 22px; font-weight: bold; border-bottom: 2px solid #dc2626; padding-bottom: 12px;">${reasonTitle}</h2>
          </div>
          <p style="font-size: 15px; color: #334155; line-height: 1.5;">
            Hi ${assignedProfile.full_name || 'Team Member'}, a lead assigned to you, <strong>${leadName}</strong>, requested an expert callback during an AI phone call.
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; width: 140px;">Lead Name:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${leadName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase;">Lead Phone:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a; font-size: 15px;"><a href="tel:${leadPhone}" style="color: #2563eb; text-decoration: none;">${leadPhone}</a></td>
              </tr>
            </table>
          </div>

          <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <h4 style="margin: 0 0 8px 0; color: #991b1b; font-size: 14px; text-transform: uppercase;">Call Details / Reason:</h4>
            <p style="margin: 0; color: #7f1d1d; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${reasonBody}</p>
          </div>

          ${recUrl ? `
          <div style="text-align: center; margin: 24px 0;">
            <a href="${recUrl}" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">🎙️ Listen to Call Recording</a>
          </div>
          ` : ''}
        </div>
      `;

      await sendAdminMultiChannelNotification({
        ownerUserId: assignedProfile.id,
        title: reasonTitle,
        body: `Lead assigned to you requested expert connection: ${leadName} (${leadPhone})\n\n${reasonBody}${recUrl ? `\n\n🎙️ Call Recording: ${recUrl}` : ''}`,
        url: '/dashboard/crm',
        type: 'expert_escalation',
        emailSubject: `${reasonTitle}: ${leadName}`,
        emailHtml: teamEmailHtml
      });
    }

  } catch (err: any) {
    console.error('[EXPERT ESCALATION NOTIFICATION ERROR]', err.message);
  }
}