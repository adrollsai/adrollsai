import { getTransporter, resolveNotificationRecipients } from '@/utils/email-helper';
import { sendNobogentCreativeWithButtons } from '@/utils/creative-approval-handler';

export interface DispatchCreativeParams {
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  businessName: string;
  creativeUrl: string;
  caption: string;
  title: string;
  isFestival?: boolean;
  festivalName?: string;
  clientWabaPhoneId?: string | null;
  clientWabaToken?: string | null;
  assetId?: string | null;
  userId?: string | null;
}

/**
 * Dispatches newly generated creatives (Daily & Festival) to Admin's WhatsApp & Email
 * from Nobogent WABA account with interactive Approve & Edit buttons and Nobogent Official Email.
 */
export async function dispatchCreativeToAdmin(params: DispatchCreativeParams) {
  const {
    recipientEmail,
    recipientPhone,
    businessName,
    creativeUrl,
    caption,
    title,
    isFestival = false,
    festivalName,
    assetId
  } = params;

  const results = {
    whatsappSent: false,
    emailSent: false,
    whatsappError: null as string | null,
    emailError: null as string | null
  };

  // ==========================================
  // 1. DISPATCH TO WHATSAPP (NOBOGENT WABA)
  // Strictly sent from Nobogent WABA with Approve & Edit buttons
  // ==========================================
  let cleanPhone = (recipientPhone || '').replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = `91${cleanPhone}`;
  }

  if (cleanPhone && creativeUrl) {
    try {
      console.log(`[Creative Dispatcher] Sending creative to WhatsApp ${cleanPhone} from Nobogent WABA with Approve & Edit buttons...`);
      const sent = await sendNobogentCreativeWithButtons({
        to: cleanPhone,
        creativeUrl,
        caption,
        title,
        assetId: assetId || null,
        isFestival,
        festivalName
      });

      results.whatsappSent = sent;
      if (!sent) {
        results.whatsappError = 'Failed to deliver via Nobogent WABA';
      }
    } catch (waErr: any) {
      console.error('[Creative Dispatcher] WhatsApp dispatch exception:', waErr);
      results.whatsappError = waErr.message;
    }
  } else {
    console.warn('[Creative Dispatcher] WhatsApp dispatch skipped (missing phone or creativeUrl)');
  }

  // ==========================================
  // 2. DISPATCH TO EMAIL (NOBOGENT EMAIL)
  // ==========================================
  if (recipientEmail && recipientEmail.includes('@')) {
    try {
      console.log(`[Creative Dispatcher] Sending creative email to ${recipientEmail}...`);
      const transporter = getTransporter();

      const subject = isFestival
        ? `🎉 Happy ${festivalName}! New Festive Brand Creative for ${businessName}`
        : `🌅 Daily Marketing Creative Ready - ${title} | Nobogent AI`;

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px rgba(0,0,0,0.06);">
    
    <!-- Header Banner -->
    <div style="background: ${isFestival ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'}; padding: 32px 24px; text-align: center; color: #ffffff;">
      <span style="display: inline-block; padding: 4px 12px; background: rgba(255,255,255,0.2); border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
        ${isFestival ? `🎉 Festival Greeting · ${festivalName}` : '🌅 Daily Automated Creative'}
      </span>
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 900; letter-spacing: -0.5px;">
        ${isFestival ? `Happy ${festivalName} from Nobogent AI!` : title}
      </h1>
      <p style="margin: 0; font-size: 13px; color: rgba(255,255,255,0.85); font-weight: 500;">
        Created automatically for <strong>${businessName}</strong>
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding: 28px 24px;">
      
      <!-- Graphic Display -->
      <div style="margin-bottom: 24px; text-align: center;">
        <a href="${creativeUrl}" target="_blank" style="text-decoration: none;">
          <img 
            src="${creativeUrl}" 
            alt="Generated Marketing Creative" 
            style="width: 100%; max-width: 440px; height: auto; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 8px 24px rgba(0,0,0,0.08); display: inline-block;" 
          />
        </a>
      </div>

      <!-- Action Buttons -->
      <div style="text-align: center; margin-bottom: 28px;">
        <a href="${creativeUrl}" target="_blank" style="display: inline-block; padding: 13px 26px; background: #0f172a; color: #ffffff; text-decoration: none; border-radius: 12px; font-size: 13px; font-weight: 800; margin: 4px; box-shadow: 0 4px 12px rgba(15,23,42,0.15);">
          ⬇️ Download High-Res Poster
        </a>
        <a href="https://app.nobogent.com/dashboard/assets" target="_blank" style="display: inline-block; padding: 13px 26px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 12px; font-size: 13px; font-weight: 800; margin: 4px;">
          🚀 Open in Studio
        </a>
      </div>

      <!-- Marketing Caption Box -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 24px;">
        <span style="display: block; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
          📝 Recommended Post Caption
        </span>
        <div style="font-size: 13px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; font-weight: 500;">${caption}</div>
      </div>

      <!-- Instant Revision Instructions -->
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 14px; padding: 16px; text-align: left;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span style="font-size: 16px;">💬</span>
          <strong style="font-size: 13px; color: #166534;">Instant WhatsApp Revisions:</strong>
        </div>
        <p style="margin: 0; font-size: 12px; color: #15803d; line-height: 1.5;">
          You also received this creative on your connected WhatsApp. Simply reply with any changes (e.g. <em>"change price"</em>, <em>"highlight metro connectivity"</em>) and our AI will regenerate it immediately!
        </p>
      </div>

    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #f1f5f9; padding: 20px; text-align: center; color: #94a3b8; font-size: 11px; font-weight: 600;">
      Sent automatically by Nobogent Autonomous Creative Engine<br/>
      <a href="https://app.nobogent.com" style="color: #64748b; text-decoration: underline;">Nobogent AI Studio</a>
    </div>

  </div>
</body>
</html>
      `;

      const info = await transporter.sendMail({
        from: `"${businessName || 'Nobogent AI Studio'}" <no-reply@mail.nobogent.com>`,
        to: recipientEmail,
        subject,
        html: emailHtml
      });

      results.emailSent = true;
      console.log(`[Creative Dispatcher] ✅ Email delivered to ${recipientEmail} (ID: ${info.messageId})`);
    } catch (emailErr: any) {
      console.error('[Creative Dispatcher] Email dispatch error:', emailErr);
      results.emailError = emailErr.message;
    }
  }

  return results;
}
