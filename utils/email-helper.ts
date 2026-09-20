import nodemailer from 'nodemailer'

export function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.resend.com'
  const port = parseInt(process.env.SMTP_PORT || '465')
  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER || 'resend',
      pass: process.env.SMTP_PASS,
    },
  })
}

const transporter = {
  sendMail: (options: any) => getTransporter().sendMail(options)
}


export function resolveNotificationRecipients(profile: {
  email?: string | null;
  notification_email?: string | null;
  business_info?: string | any | null;
} | null | undefined) {
  if (!profile) {
    return { toEmail: '', bccEmail: undefined, notificationEmail: null, registeredEmail: null };
  }

  let notifEmail = profile.notification_email?.trim() || null;
  if (!notifEmail && profile.business_info) {
    try {
      const parsed = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : profile.business_info;
      if (parsed && typeof parsed.notification_email === 'string' && parsed.notification_email.trim()) {
        notifEmail = parsed.notification_email.trim();
      }
    } catch {}
  }

  const registeredEmail = profile.email?.trim() || null;
  const toEmail = notifEmail || registeredEmail || '';
  const bccEmail = (notifEmail && registeredEmail && notifEmail.toLowerCase() !== registeredEmail.toLowerCase())
    ? registeredEmail
    : undefined;

  return { toEmail, bccEmail, notificationEmail: notifEmail, registeredEmail };
}

