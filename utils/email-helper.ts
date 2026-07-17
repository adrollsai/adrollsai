import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendDistributionEmail(to: string, agentName: string, imageUrl: string, senderName: string) {
  try {
    const info = await transporter.sendMail({
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
    })
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendContactFormEmail(name: string, email: string, phone: string, message: string) {
  try {
    const info = await transporter.sendMail({
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
    })
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
}) {
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

    const info = await transporter.sendMail({
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
    });
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
  timeZone?: string
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

    const info = await transporter.sendMail({
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
              Nobogent AI Booking Platform
            </p>
          </div>
        </div>
      `,
    })
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
  timeZone?: string
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

    const info = await transporter.sendMail({
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
              Nobogent AI Booking Platform
            </p>
          </div>
        </div>
      `,
    })
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
  }
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

    const info = await transporter.sendMail({
      from: `"Nobogent CRM" <no-reply@mail.nobogent.com>`,
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
              Sent automatically by Nobogent CRM Platform
            </p>
          </div>
        </div>
      `,
    });
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
  adName?: string
) {
  try {
    if (!to) {
      return { success: false, error: "No recipient email provided" };
    }

    const campaignInfo = adName ? ` regarding <strong>${adName}</strong>` : '';

    const info = await transporter.sendMail({
      from: `"${businessName || 'Nobogent'}" <no-reply@mail.nobogent.com>`,
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
              Powered by Nobogent
            </p>
          </div>
        </div>
      `,
    });
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Lead AutoResponse Email Error:", error);
    return { success: false, error: error.message };
  }
}

export async function sendDailyEodReportEmail(to: string, businessName: string, htmlContent: string) {
  try {
    if (!to) {
      return { success: false, error: "No recipient email provided" };
    }

    const info = await transporter.sendMail({
      from: `"Nobogent Daily Analytics" <no-reply@mail.nobogent.com>`,
      to: to,
      subject: `📊 Daily EOD Operations Report: ${businessName}`,
      html: htmlContent,
    });
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
  timeLeftStr?: string
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

    const info = await transporter.sendMail({
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
    })
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
  timeZone?: string
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

    const info = await transporter.sendMail({
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
    })
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Reschedule Email Error:", error)
    return { success: false, error: error.message }
  }
}

export async function sendCancellationEmail(
  to: string,
  leadName: string,
  businessName: string
) {
  try {
    const info = await transporter.sendMail({
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
    })
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Cancellation Email Error:", error)
    return { success: false, error: error.message }
  }
}