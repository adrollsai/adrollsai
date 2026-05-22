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
      from: `"${senderName}" <${process.env.SMTP_USER}>`,
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
      from: `"AdRolls AI Landing Page" <${process.env.SMTP_USER}>`,
      to: 'adrollsai@gmail.com',
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
              Sent automatically by AdRolls AI Platform
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