export async function sendDistributionEmail(to: string, agentName: string, imageUrl: string, senderName: string, bcc?: string | string[]) {
  try {
    const mailOptions: any = {
      from: `"${senderName}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `New Marketing Asset for ${agentName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Hello ${agentName},</h2>
          <p>Here is your new personalized marketing graphic from <strong>${senderName}</strong>.</p>
          <p>You can download it below and share it immediately.</p>
          <br/>
          <a href="${imageUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">Download Graphic</a>
          <br/><br/>
          <img src="${imageUrl}" alt="Preview" style="width: 100%; border-radius: 8px; border: 1px solid #eee;" />
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendContactFormEmail(name: string, email: string, phone: string, message: string, bcc?: string | string[]) {
  try {
    const mailOptions: any = {
      from: `"Nobogent AI Landing Page" <no-reply@mail.nobogent.com>`,
      to: 'info@nobogent.com, rchopra489@gmail.com',
      subject: `New Lead Query from ${name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #003D6F; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #003D6F; padding-bottom: 12px;">New Contact Query</h2>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; width: 140px; color: #64748b; font-size: 14px; text-transform: uppercase;">Name:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${name}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Email:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;"><a href="mailto:${email}" style="color: #B22B31; text-decoration: none;">${email}</a></td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Phone:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${phone}</td>
            </tr>
            <tr>
              <td style="padding: 12px 8px; font-weight: bold; vertical-align: top; color: #64748b; font-size: 14px; text-transform: uppercase;">Message:</td>
              <td style="padding: 12px 8px; color: #334155; font-size: 15px; line-height: 1.6; white-space: pre-wrap; background-color: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9;">${message}</td>
            </tr>
          </table>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Sent automatically by Nobogent AI Platform
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendLandingPageLeadEmail(to: string[], leadDetails: {
  name: string,
  email?: string,
  phone: string,
  city?: string,
  source?: string,
  customQuestions?: Record<string, any>
}, bcc?: string | string[]) {
  try {
    if (!to || to.length === 0) {
      return { success: false, error: "No recipients provided" };
    }

    // Format custom questions answers as HTML list
    let customQuestionsHtml = '';
    if (leadDetails.customQuestions && Object.keys(leadDetails.customQuestions).length > 0) {
      // Filter out city and empty answers
      const customEntries = Object.entries(leadDetails.customQuestions).filter(([key, val]) => key !== 'city' && val);
      if (customEntries.length > 0) {
        customQuestionsHtml = '<div style="margin-top: 16px; border-top: 1px solid #f1f5f9; padding-top: 12px;">';
        customQuestionsHtml += '<h3 style="color: #64748b; font-size: 13px; text-transform: uppercase; margin: 0 0 8px 0; font-weight: bold;">Custom Fields / Answers:</h3>';
        customQuestionsHtml += '<ul style="list-style-type: none; padding-left: 0; margin: 0;">';
        for (const [key, value] of customEntries) {
          const displayKey = key.replace(/_/g, ' ').replace(/^custom question\s+/i, 'Question ');
          customQuestionsHtml += `<li style="margin-bottom: 6px; font-size: 14px; color: #334155;"><strong style="text-transform: capitalize; color: #64748b;">${displayKey}:</strong> ${value}</li>`;
        }
        customQuestionsHtml += '</ul></div>';
      }
    }

    const mailOptions: any = {
      from: `"Nobogent AI Landing Page" <no-reply@mail.nobogent.com>`,
      to: to.join(', '),
      subject: `New Landing Page Lead: ${leadDetails.name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #003D6F; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #003D6F; padding-bottom: 12px;">New Lead Captured</h2>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; width: 140px; color: #64748b; font-size: 14px; text-transform: uppercase;">Name:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.name}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Phone:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.phone}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Email:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">
                ${leadDetails.email ? `<a href="mailto:${leadDetails.email}" style="color: #B22B31; text-decoration: none;">${leadDetails.email}</a>` : 'Not provided'}
              </td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">City:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.city || 'Not provided'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Source:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.source || 'Landing Page'}</td>
            </tr>
          </table>
          ${customQuestionsHtml}
          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Sent automatically by Nobogent AI Platform
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Landing Page Lead Email Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendBookingConfirmationEmail(
  to: string,
  leadName: string,
  slot: string,
  meetLink: string,
  businessName: string,
  timeZone?: string,
  bcc?: string | string[]
) {
  try {
    const localDate = new Date(slot)
    const formattedDate = localDate.toLocaleString('en-US', {
      timeZone: timeZone || 'Asia/Kolkata',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    const mailOptions: any = {
      from: `"${businessName || 'Consultation'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `Booking Confirmed: Meeting with ${businessName || 'Us'}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #10b981; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #10b981; padding-bottom: 12px;">Booking Confirmed!</h2>
          </div>
          <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hi ${leadName},</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">Your meeting with <strong>${businessName || 'our team'}</strong> has been successfully booked.</p>
          
          <div style="background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; width: 100px;">Time:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${formattedDate}</td>
              </tr>
              ${meetLink ? `
              <tr>
                <td style="padding: 8px 0 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; vertical-align: top;">Video Link:</td>
                <td style="padding: 8px 0 4px 0; font-size: 15px;">
                  <a href="${meetLink}" style="color: #2563eb; text-decoration: underline; font-weight: bold;">Join Google Meet</a>
                  <br/>
                  <span style="font-size: 12px; color: #64748b; display: block; margin-top: 4px;">${meetLink}</span>
                </td>
              </tr>
              ` : ''}
            </table>
          </div>

          <p style="font-size: 14px; color: #64748b; line-height: 1.5; margin-top: 24px;">If you need to make changes or reschedule, please reach out to us directly.</p>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              ${businessName || 'Automated Booking System'}
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Booking Confirmation Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendBookingReminderEmail(
  to: string,
  isHost: boolean,
  leadName: string,
  slot: string,
  meetLink: string,
  businessName: string,
  timeZone?: string,
  bcc?: string | string[]
) {
  try {
    const localDate = new Date(slot)
    const formattedDate = localDate.toLocaleString('en-US', {
      timeZone: timeZone || 'Asia/Kolkata',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    const subject = isHost 
      ? `Reminder: Meeting with ${leadName} in 30 minutes`
      : `Reminder: Meeting with ${businessName || 'Us'} in 30 minutes`

    const contentTitle = isHost ? "Meeting Reminder" : "Upcoming Meeting Reminder"
    const contentText = isHost
      ? `You have an upcoming meeting with lead <strong>${leadName}</strong> in 30 minutes.`
      : `You have an upcoming meeting with <strong>${businessName || 'our team'}</strong> in 30 minutes.`

    const mailOptions: any = {
      from: `"${businessName || 'Meeting Reminder'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: subject,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #003D6F; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #003D6F; padding-bottom: 12px;">${contentTitle}</h2>
          </div>
          <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hello,</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">${contentText}</p>
          
          <div style="background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; width: 100px;">Time:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${formattedDate} (in 30 mins)</td>
              </tr>
              ${meetLink ? `
              <tr>
                <td style="padding: 8px 0 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; vertical-align: top;">Video Link:</td>
                <td style="padding: 8px 0 4px 0; font-size: 15px;">
                  <a href="${meetLink}" style="color: #2563eb; text-decoration: underline; font-weight: bold;">Join Google Meet</a>
                  <br/>
                  <span style="font-size: 12px; color: #64748b; display: block; margin-top: 4px;">${meetLink}</span>
                </td>
              </tr>
              ` : ''}
            </table>
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              ${businessName || 'Automated Booking System'}
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Booking Reminder Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendFacebookLeadEmail(
  to: string[],
  leadDetails: {
    name: string,
    email?: string,
    phone: string,
    formName?: string,
    adName?: string,
    customQuestions?: Record<string, any>
  },
  bcc?: string | string[]
) {
  try {
    if (!to || to.length === 0) {
      return { success: false, error: "No recipients provided" };
    }

    let customQuestionsHtml = '';
    if (leadDetails.customQuestions && Object.keys(leadDetails.customQuestions).length > 0) {
      customQuestionsHtml = '<div style="margin-top: 16px; border-top: 1px solid #f1f5f9; padding-top: 12px;">';
      customQuestionsHtml += '<h3 style="color: #64748b; font-size: 13px; text-transform: uppercase; margin: 0 0 8px 0; font-weight: bold;">Form Submissions / Answers:</h3>';
      customQuestionsHtml += '<ul style="list-style-type: none; padding-left: 0; margin: 0;">';
      for (const [key, value] of Object.entries(leadDetails.customQuestions)) {
        customQuestionsHtml += `<li style="margin-bottom: 6px; font-size: 14px; color: #334155;"><strong style="text-transform: capitalize; color: #64748b;">${key}:</strong> ${value}</li>`;
      }
      customQuestionsHtml += '</ul></div>';
    }

    const mailOptions: any = {
      from: `"Lead Alert" <no-reply@mail.nobogent.com>`,
      to: to.join(', '),
      subject: `🔥 New Facebook Lead: ${leadDetails.name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #003D6F; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #003D6F; padding-bottom: 12px;">New Facebook Lead</h2>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; width: 140px; color: #64748b; font-size: 14px; text-transform: uppercase;">Name:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.name}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Phone:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.phone}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Email:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">
                ${leadDetails.email ? `<a href="mailto:${leadDetails.email}" style="color: #B22B31; text-decoration: none;">${leadDetails.email}</a>` : 'Not provided'}
              </td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Form Name:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.formName || 'Facebook Lead Form'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 8px; font-weight: bold; color: #64748b; font-size: 14px; text-transform: uppercase;">Campaign/Ad:</td>
              <td style="padding: 12px 8px; color: #003D6F; font-weight: 600; font-size: 15px;">${leadDetails.adName || 'Facebook Ads'}</td>
            </tr>
          </table>
          ${customQuestionsHtml}
          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Sent automatically via Instant Lead Notification
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Facebook Lead Email Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendLeadAutoResponseEmail(
  to: string,
  leadName: string,
  businessName: string,
  adName?: string,
  bcc?: string | string[]
) {
  try {
    if (!to) {
      return { success: false, error: "No recipient email provided" };
    }

    const campaignInfo = adName ? ` regarding <strong>${adName}</strong>` : '';

    const mailOptions: any = {
      from: `"${businessName || 'Notification'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `Thank you for contacting ${businessName || 'us'}!`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #003D6F; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #003D6F; padding-bottom: 12px;">We Received Your Details!</h2>
          </div>
          <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hi ${leadName},</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">
            Thank you for reaching out to <strong>${businessName || 'our team'}</strong>${campaignInfo}. We have successfully received your query.
          </p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">
            One of our team members will review your details and get in touch with you shortly.
          </p>
          <div style="background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; font-size: 14px; color: #64748b; font-weight: 600;">
              No further action is required from your end. We'll speak with you soon!
            </p>
          </div>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              ${businessName || 'All Rights Reserved'}
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Auto Response Email Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendEodReportEmail(
  to: string,
  businessName: string,
  htmlContent: string,
  bcc?: string | string[]
) {
  try {
    if (!to) {
      return { success: false, error: "No recipient email provided" };
    }

    const mailOptions: any = {
      from: `"${businessName ? `${businessName} Analytics` : 'Daily Analytics'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `📊 Daily EOD Operations Report: ${businessName}`,
      html: htmlContent,
    };
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("EOD Report Email Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendReminderEmail(
  to: string,
  leadName: string,
  slot: string,
  meetLink: string,
  rescheduleLink: string,
  cancelLink: string,
  businessName: string,
  timeZone?: string,
  timeLeftStr?: string,
  bcc?: string | string[]
) {
  try {
    const localDate = new Date(slot)
    const formattedDate = localDate.toLocaleString('en-US', {
      timeZone: timeZone || 'Asia/Kolkata',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    const mailOptions: any = {
      from: `"${businessName || 'Consultation'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `⏰ Reminder: Meeting with ${businessName || 'Us'} in ${timeLeftStr || 'a few hours'}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #3b82f6; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #3b82f6; padding-bottom: 12px;">Meeting Reminder</h2>
          </div>
          <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hi ${leadName},</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">This is a reminder that you have a meeting scheduled with <strong>${businessName || 'our team'}</strong> in <strong>${timeLeftStr || 'some time'}</strong>.</p>
          
          <div style="background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; width: 100px;">Time:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${formattedDate}</td>
              </tr>
              ${meetLink ? `
              <tr>
                <td style="padding: 8px 0 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; vertical-align: top;">Video Link:</td>
                <td style="padding: 8px 0 4px 0; font-size: 15px;">
                  <a href="${meetLink}" style="color: #2563eb; text-decoration: underline; font-weight: bold;">Join Google Meet</a>
                  <br/>
                  <span style="font-size: 12px; color: #64748b; display: block; margin-top: 4px;">${meetLink}</span>
                </td>
              </tr>
              ` : ''}
            </table>
          </div>

          <div style="margin: 24px 0 16px 0; text-align: center; display: flex; justify-content: center; gap: 12px;">
            <a href="${rescheduleLink}" style="display: inline-block; padding: 10px 20px; background-color: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; margin-right: 10px;">Reschedule Meeting</a>
            <a href="${cancelLink}" style="display: inline-block; padding: 10px 20px; background-color: #ef4444; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Cancel Meeting</a>
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Nobogent AI Booking Platform
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Reminder Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendRescheduledEmail(
  to: string,
  leadName: string,
  slot: string,
  meetLink: string,
  rescheduleLink: string,
  cancelLink: string,
  businessName: string,
  timeZone?: string,
  bcc?: string | string[]
) {
  try {
    const localDate = new Date(slot)
    const formattedDate = localDate.toLocaleString('en-US', {
      timeZone: timeZone || 'Asia/Kolkata',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })

    const mailOptions: any = {
      from: `"${businessName || 'Consultation'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `🔄 Meeting Rescheduled: ${businessName || 'Us'}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #f59e0b; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #f59e0b; padding-bottom: 12px;">Meeting Rescheduled</h2>
          </div>
          <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hi ${leadName},</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">Your appointment with <strong>${businessName || 'our team'}</strong> has been successfully rescheduled to the new time slot below.</p>
          
          <div style="background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; width: 100px;">New Time:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${formattedDate}</td>
              </tr>
              ${meetLink ? `
              <tr>
                <td style="padding: 8px 0 4px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; vertical-align: top;">Video Link:</td>
                <td style="padding: 8px 0 4px 0; font-size: 15px;">
                  <a href="${meetLink}" style="color: #2563eb; text-decoration: underline; font-weight: bold;">Join Google Meet</a>
                  <br/>
                  <span style="font-size: 12px; color: #64748b; display: block; margin-top: 4px;">${meetLink}</span>
                </td>
              </tr>
              ` : ''}
            </table>
          </div>

          <div style="margin: 24px 0 16px 0; text-align: center; display: flex; justify-content: center; gap: 12px;">
            <a href="${rescheduleLink}" style="display: inline-block; padding: 10px 20px; background-color: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; margin-right: 10px;">Reschedule Again</a>
            <a href="${cancelLink}" style="display: inline-block; padding: 10px 20px; background-color: #ef4444; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Cancel Meeting</a>
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Nobogent AI Booking Platform
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Reschedule Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendCancellationEmail(
  to: string,
  leadName: string,
  businessName: string,
  bcc?: string | string[]
) {
  try {
    const mailOptions: any = {
      from: `"${businessName || 'Consultation'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `❌ Meeting Cancelled: ${businessName || 'Us'}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #ef4444; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #ef4444; padding-bottom: 12px;">Meeting Cancelled</h2>
          </div>
          <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hi ${leadName},</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">This email confirms that your scheduled meeting with <strong>${businessName || 'our team'}</strong> has been cancelled.</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">If this was a mistake or you wish to schedule a new consultation in the future, you are welcome to book with us again anytime.</p>
          
          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 32px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Nobogent AI Booking Platform
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Cancellation Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendConnectExpertNotificationEmail(
  to: string,
  businessName: string,
  leadName: string,
  leadPhone: string,
  bcc?: string | string[]
) {
  try {
    if (!to) {
      return { success: false, error: "No recipient email provided" };
    }

    const mailOptions: any = {
      from: `"Nobogent Alerts" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `☎️ Lead Callback Requested: Connect with Expert`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #b91c1c; margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #b91c1c; padding-bottom: 12px;">Expert Callback Request</h2>
          </div>
          <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hello,</p>
          <p style="font-size: 15px; color: #475569; line-height: 1.5;">
            A lead has requested to connect with an expert immediately regarding <strong>${businessName}</strong>. Please reach out to them on call as soon as possible.
          </p>
          
          <div style="background-color: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase; width: 120px;">Lead Name:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a; font-size: 15px;">${leadName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; font-weight: bold; color: #64748b; font-size: 13px; text-transform: uppercase;">Phone Number:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a; font-size: 15px;">
                  <a href="tel:${leadPhone}" style="color: #2563eb; text-decoration: none;">${leadPhone}</a>
                </td>
              </tr>
            </table>
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; margin-top: 24px;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Nobogent AI Notification Alerts
            </p>
          </div>
        </div>
      `,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Connect Expert Email Notification Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendGenericEmail(to: string, subject: string, html: string, bcc?: string | string[]) {
  try {
    if (!to) return { success: false, error: 'No recipient email provided' };
    const mailOptions: any = {
      from: `"Nobogent Alerts" <no-reply@mail.nobogent.com>`,
      to,
      subject,
      html
    };
    if (bcc) mailOptions.bcc = bcc;
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Generic Email Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendLeadNotificationEmail({
  to,
  subject,
  leadName,
  leadPhone,
  businessName,
  templateName,
  campaignName,
  buttonClicked,
  customBody,
  crmUrl,
  chatUrl,
  bcc
}: {
  to: string | string[];
  subject?: string;
  leadName: string;
  leadPhone: string;
  businessName?: string;
  templateName?: string;
  campaignName?: string;
  buttonClicked?: string;
  customBody?: string;
  crmUrl?: string;
  chatUrl?: string;
  bcc?: string | string[];
}) {
  try {
    const recipients = Array.isArray(to) ? to.filter(Boolean).join(', ') : to;
    if (!recipients) return { success: false, error: 'No recipient email provided' };

    const emailSubject = subject || `🔥 New Interested Lead: ${leadName} (${leadPhone}) - ${businessName || 'Nobogent'}`;
    const cleanDigits = leadPhone.replace(/\D/g, '');
    const waChatLink = cleanDigits ? `https://wa.me/${cleanDigits}` : null;
    const callLink = leadPhone ? `tel:${leadPhone}` : null;

    const htmlContent = customBody ? `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
        <div style="margin-bottom: 20px;">
          <h2 style="color: #0f172a; margin: 0; font-size: 20px; font-weight: 800;">${emailSubject}</h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">${businessName || 'Sales Notification'}</p>
        </div>
        <div style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap; background-color: #f8fafc; border-radius: 12px; padding: 16px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
${customBody}
        </div>
        <div style="margin-top: 16px;">
          ${waChatLink ? `<a href="${waChatLink}" style="display: inline-block; padding: 10px 18px; background-color: #25D366; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 13px; margin-right: 8px;">Open WhatsApp</a>` : ''}
          ${crmUrl ? `<a href="${crmUrl}" style="display: inline-block; padding: 10px 18px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 13px;">View in CRM</a>` : ''}
        </div>
      </div>
    ` : `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <div style="border-bottom: 2px solid #6366f1; padding-bottom: 16px; margin-bottom: 24px;">
          <div style="display: inline-block; padding: 4px 10px; background-color: #eef2ff; color: #4f46e5; border-radius: 6px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
            WhatsApp Automation Alert
          </div>
          <h2 style="color: #0f172a; margin: 0; font-size: 22px; font-weight: 900; letter-spacing: -0.02em;">
            🔥 Lead Clicked "${buttonClicked || 'Interested'}"!
          </h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">
            ${businessName || 'Our Workspace'} • Handled automatically via Flow Builder
          </p>
        </div>

        <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 12px; font-weight: bold; text-transform: uppercase; width: 130px;">Lead Name</td>
              <td style="padding: 6px 0; color: #0f172a; font-size: 16px; font-weight: 800;">${leadName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 12px; font-weight: bold; text-transform: uppercase;">Phone Number</td>
              <td style="padding: 6px 0; color: #0f172a; font-size: 16px; font-weight: 800; font-family: monospace;">${leadPhone}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 12px; font-weight: bold; text-transform: uppercase;">Button Clicked</td>
              <td style="padding: 6px 0; color: #16a34a; font-size: 14px; font-weight: 700;">✅ ${buttonClicked || 'Interested'}</td>
            </tr>
            ${templateName ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 12px; font-weight: bold; text-transform: uppercase;">Template Name</td>
              <td style="padding: 6px 0; color: #4f46e5; font-size: 14px; font-weight: 800; font-family: monospace;">${templateName}</td>
            </tr>
            ` : ''}
            ${campaignName ? `
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 12px; font-weight: bold; text-transform: uppercase;">Campaign / Flow</td>
              <td style="padding: 6px 0; color: #475569; font-size: 13px; font-weight: 600;">${campaignName}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 12px; font-weight: bold; text-transform: uppercase;">Captured At</td>
              <td style="padding: 6px 0; color: #475569; font-size: 13px;">${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px; text-align: center;">
          <p style="font-size: 13px; color: #475569; margin-bottom: 14px; font-weight: 500;">
            The catalogue link was automatically delivered to the prospect on WhatsApp. Follow up promptly to convert:
          </p>
          <div style="display: inline-block;">
            ${waChatLink ? `<a href="${waChatLink}" style="display: inline-block; padding: 12px 22px; background-color: #25D366; color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 800; font-size: 13px; margin: 4px; box-shadow: 0 2px 5px rgba(37, 211, 102, 0.2);">💬 Chat on WhatsApp</a>` : ''}
            ${callLink ? `<a href="${callLink}" style="display: inline-block; padding: 12px 22px; background-color: #0f172a; color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 800; font-size: 13px; margin: 4px;">📞 Call ${leadPhone}</a>` : ''}
            ${crmUrl ? `<a href="${crmUrl}" style="display: inline-block; padding: 12px 22px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 800; font-size: 13px; margin: 4px;">🚀 Open Lead in CRM</a>` : ''}
          </div>
        </div>

        <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; text-align: center; color: #94a3b8; font-size: 11px; font-weight: 600;">
          Sent automatically by Nobogent AI Marketing & Flow Builder Engine
        </div>
      </div>
    `;

    const mailOptions: any = {
      from: `"${businessName || 'Nobogent CRM'}" <no-reply@mail.nobogent.com>`,
      to: recipients,
      subject: emailSubject,
      html: htmlContent
    };
    if (bcc) mailOptions.bcc = bcc;

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error('[Email Helper] Error sending lead notification email:', error);
    return { success: false, error: error.message };
  }
}

export async function sendFollowupReminderEmail(
  toEmail: string,
  agentName: string,
  leadName: string,
  leadPhone: string,
  followupType: string,
  followupDate: string,
  remarks: string
) {
  // Follow-up reminder emails to agents are disabled per system policy
  console.log(`[Followup Email] Followup reminder emails to agents are disabled. Skipped sending email to ${toEmail} for lead ${leadName}.`);
  return { success: true, message: 'Followup reminder emails are disabled' };
}

export async function sendLeadTransferEmail(to: string, agentName: string, senderName: string, leadCount: number, bcc?: string | string[]) {
  try {
    const mailOptions: any = {
      from: '"Nobogent CRM" <no-reply@mail.nobogent.com>',
      to: to,
      subject: `🎯 ${leadCount} Lead(s) Transferred to You on Nobogent CRM`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 20px;">
          <h2 style="color: #2563eb;">🎯 New Leads Transferred</h2>
          <p>Hi <strong>${agentName}</strong>,</p>
          <p><strong>${senderName}</strong> has assigned <strong>${leadCount} lead(s)</strong> to your CRM account.</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; margin: 15px 0;">
            <p style="margin: 0; font-size: 14px; font-weight: bold; color: #475569;">Total Transferred Records: ${leadCount}</p>
          </div>
          <p><a href="https://app.nobogent.com/dashboard/crm" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 10px; font-weight: bold;">View Leads in CRM</a></p>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">Nobogent CRM Notifications</p>
        </div>
      `
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Lead Transfer Email Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendDailyEodReportEmail(to: string, businessName: string, emailHtml: string, bcc?: string | string[]) {
  try {
    const mailOptions: any = {
      from: `"${businessName || 'CRM Reporting'}" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `Daily CRM EOD Performance Report - ${businessName || 'Workspace'}`,
      html: emailHtml,
    }
    if (bcc) mailOptions.bcc = bcc
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("EOD Email Error:", error)
    return { success: false, error: error.message }
  }
}

